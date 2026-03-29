import { prisma } from '@seal/db';
import { env, serviceUrls } from '@seal/config';
import { buildService, requestJson } from '@seal/shared';
import { EventBus } from '@seal/events';
import { events } from '@seal/contracts';

const app = await buildService('payment-service');
const bus = new EventBus();

function fakeMpesaRef(prefix: string) {
  return `${prefix}${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
}

async function createInboundPayment(jobId: string, phone: string, amount: number, type: 'c2b' | 'stk_push') {
  const mpesaRef = fakeMpesaRef(type === 'c2b' ? 'C2B' : 'STK');
  const payment = await prisma.payment.create({
    data: {
      jobId,
      type,
      direction: 'inbound',
      mpesaRef,
      phone,
      amount,
      status: 'confirmed',
      rawPayload: { source: 'simulated' }
    }
  });

  return payment;
}

app.post('/webhook/mpesa/validation', async () => {
  return { ResultCode: 0, ResultDesc: 'Accepted' };
});

app.post('/webhook/mpesa/confirmation', async (req, reply) => {
  const body = req.body as { jobId: string; phone: string; amount: number; mpesaRef?: string };
  const job = await prisma.job.findUnique({ where: { id: body.jobId } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }

  const mpesaRef = body.mpesaRef ?? fakeMpesaRef('C2B');
  try {
    await prisma.payment.create({
      data: {
        jobId: body.jobId,
        type: 'c2b',
        direction: 'inbound',
        mpesaRef,
        phone: body.phone,
        amount: body.amount,
        status: 'confirmed',
        rawPayload: body as unknown as object
      }
    });
  } catch {
    return { ResultCode: 0, ResultDesc: 'Duplicate ignored' };
  }

  await bus.publish(events.PAYMENT_DEPOSIT_CONFIRMED, {
    jobId: body.jobId,
    mpesaRef,
    amount: body.amount,
    phone: body.phone
  });

  return { ResultCode: 0, ResultDesc: 'Success' };
});

app.post('/webhook/mpesa/stk-callback', async (req) => {
  const body = req.body as { jobId: string; phone: string; amount: number; success: boolean };
  if (!body.success) {
    const job = await prisma.job.findUnique({ where: { id: body.jobId } });
    const purpose = job?.state === 'RELEASING' ? 'balance' : 'deposit';
    await bus.publish(events.PAYMENT_STK_FAILED, {
      jobId: body.jobId,
      phone: body.phone,
      amount: body.amount,
      purpose,
      retries: 0
    });
    return { ResultCode: 0, ResultDesc: 'Handled failed STK' };
  }

  const payment = await createInboundPayment(body.jobId, body.phone, body.amount, 'stk_push');
  const job = await prisma.job.findUnique({ where: { id: body.jobId } });
  if (!job) {
    return { ResultCode: 0, ResultDesc: 'Job missing' };
  }

  if (job.state === 'AWAITING_DEPOSIT') {
    await bus.publish(events.PAYMENT_DEPOSIT_CONFIRMED, {
      jobId: body.jobId,
      mpesaRef: payment.mpesaRef,
      amount: body.amount,
      phone: body.phone
    });
  }

  if (job.state === 'RELEASING') {
    await bus.publish(events.PAYMENT_BALANCE_CONFIRMED, {
      jobId: body.jobId,
      mpesaRef: payment.mpesaRef,
      amount: body.amount,
      phone: body.phone
    });
  }

  return { ResultCode: 0, ResultDesc: 'STK callback handled' };
});

app.post('/webhook/mpesa/b2c-result', async (req) => {
  const body = req.body as { jobId: string; phone: string; amount: number; mpesaRef?: string };
  const mpesaRef = body.mpesaRef ?? fakeMpesaRef('B2C');

  try {
    await prisma.payment.create({
      data: {
        jobId: body.jobId,
        type: 'b2c',
        direction: 'outbound',
        mpesaRef,
        phone: body.phone,
        amount: body.amount,
        status: 'confirmed',
        rawPayload: body as unknown as object
      }
    });
  } catch {
    return { ResultCode: 0, ResultDesc: 'Duplicate ignored' };
  }

  await bus.publish(events.PAYMENT_B2C_CONFIRMED, {
    jobId: body.jobId,
    mpesaRef,
    amount: body.amount,
    phone: body.phone
  });

  return { ResultCode: 0, ResultDesc: 'Success' };
});

app.post('/api/payments/stk-push', async (req) => {
  const body = req.body as { jobId: string; phone: string; amount: number; purpose: 'deposit' | 'balance' };
  const payment = await createInboundPayment(body.jobId, body.phone, body.amount, 'stk_push');

  if (body.purpose === 'deposit') {
    await bus.publish(events.PAYMENT_DEPOSIT_CONFIRMED, {
      jobId: body.jobId,
      mpesaRef: payment.mpesaRef,
      amount: body.amount,
      phone: body.phone
    });
  } else {
    await bus.publish(events.PAYMENT_BALANCE_CONFIRMED, {
      jobId: body.jobId,
      mpesaRef: payment.mpesaRef,
      amount: body.amount,
      phone: body.phone
    });
  }

  return { ok: true, mpesaRef: payment.mpesaRef };
});

app.post('/api/payments/b2c', async (req) => {
  const body = req.body as { jobId: string; phone: string; amount: number };
  const mpesaRef = fakeMpesaRef('B2C');
  await prisma.payment.create({
    data: {
      jobId: body.jobId,
      type: 'b2c',
      direction: 'outbound',
      mpesaRef,
      phone: body.phone,
      amount: body.amount,
      status: 'confirmed',
      rawPayload: body as unknown as object
    }
  });
  await bus.publish(events.PAYMENT_B2C_CONFIRMED, { jobId: body.jobId, amount: body.amount, phone: body.phone, mpesaRef });
  return { ok: true, mpesaRef };
});

app.get('/api/payments/:mpesaRef', async (req, reply) => {
  const params = req.params as { mpesaRef: string };
  const payment = await prisma.payment.findUnique({ where: { mpesaRef: params.mpesaRef } });
  if (!payment) {
    return reply.code(404).send({ message: 'Payment not found' });
  }
  return { payment };
});

bus.consume('payment-service', {
  [events.JOB_ACCEPTED]: async (payload) => {
    const jobId = String(payload.jobId);
    const amount = Number(payload.amount);
    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { client: true } });
    if (!job) {
      return;
    }

    await app.inject({
      method: 'POST',
      url: '/api/payments/stk-push',
      payload: {
        jobId,
        phone: job.client.phone,
        amount,
        purpose: 'deposit'
      }
    });
  },
  [events.JOB_APPROVED]: async (payload) => {
    const jobId = String(payload.jobId);
    const amount = Number(payload.amount);
    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { client: true } });
    if (!job) {
      return;
    }

    await app.inject({
      method: 'POST',
      url: '/api/payments/stk-push',
      payload: {
        jobId,
        phone: job.client.phone,
        amount,
        purpose: 'balance'
      }
    });
  },
  [events.PAYMENT_BALANCE_CONFIRMED]: async (payload) => {
    const jobId = String(payload.jobId);
    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { artisan: true } });
    if (!job) {
      return;
    }
    const payout = Math.round(job.totalAmount * (1 - env.PLATFORM_FEE_PCT / 100));
    await app.inject({
      method: 'POST',
      url: '/api/payments/b2c',
      payload: {
        jobId,
        phone: job.artisan.phone,
        amount: payout
      }
    });
  },
  [events.DISPUTE_RESOLVED]: async (payload) => {
    const jobId = String(payload.jobId);
    const resolution = String(payload.resolution);
    const splitArtisanPct = Number(payload.splitArtisanPct ?? 0);
    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { artisan: true, client: true } });
    if (!job) {
      return;
    }

    if (resolution === 'artisan_full') {
      const payout = Math.round(job.totalAmount * (1 - env.PLATFORM_FEE_PCT / 100));
      await app.inject({ method: 'POST', url: '/api/payments/b2c', payload: { jobId, phone: job.artisan.phone, amount: payout } });
      return;
    }

    if (resolution === 'client_full') {
      await app.inject({ method: 'POST', url: '/api/payments/b2c', payload: { jobId, phone: job.client.phone, amount: job.totalAmount } });
      return;
    }

    const artisanAmount = Math.round(job.totalAmount * (splitArtisanPct / 100));
    const clientAmount = job.totalAmount - artisanAmount;
    if (artisanAmount > 0) {
      await app.inject({ method: 'POST', url: '/api/payments/b2c', payload: { jobId, phone: job.artisan.phone, amount: artisanAmount } });
    }
    if (clientAmount > 0) {
      await app.inject({ method: 'POST', url: '/api/payments/b2c', payload: { jobId, phone: job.client.phone, amount: clientAmount } });
    }
  },
  [events.PAYMENT_STK_FAILED]: async (payload) => {
    const retries = Number(payload.retries ?? 0);
    if (retries >= 1) {
      await bus.publish(events.PAYMENT_STK_FAILED_FINAL, payload);
      return;
    }

    await requestJson<{ jobId: string }>(`${serviceUrls.scheduler}/api/scheduler/timers`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'stk.retry',
        delayMs: 10 * 60 * 1000,
        payload: {
          jobId: String(payload.jobId),
          phone: String(payload.phone),
          amount: Number(payload.amount),
          purpose: String(payload.purpose ?? 'deposit'),
          retries: retries + 1
        }
      })
    });
  },
  [events.TIMER_STK_RETRY_FIRED]: async (payload) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/stk-push',
      payload: {
        jobId: String(payload.jobId),
        phone: String(payload.phone),
        amount: Number(payload.amount),
        purpose: String(payload.purpose ?? 'deposit')
      }
    });

    if (response.statusCode >= 400) {
      await bus.publish(events.PAYMENT_STK_FAILED_FINAL, payload);
    }
  }
}).catch((error) => app.log.error(error));

await app.listen({ port: env.PAYMENT_SERVICE_PORT, host: '0.0.0.0' });

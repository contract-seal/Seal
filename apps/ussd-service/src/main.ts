import { Redis } from 'ioredis';
import { prisma } from '@seal/db';
import { env } from '@seal/config';
import { buildService } from '@seal/shared';
import { EventBus } from '@seal/events';
import { events } from '@seal/contracts';

const app = await buildService('ussd-service');
const redis = new Redis(env.REDIS_URL);
const bus = new EventBus();

type SessionState = {
  step: 'main' | 'balance_ref' | 'delivery_ref' | 'delivery_confirm' | 'reputation' | 'approve_ref' | 'approve_confirm';
  jobRef?: string;
};

function con(text: string) {
  return `CON ${text}`;
}

function end(text: string) {
  return `END ${text}`;
}

async function readState(sessionId: string): Promise<SessionState> {
  const raw = await redis.get(`ussd:session:${sessionId}`);
  if (!raw) {
    return { step: 'main' };
  }
  return JSON.parse(raw) as SessionState;
}

async function writeState(sessionId: string, value: SessionState) {
  await redis.set(`ussd:session:${sessionId}`, JSON.stringify(value), 'EX', 90);
}

async function findUserByPhone(phone: string) {
  return prisma.user.findUnique({ where: { phone } });
}

app.post('/ussd/callback', async (req, reply) => {
  const body = req.body as {
    sessionId: string;
    phoneNumber: string;
    serviceCode: string;
    text: string;
  };

  const state = await readState(body.sessionId);
  const input = body.text.split('*').pop() ?? '';
  const user = await findUserByPhone(body.phoneNumber);

  if (!user) {
    return reply.type('text/plain').send(end('User not registered. Request OTP login first.'));
  }

  if (state.step === 'main') {
    if (!body.text) {
      await writeState(body.sessionId, { step: 'main' });
      return reply.type('text/plain').send(con('1. Check escrow balance\n2. Confirm job delivery\n3. Check my reputation score\n4. Approve delivery\n0. Exit'));
    }
    if (input === '1') {
      await writeState(body.sessionId, { step: 'balance_ref' });
      return reply.type('text/plain').send(con('Enter job reference: JOB-XXXXX'));
    }
    if (input === '2') {
      if (user.role !== 'artisan') {
        return reply.type('text/plain').send(end('Only artisans can submit delivery.'));
      }
      await writeState(body.sessionId, { step: 'delivery_ref' });
      return reply.type('text/plain').send(con('Enter job reference'));
    }
    if (input === '3') {
      const latest = await prisma.reputationScore.findFirst({
        where: { artisanId: user.id },
        orderBy: { computedAt: 'desc' }
      });
      const score = latest?.score ?? 0;
      return reply.type('text/plain').send(end(`Score: ${score}/100 (${user.tier}) | Jobs: ${latest?.jobsCompleted ?? 0} | On-time: ${Number(latest?.onTimeRate ?? 0).toFixed(1)}%`));
    }
    if (input === '4') {
      if (user.role !== 'client') {
        return reply.type('text/plain').send(end('Only clients can approve delivery.'));
      }
      await writeState(body.sessionId, { step: 'approve_ref' });
      return reply.type('text/plain').send(con('Enter job reference'));
    }
    return reply.type('text/plain').send(end('Goodbye'));
  }

  if (state.step === 'balance_ref') {
    const job = await prisma.job.findFirst({ where: { refCode: input } });
    if (!job) {
      return reply.type('text/plain').send(end('Job not found'));
    }
    const credits = await prisma.escrowLedger.aggregate({ where: { jobId: job.id, type: 'credit' }, _sum: { amount: true } });
    const debits = await prisma.escrowLedger.aggregate({ where: { jobId: job.id, type: 'debit' }, _sum: { amount: true } });
    const balance = (credits._sum.amount ?? 0) - (debits._sum.amount ?? 0);
    return reply.type('text/plain').send(end(`Job: ${job.title} | Escrow: Ksh ${(balance / 100).toFixed(2)} | State: ${job.state}`));
  }

  if (state.step === 'delivery_ref') {
    const job = await prisma.job.findFirst({ where: { refCode: input, artisanId: user.id } });
    if (!job) {
      return reply.type('text/plain').send(end('Job not found'));
    }
    await writeState(body.sessionId, { step: 'delivery_confirm', jobRef: input });
    return reply.type('text/plain').send(con(`Confirm delivery for ${job.title}? 1=Yes 2=No`));
  }

  if (state.step === 'delivery_confirm') {
    if (input !== '1') {
      return reply.type('text/plain').send(end('Cancelled'));
    }
    const job = await prisma.job.findFirst({ where: { refCode: state.jobRef, artisanId: user.id } });
    if (!job) {
      return reply.type('text/plain').send(end('Job not found'));
    }
    await prisma.job.update({
      where: { id: job.id },
      data: { state: 'PENDING_APPROVAL', deliveredAt: new Date(), deliveryNotes: 'USSD delivery confirmation' }
    });
    await bus.publish(events.JOB_DELIVERED, { jobId: job.id, clientId: job.clientId, source: 'ussd' });
    return reply.type('text/plain').send(end('Delivery submitted. Client has 48hrs to approve.'));
  }

  if (state.step === 'approve_ref') {
    const job = await prisma.job.findFirst({ where: { refCode: input, clientId: user.id } });
    if (!job) {
      return reply.type('text/plain').send(end('Job not found'));
    }
    await writeState(body.sessionId, { step: 'approve_confirm', jobRef: input });
    return reply.type('text/plain').send(con(`Approve ${job.title}? Ksh ${(Math.ceil(job.totalAmount / 2) / 100).toFixed(2)} will be charged.\n1=Approve 2=Cancel`));
  }

  if (state.step === 'approve_confirm') {
    if (input !== '1') {
      return reply.type('text/plain').send(end('Cancelled'));
    }
    const job = await prisma.job.findFirst({ where: { refCode: state.jobRef, clientId: user.id } });
    if (!job) {
      return reply.type('text/plain').send(end('Job not found'));
    }
    await prisma.job.update({ where: { id: job.id }, data: { state: 'RELEASING' } });
    await bus.publish(events.JOB_APPROVED, { jobId: job.id, amount: Math.ceil(job.totalAmount / 2), clientId: job.clientId, source: 'ussd' });
    return reply.type('text/plain').send(end('Approved. STK Push sent.'));
  }

  return reply.type('text/plain').send(end('Session ended'));
});

app.post('/api/ussd/callback', async (req, reply) => {
  return app.inject({ method: 'POST', url: '/ussd/callback', payload: req.body as Record<string, unknown> }).then((res) => {
    reply.type('text/plain').send(res.body);
  });
});

await app.listen({ port: env.USSD_SERVICE_PORT, host: '0.0.0.0' });

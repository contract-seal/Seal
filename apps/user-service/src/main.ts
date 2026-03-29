import { buildService, authGuard, roleGuard, requestJson } from '@seal/shared';
import { env, serviceUrls } from '@seal/config';
import { prisma } from '@seal/db';
import { EventBus } from '@seal/events';
import { events } from '@seal/contracts';

const app = await buildService('user-service');
const bus = new EventBus();

async function scheduleIprsRetry(phone: string, attempt: number) {
  await requestJson<{ jobId: string }>(`${serviceUrls.scheduler}/api/scheduler/timers`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'iprs.retry',
      delayMs: 30 * 60 * 1000,
      payload: { phone, attempt }
    })
  });
}

async function verifyIprs(name: string, nationalId: string): Promise<{ matched: boolean; unavailable: boolean }> {
  if (!env.IPRS_API_URL) {
    return { matched: false, unavailable: true };
  }

  try {
    const res = await fetch(env.IPRS_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.IPRS_API_KEY ? { authorization: `Bearer ${env.IPRS_API_KEY}` } : {})
      },
      body: JSON.stringify({ name, nationalId })
    });

    if (res.status >= 500) {
      return { matched: false, unavailable: true };
    }
    if (!res.ok) {
      return { matched: false, unavailable: false };
    }

    const body = (await res.json()) as { matched?: boolean };
    return { matched: Boolean(body.matched), unavailable: false };
  } catch {
    return { matched: false, unavailable: true };
  }
}

app.post('/api/users/artisan/apply', async (req, reply) => {
  const body = req.body as {
    name: string;
    phone: string;
    nationalId: string;
    trade: string;
    county: string;
  };

  const iprs = await verifyIprs(body.name, body.nationalId);
  const status = iprs.matched ? 'pending' : 'pending_iprs_check';

  const user = await prisma.user.upsert({
    where: { phone: body.phone },
    update: {
      name: body.name,
      nationalId: body.nationalId,
      trade: body.trade,
      county: body.county,
      role: 'artisan',
      iprsVerified: iprs.matched,
      status
    },
    create: {
      name: body.name,
      phone: body.phone,
      nationalId: body.nationalId,
      trade: body.trade,
      county: body.county,
      role: 'artisan',
      iprsVerified: iprs.matched,
      status
    }
  });

  if (iprs.unavailable) {
    await scheduleIprsRetry(user.phone, 1);
  }

  return reply.send({ user });
});

app.get('/api/users/:id', { preHandler: [authGuard] }, async (req, reply) => {
  const params = req.params as { id: string };
  if (req.auth?.role !== 'admin' && req.auth?.userId !== params.id) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) {
    return reply.code(404).send({ message: 'User not found' });
  }
  return reply.send({ user });
});

app.put('/api/users/:id/tier', { preHandler: [authGuard, roleGuard(['admin'])] }, async (req, reply) => {
  const params = req.params as { id: string };
  const body = req.body as { tier: 'new' | 'standard' | 'trusted' | 'elite' };
  const user = await prisma.user.update({
    where: { id: params.id },
    data: { tier: body.tier }
  });
  return reply.send({ user });
});

app.post('/api/users/artisan/:id/approve', { preHandler: [authGuard, roleGuard(['admin'])] }, async (req, reply) => {
  const params = req.params as { id: string };
  const body = req.body as { approved: boolean; reason?: string };

  const status = body.approved ? 'active' : 'suspended';
  const user = await prisma.user.update({
    where: { id: params.id },
    data: { status, iprsVerified: body.approved }
  });

  if (body.approved) {
    await bus.publish(events.USER_ARTISAN_APPROVED, { artisanId: user.id, phone: user.phone });
  } else {
    await bus.publish(events.USER_ARTISAN_REJECTED, { artisanId: user.id, phone: user.phone, reason: body.reason ?? '' });
  }

  return reply.send({ user });
});

app.get('/api/users/artisan/:id/reputation', async (req, reply) => {
  const params = req.params as { id: string };
  const latest = await prisma.reputationScore.findFirst({
    where: { artisanId: params.id },
    orderBy: { computedAt: 'desc' }
  });
  return reply.send({
    artisanId: params.id,
    score: latest?.score ?? 0,
    jobsCompleted: latest?.jobsCompleted ?? 0,
    onTimeRate: Number(latest?.onTimeRate ?? 0),
    disputeRate: Number(latest?.disputeRate ?? 0),
    avgRating: Number(latest?.avgRating ?? 0)
  });
});

app.get('/api/users/clients/:phone', async (req, reply) => {
  const params = req.params as { phone: string };
  const user = await prisma.user.findFirst({ where: { phone: params.phone, role: 'client' } });
  if (!user) {
    return reply.code(404).send({ message: 'Client not found' });
  }
  return reply.send({ user });
});

bus.consume('user-service', {
  [events.TIMER_IPRS_RETRY_FIRED]: async (payload) => {
    const phone = String(payload.phone ?? '');
    const attempt = Number(payload.attempt ?? 1);
    if (!phone) {
      return;
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user || user.status !== 'pending_iprs_check' || !user.nationalId) {
      return;
    }

    const iprs = await verifyIprs(user.name, user.nationalId);
    if (iprs.matched) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          iprsVerified: true,
          status: 'pending'
        }
      });
      return;
    }

    if (iprs.unavailable && attempt < 48) {
      await scheduleIprsRetry(phone, attempt + 1);
    }
  }
}).catch((error) => app.log.error(error));

await app.listen({ port: env.USER_SERVICE_PORT, host: '0.0.0.0' });

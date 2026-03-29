import { buildService, authGuard, roleGuard } from '@seal/shared';
import { env } from '@seal/config';
import { prisma } from '@seal/db';
import { EventBus } from '@seal/events';
import { events } from '@seal/contracts';

const app = await buildService('user-service');
const bus = new EventBus();

app.post('/api/users/artisan/apply', async (req, reply) => {
  const body = req.body as {
    name: string;
    phone: string;
    nationalId: string;
    trade: string;
    county: string;
  };

  const iprsMatch = body.nationalId.length >= 6;
  const status = iprsMatch ? 'pending' : 'pending_iprs_check';

  const user = await prisma.user.upsert({
    where: { phone: body.phone },
    update: {
      name: body.name,
      nationalId: body.nationalId,
      trade: body.trade,
      county: body.county,
      role: 'artisan',
      iprsVerified: iprsMatch,
      status
    },
    create: {
      name: body.name,
      phone: body.phone,
      nationalId: body.nationalId,
      trade: body.trade,
      county: body.county,
      role: 'artisan',
      iprsVerified: iprsMatch,
      status
    }
  });

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

await app.listen({ port: env.USER_SERVICE_PORT, host: '0.0.0.0' });

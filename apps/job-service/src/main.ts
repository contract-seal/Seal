import { prisma } from '@seal/db';
import { env, serviceUrls } from '@seal/config';
import { buildService, authGuard, roleGuard, requestJson } from '@seal/shared';
import { createQuoteSchema, deliverySchema, disputeSchema, events, jobStateSchema } from '@seal/contracts';
import { EventBus } from '@seal/events';
import { randomUUID } from 'crypto';

const app = await buildService('job-service');
const bus = new EventBus();

function makeRef() {
  return `JOB-${randomUUID().slice(0, 5).toUpperCase()}`;
}

async function scheduleTimer(type: 'deposit.expiry' | 'delivery.auto_approve' | 'dispute.admin_sla', delayMs: number, payload: Record<string, unknown>) {
  return requestJson<{ jobId: string }>(`${serviceUrls.scheduler}/api/scheduler/timers`, {
    method: 'POST',
    body: JSON.stringify({ type, delayMs, payload })
  });
}

async function cancelTimer(jobId: string) {
  await requestJson<{ ok: boolean }>(`${serviceUrls.scheduler}/api/scheduler/timers/${jobId}`, {
    method: 'DELETE'
  });
}

app.post('/api/jobs/quote', { preHandler: [authGuard, roleGuard(['artisan'])] }, async (req, reply) => {
  const parsed = createQuoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send(parsed.error.flatten());
  }

  const body = parsed.data;
  if (req.auth?.userId !== body.artisanId) {
    return reply.code(403).send({ message: 'artisanId mismatch' });
  }

  const artisan = await prisma.user.findUnique({ where: { id: body.artisanId } });
  if (!artisan || artisan.role !== 'artisan' || artisan.status !== 'active') {
    return reply.code(400).send({ message: 'Artisan not active' });
  }

  const client = await prisma.user.upsert({
    where: { phone: body.clientPhone },
    update: {},
    create: {
      phone: body.clientPhone,
      role: 'client',
      name: body.clientPhone,
      status: 'active'
    }
  });

  const job = await prisma.job.create({
    data: {
      refCode: makeRef(),
      artisanId: body.artisanId,
      clientId: client.id,
      title: body.title,
      description: body.description,
      totalAmount: body.totalAmount,
      deadline: body.deadline ? new Date(body.deadline) : null,
      state: 'DRAFT',
      milestones: body.milestones
        ? {
            create: body.milestones.map((m) => ({ title: m.title, amount: m.amount }))
          }
        : undefined
    },
    include: { milestones: true }
  });

  await bus.publish(events.JOB_CREATED, { jobId: job.id, clientPhone: client.phone, artisanId: artisan.id });

  return reply.send({ job });
});

app.get('/api/jobs/:id', { preHandler: [authGuard] }, async (req, reply) => {
  const params = req.params as { id: string };
  const job = await prisma.job.findUnique({
    where: { id: params.id },
    include: { milestones: true, artisan: true, client: true }
  });

  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }

  if (req.auth?.role !== 'admin' && req.auth?.userId !== job.artisanId && req.auth?.userId !== job.clientId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  return reply.send({ job });
});

app.post('/api/jobs/:id/accept', { preHandler: [authGuard, roleGuard(['client'])] }, async (req, reply) => {
  const params = req.params as { id: string };
  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }
  if (job.clientId !== req.auth?.userId) {
    return reply.code(403).send({ message: 'Not your job' });
  }
  if (job.state !== 'DRAFT') {
    return reply.code(409).send({ message: 'Invalid state transition' });
  }

  const timer = await scheduleTimer('deposit.expiry', 72 * 60 * 60 * 1000, { jobId: job.id });

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: {
      state: 'AWAITING_DEPOSIT',
      depositExpiryJobId: timer.jobId
    }
  });

  await bus.publish(events.JOB_ACCEPTED, { jobId: updated.id, amount: Math.floor(updated.totalAmount / 2), clientId: updated.clientId });

  return reply.send({ job: updated });
});

app.post('/api/jobs/:id/decline', { preHandler: [authGuard, roleGuard(['client'])] }, async (req, reply) => {
  const params = req.params as { id: string };
  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }
  if (job.clientId !== req.auth?.userId) {
    return reply.code(403).send({ message: 'Not your job' });
  }
  const updated = await prisma.job.update({ where: { id: job.id }, data: { state: 'CANCELLED' } });
  return reply.send({ job: updated });
});

app.put('/api/jobs/:id/milestones', { preHandler: [authGuard, roleGuard(['artisan'])] }, async (req, reply) => {
  const params = req.params as { id: string };
  const body = req.body as { milestones: Array<{ title: string; amount: number }> };
  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }
  if (job.artisanId !== req.auth?.userId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  await prisma.milestone.deleteMany({ where: { jobId: job.id } });
  await prisma.milestone.createMany({
    data: body.milestones.map((m) => ({
      jobId: job.id,
      title: m.title,
      amount: m.amount
    }))
  });

  return reply.send({ ok: true });
});

app.post('/api/jobs/:id/milestone/:mid/complete', { preHandler: [authGuard, roleGuard(['artisan'])] }, async (req, reply) => {
  const params = req.params as { id: string; mid: string };
  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }
  if (job.artisanId !== req.auth?.userId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const milestone = await prisma.milestone.update({
    where: { id: params.mid },
    data: { status: 'complete', completedAt: new Date() }
  });

  return reply.send({ milestone });
});

app.post('/api/jobs/:id/deliver', { preHandler: [authGuard, roleGuard(['artisan'])] }, async (req, reply) => {
  const params = req.params as { id: string };
  const parsed = deliverySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send(parsed.error.flatten());
  }

  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }
  if (job.artisanId !== req.auth?.userId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  if (job.state !== 'ACTIVE') {
    return reply.code(409).send({ message: 'Job not active' });
  }

  if (job.depositExpiryJobId) {
    await cancelTimer(job.depositExpiryJobId);
  }

  const timer = await scheduleTimer('delivery.auto_approve', 48 * 60 * 60 * 1000, { jobId: job.id });

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: {
      state: 'PENDING_APPROVAL',
      deliveredAt: new Date(),
      deliveryNotes: parsed.data.note,
      deliveryPhotoUrls: parsed.data.photoUrls,
      approvalTimerJobId: timer.jobId
    }
  });

  await bus.publish(events.JOB_DELIVERED, { jobId: updated.id, clientId: updated.clientId });

  return reply.send({ job: updated });
});

app.post('/api/jobs/:id/approve', { preHandler: [authGuard, roleGuard(['client'])] }, async (req, reply) => {
  const params = req.params as { id: string };
  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }
  if (job.clientId !== req.auth?.userId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  if (job.state !== 'PENDING_APPROVAL') {
    return reply.code(409).send({ message: 'Job not pending approval' });
  }

  if (job.approvalTimerJobId) {
    await cancelTimer(job.approvalTimerJobId);
  }

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: { state: 'RELEASING', approvalTimerJobId: null }
  });

  await bus.publish(events.JOB_APPROVED, { jobId: updated.id, amount: Math.ceil(updated.totalAmount / 2), clientId: updated.clientId });

  return reply.send({ job: updated });
});

app.post('/api/jobs/:id/dispute', { preHandler: [authGuard, roleGuard(['client'])] }, async (req, reply) => {
  const params = req.params as { id: string };
  const parsed = disputeSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send(parsed.error.flatten());
  }

  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }
  if (job.clientId !== req.auth?.userId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  if (job.state !== 'PENDING_APPROVAL') {
    return reply.code(409).send({ message: 'Job not pending approval' });
  }

  if (job.approvalTimerJobId) {
    await cancelTimer(job.approvalTimerJobId);
  }

  const updated = await prisma.job.update({ where: { id: job.id }, data: { state: 'DISPUTED' } });

  await bus.publish(events.JOB_DISPUTED, {
    jobId: updated.id,
    raisedBy: req.auth?.userId,
    reason: parsed.data.reason,
    description: parsed.data.description,
    evidence: parsed.data.evidence ?? []
  });

  return reply.send({ job: updated });
});

app.get('/api/artisan/jobs', { preHandler: [authGuard, roleGuard(['artisan'])] }, async (req) => {
  const jobs = await prisma.job.findMany({
    where: { artisanId: req.auth?.userId },
    orderBy: { createdAt: 'desc' }
  });
  return { jobs };
});

app.get('/api/client/jobs', { preHandler: [authGuard, roleGuard(['client'])] }, async (req) => {
  const jobs = await prisma.job.findMany({
    where: { clientId: req.auth?.userId },
    orderBy: { createdAt: 'desc' }
  });
  return { jobs };
});

app.get('/api/artisan/dashboard', { preHandler: [authGuard, roleGuard(['artisan'])] }, async (req) => {
  const jobs = await prisma.job.findMany({
    where: { artisanId: req.auth?.userId },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  const activeJobs = jobs.filter((j) => ['ACTIVE', 'PENDING_APPROVAL', 'RELEASING', 'DISPUTED'].includes(j.state));
  const ids = activeJobs.map((j) => j.id);
  const ledger = ids.length === 0 ? [] : await prisma.escrowLedger.findMany({ where: { jobId: { in: ids } } });
  const balanceByJob = ledger.reduce<Record<string, number>>((acc, entry) => {
    const current = acc[entry.jobId] ?? 0;
    acc[entry.jobId] = entry.type === 'credit' ? current + entry.amount : current - entry.amount;
    return acc;
  }, {});

  return {
    activeJobs: activeJobs.length,
    pendingApprovals: jobs.filter((j) => j.state === 'PENDING_APPROVAL').length,
    totalEarnedThisMonth: jobs
      .filter((j) => j.state === 'COMPLETE' && j.completedAt && j.completedAt.getMonth() === new Date().getMonth())
      .reduce((sum, j) => sum + j.totalAmount, 0),
    jobs: activeJobs.map((j) => ({
      ...j,
      escrowBalance: balanceByJob[j.id] ?? 0
    }))
  };
});

bus.consume('job-service', {
  [events.PAYMENT_DEPOSIT_CONFIRMED]: async (payload) => {
    const jobId = String(payload.jobId);
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.state !== 'AWAITING_DEPOSIT') {
      return;
    }
    await prisma.job.update({ where: { id: job.id }, data: { state: 'ACTIVE' } });
  },
  [events.PAYMENT_B2C_CONFIRMED]: async (payload) => {
    const jobId = String(payload.jobId);
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || (job.state !== 'RELEASING' && job.state !== 'DISPUTED')) {
      return;
    }
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { state: 'COMPLETE', completedAt: new Date() }
    });
    await bus.publish(events.JOB_COMPLETED, { jobId: updated.id, artisanId: updated.artisanId, clientId: updated.clientId });
  },
  [events.TIMER_DEPOSIT_EXPIRED]: async (payload) => {
    const jobId = String(payload.jobId);
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.state !== 'AWAITING_DEPOSIT') {
      return;
    }
    await prisma.job.update({ where: { id: job.id }, data: { state: 'CANCELLED' } });
  },
  [events.TIMER_APPROVAL_EXPIRED]: async (payload) => {
    const jobId = String(payload.jobId);
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.state !== 'PENDING_APPROVAL') {
      return;
    }
    await prisma.job.update({ where: { id: job.id }, data: { state: 'RELEASING', approvalTimerJobId: null } });
    await bus.publish(events.JOB_APPROVED, { jobId: job.id, amount: Math.ceil(job.totalAmount / 2), clientId: job.clientId, autoApproved: true });
  },
  [events.TIMER_DISPUTE_SLA_EXPIRED]: async (payload) => {
    const jobId = String(payload.jobId);
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.state !== 'DISPUTED') {
      return;
    }
    await bus.publish(events.DISPUTE_RESOLVED, {
      jobId,
      resolution: 'client_full',
      splitArtisanPct: 0,
      resolutionNote: 'Auto-resolved after SLA expiry'
    });
  }
}).catch((error) => app.log.error(error));

await app.listen({ port: env.JOB_SERVICE_PORT, host: '0.0.0.0' });

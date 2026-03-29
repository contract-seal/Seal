import { prisma } from '@seal/db';
import { env, serviceUrls } from '@seal/config';
import { buildService, authGuard, roleGuard, requestJson } from '@seal/shared';
import { EventBus } from '@seal/events';
import { disputeResolutionSchema, events } from '@seal/contracts';

const app = await buildService('dispute-service');
const bus = new EventBus();

async function scheduleSla(jobId: string) {
  return requestJson<{ jobId: string }>(`${serviceUrls.scheduler}/api/scheduler/timers`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'dispute.admin_sla',
      delayMs: 72 * 60 * 60 * 1000,
      payload: { jobId }
    })
  });
}

app.get('/api/disputes', { preHandler: [authGuard, roleGuard(['admin'])] }, async () => {
  const disputes = await prisma.dispute.findMany({
    orderBy: { createdAt: 'asc' },
    include: { job: true }
  });
  return { disputes };
});

app.get('/api/disputes/:id', { preHandler: [authGuard] }, async (req, reply) => {
  const params = req.params as { id: string };
  const dispute = await prisma.dispute.findUnique({ where: { id: params.id }, include: { job: true } });
  if (!dispute) {
    return reply.code(404).send({ message: 'Dispute not found' });
  }
  if (req.auth?.role !== 'admin' && req.auth?.userId !== dispute.job.artisanId && req.auth?.userId !== dispute.job.clientId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  return { dispute };
});

app.post('/api/disputes/:id/evidence', { preHandler: [authGuard] }, async (req, reply) => {
  const params = req.params as { id: string };
  const body = req.body as { urls: string[] };
  const dispute = await prisma.dispute.findUnique({ where: { id: params.id }, include: { job: true } });
  if (!dispute) {
    return reply.code(404).send({ message: 'Dispute not found' });
  }

  if (req.auth?.userId !== dispute.job.clientId && req.auth?.userId !== dispute.job.artisanId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  if (req.auth?.userId === dispute.job.clientId) {
    const updated = await prisma.dispute.update({
      where: { id: dispute.id },
      data: { clientEvidence: [...dispute.clientEvidence, ...body.urls].slice(0, 4) }
    });
    return { dispute: updated };
  }

  const updated = await prisma.dispute.update({
    where: { id: dispute.id },
    data: { artisanEvidence: [...dispute.artisanEvidence, ...body.urls].slice(0, 4) }
  });
  return { dispute: updated };
});

app.post('/api/disputes/:id/resolve', { preHandler: [authGuard, roleGuard(['admin'])] }, async (req, reply) => {
  const params = req.params as { id: string };
  const body = req.body as { resolution: string; splitArtisanPct?: number; resolutionNote: string };
  const parsed = disputeResolutionSchema.safeParse(body.resolution);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid resolution' });
  }

  const dispute = await prisma.dispute.findUnique({ where: { id: params.id } });
  if (!dispute) {
    return reply.code(404).send({ message: 'Dispute not found' });
  }

  const updated = await prisma.dispute.update({
    where: { id: dispute.id },
    data: {
      resolution: parsed.data,
      splitArtisanPct: body.splitArtisanPct,
      resolutionNote: body.resolutionNote,
      resolvedAt: new Date(),
      resolvedBy: req.auth?.userId
    }
  });

  if (updated.slaJobId) {
    await requestJson<{ ok: boolean }>(`${serviceUrls.scheduler}/api/scheduler/timers/${updated.slaJobId}`, { method: 'DELETE' });
  }

  await bus.publish(events.DISPUTE_RESOLVED, {
    disputeId: updated.id,
    jobId: updated.jobId,
    resolution: updated.resolution,
    splitArtisanPct: Number(updated.splitArtisanPct ?? 0),
    resolutionNote: updated.resolutionNote
  });

  return { dispute: updated };
});

bus.consume('dispute-service', {
  [events.JOB_DISPUTED]: async (payload) => {
    const jobId = String(payload.jobId);
    const existing = await prisma.dispute.findUnique({ where: { jobId } });
    if (existing) {
      return;
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return;
    }

    const timer = await scheduleSla(jobId);

    await prisma.dispute.create({
      data: {
        jobId,
        raisedBy: String(payload.raisedBy),
        reason: String(payload.reason),
        description: String(payload.description ?? ''),
        clientEvidence: (payload.evidence as string[] | undefined) ?? [],
        artisanEvidence: job.deliveryPhotoUrls,
        slaJobId: timer.jobId
      }
    });
  },
  [events.TIMER_DISPUTE_SLA_EXPIRED]: async (payload) => {
    const jobId = String(payload.jobId);
    const dispute = await prisma.dispute.findUnique({ where: { jobId } });
    if (!dispute || dispute.resolvedAt) {
      return;
    }
    await prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        resolution: 'client_full',
        splitArtisanPct: 0,
        resolutionNote: 'Auto-resolved due to admin SLA expiry',
        resolvedAt: new Date()
      }
    });

    await bus.publish(events.DISPUTE_RESOLVED, {
      disputeId: dispute.id,
      jobId,
      resolution: 'client_full',
      splitArtisanPct: 0,
      resolutionNote: 'Auto-resolved due to admin SLA expiry'
    });
  }
}).catch((error) => app.log.error(error));

await app.listen({ port: env.DISPUTE_SERVICE_PORT, host: '0.0.0.0' });

import { prisma } from '@seal/db';
import { env } from '@seal/config';
import { buildService } from '@seal/shared';
import { EventBus } from '@seal/events';
import { events } from '@seal/contracts';

const app = await buildService('reputation-service');
const bus = new EventBus();

function tierFromScore(score: number): 'new' | 'standard' | 'trusted' | 'elite' {
  if (score >= 85) return 'elite';
  if (score >= 60) return 'trusted';
  if (score >= 30) return 'standard';
  return 'new';
}

async function recompute(artisanId: string) {
  const jobs = await prisma.job.findMany({ where: { artisanId, state: 'COMPLETE' } });
  const total = jobs.length;
  const onTime = total === 0 ? 0 : jobs.filter((j) => !j.deadline || (j.completedAt && j.completedAt <= j.deadline)).length / total;

  const disputes = await prisma.dispute.count({ where: { job: { artisanId } } });
  const disputeRate = total === 0 ? 0 : disputes / total;

  const ratings = await prisma.rating.findMany({ where: { artisanId } });
  const avgRating = ratings.length === 0 ? 0 : ratings.reduce((acc, r) => acc + r.stars, 0) / ratings.length;
  const ratingNorm = (avgRating / 5) * 100;

  const historyDepth = Math.min(1, Math.log1p(total) / Math.log(51)) * 100;

  const score = Math.round(
    onTime * 100 * 0.35 +
      (1 - Math.min(1, disputeRate)) * 100 * 0.3 +
      ratingNorm * 0.25 +
      historyDepth * 0.1
  );

  const record = await prisma.reputationScore.create({
    data: {
      artisanId,
      score,
      jobsCompleted: total,
      onTimeRate: onTime * 100,
      disputeRate: disputeRate * 100,
      avgRating
    }
  });

  const tier = tierFromScore(score);
  await prisma.user.update({ where: { id: artisanId }, data: { tier } });

  await bus.publish(events.REPUTATION_UPDATED, {
    artisanId,
    score,
    tier,
    jobsCompleted: total
  });

  return record;
}

app.get('/api/reputation/artisan/:artisanId', async (req) => {
  const params = req.params as { artisanId: string };
  const latest = await prisma.reputationScore.findFirst({
    where: { artisanId: params.artisanId },
    orderBy: { computedAt: 'desc' }
  });

  return {
    artisanId: params.artisanId,
    score: latest?.score ?? 0,
    jobsCompleted: latest?.jobsCompleted ?? 0,
    onTimeRate: Number(latest?.onTimeRate ?? 0),
    disputeRate: Number(latest?.disputeRate ?? 0),
    avgRating: Number(latest?.avgRating ?? 0)
  };
});

app.post('/api/reputation/jobs/:jobId/rate', async (req, reply) => {
  const params = req.params as { jobId: string };
  const body = req.body as { stars: number };
  if (body.stars < 1 || body.stars > 5) {
    return reply.code(400).send({ message: 'stars must be 1..5' });
  }

  const job = await prisma.job.findUnique({ where: { id: params.jobId } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }

  await prisma.rating.upsert({
    where: { jobId: job.id },
    update: { stars: body.stars },
    create: {
      jobId: job.id,
      artisanId: job.artisanId,
      clientId: job.clientId,
      stars: body.stars
    }
  });

  const score = await recompute(job.artisanId);
  return { ok: true, score };
});

bus.consume('reputation-service', {
  [events.JOB_COMPLETED]: async (payload) => {
    const artisanId = String(payload.artisanId);
    await recompute(artisanId);
  }
}).catch((error) => app.log.error(error));

await app.listen({ port: env.REPUTATION_SERVICE_PORT, host: '0.0.0.0' });

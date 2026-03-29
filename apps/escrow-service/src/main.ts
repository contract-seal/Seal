import { Redis } from 'ioredis';
import { prisma } from '@seal/db';
import { env } from '@seal/config';
import { buildService } from '@seal/shared';
import { EventBus } from '@seal/events';
import { events } from '@seal/contracts';

const app = await buildService('escrow-service');
const bus = new EventBus();
const redis = new Redis(env.REDIS_URL);

async function withJobLock<T>(jobId: string, fn: () => Promise<T>) {
  const lockKey = `escrow:lock:${jobId}`;
  const started = Date.now();
  while (Date.now() - started < 2000) {
    const ok = await redis.set(lockKey, '1', 'EX', 5, 'NX');
    if (ok) {
      try {
        return await fn();
      } finally {
        await redis.del(lockKey);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Lock timeout');
}

async function getBalance(jobId: string) {
  const result = await prisma.escrowLedger.aggregate({
    where: { jobId },
    _sum: { amount: true }
  });
  const credits = await prisma.escrowLedger.aggregate({
    where: { jobId, type: 'credit' },
    _sum: { amount: true }
  });
  const debits = await prisma.escrowLedger.aggregate({
    where: { jobId, type: 'debit' },
    _sum: { amount: true }
  });

  return {
    totalCredited: credits._sum.amount ?? 0,
    totalDebited: debits._sum.amount ?? 0,
    balance: (credits._sum.amount ?? 0) - (debits._sum.amount ?? 0),
    totalMovements: result._sum.amount ?? 0
  };
}

app.get('/api/escrow/:jobId/balance', async (req, reply) => {
  const params = req.params as { jobId: string };
  const job = await prisma.job.findUnique({ where: { id: params.jobId } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }
  const balance = await getBalance(params.jobId);
  return { jobId: params.jobId, ...balance };
});

app.get('/api/escrow/:jobId/ledger', async (req, reply) => {
  const params = req.params as { jobId: string };
  const job = await prisma.job.findUnique({ where: { id: params.jobId } });
  if (!job) {
    return reply.code(404).send({ message: 'Job not found' });
  }
  const entries = await prisma.escrowLedger.findMany({ where: { jobId: params.jobId }, orderBy: { createdAt: 'asc' } });
  return { entries };
});

bus.consume('escrow-service', {
  [events.PAYMENT_DEPOSIT_CONFIRMED]: async (payload) => {
    const jobId = String(payload.jobId);
    const amount = Number(payload.amount);
    const mpesaRef = String(payload.mpesaRef);

    await withJobLock(jobId, async () => {
      try {
        await prisma.escrowLedger.create({
          data: {
            jobId,
            type: 'credit',
            amount,
            mpesaRef,
            description: 'deposit_50pct'
          }
        });
      } catch {
      }
    });
  },
  [events.PAYMENT_BALANCE_CONFIRMED]: async (payload) => {
    const jobId = String(payload.jobId);
    const amount = Number(payload.amount);
    const mpesaRef = String(payload.mpesaRef);

    await withJobLock(jobId, async () => {
      try {
        await prisma.escrowLedger.create({
          data: {
            jobId,
            type: 'credit',
            amount,
            mpesaRef,
            description: 'balance_50pct'
          }
        });
      } catch {
      }
    });
  },
  [events.PAYMENT_B2C_CONFIRMED]: async (payload) => {
    const jobId = String(payload.jobId);
    const amount = Number(payload.amount);
    const mpesaRef = String(payload.mpesaRef);

    await withJobLock(jobId, async () => {
      await prisma.escrowLedger.create({
        data: {
          jobId,
          type: 'debit',
          amount,
          mpesaRef,
          description: 'payout'
        }
      });
    });
  },
  [events.JOB_DISPUTED]: async (payload) => {
    const jobId = String(payload.jobId);
    await redis.set(`escrow:frozen:${jobId}`, '1', 'EX', 72 * 60 * 60);
  },
  [events.DISPUTE_RESOLVED]: async (payload) => {
    const jobId = String(payload.jobId);
    await redis.del(`escrow:frozen:${jobId}`);
  }
}).catch((error) => app.log.error(error));

await app.listen({ port: env.ESCROW_SERVICE_PORT, host: '0.0.0.0' });

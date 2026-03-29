import { Queue, Worker, Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { env } from '@seal/config';
import { buildService } from '@seal/shared';
import { EventBus } from '@seal/events';
import { events } from '@seal/contracts';

const app = await buildService('scheduler-service');
const bus = new EventBus();

const connection = {
  host: new URL(env.REDIS_URL).hostname,
  port: Number(new URL(env.REDIS_URL).port || 6379),
  username: new URL(env.REDIS_URL).username || undefined,
  password: new URL(env.REDIS_URL).password || undefined
};

const queue = new Queue('seal-scheduler', { connection });

const mapTypeToEvent: Record<string, string> = {
  'deposit.expiry': events.TIMER_DEPOSIT_EXPIRED,
  'delivery.auto_approve': events.TIMER_APPROVAL_EXPIRED,
  'dispute.admin_sla': events.TIMER_DISPUTE_SLA_EXPIRED,
  'stk.retry': events.PAYMENT_STK_FAILED
};

new Worker(
  'seal-scheduler',
  async (job: Job) => {
    const eventName = mapTypeToEvent[job.name];
    if (!eventName) {
      return;
    }
    await bus.publish(eventName, job.data as Record<string, unknown>);
  },
  { connection }
);

app.post('/api/scheduler/timers', async (req, reply) => {
  const body = req.body as { type: string; delayMs: number; payload: Record<string, unknown>; jobId?: string };
  const jobId = body.jobId ?? randomUUID();
  if (!mapTypeToEvent[body.type]) {
    return reply.code(400).send({ message: 'Unsupported timer type' });
  }

  await queue.add(body.type, body.payload, {
    delay: body.delayMs,
    jobId,
    removeOnComplete: true,
    removeOnFail: 1000
  });

  return { jobId };
});

app.delete('/api/scheduler/timers/:jobId', async (req) => {
  const params = req.params as { jobId: string };
  const job = await queue.getJob(params.jobId);
  if (job) {
    await job.remove();
  }
  return { ok: true };
});

app.get('/api/scheduler/timers', async () => {
  const jobs = await queue.getDelayed();
  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      name: j.name,
      timestamp: j.timestamp,
      delay: j.delay
    }))
  };
});

await app.listen({ port: env.SCHEDULER_SERVICE_PORT, host: '0.0.0.0' });

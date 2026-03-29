import { prisma } from '@seal/db';
import { env } from '@seal/config';
import { buildService } from '@seal/shared';
import { EventBus } from '@seal/events';
import { events } from '@seal/contracts';

const app = await buildService('notification-service');
const bus = new EventBus();

async function queueMessage(channel: 'sms' | 'whatsapp', recipient: string, template: string, payload: Record<string, unknown>) {
  return prisma.notification.create({
    data: {
      channel,
      recipient,
      template,
      payload: payload as object,
      status: 'queued'
    }
  });
}

async function markDelivered(id: string) {
  await prisma.notification.update({ where: { id }, data: { status: 'delivered', attempts: { increment: 1 } } });
}

app.get('/api/notifications', async () => {
  const notifications = await prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  return { notifications };
});

app.post('/api/notifications/delivery-receipt', async (req, reply) => {
  const body = req.body as { id: string; status: 'delivered' | 'failed' };
  const notification = await prisma.notification.findUnique({ where: { id: body.id } });
  if (!notification) {
    return reply.code(404).send({ message: 'Notification not found' });
  }
  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: body.status,
      attempts: { increment: 1 }
    }
  });
  return { ok: true };
});

bus.consume('notification-service', {
  [events.JOB_CREATED]: async (payload) => {
    const job = await prisma.job.findUnique({ where: { id: String(payload.jobId) }, include: { artisan: true, client: true } });
    if (!job) return;
    const a = await queueMessage('whatsapp', job.client.phone, 'job.created', { jobId: job.id, title: job.title, price: job.totalAmount, artisan: job.artisan.name });
    await markDelivered(a.id);
    const b = await queueMessage('sms', job.client.phone, 'job.created.sms', { jobId: job.id, title: job.title, price: job.totalAmount });
    await markDelivered(b.id);
  },
  [events.PAYMENT_DEPOSIT_CONFIRMED]: async (payload) => {
    const job = await prisma.job.findUnique({ where: { id: String(payload.jobId) }, include: { artisan: true, client: true } });
    if (!job) return;
    const receipt = { amount: payload.amount, mpesaRef: payload.mpesaRef, jobRef: job.refCode };
    const a = await queueMessage('sms', job.artisan.phone, 'payment.deposit.confirmed', receipt);
    await markDelivered(a.id);
    const b = await queueMessage('sms', job.client.phone, 'payment.deposit.confirmed', receipt);
    await markDelivered(b.id);
  },
  [events.JOB_DELIVERED]: async (payload) => {
    const job = await prisma.job.findUnique({ where: { id: String(payload.jobId) }, include: { client: true } });
    if (!job) return;
    const a = await queueMessage('whatsapp', job.client.phone, 'job.delivered', {
      jobId: job.id,
      note: job.deliveryNotes,
      photos: job.deliveryPhotoUrls
    });
    await markDelivered(a.id);
  },
  [events.JOB_DISPUTED]: async (payload) => {
    const job = await prisma.job.findUnique({ where: { id: String(payload.jobId) }, include: { artisan: true, client: true } });
    if (!job) return;
    const a = await queueMessage('sms', job.artisan.phone, 'job.disputed', { jobId: job.id });
    await markDelivered(a.id);
    const b = await queueMessage('sms', job.client.phone, 'job.disputed', { jobId: job.id });
    await markDelivered(b.id);
  },
  [events.JOB_COMPLETED]: async (payload) => {
    const job = await prisma.job.findUnique({ where: { id: String(payload.jobId) }, include: { artisan: true, client: true } });
    if (!job) return;
    const a = await queueMessage('sms', job.artisan.phone, 'job.completed', { jobId: job.id, amount: job.totalAmount });
    await markDelivered(a.id);
    const b = await queueMessage('sms', job.client.phone, 'job.completed', { jobId: job.id, amount: job.totalAmount });
    await markDelivered(b.id);
  },
  [events.PAYMENT_STK_FAILED_FINAL]: async (payload) => {
    const job = await prisma.job.findUnique({ where: { id: String(payload.jobId) }, include: { client: true } });
    if (!job) return;
    const a = await queueMessage('sms', job.client.phone, 'payment.stk.failed', {
      jobId: job.id,
      amount: payload.amount,
      paybill: env.MPESA_PAYBILL,
      account: job.refCode
    });
    await markDelivered(a.id);
  },
  [events.USER_ARTISAN_APPROVED]: async (payload) => {
    const a = await queueMessage('sms', String(payload.phone), 'user.artisan.approved', { artisanId: payload.artisanId });
    await markDelivered(a.id);
  },
  [events.USER_ARTISAN_REJECTED]: async (payload) => {
    const a = await queueMessage('sms', String(payload.phone), 'user.artisan.rejected', { reason: payload.reason });
    await markDelivered(a.id);
  },
  [events.DISPUTE_RESOLVED]: async (payload) => {
    const job = await prisma.job.findUnique({ where: { id: String(payload.jobId) }, include: { artisan: true, client: true } });
    if (!job) return;
    const eventPayload = { resolution: payload.resolution, note: payload.resolutionNote, jobId: job.id };
    const a = await queueMessage('sms', job.artisan.phone, 'dispute.resolved', eventPayload);
    await markDelivered(a.id);
    const b = await queueMessage('sms', job.client.phone, 'dispute.resolved', eventPayload);
    await markDelivered(b.id);
  },
  [events.REPUTATION_UPDATED]: async (payload) => {
    const artisan = await prisma.user.findUnique({ where: { id: String(payload.artisanId) } });
    if (!artisan) return;
    const a = await queueMessage('sms', artisan.phone, 'reputation.updated', payload);
    await markDelivered(a.id);
  },
  [events.TIMER_APPROVAL_EXPIRED]: async (payload) => {
    const job = await prisma.job.findUnique({ where: { id: String(payload.jobId) }, include: { client: true } });
    if (!job) return;
    const a = await queueMessage('sms', job.client.phone, 'delivery.auto_approve', { jobId: job.id });
    await markDelivered(a.id);
  }
}).catch((error) => app.log.error(error));

await app.listen({ port: env.NOTIFICATION_SERVICE_PORT, host: '0.0.0.0' });

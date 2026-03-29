import { z } from 'zod';

export const roleSchema = z.enum(['artisan', 'client', 'admin']);
export const userStatusSchema = z.enum(['pending', 'active', 'suspended', 'pending_iprs_check']);
export const tierSchema = z.enum(['new', 'standard', 'trusted', 'elite']);
export const jobStateSchema = z.enum([
  'DRAFT',
  'AWAITING_DEPOSIT',
  'ACTIVE',
  'PENDING_APPROVAL',
  'DISPUTED',
  'RELEASING',
  'COMPLETE',
  'CANCELLED'
]);
export const disputeResolutionSchema = z.enum(['artisan_full', 'client_full', 'split']);

export const createQuoteSchema = z.object({
  artisanId: z.string().uuid(),
  clientPhone: z.string().min(10),
  title: z.string().min(3),
  description: z.string().optional(),
  totalAmount: z.number().int().positive(),
  deadline: z.string().datetime().optional(),
  milestones: z.array(
    z.object({
      title: z.string().min(2),
      amount: z.number().int().positive()
    })
  ).max(5).optional()
});

export const deliverySchema = z.object({
  note: z.string().min(1),
  photoUrls: z.array(z.string().url()).min(1).max(4)
});

export const disputeSchema = z.object({
  reason: z.string().min(2),
  description: z.string().optional(),
  evidence: z.array(z.string().url()).max(4).optional()
});

export type Role = z.infer<typeof roleSchema>;
export type JobState = z.infer<typeof jobStateSchema>;

export const events = {
  JOB_CREATED: 'job.created',
  JOB_ACCEPTED: 'job.accepted',
  JOB_DELIVERED: 'job.delivered',
  JOB_APPROVED: 'job.approved',
  JOB_COMPLETED: 'job.completed',
  JOB_DISPUTED: 'job.disputed',
  PAYMENT_DEPOSIT_CONFIRMED: 'payment.deposit.confirmed',
  PAYMENT_BALANCE_CONFIRMED: 'payment.balance.confirmed',
  PAYMENT_B2C_CONFIRMED: 'payment.b2c.confirmed',
  PAYMENT_STK_FAILED: 'payment.stk.failed',
  DISPUTE_RESOLVED: 'dispute.resolved',
  USER_ARTISAN_APPROVED: 'user.artisan.approved',
  USER_ARTISAN_REJECTED: 'user.artisan.rejected',
  REPUTATION_UPDATED: 'reputation.score.updated',
  TIMER_DEPOSIT_EXPIRED: 'timer.deposit_expired',
  TIMER_APPROVAL_EXPIRED: 'timer.approval_expired',
  TIMER_DISPUTE_SLA_EXPIRED: 'timer.dispute_sla_expired'
} as const;

export type EventName = (typeof events)[keyof typeof events];

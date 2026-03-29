import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('seal'),
  APP_URL: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/seal'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_EXPIRY: z.coerce.number().default(86400),
  PLATFORM_FEE_PCT: z.coerce.number().default(2.5),
  GATEWAY_PORT: z.coerce.number().default(3000),
  USER_SERVICE_PORT: z.coerce.number().default(3001),
  JOB_SERVICE_PORT: z.coerce.number().default(3002),
  PAYMENT_SERVICE_PORT: z.coerce.number().default(3003),
  ESCROW_SERVICE_PORT: z.coerce.number().default(3004),
  DISPUTE_SERVICE_PORT: z.coerce.number().default(3005),
  REPUTATION_SERVICE_PORT: z.coerce.number().default(3006),
  SCHEDULER_SERVICE_PORT: z.coerce.number().default(3007),
  NOTIFICATION_SERVICE_PORT: z.coerce.number().default(3008),
  USSD_SERVICE_PORT: z.coerce.number().default(3009),
  MPESA_PAYBILL: z.string().default('000000'),
  AT_SENDER_ID: z.string().default('Seal')
});

export const env = schema.parse(process.env);

export const serviceUrls = {
  user: `http://localhost:${env.USER_SERVICE_PORT}`,
  job: `http://localhost:${env.JOB_SERVICE_PORT}`,
  payment: `http://localhost:${env.PAYMENT_SERVICE_PORT}`,
  escrow: `http://localhost:${env.ESCROW_SERVICE_PORT}`,
  dispute: `http://localhost:${env.DISPUTE_SERVICE_PORT}`,
  reputation: `http://localhost:${env.REPUTATION_SERVICE_PORT}`,
  scheduler: `http://localhost:${env.SCHEDULER_SERVICE_PORT}`,
  notification: `http://localhost:${env.NOTIFICATION_SERVICE_PORT}`,
  ussd: `http://localhost:${env.USSD_SERVICE_PORT}`
};

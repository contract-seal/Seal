import { Redis } from 'ioredis';
import { randomInt } from 'crypto';
import { env, serviceUrls } from '@seal/config';
import { signAccessToken, verifyAccessToken } from '@seal/auth';
import { buildService } from '@seal/shared';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { prisma } from '@seal/db';

const redis = new Redis(env.REDIS_URL);

const app = await buildService('gateway');

// Serve frontend build
app.register(fastifyStatic, {
  root: path.join(process.cwd(), 'apps/web/build'),
  prefix: '/',
  wildcard: false,
});

// Fallback to index.html for SPA routes
app.setNotFoundHandler((req, reply) => {
  if (req.raw.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/auth/') && !req.url.startsWith('/webhook/')) {
    return reply.sendFile('index.html');
  }
  reply.code(404).send({ message: 'Route not found' });
});

function extractIp(req: any) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip as string;
}

function normalizeIp(ip: string) {
  return ip.replace('::ffff:', '');
}

function isAllowedWebhookIp(ip: string) {
  const normalized = normalizeIp(ip);
  if (normalized.startsWith('196.201.214.')) {
    return true;
  }
  if (env.NODE_ENV === 'development' && (normalized === '127.0.0.1' || normalized === '::1')) {
    return true;
  }
  return false;
}

async function enforceRateLimit(key: string, limit: number, windowSec: number) {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSec);
  }
  return count <= limit;
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254')) {
    return digits;
  }
  if (digits.startsWith('0')) {
    return `254${digits.slice(1)}`;
  }
  return digits;
}

app.post('/auth/otp/request', async (req, reply) => {
  const body = req.body as { phone: string };
  const phone = normalizePhone(body.phone);
  const otpRateKey = `ratelimit:otp:${phone}`;
  const allowed = await enforceRateLimit(otpRateKey, 5, 60 * 60);
  if (!allowed) {
    return reply.code(429).send({ message: 'OTP request limit exceeded. Try again later.' });
  }
  const key = `otp:${phone}`;
  const existing = await redis.get(key);
  if (existing) {
    return reply.send({ ok: true, message: 'OTP already sent' });
  }

  const code = String(randomInt(100000, 999999));
  await redis.set(key, code, 'EX', 600);
  await prisma.otpCode.create({
    data: {
      phone,
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    }
  });

  return reply.send({ ok: true, phone, message: 'OTP generated and queued for delivery' });
});

app.post('/auth/otp/verify', async (req, reply) => {
  const body = req.body as { phone: string; code: string; role?: 'artisan' | 'client' | 'admin'; name?: string };
  const phone = normalizePhone(body.phone);
  const key = `otp:${phone}`;
  const expected = await redis.get(key);

  if (!expected || expected !== body.code) {
    return reply.code(400).send({ message: 'Invalid OTP' });
  }

  await redis.del(key);

  const role = body.role ?? 'client';
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: {
      phone,
      role,
      name: body.name ?? phone,
      status: role === 'client' ? 'active' : 'pending'
    }
  });

  const token = await signAccessToken({
    sub: user.id,
    phone: user.phone,
    role: user.role
  });

  return reply.send({ token, user });
});

app.post('/auth/logout', async (req, reply) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return reply.code(400).send({ message: 'Missing bearer token' });
  }
  const token = auth.slice(7);
  const payload = await verifyAccessToken(token);
  const ttl = Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
  await redis.set(`jwt_blacklist:${payload.jti}`, '1', 'EX', ttl);
  return reply.send({ ok: true });
});

app.addHook('preHandler', async (req, reply) => {
  if (req.url.startsWith('/auth/')) {
    return;
  }
  if (req.url.startsWith('/webhook/mpesa/')) {
    const ip = extractIp(req);
    if (!isAllowedWebhookIp(ip)) {
      return reply.code(403).send({ message: 'Forbidden webhook source' });
    }
    return;
  }
  if (!req.url.startsWith('/api/')) {
    return;
  }
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return reply.code(401).send({ message: 'Missing bearer token' });
  }
  const token = auth.slice(7);
  const payload = await verifyAccessToken(token);
  const blocked = await redis.get(`jwt_blacklist:${payload.jti}`);
  if (blocked) {
    return reply.code(401).send({ message: 'Token blacklisted' });
  }

  const limit = payload.role === 'admin' ? 1000 : 300;
  const ok = await enforceRateLimit(`ratelimit:api:${payload.jti}`, limit, 60 * 60);
  if (!ok) {
    return reply.code(429).send({ message: 'API rate limit exceeded. Try again later.' });
  }
});

const routeTable: Array<{ prefix: string; target: string }> = [
  { prefix: '/api/users', target: serviceUrls.user },
  { prefix: '/api/jobs', target: serviceUrls.job },
  { prefix: '/api/artisan', target: serviceUrls.job },
  { prefix: '/api/client', target: serviceUrls.job },
  { prefix: '/api/payments', target: serviceUrls.payment },
  { prefix: '/api/escrow', target: serviceUrls.escrow },
  { prefix: '/api/disputes', target: serviceUrls.dispute },
  { prefix: '/api/reputation', target: serviceUrls.reputation },
  { prefix: '/api/scheduler', target: serviceUrls.scheduler },
  { prefix: '/api/notifications', target: serviceUrls.notification },
  { prefix: '/api/ussd', target: serviceUrls.ussd },
  { prefix: '/ussd', target: serviceUrls.ussd },
  { prefix: '/webhook/mpesa', target: serviceUrls.payment }
];

app.all('*', async (req, reply) => {
  const target = routeTable.find((item) => req.url.startsWith(item.prefix));
  if (!target) {
    return reply.code(404).send({ message: 'Route not found' });
  }

  const body = req.body ? JSON.stringify(req.body) : undefined;
  const response = await fetch(`${target.target}${req.url}`, {
    method: req.method,
    headers: {
      ...(req.headers as Record<string, string>),
      host: ''
    },
    body
  });

  const text = await response.text();
  reply.code(response.status);
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === 'content-length') {
      continue;
    }
    reply.header(key, value);
  }
  return reply.send(text);
});

await app.listen({ port: env.GATEWAY_PORT, host: '0.0.0.0' });

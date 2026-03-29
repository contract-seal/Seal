import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '@seal/config';
import { verifyAccessToken } from '@seal/auth';

export type AuthContext = {
  userId: string;
  phone: string;
  role: 'artisan' | 'client' | 'admin';
  jti: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function buildService(name: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.NODE_ENV === 'development' ? 'info' : 'warn' } });
  await app.register(cors, { origin: true });
  app.get('/health', async () => ({ ok: true, service: name }));
  return app;
}

export async function authGuard(req: any, reply: any) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return reply.code(401).send({ message: 'Missing bearer token' });
  }
  const token = auth.slice('Bearer '.length);
  try {
    const payload = await verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      phone: payload.phone,
      role: payload.role,
      jti: payload.jti
    };
  } catch {
    return reply.code(401).send({ message: 'Invalid token' });
  }
}

export function roleGuard(roles: Array<'artisan' | 'client' | 'admin'>) {
  return async (req: any, reply: any) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
  };
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

export function toCents(value: number) {
  return Math.round(value * 100);
}

export function fromCents(value: number) {
  return value / 100;
}

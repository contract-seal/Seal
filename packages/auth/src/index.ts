import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '@seal/config';

type JwtPayload = {
  sub: string;
  phone: string;
  role: 'artisan' | 'client' | 'admin';
  jti: string;
};

const keyPair = (() => {
  if (env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY) {
    return {
      privateKey: createPrivateKey(env.JWT_PRIVATE_KEY),
      publicKey: createPublicKey(env.JWT_PUBLIC_KEY)
    };
  }
  const generated = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey: generated.privateKey, publicKey: generated.publicKey };
})();

export async function signAccessToken(input: Omit<JwtPayload, 'jti'>) {
  const jti = randomUUID();
  return new SignJWT({ phone: input.phone, role: input.role, jti })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_EXPIRY}s`)
    .sign(keyPair.privateKey);
}

export async function verifyAccessToken(token: string) {
  const result = await jwtVerify(token, keyPair.publicKey, { algorithms: ['RS256'] });
  return result.payload as unknown as JwtPayload & { exp: number; iat: number };
}

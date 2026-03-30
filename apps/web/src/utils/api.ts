// API client for Seal Gateway
// Adjust BASE_URL as needed for your environment

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || 'API error');
  }
  return res.json();
}

// Auth endpoints
export async function requestOtp(phone: string) {
  return apiFetch<{ ok: boolean; message: string }>(
    '/auth/otp/request',
    { method: 'POST', body: JSON.stringify({ phone }) }
  );
}

export async function verifyOtp(phone: string, code: string, role?: string, name?: string) {
  return apiFetch<{ token: string; user: any }>(
    '/auth/otp/verify',
    { method: 'POST', body: JSON.stringify({ phone, code, role, name }) }
  );
}

import { useState } from 'react';
import { requestOtp, verifyOtp } from '../utils/api';

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [user, setUser] = useState<any>(() => {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendOtp(phone: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await requestOtp(phone);
      setLoading(false);
      return res;
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
      throw e;
    }
  }

  async function login(phone: string, code: string, role?: string, name?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await verifyOtp(phone, code, role, name);
      setToken(res.token);
      setUser(res.user);
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      setLoading(false);
      return res;
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
      throw e;
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  return { token, user, loading, error, sendOtp, login, logout };
}

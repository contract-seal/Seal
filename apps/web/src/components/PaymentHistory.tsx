import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';

interface Payment {
  id: string;
  jobId: string;
  amount: number;
  type: string;
  status: string;
  createdAt: string;
}

export default function PaymentHistory() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }
    apiFetch<Payment[]>('/api/payments', {}, token)
      .then(setPayments)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: 'var(--color-info)' }}>Loading payments...</div>;
  if (error) return <div style={{ color: 'var(--color-danger)' }}>{error}</div>;

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ color: 'var(--color-accent-deep)' }}>Payment History</h3>
      {payments.length === 0 ? (
        <div style={{ color: 'var(--color-text-hint)' }}>No payments found.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {payments.map(p => (
            <li key={p.id} style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              marginBottom: 10,
              padding: 12,
              color: 'var(--color-text-primary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8
            }}>
              <span>
                <b>Ksh {p.amount}</b> <span style={{ color: 'var(--color-text-secondary)' }}>{p.type}</span>
                <span style={{ color: p.status === 'confirmed' ? 'var(--color-success)' : 'var(--color-warning)', marginLeft: 8 }}>{p.status}</span>
              </span>
              <span style={{ fontSize: 12, color: 'var(--color-text-hint)' }}>{new Date(p.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { apiFetch } from '../utils/api';

export default function JobPaymentActions({ jobId, jobState, amount }: { jobId: string; jobState: string; amount: number }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handlePayDeposit() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Not authenticated');
      // Simulate payment initiation (replace with actual endpoint as needed)
      await apiFetch(`/api/payments/deposit`, {
        method: 'POST',
        body: JSON.stringify({ jobId, amount })
      }, token);
      setSuccess('Deposit payment initiated!');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Add more payment/status actions as needed

  return (
    <div style={{ marginTop: 16 }}>
      {jobState === 'pending' && (
        <button
          onClick={handlePayDeposit}
          style={{ background: 'var(--color-success)', color: 'var(--color-bg)', border: 'none', borderRadius: 6, padding: '0.5rem 1.5rem', fontWeight: 600, fontSize: '1rem', cursor: 'pointer' }}
          disabled={loading}
        >
          {loading ? 'Processing...' : 'Pay Deposit'}
        </button>
      )}
      {error && <div style={{ color: 'var(--color-danger)', marginTop: 8 }}>{error}</div>}
      {success && <div style={{ color: 'var(--color-success)', marginTop: 8 }}>{success}</div>}
    </div>
  );
}

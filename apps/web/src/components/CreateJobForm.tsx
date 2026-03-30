import React, { useState } from 'react';
import { apiFetch } from '../utils/api';

export default function CreateJobForm({ onCreated }: { onCreated?: () => void }) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [clientId, setClientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Not authenticated');
      await apiFetch('/api/jobs/quote', {
        method: 'POST',
        body: JSON.stringify({
          title,
          amount: Number(amount),
          clientId,
          // artisanId will be set by backend from token
        })
      }, token);
      setSuccess('Job created!');
      setTitle('');
      setAmount('');
      setClientId('');
      if (onCreated) onCreated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--color-surface)',
      borderRadius: 8,
      padding: 16,
      marginBottom: 24,
      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
      maxWidth: 400
    }}>
      <h4 style={{ color: 'var(--color-brand)' }}>Create New Job</h4>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Title
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
          style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid var(--color-border)' }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Amount (Ksh)
        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          required
          min={1}
          style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid var(--color-border)' }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Client ID
        <input
          type="text"
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          required
          style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid var(--color-border)' }}
        />
      </label>
      <button type="submit" style={{ background: 'var(--color-brand)', color: 'var(--color-bg)', border: 'none', borderRadius: 6, padding: '0.5rem 1.5rem', fontWeight: 600, fontSize: '1rem', marginTop: 8, cursor: 'pointer' }} disabled={loading}>
        {loading ? 'Creating...' : 'Create Job'}
      </button>
      {error && <div style={{ color: 'var(--color-danger)', marginTop: 8 }}>{error}</div>}
      {success && <div style={{ color: 'var(--color-success)', marginTop: 8 }}>{success}</div>}
    </form>
  );
}

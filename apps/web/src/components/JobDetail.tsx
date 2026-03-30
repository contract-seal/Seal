
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import JobPaymentActions from './JobPaymentActions';
import JobStatusActions from './JobStatusActions';

interface Job {
  id: string;
  ref: string;
  title: string;
  state: string;
  amount: number;
  clientId: string;
  artisanId: string;
}

export default function JobDetail({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }
    apiFetch<Job>(`/api/jobs/${jobId}`, {}, token)
      .then(setJob)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) return <div style={{ color: 'var(--color-info)' }}>Loading job...</div>;
  if (error) return <div style={{ color: 'var(--color-danger)' }}>{error}</div>;
  if (!job) return null;

  return (
    <div style={{
      background: 'var(--color-surface)',
      borderRadius: 8,
      padding: 24,
      margin: '2rem auto',
      maxWidth: 500,
      color: 'var(--color-text-primary)'
    }}>
      <button onClick={onBack} style={{ marginBottom: 16, background: 'var(--color-accent)', color: 'var(--color-bg)', border: 'none', borderRadius: 6, padding: '0.5rem 1.5rem', cursor: 'pointer' }}>Back</button>
      <h3 style={{ color: 'var(--color-brand)' }}>{job.title} <span style={{ color: 'var(--color-accent)' }}>({job.ref})</span></h3>
      <div style={{ color: 'var(--color-text-secondary)', marginBottom: 12 }}>
        <strong>Status:</strong> <span style={{ color: job.state === 'completed' ? 'var(--color-success)' : job.state === 'pending' ? 'var(--color-warning)' : 'var(--color-danger)' }}>{job.state}</span><br />
        <strong>Amount:</strong> <span style={{ color: 'var(--color-brand)' }}>Ksh {job.amount}</span><br />
        <strong>Client ID:</strong> {job.clientId}<br />
        <strong>Artisan ID:</strong> {job.artisanId}
      </div>
      <JobPaymentActions jobId={job.id} jobState={job.state} amount={job.amount} />
      <JobStatusActions jobId={job.id} jobState={job.state} onStatusChange={() => window.location.reload()} />
    </div>
  );
}


import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import JobDetail from './JobDetail';

interface Job {
  id: string;
  ref: string;
  title: string;
  state: string;
  amount: number;
  clientId: string;
  artisanId: string;
}

export default function JobList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }
    apiFetch<Job[]>('/api/jobs', {}, token)
      .then(setJobs)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: 'var(--color-info)' }}>Loading jobs...</div>;
  if (error) return <div style={{ color: 'var(--color-danger)' }}>{error}</div>;

  if (selectedJobId) {
    return <JobDetail jobId={selectedJobId} onBack={() => setSelectedJobId(null)} />;
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ color: 'var(--color-brand)' }}>Your Jobs</h3>
      {jobs.length === 0 ? (
        <div style={{ color: 'var(--color-text-hint)' }}>No jobs found.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {jobs.map(job => (
            <li key={job.id} style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              marginBottom: 12,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              cursor: 'pointer',
              transition: 'box-shadow 0.15s',
            }}
            onClick={() => setSelectedJobId(job.id)}
            >
              <span style={{ fontWeight: 600 }}>{job.title} <span style={{ color: 'var(--color-accent)' }}>({job.ref})</span></span>
              <span>Status: <b style={{ color: job.state === 'completed' ? 'var(--color-success)' : job.state === 'pending' ? 'var(--color-warning)' : 'var(--color-danger)' }}>{job.state}</b></span>
              <span>Amount: <b style={{ color: 'var(--color-brand)' }}>Ksh {job.amount}</b></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

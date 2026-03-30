
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import JobList from '../components/JobList';
import CreateJobForm from '../components/CreateJobForm';
import NotificationList from '../components/NotificationList';
import PaymentHistory from '../components/PaymentHistory';

interface User {
  id: string;
  name: string;
  phone: string;
  role: string;
  status: string;
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshJobs, setRefreshJobs] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }
    apiFetch<User>('/api/users/me', {}, token)
      .then(setUser)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: 'var(--color-info)' }}>Loading dashboard...</div>;
  if (error) return <div style={{ color: 'var(--color-danger)' }}>{error}</div>;
  if (!user) return null;

  return (
    <div style={{
      background: 'var(--color-bg)',
      minHeight: '100vh',
      padding: '0',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        maxWidth: 420,
        margin: '2.5rem auto',
        background: 'var(--color-surface)',
        borderRadius: '1.25rem',
        boxShadow: '0 4px 24px 0 rgba(26,107,90,0.07)',
        padding: '2.5rem 1.5rem 2rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '1.7rem', color: 'var(--color-brand)', letterSpacing: '-0.5px', marginBottom: 2 }}>
            Hello, {user.name}
          </div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '1rem', marginTop: 2 }}>
            <span style={{ background: 'var(--color-bg)', borderRadius: 8, padding: '2px 10px', marginRight: 6 }}>{user.role}</span>
            <span style={{ color: 'var(--color-text-hint)', fontSize: '0.95em' }}>{user.phone}</span>
          </div>
        </div>
        <div style={{ color: 'var(--color-success)', fontWeight: 500, fontSize: '1.05rem', marginBottom: 0 }}>
          {user.status === 'active' ? 'Account Active' : user.status}
        </div>
        <CreateJobForm onCreated={() => setRefreshJobs(r => r + 1)} />
        <JobList key={refreshJobs} />
        <NotificationList />
        <PaymentHistory />
      </div>
      <div style={{ textAlign: 'center', color: 'var(--color-text-hint)', fontSize: '0.95rem', marginTop: '2rem' }}>
        &copy; {new Date().getFullYear()} Seal. All rights reserved.
      </div>
    </div>
  );
}

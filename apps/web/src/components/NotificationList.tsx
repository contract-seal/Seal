import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';

interface Notification {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export default function NotificationList() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }
    apiFetch<Notification[]>('/api/notifications', {}, token)
      .then(setNotifications)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: 'var(--color-info)' }}>Loading notifications...</div>;
  if (error) return <div style={{ color: 'var(--color-danger)' }}>{error}</div>;

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ color: 'var(--color-accent)' }}>Notifications</h3>
      {notifications.length === 0 ? (
        <div style={{ color: 'var(--color-text-hint)' }}>No notifications.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {notifications.map(n => (
            <li key={n.id} style={{
              background: n.read ? 'var(--color-surface)' : 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              marginBottom: 10,
              padding: 12,
              color: n.read ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
              fontWeight: n.read ? 400 : 600
            }}>
              <span>{n.message}</span>
              <span style={{ float: 'right', fontSize: 12, color: 'var(--color-text-hint)' }}>{new Date(n.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

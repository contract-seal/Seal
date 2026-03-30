import React, { useState } from 'react';
import { apiFetch } from '../utils/api';

export default function JobStatusActions({ jobId, jobState, onStatusChange }: { jobId: string; jobState: string; onStatusChange?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleMarkComplete() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Not authenticated');
      // Simulate status update (replace with actual endpoint as needed)
      await apiFetch(`/api/jobs/${jobId}/complete`, {
        method: 'POST',
      }, token);
      setSuccess('Job marked as complete!');
      if (onStatusChange) onStatusChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Add more status actions as needed

  return (
    <div style={{ marginTop: 16 }}>
      {jobState === 'in_progress' && (
        <button
          onClick={handleMarkComplete}
          style={{ background: 'var(--color-success)', color: 'var(--color-bg)', border: 'none', borderRadius: 6, padding: '0.5rem 1.5rem', fontWeight: 600, fontSize: '1rem', cursor: 'pointer' }}
          disabled={loading}
        >
          {loading ? 'Processing...' : 'Mark as Complete'}
        </button>
      )}
      {error && <div style={{ color: 'var(--color-danger)', marginTop: 8 }}>{error}</div>}
      {success && <div style={{ color: 'var(--color-success)', marginTop: 8 }}>{success}</div>}
    </div>
  );
}

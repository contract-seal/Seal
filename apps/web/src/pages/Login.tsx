
import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';


export default function Login() {
  const { sendOtp, login, loading, error } = useAuth();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [role, setRole] = useState<'artisan' | 'client'>('client');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    try {
      await sendOtp(phone);
      setStep('otp');
      setMessage('OTP sent! Check your phone.');
    } catch {}
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    try {
      await login(phone, otp, role, name);
      setMessage('Login successful!');
      setTimeout(() => navigate('/dashboard'), 500);
    } catch {}
  }

  return (
    <div style={{
      background: 'var(--color-surface)',
      borderRadius: '1rem',
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      padding: '2rem',
      maxWidth: 400,
      margin: '2rem auto',
      color: 'var(--color-text-primary)'
    }}>
      <h2 style={{ color: 'var(--color-brand)' }}>Sign In</h2>
      {step === 'phone' && (
        <form onSubmit={handleSendOtp}>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Phone Number
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              required
              style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid var(--color-border)' }}
              placeholder="e.g. 0712345678"
            />
          </label>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Name
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid var(--color-border)' }}
              placeholder="Your name"
            />
          </label>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Role
            <select value={role} onChange={e => setRole(e.target.value as any)} style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid var(--color-border)' }}>
              <option value="client">Client</option>
              <option value="artisan">Artisan</option>
            </select>
          </label>
          <button type="submit" style={{ background: 'var(--color-brand)', color: 'var(--color-bg)', border: 'none', borderRadius: 6, padding: '0.75rem 2rem', fontWeight: 600, fontSize: '1rem', marginTop: 12, cursor: 'pointer' }} disabled={loading}>
            {loading ? 'Sending...' : 'Send OTP'}
          </button>
        </form>
      )}
      {step === 'otp' && (
        <form onSubmit={handleVerifyOtp}>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Enter OTP
            <input
              type="text"
              value={otp}
              onChange={e => setOtp(e.target.value)}
              required
              style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid var(--color-border)' }}
              placeholder="6-digit code"
            />
          </label>
          <button type="submit" style={{ background: 'var(--color-brand)', color: 'var(--color-bg)', border: 'none', borderRadius: 6, padding: '0.75rem 2rem', fontWeight: 600, fontSize: '1rem', marginTop: 12, cursor: 'pointer' }} disabled={loading}>
            {loading ? 'Verifying...' : 'Verify & Sign In'}
          </button>
        </form>
      )}
      {error && <div style={{ color: 'var(--color-danger)', marginTop: 12 }}>{error}</div>}
      {message && <div style={{ color: 'var(--color-success)', marginTop: 12 }}>{message}</div>}
    </div>
  );
}

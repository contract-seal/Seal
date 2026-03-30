import React from 'react';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/';
    return null;
  }
  return <>{children}</>;
}

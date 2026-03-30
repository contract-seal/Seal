import React from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProtectedRoute from './layouts/ProtectedRoute';

export const routes = [
  {
    path: '/',
    element: <Login />,
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <Dashboard />
      </ProtectedRoute>
    ),
  },
];

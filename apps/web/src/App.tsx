
import './App.css';
import AppRouter from './AppRouter';

function App() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-text-primary)',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <header style={{
        background: 'var(--color-brand-dark)',
        color: 'var(--color-bg)',
        padding: '1rem 2rem',
        fontWeight: 700,
        fontSize: '1.5rem',
        letterSpacing: '0.02em',
      }}>
        Seal Artisan Fintech
      </header>
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        width: '100%',
      }}>
        <AppRouter />
      </main>
      <footer style={{
        background: 'var(--color-surface)',
        color: 'var(--color-text-hint)',
        textAlign: 'center',
        padding: '1rem',
        fontSize: '0.95rem',
        borderTop: '1px solid var(--color-border)',
      }}>
        &copy; {new Date().getFullYear()} Seal. All rights reserved.
      </footer>
    </div>
  );
}

export default App;

'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary.
 *
 * Catches failures in the root layout itself, which is the one case the normal
 * error boundary cannot handle — at this point the layout, and therefore the
 * i18n provider, may never have mounted. So this file renders its own <html>
 * and <body>, and its copy is deliberately not translated: reaching for the
 * dictionary here is exactly what would fail.
 *
 * Kept plain and dependency-free for the same reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-boundary] root layout failed', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f7f8fb',
          color: '#101a2e',
        }}
      >
        <div style={{ maxWidth: '28rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>Something went wrong</h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: '#5a6478', margin: '0 0 1.5rem' }}>
            The problem has been logged. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '0.5rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#f7f8fb',
              background: '#1f3a72',
              border: 0,
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontFamily: 'monospace', fontSize: '0.6875rem', color: '#8a92a6' }}>
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

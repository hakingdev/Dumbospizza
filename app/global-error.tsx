"use client";

/**
 * Последний рубеж: ошибки в самом корневом layout сюда, а не в белый экран.
 *
 * global-error ЗАМЕНЯЕТ корневой layout целиком, поэтому он обязан отрисовать
 * собственные <html>/<body>. Подключённый в layout.tsx Tailwind здесь не
 * гарантирован — стили только инлайном, без импортов и без контекстов.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#f9fafb',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          color: '#111827',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🍕</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px' }}>
            Dumbos Pizza ist gerade nicht erreichbar
          </h1>
          <p style={{ color: '#4b5563', lineHeight: 1.6, margin: '0 0 24px' }}>
            Bitte laden Sie die Seite neu. Ihre Bestellung nehmen wir auch gerne
            telefonisch entgegen.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: '48px',
              padding: '12px 24px',
              borderRadius: '12px',
              border: 'none',
              background: '#dc2626',
              color: '#fff',
              fontSize: '16px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Seite neu laden
          </button>
          {error.digest && (
            <p style={{ marginTop: '24px', fontSize: '12px', color: '#9ca3af' }}>
              Fehler-ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

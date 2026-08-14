import React from 'react';
import { z } from '../theme';

export function YourTurnBanner({ open }: { open: boolean }) {
  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Your turn"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: z.modal,
      }}
    >
      <div
        style={{
          padding: '18px 36px',
          borderRadius: 16,
          background: 'linear-gradient(180deg, rgba(6, 78, 59, 0.94), rgba(4, 47, 46, 0.96))',
          border: '1px solid rgba(52, 211, 153, 0.7)',
          boxShadow: '0 18px 50px rgba(0, 0, 0, 0.45), 0 0 28px rgba(52, 211, 153, 0.28)',
          color: '#ecfdf5',
          fontSize: 42,
          fontWeight: 800,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          animation: 'yourTurnBannerIn 1.5s ease-out both',
        }}
      >
        Your Turn
      </div>
      <style>{`
        @keyframes yourTurnBannerIn {
          0% { opacity: 0; transform: scale(0.92) translateY(8px); }
          18% { opacity: 1; transform: scale(1) translateY(0); }
          78% { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 0; transform: scale(1.02) translateY(-6px); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes yourTurnBannerIn {
            0% { opacity: 0; }
            12% { opacity: 1; }
            88% { opacity: 1; }
            100% { opacity: 0; }
          }
        }
      `}</style>
    </div>
  );
}

export default YourTurnBanner;

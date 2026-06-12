import React from 'react';

export interface ResolutionMinimizedChipProps {
  title: string;
  subtitle?: string;
  onRestore: () => void;
}

export function ResolutionMinimizedChip({ title, subtitle, onRestore }: ResolutionMinimizedChipProps) {
  return (
    <button
      type="button"
      onClick={onRestore}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.95), rgba(217, 119, 6, 0.95))',
        border: '2px solid #fbbf24',
        borderRadius: 10,
        padding: '10px 14px',
        cursor: 'pointer',
        zIndex: 10002,
        boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 2,
        maxWidth: 'min(320px, calc(100vw - 32px))',
        textAlign: 'left',
      }}
      title="Click to restore the pending choice"
    >
      <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{title}</span>
      <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11 }}>
        {subtitle || 'Pending choice — click to expand'}
      </span>
    </button>
  );
}

export function ResolutionPromptMinimizeButton({ onMinimize }: { onMinimize: () => void }) {
  return (
    <button
      type="button"
      onClick={onMinimize}
      style={{
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.2)',
        color: '#cbd5e1',
        cursor: 'pointer',
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 6,
        whiteSpace: 'nowrap',
      }}
      title="Minimize to view the battlefield"
    >
      Minimize
    </button>
  );
}

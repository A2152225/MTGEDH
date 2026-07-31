import React, { useState } from 'react';

export type LoopShortcutConsentPrompt = {
  gameId: string;
  proposalId: string;
  proposerId: string;
  proposerName: string;
  name: string;
  summary: string;
  requestedIterations: number;
};

interface LoopShortcutConsentModalProps {
  prompt: LoopShortcutConsentPrompt | null;
  onAllow: () => void;
  onInterrupt: (afterIterations: number) => void;
}

export function LoopShortcutConsentModal({
  prompt,
  onAllow,
  onInterrupt,
}: LoopShortcutConsentModalProps) {
  const [afterIterations, setAfterIterations] = useState(1);

  React.useEffect(() => {
    if (prompt) {
      setAfterIterations(1);
    }
  }, [prompt?.proposalId]);

  if (!prompt) return null;

  const max = Math.max(1, prompt.requestedIterations);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 12000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          background: '#1f1f1f',
          color: '#fff',
          border: '1px solid #555',
          borderRadius: 10,
          padding: 16,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
          Loop Shortcut proposed
        </div>
        <div style={{ fontSize: 13, color: '#ccc', marginBottom: 12, lineHeight: 1.4 }}>
          <strong>{prompt.proposerName}</strong> wants to run{' '}
          <strong>{prompt.name}</strong> for{' '}
          <strong>{prompt.requestedIterations}</strong> iteration
          {prompt.requestedIterations === 1 ? '' : 's'}.
          {prompt.summary ? (
            <>
              <br />
              <span style={{ color: '#999' }}>{prompt.summary}</span>
            </>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>
          Allow the full loop, or interrupt after a specific number of iterations so you can respond.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: '#bbb' }}>Interrupt after</label>
          <input
            type="number"
            min={1}
            max={max}
            value={afterIterations}
            onChange={(e) =>
              setAfterIterations(Math.max(1, Math.min(max, Number(e.target.value) || 1)))
            }
            style={{
              width: 72,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid #666',
              background: '#111',
              color: '#fff',
            }}
          />
          <span style={{ fontSize: 12, color: '#888' }}>iteration(s)</span>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => onInterrupt(afterIterations)}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #884',
              background: '#332',
              color: '#fc6',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Interrupt after {afterIterations}
          </button>
          <button
            type="button"
            onClick={onAllow}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #484',
              background: '#243',
              color: '#9e9',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Allow full loop
          </button>
        </div>
      </div>
    </div>
  );
}

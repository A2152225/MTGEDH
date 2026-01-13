/**
 * TwoPileSplitModal.tsx
 *
 * Generic modal for ResolutionQueue step type: two_pile_split.
 * Lets a player assign a set of items into Pile A / Pile B.
 */

import React, { useMemo, useState } from 'react';

export interface TwoPileSplitItem {
  id: string;
  label: string;
  description?: string;
  imageUrl?: string;
}

export interface TwoPileSplitRequest {
  gameId: string;
  stepId: string;
  sourceName?: string;
  sourceImage?: string;
  description: string;
  items: TwoPileSplitItem[];
  minPerPile?: number;
  mandatory: boolean;
}

export interface TwoPileSplitModalProps {
  open: boolean;
  request: TwoPileSplitRequest | null;
  onRespond: (payload: { pileA: string[]; pileB: string[] }) => void;
}

export function TwoPileSplitModal({ open, request, onRespond }: TwoPileSplitModalProps) {
  const [assignments, setAssignments] = useState<Record<string, 0 | 1>>({});

  const items = request?.items || [];
  const minPerPile = request?.minPerPile ?? 0;

  const effectiveAssignments = useMemo(() => {
    // Default: put everything in pile A.
    const base: Record<string, 0 | 1> = {};
    for (const it of items) base[it.id] = 0;
    return { ...base, ...assignments };
  }, [assignments, items]);

  const { pileA, pileB } = useMemo(() => {
    const a: string[] = [];
    const b: string[] = [];
    for (const it of items) {
      const which = effectiveAssignments[it.id] ?? 0;
      (which === 0 ? a : b).push(it.id);
    }
    return { pileA: a, pileB: b };
  }, [effectiveAssignments, items]);

  const canSubmit = pileA.length >= minPerPile && pileB.length >= minPerPile;

  if (!open || !request) return null;

  const toggle = (id: string) => {
    setAssignments((prev) => ({ ...prev, [id]: (prev[id] ?? 0) === 0 ? 1 : 0 }));
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onRespond({ pileA, pileB });
    setAssignments({});
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 720,
          maxHeight: '80vh',
          width: '92%',
          border: '2px solid #3b82f6',
          boxShadow: '0 8px 32px rgba(59,130,246,0.3)',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          {request.sourceImage && (
            <img
              src={request.sourceImage}
              alt={request.sourceName || 'Source'}
              style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }}
            />
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 20 }}>{request.sourceName || 'Separate Into Two Piles'}</h2>
            <div style={{ color: '#60a5fa', fontSize: 14, marginTop: 4 }}>{request.description}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, color: '#fff' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Pile A ({pileA.length})</div>
            <div style={{ fontSize: 12, color: '#aaa' }}>Click a card to move it between piles.</div>
          </div>
          <div style={{ flex: 1, color: '#fff' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Pile B ({pileB.length})</div>
            <div style={{ fontSize: 12, color: '#aaa' }}>Minimum per pile: {minPerPile}</div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          {items.map((it) => {
            const which = effectiveAssignments[it.id] ?? 0;
            const pileLabel = which === 0 ? 'Pile A' : 'Pile B';
            return (
              <button
                key={it.id}
                onClick={() => toggle(it.id)}
                style={{
                  width: '100%',
                  padding: 12,
                  marginBottom: 8,
                  backgroundColor: which === 0 ? 'rgba(59,130,246,0.12)' : 'rgba(16,185,129,0.12)',
                  border: `2px solid ${which === 0 ? '#3b82f6' : '#10b981'}`,
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 16,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  textAlign: 'left',
                }}
              >
                {it.imageUrl && (
                  <img src={it.imageUrl} alt={it.label} style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover' }} />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{it.label}</div>
                  {it.description && <div style={{ fontSize: 13, color: '#aaa', marginTop: 4 }}>{it.description}</div>}
                </div>
                <div style={{ fontSize: 13, opacity: 0.9 }}>{pileLabel}</div>
              </button>
            );
          })}
        </div>

        {minPerPile > 0 && !canSubmit && (
          <div style={{ color: '#fbbf24', fontSize: 13, marginBottom: 12 }}>
            Each pile must contain at least {minPerPile} item{minPerPile !== 1 ? 's' : ''}.
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              flex: 1,
              padding: 12,
              backgroundColor: canSubmit ? '#3b82f6' : 'rgba(59,130,246,0.3)',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 16,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            Confirm Piles
          </button>
        </div>
      </div>
    </div>
  );
}

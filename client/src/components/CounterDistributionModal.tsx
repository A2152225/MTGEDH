import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ResolutionPromptMinimizeButton } from './ResolutionMinimizedChip';
import {
  buildInitialCounterDistribution,
  canConfirmCounterDistribution,
  counterDistributionMeetsMinimums,
  getCounterDistributionAllocated,
} from '../utils/counterDistributionUtils';

export interface CounterDistributionTarget {
  id: string;
  label: string;
}

export interface CounterDistributionModalProps {
  open: boolean;
  cardName: string;
  cardImageUrl?: string;
  counterType: string;
  totalAmount: number;
  minPerTarget?: number;
  targets: CounterDistributionTarget[];
  message?: string;
  canCancel?: boolean;
  onMinimize?: () => void;
  onConfirm: (distribution: Record<string, number>) => void;
  onCancel: () => void;
}

export function CounterDistributionModal({
  open,
  cardName,
  cardImageUrl,
  counterType,
  totalAmount,
  minPerTarget = 1,
  targets,
  message,
  canCancel = true,
  onMinimize,
  onConfirm,
  onCancel,
}: CounterDistributionModalProps) {
  const targetIds = useMemo(
    () => targets.map((target) => String(target.id || '').trim()).filter(Boolean),
    [targets],
  );

  const [distribution, setDistribution] = useState<Record<string, number>>(() =>
    buildInitialCounterDistribution(targetIds),
  );

  useEffect(() => {
    if (!open) return;
    setDistribution(buildInitialCounterDistribution(targetIds));
  }, [open, targetIds, totalAmount, counterType]);

  const allocated = useMemo(
    () => getCounterDistributionAllocated(distribution),
    [distribution],
  );
  const remaining = totalAmount - allocated;

  const increment = useCallback((targetId: string) => {
    if (remaining <= 0) return;
    setDistribution((prev) => ({ ...prev, [targetId]: (prev[targetId] || 0) + 1 }));
  }, [remaining]);

  const decrement = useCallback((targetId: string) => {
    setDistribution((prev) => {
      const current = prev[targetId] || 0;
      if (current <= 0) return prev;
      return { ...prev, [targetId]: current - 1 };
    });
  }, []);

  const setValue = useCallback((targetId: string, value: number) => {
    const next = Math.max(0, Math.min(value, totalAmount));
    setDistribution((prev) => ({ ...prev, [targetId]: next }));
  }, [totalAmount]);

  const fillTarget = useCallback((targetId: string) => {
    if (remaining <= 0) return;
    setDistribution((prev) => ({ ...prev, [targetId]: (prev[targetId] || 0) + remaining }));
  }, [remaining]);

  const meetsMinimums = useMemo(
    () => counterDistributionMeetsMinimums(distribution, targetIds, minPerTarget, totalAmount),
    [distribution, minPerTarget, targetIds, totalAmount],
  );

  const canConfirm = canConfirmCounterDistribution({
    distribution,
    targetIds,
    totalAmount,
    minPerTarget,
  });

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm(distribution);
  }, [canConfirm, distribution, onConfirm]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10003,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 560,
          width: '92%',
          color: '#e0e0e0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20, color: '#fff', flex: 1 }}>
            Distribute {counterType} — {cardName}
          </h2>
          {onMinimize ? <ResolutionPromptMinimizeButton onMinimize={onMinimize} /> : null}
        </div>

        {cardImageUrl ? (
          <img
            src={cardImageUrl}
            alt={cardName}
            style={{ width: 96, borderRadius: 8, marginBottom: 12 }}
          />
        ) : null}

        {message ? (
          <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#bbb' }}>{message}</p>
        ) : null}

        <div style={{ marginBottom: 16, fontSize: 16, fontWeight: 'bold' }}>
          Total: {totalAmount} | Allocated: {allocated} | Remaining: {remaining}
        </div>

        {!meetsMinimums && allocated === totalAmount ? (
          <div style={{ marginBottom: 12, padding: 8, background: '#2a2a3e', borderRadius: 6, fontSize: 13, color: '#ffcc00' }}>
            Each target must receive at least {minPerTarget} counter(s).
          </div>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {targets.map((target) => (
            <div key={target.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, fontSize: 15 }}>{target.label}</div>
              <button
                onClick={() => decrement(target.id)}
                disabled={(distribution[target.id] || 0) === 0}
                style={{
                  width: 32,
                  height: 32,
                  background: (distribution[target.id] || 0) === 0 ? '#333' : '#444',
                  color: (distribution[target.id] || 0) === 0 ? '#666' : '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: (distribution[target.id] || 0) === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                −
              </button>
              <input
                type="number"
                value={distribution[target.id] || 0}
                onChange={(event) => setValue(target.id, parseInt(event.target.value, 10) || 0)}
                min={0}
                max={totalAmount}
                style={{
                  width: 60,
                  padding: 6,
                  textAlign: 'center',
                  background: '#2a2a3e',
                  color: '#fff',
                  border: '1px solid #444',
                  borderRadius: 4,
                }}
              />
              <button
                onClick={() => increment(target.id)}
                disabled={remaining === 0}
                style={{
                  width: 32,
                  height: 32,
                  background: remaining === 0 ? '#333' : '#444',
                  color: remaining === 0 ? '#666' : '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: remaining === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                +
              </button>
              {remaining > 0 ? (
                <button
                  onClick={() => fillTarget(target.id)}
                  style={{
                    padding: '4px 8px',
                    background: '#2b6cb0',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Fill
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {canCancel ? (
            <button
              onClick={onCancel}
              style={{
                padding: '8px 16px',
                background: '#444',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          ) : null}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '8px 16px',
              background: canConfirm ? '#2b6cb0' : '#333',
              color: canConfirm ? '#fff' : '#666',
              border: 'none',
              borderRadius: 6,
              cursor: canConfirm ? 'pointer' : 'not-allowed',
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

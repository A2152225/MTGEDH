/**
 * ModalSpellSelectionModal.tsx
 *
 * Modal for selecting modes on modal spells like:
 * - Austere Command (choose two)
 * - Cryptic Command (choose two)
 * - Confluence spells (choose three)
 * - Charms (choose one)
 * - Season spells (choose up to N {P} worth of modes, optionally with repeats)
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  canAddModeUnderPBudget,
  modePCost,
  sumSelectedPCost,
} from '../../../shared/src';

export interface SpellMode {
  id: string;
  name: string;
  description: string;
  /** Season-style `{P}` cost for this mode. */
  pCost?: number;
}

export interface ModalSpellSelectionProps {
  open: boolean;
  cardName: string;
  imageUrl?: string;
  description?: string;
  modes: SpellMode[];
  modeCount: number; // How many modes to select (1 for charms, 2 for commands, etc.)
  canChooseAny?: boolean; // "Choose any number" / Spree
  minModes?: number;
  /** Season-style `{P}` budget ("Choose up to five {P} worth of modes"). */
  pBudget?: number;
  canRepeatModes?: boolean;
  onConfirm: (selectedModeIds: string[]) => void;
  onCancel: () => void;
}

function formatPCost(cost: number): string {
  return `{P}`.repeat(Math.max(1, cost));
}

export function ModalSpellSelectionModal({
  open,
  cardName,
  imageUrl,
  description,
  modes,
  modeCount,
  canChooseAny = false,
  minModes = 0,
  pBudget,
  canRepeatModes = false,
  onConfirm,
  onCancel,
}: ModalSpellSelectionProps) {
  // Ordered list so Season repeats preserve multiplicity.
  const [selectedModes, setSelectedModes] = useState<string[]>([]);

  React.useEffect(() => {
    if (open) {
      setSelectedModes([]);
    }
  }, [open, cardName, pBudget, modeCount]);

  const hasPBudget = Number.isFinite(Number(pBudget)) && Number(pBudget) > 0;
  const budget = hasPBudget ? Math.floor(Number(pBudget)) : 0;
  const spent = useMemo(
    () => (hasPBudget ? sumSelectedPCost(selectedModes, modes) : selectedModes.length),
    [hasPBudget, selectedModes, modes],
  );

  const modeCountById = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of selectedModes) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [selectedModes]);

  const toggleMode = useCallback((modeId: string) => {
    setSelectedModes((prev) => {
      if (hasPBudget) {
        const already = prev.includes(modeId);
        if (already && !canRepeatModes) {
          return prev.filter((id) => id !== modeId);
        }
        if (canAddModeUnderPBudget(prev, modeId, modes, budget, canRepeatModes)) {
          return [...prev, modeId];
        }
        return prev;
      }

      const next = new Set(prev);
      if (next.has(modeId)) {
        next.delete(modeId);
      } else if (canChooseAny || next.size < modeCount) {
        next.add(modeId);
      }
      return Array.from(next);
    });
  }, [hasPBudget, canRepeatModes, modes, budget, canChooseAny, modeCount]);

  const adjustModeCount = useCallback((modeId: string, delta: number) => {
    if (!hasPBudget || !canRepeatModes) {
      toggleMode(modeId);
      return;
    }
    setSelectedModes((prev) => {
      if (delta > 0) {
        if (!canAddModeUnderPBudget(prev, modeId, modes, budget, true)) return prev;
        return [...prev, modeId];
      }
      const idx = prev.lastIndexOf(modeId);
      if (idx < 0) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }, [hasPBudget, canRepeatModes, toggleMode, modes, budget]);

  const canConfirm = (() => {
    if (hasPBudget) {
      return (
        spent <= budget &&
        selectedModes.length >= Math.max(0, minModes) &&
        // "Up to" allows zero; non-zero min still enforced above.
        (minModes > 0 ? selectedModes.length >= minModes : true)
      );
    }
    if (canChooseAny) {
      return selectedModes.length >= Math.max(1, minModes || 0);
    }
    if (minModes > 0 && modeCount !== minModes) {
      return selectedModes.length >= minModes && selectedModes.length <= modeCount;
    }
    return selectedModes.length === modeCount;
  })();

  const handleConfirm = () => {
    if (canConfirm) {
      onConfirm(selectedModes);
    }
  };

  if (!open) return null;

  const modeWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  const modeWord = modeWords[modeCount] || `${modeCount}`;
  const headerTitle = hasPBudget
    ? `Choose up to ${budget} {P}`
    : `Choose ${canChooseAny ? 'any number' : modeWord}`;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
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
          maxWidth: 600,
          width: '95%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          {imageUrl && (
            <div
              style={{
                width: 100,
                height: 140,
                borderRadius: 8,
                overflow: 'hidden',
                flexShrink: 0,
                border: '2px solid #f59e0b',
                boxShadow: '0 0 20px rgba(245, 158, 11, 0.3)',
              }}
            >
              <img
                src={imageUrl}
                alt={cardName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#f59e0b' }}>
              {headerTitle}
            </h2>
            <div style={{ marginTop: 4, fontSize: 14, color: '#888' }}>
              {cardName}
            </div>
            {description && (
              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  borderRadius: 8,
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  fontSize: 11,
                  color: '#fcd34d',
                  lineHeight: 1.4,
                  maxHeight: 80,
                  overflow: 'auto',
                }}
              >
                {description}
              </div>
            )}
            <div
              style={{
                marginTop: 12,
                fontSize: 13,
                color: hasPBudget
                  ? (spent <= budget ? '#10b981' : '#f87171')
                  : selectedModes.length === modeCount
                    ? '#10b981'
                    : '#888',
              }}
            >
              {hasPBudget
                ? `${spent} / ${budget} {P} spent${canRepeatModes ? ' · repeats allowed' : ''}`
                : canChooseAny
                  ? `${selectedModes.length} mode${selectedModes.length !== 1 ? 's' : ''} selected`
                  : `${selectedModes.length} of ${modeCount} modes selected`}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {modes.map((mode, index) => {
            const count = modeCountById.get(mode.id) || 0;
            const isSelected = count > 0;
            const cost = modePCost(mode);
            const canAdd = hasPBudget
              ? canAddModeUnderPBudget(selectedModes, mode.id, modes, budget, canRepeatModes)
              : isSelected || canChooseAny || selectedModes.length < modeCount;
            const canSelect = hasPBudget
              ? (isSelected || canAdd)
              : canAdd;

            return (
              <div
                key={mode.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: 14,
                  borderRadius: 8,
                  border: isSelected ? '2px solid #f59e0b' : '2px solid #4a4a6a',
                  backgroundColor: isSelected ? 'rgba(245, 158, 11, 0.15)' : 'rgba(0,0,0,0.2)',
                  opacity: canSelect ? 1 : 0.5,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (hasPBudget && canRepeatModes) return;
                    if (canSelect) toggleMode(mode.id);
                  }}
                  disabled={!canSelect && !(hasPBudget && canRepeatModes)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: isSelected ? '2px solid #f59e0b' : '2px solid #666',
                    backgroundColor: isSelected ? '#f59e0b' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 600,
                    color: isSelected ? '#000' : '#888',
                    flexShrink: 0,
                    cursor: canSelect ? 'pointer' : 'not-allowed',
                    padding: 0,
                  }}
                >
                  {isSelected ? (hasPBudget && canRepeatModes ? count : '✓') : index + 1}
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#fff', marginBottom: 4 }}>
                    {hasPBudget && (
                      <span style={{ color: '#fbbf24', marginRight: 8, fontFamily: 'monospace' }}>
                        {formatPCost(cost)}
                      </span>
                    )}
                    {mode.name}
                  </div>
                  <div style={{ fontSize: 12, color: '#a0aec0', lineHeight: 1.4 }}>
                    {mode.description}
                  </div>
                </div>
                {hasPBudget && canRepeatModes && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => adjustModeCount(mode.id, -1)}
                      disabled={count < 1}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: '1px solid #4a4a6a',
                        background: 'transparent',
                        color: '#fff',
                        cursor: count < 1 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      −
                    </button>
                    <span style={{ minWidth: 16, textAlign: 'center', fontWeight: 600 }}>{count}</span>
                    <button
                      type="button"
                      onClick={() => adjustModeCount(mode.id, 1)}
                      disabled={!canAdd}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: '1px solid #4a4a6a',
                        background: 'transparent',
                        color: '#fff',
                        cursor: !canAdd ? 'not-allowed' : 'pointer',
                      }}
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '12px 28px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: canConfirm ? '#f59e0b' : '#4a4a6a',
              color: canConfirm ? '#000' : '#888',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Cast Spell
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalSpellSelectionModal;

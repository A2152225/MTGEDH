/**
 * ModalSpellSelectionModal.tsx
 * 
 * Modal for selecting modes on modal spells like:
 * - Austere Command (choose two)
 * - Cryptic Command (choose two)
 * - Confluence spells (choose three)
 * - Charms (choose one)
 */

import React, { useState, useCallback } from 'react';

export interface SpellMode {
  id: string;
  name: string;
  description: string;
}

export interface ModalSpellSelectionProps {
  open: boolean;
  cardName: string;
  imageUrl?: string;
  description?: string;
  modes: SpellMode[];
  modeCount: number; // How many modes to select (1 for charms, 2 for commands, etc.)
  canChooseAny?: boolean; // "Choose any number" option
  onConfirm: (selectedModeIds: string[]) => void;
  onCancel: () => void;
}

export function ModalSpellSelectionModal({
  open,
  cardName,
  imageUrl,
  description,
  modes,
  modeCount,
  canChooseAny = false,
  onConfirm,
  onCancel,
}: ModalSpellSelectionProps) {
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());

  // Reset selection when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedModes(new Set());
    }
  }, [open]);

  const toggleMode = useCallback((modeId: string) => {
    setSelectedModes(prev => {
      const next = new Set(prev);
      if (next.has(modeId)) {
        next.delete(modeId);
      } else if (canChooseAny || next.size < modeCount) {
        next.add(modeId);
      }
      return next;
    });
  }, [modeCount, canChooseAny]);

  const canConfirm = canChooseAny 
    ? selectedModes.size > 0 
    : selectedModes.size === modeCount;

  const handleConfirm = () => {
    if (canConfirm) {
      onConfirm(Array.from(selectedModes));
    }
  };

  if (!open) return null;

  const modeWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  const modeWord = modeWords[modeCount] || `${modeCount}`;

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
        {/* Header */}
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
              🎯 Choose {canChooseAny ? 'any number' : modeWord}
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
            <div style={{ marginTop: 12, fontSize: 13, color: selectedModes.size === modeCount ? '#10b981' : '#888' }}>
              {canChooseAny 
                ? `${selectedModes.size} mode${selectedModes.size !== 1 ? 's' : ''} selected`
                : `${selectedModes.size} of ${modeCount} modes selected`
              }
            </div>
          </div>
        </div>

        {/* Mode Selection */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {modes.map((mode, index) => {
            const isSelected = selectedModes.has(mode.id);
            const canSelect = isSelected || canChooseAny || selectedModes.size < modeCount;

            return (
              <button
                key={mode.id}
                onClick={() => canSelect && toggleMode(mode.id)}
                disabled={!canSelect}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: 14,
                  borderRadius: 8,
                  border: isSelected ? '2px solid #f59e0b' : '2px solid #4a4a6a',
                  backgroundColor: isSelected ? 'rgba(245, 158, 11, 0.15)' : 'rgba(0,0,0,0.2)',
                  cursor: canSelect ? 'pointer' : 'not-allowed',
                  opacity: canSelect ? 1 : 0.5,
                  transition: 'all 0.15s',
                  textAlign: 'left',
                }}
              >
                <div
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
                  }}
                >
                  {isSelected ? '✓' : index + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#fff', marginBottom: 4 }}>
                    {mode.name}
                  </div>
                  <div style={{ fontSize: 12, color: '#a0aec0', lineHeight: 1.4 }}>
                    {mode.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
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

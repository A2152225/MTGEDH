import React, { useState, useEffect } from 'react';

interface XValueSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSelect: (xValue: number) => void;
  cardName: string;
  abilityText?: string;
  minValue?: number;
  maxValue?: number;
  suggestedMax?: number;
  xCount?: number;
  affordableXHint?: number;
}

/**
 * Modal for selecting X value for activated abilities with X in their cost.
 * Examples: Steel Hellkite's {X}: Destroy all nonland permanents with mana value X
 */
export function XValueSelectionModal({
  isOpen,
  onClose,
  onCancel,
  onSelect,
  cardName,
  abilityText,
  minValue = 0,
  maxValue = 20,
  suggestedMax,
  xCount = 1,
  affordableXHint,
}: XValueSelectionModalProps) {
  const [xValue, setXValue] = useState(0);
  const effectiveMax = suggestedMax !== undefined ? Math.min(maxValue, suggestedMax) : maxValue;
  const effectiveXCount = Math.max(1, xCount);
  const totalManaForX = Math.max(0, xValue * effectiveXCount);
  const sliderPercent = effectiveMax > minValue
    ? ((xValue - minValue) / (effectiveMax - minValue)) * 100
    : 100;

  useEffect(() => {
    if (isOpen) {
      // Reset to 0 when modal opens
      setXValue(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (xValue >= minValue && xValue <= effectiveMax) {
      onSelect(xValue);
      onClose();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      (onCancel || onClose)();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={() => (onCancel || onClose)()}
    >
      <div
        style={{
          backgroundColor: '#1e293b',
          borderRadius: 12,
          padding: 24,
          minWidth: 400,
          maxWidth: 500,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          border: '1px solid #334155',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 16px 0', fontSize: 20, color: '#f1f5f9' }}>
          Choose X Value
        </h2>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 4 }}>
            Card: <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{cardName}</span>
          </div>
          {abilityText && (
            <div
              style={{
                fontSize: 12,
                color: '#cbd5e1',
                backgroundColor: '#0f172a',
                padding: 12,
                borderRadius: 8,
                marginTop: 8,
                border: '1px solid #1e293b',
                fontFamily: 'monospace',
              }}
            >
              {abilityText}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label
            htmlFor="x-value-input"
            style={{
              display: 'block',
              marginBottom: 8,
              fontSize: 14,
              color: '#cbd5e1',
            }}
          >
            X Value: {xValue}
          </label>

          {effectiveXCount > 1 && (
            <div
              style={{
                marginBottom: 8,
                fontSize: 13,
                color: '#cbd5e1',
              }}
            >
              Total mana paid for X: {totalManaForX} ({effectiveXCount} mana per X)
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input
              id="x-value-input"
              type="range"
              min={minValue}
              max={effectiveMax}
              value={xValue}
              onChange={(e) => setXValue(Number(e.target.value))}
              onKeyDown={handleKeyPress}
              style={{
                flex: 1,
                height: 8,
                borderRadius: 4,
                outline: 'none',
                background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${
                  sliderPercent
                }%, #334155 ${sliderPercent}%, #334155 100%)`,
              }}
              autoFocus
            />

            <input
              type="number"
              min={minValue}
              max={effectiveMax}
              value={xValue}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (val >= minValue && val <= effectiveMax) {
                  setXValue(val);
                }
              }}
              onKeyDown={handleKeyPress}
              style={{
                width: 80,
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #475569',
                backgroundColor: '#0f172a',
                color: '#f1f5f9',
                fontSize: 16,
                textAlign: 'center',
              }}
            />
          </div>

          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: '#64748b',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>Min: {minValue}</span>
            <span>Max: {effectiveMax}</span>
          </div>

          {effectiveXCount > 1 && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: '#94a3b8',
              }}
            >
              This activation has {effectiveXCount} X symbols, so the total mana paid changes in multiples of {effectiveXCount}.
            </div>
          )}

          {affordableXHint !== undefined && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: '#f59e0b',
                fontStyle: 'italic',
              }}
            >
              Current floating mana covers up to X={affordableXHint}
              {effectiveXCount > 1 ? ` (${affordableXHint * effectiveXCount} total mana toward X)` : ''}.
            </div>
          )}

          {suggestedMax !== undefined && suggestedMax < maxValue && affordableXHint === undefined && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: '#f59e0b',
                fontStyle: 'italic',
              }}
            >
              (Based on available mana)
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: 6,
              border: '1px solid #475569',
              backgroundColor: '#334155',
              color: '#e2e8f0',
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#475569';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#334155';
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            style={{
              padding: '10px 20px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#2563eb';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#3b82f6';
            }}
          >
            Activate with X={xValue}
          </button>
        </div>
      </div>
    </div>
  );
}

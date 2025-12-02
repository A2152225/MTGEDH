/**
 * ForetellModal.tsx
 * 
 * Modal for foretell ability selection and casting.
 * Supports:
 * - Foretelling cards from hand (exile face-down for {2})
 * - Casting foretold cards from exile for their foretell cost
 */

import React from 'react';

export interface ForetellOption {
  id: string;
  action: 'foretell' | 'cast';
  cost: string;
  description: string;
}

export interface ForetellModalProps {
  open: boolean;
  cardName: string;
  imageUrl?: string;
  options: ForetellOption[];
  onSelect: (option: ForetellOption) => void;
  onCancel: () => void;
}

export function ForetellModal({
  open,
  cardName,
  imageUrl,
  options,
  onSelect,
  onCancel,
}: ForetellModalProps) {
  if (!open) return null;

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
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 500,
          width: '90%',
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
                border: '2px solid #6366f1',
                boxShadow: '0 0 20px rgba(99, 102, 241, 0.3)',
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
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#6366f1' }}>
              🔮 Foretell
            </h2>
            <div style={{ marginTop: 4, fontSize: 14, color: '#888' }}>
              {cardName}
            </div>
            <div
              style={{
                marginTop: 12,
                padding: 12,
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                borderRadius: 8,
                border: '1px solid rgba(99, 102, 241, 0.3)',
                fontSize: 12,
                color: '#a5b4fc',
                lineHeight: 1.5,
              }}
            >
              <strong>Foretell</strong> — During your turn, you may pay {'{2}'} and exile this card from your hand face down. 
              Cast it on a later turn for its foretell cost.
            </div>
          </div>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {options.map(option => (
            <button
              key={option.id}
              onClick={() => onSelect(option)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 16,
                borderRadius: 8,
                border: '2px solid',
                borderColor: option.action === 'foretell' ? '#6366f1' : '#10b981',
                backgroundColor: option.action === 'foretell' 
                  ? 'rgba(99, 102, 241, 0.1)' 
                  : 'rgba(16, 185, 129, 0.1)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.02)';
                e.currentTarget.style.borderColor = option.action === 'foretell' ? '#818cf8' : '#34d399';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.borderColor = option.action === 'foretell' ? '#6366f1' : '#10b981';
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  backgroundColor: option.action === 'foretell' ? '#6366f1' : '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  flexShrink: 0,
                }}
              >
                {option.action === 'foretell' ? '🔮' : '✨'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#fff', marginBottom: 2 }}>
                  {option.action === 'foretell' ? 'Foretell Now' : 'Cast from Exile'}
                </div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  {option.description}
                </div>
              </div>
              <div
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: option.action === 'foretell' ? '#6366f1' : '#10b981',
                }}
              >
                {option.cost}
              </div>
            </button>
          ))}
        </div>

        {/* Cancel button */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
              color: '#888',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ForetellModal;

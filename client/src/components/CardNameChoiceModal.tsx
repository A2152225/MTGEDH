import React, { useEffect, useRef, useState } from 'react';

interface CardNameChoiceModalProps {
  open: boolean;
  title?: string;
  description?: string;
  cardName?: string;
  sourceImageUrl?: string;
  mandatory?: boolean;
  onConfirm: (cardName: string) => void;
  onCancel: () => void;
}

export function CardNameChoiceModal({
  open,
  title = 'Choose a Card Name',
  description,
  cardName,
  sourceImageUrl,
  mandatory = true,
  onConfirm,
  onCancel,
}: CardNameChoiceModalProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      // Focus after mount
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const trimmed = value.trim();
  const canConfirm = trimmed.length > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      if (!mandatory) onCancel();
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
        zIndex: 10001,
      }}
      onClick={(e) => {
        if (!mandatory && e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 520,
          width: '92%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onKeyDown={handleKeyDown}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {sourceImageUrl && (
            <img
              src={sourceImageUrl}
              alt={cardName || 'source'}
              style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }}
            />
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
            {cardName && (
              <div style={{ marginTop: 4, fontSize: 14, color: '#888' }}>
                for {cardName}
              </div>
            )}
            {description && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#aaa' }}>{description}</div>
            )}
          </div>
        </div>

        <div>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type a card name…"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid #4a4a6a',
              backgroundColor: '#252540',
              color: '#fff',
              fontSize: 14,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>
            Enter the exact name you want to choose.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          {!mandatory && (
            <button
              onClick={onCancel}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #3a3a5a',
                background: 'transparent',
                color: '#ddd',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid transparent',
              background: canConfirm ? '#3b82f6' : 'rgba(59, 130, 246, 0.4)',
              color: '#fff',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontWeight: 700,
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

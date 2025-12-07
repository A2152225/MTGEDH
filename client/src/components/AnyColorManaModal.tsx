/**
 * AnyColorManaModal.tsx
 * 
 * Modal for choosing a color when tapping a permanent that produces mana of "any color".
 * Used for cards like:
 * - Birds of Paradise
 * - Chromatic Lantern
 * - Reflecting Pool
 * - City of Brass
 * 
 * Features:
 * - Shows card image
 * - Displays five color buttons (WUBRG)
 * - Confirms selection via socket event
 */

import React, { useState, useCallback } from 'react';

export interface AnyColorManaModalProps {
  open: boolean;
  activationId: string;
  permanentId: string;
  cardName: string;
  amount: number;
  cardImageUrl?: string;
  onConfirm: (chosenColor: 'white' | 'blue' | 'black' | 'red' | 'green') => void;
  onCancel: () => void;
}

// Color theme data for each Magic color
const COLOR_DATA = {
  white: {
    name: 'White',
    symbol: 'W',
    bg: 'linear-gradient(135deg, #f9f7e8 0%, #fffdf4 100%)',
    border: '#d4cdb4',
    text: '#5a5442',
    hoverBg: 'linear-gradient(135deg, #fffdf4 0%, #ffffff 100%)',
    hoverBorder: '#b8ab7e',
  },
  blue: {
    name: 'Blue',
    symbol: 'U',
    bg: 'linear-gradient(135deg, #0e68ab 0%, #1e88c7 100%)',
    border: '#65b5e8',
    text: '#ffffff',
    hoverBg: 'linear-gradient(135deg, #1e88c7 0%, #3da3e0 100%)',
    hoverBorder: '#8ecbf0',
  },
  black: {
    name: 'Black',
    symbol: 'B',
    bg: 'linear-gradient(135deg, #1a0f0f 0%, #332222 100%)',
    border: '#5a4444',
    text: '#ffffff',
    hoverBg: 'linear-gradient(135deg, #332222 0%, #4a3333 100%)',
    hoverBorder: '#745555',
  },
  red: {
    name: 'Red',
    symbol: 'R',
    bg: 'linear-gradient(135deg, #d3202a 0%, #e74c3c 100%)',
    border: '#f39c9a',
    text: '#ffffff',
    hoverBg: 'linear-gradient(135deg, #e74c3c 0%, #ff6b5f 100%)',
    hoverBorder: '#ffb4ad',
  },
  green: {
    name: 'Green',
    symbol: 'G',
    bg: 'linear-gradient(135deg, #00733e 0%, #0f9d58 100%)',
    border: '#5cc88d',
    text: '#ffffff',
    hoverBg: 'linear-gradient(135deg, #0f9d58 0%, #34c073 100%)',
    hoverBorder: '#7fdfac',
  },
};

export function AnyColorManaModal({
  open,
  activationId,
  permanentId,
  cardName,
  amount,
  cardImageUrl,
  onConfirm,
  onCancel,
}: AnyColorManaModalProps) {
  const [selectedColor, setSelectedColor] = useState<'white' | 'blue' | 'black' | 'red' | 'green' | null>(null);

  // Reset selection when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedColor(null);
    }
  }, [open]);

  const handleColorClick = useCallback((color: 'white' | 'blue' | 'black' | 'red' | 'green') => {
    setSelectedColor(color);
    // Auto-confirm immediately when a color is clicked
    onConfirm(color);
  }, [onConfirm]);

  if (!open) return null;

  const manaText = amount > 1 ? `${amount} mana` : 'mana';

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        style={{
          backgroundColor: '#2a2a2a',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '500px',
          width: '90%',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          border: '2px solid #444',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: '20px', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px 0', color: '#fff', fontSize: '20px' }}>
            Choose Mana Color
          </h2>
          <p style={{ margin: 0, color: '#aaa', fontSize: '14px' }}>
            Tap {cardName} for {manaText} of any color
          </p>
        </div>

        {/* Card Image */}
        {cardImageUrl && (
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <img
              src={cardImageUrl}
              alt={cardName}
              style={{
                maxWidth: '200px',
                maxHeight: '280px',
                borderRadius: '4px',
                border: '1px solid #555',
              }}
            />
          </div>
        )}

        {/* Color Buttons */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          {(Object.keys(COLOR_DATA) as Array<keyof typeof COLOR_DATA>).map((color) => {
            const data = COLOR_DATA[color];
            const isSelected = selectedColor === color;
            
            return (
              <button
                key={color}
                onClick={() => handleColorClick(color)}
                style={{
                  background: isSelected ? data.hoverBg : data.bg,
                  border: `3px solid ${isSelected ? data.hoverBorder : data.border}`,
                  borderRadius: '8px',
                  padding: '20px 8px',
                  color: data.text,
                  fontSize: '24px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isSelected ? '0 0 12px rgba(255, 255, 255, 0.5)' : 'none',
                  transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = data.hoverBg;
                    e.currentTarget.style.borderColor = data.hoverBorder;
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = data.bg;
                    e.currentTarget.style.borderColor = data.border;
                    e.currentTarget.style.transform = 'scale(1)';
                  }
                }}
              >
                {data.symbol}
              </button>
            );
          })}
        </div>

        {/* Cancel Button */}
        <button
          onClick={onCancel}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#555',
            color: '#fff',
            border: '1px solid #777',
            borderRadius: '4px',
            fontSize: '14px',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#666';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#555';
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

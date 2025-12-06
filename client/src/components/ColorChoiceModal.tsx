/**
 * ColorChoiceModal.tsx
 * 
 * Modal for choosing a color for cards that require color selection:
 * - Caged Sun - "As Caged Sun enters the battlefield, choose a color"
 * - Gauntlet of Power - "As Gauntlet of Power enters the battlefield, choose a color"
 * - Extraplanar Lens - "As Extraplanar Lens enters the battlefield, you may choose a color"
 * etc.
 * 
 * Features:
 * - Shows card image and reason for color choice
 * - Displays five color buttons (WUBRG)
 * - Confirms selection via socket event
 */

import React, { useState, useCallback } from 'react';

export interface ColorChoiceModalProps {
  open: boolean;
  confirmId: string;
  cardName: string;
  reason: string;
  cardImageUrl?: string;
  colors?: ('white' | 'blue' | 'black' | 'red' | 'green')[];
  onConfirm: (selectedColor: 'white' | 'blue' | 'black' | 'red' | 'green') => void;
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

export function ColorChoiceModal({
  open,
  confirmId,
  cardName,
  reason,
  cardImageUrl,
  colors = ['white', 'blue', 'black', 'red', 'green'],
  onConfirm,
  onCancel,
}: ColorChoiceModalProps) {
  const [selectedColor, setSelectedColor] = useState<'white' | 'blue' | 'black' | 'red' | 'green' | null>(null);
  const [hoveredColor, setHoveredColor] = useState<'white' | 'blue' | 'black' | 'red' | 'green' | null>(null);

  // Reset selection when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedColor(null);
      setHoveredColor(null);
    }
  }, [open, confirmId]);

  const handleColorSelect = useCallback((color: 'white' | 'blue' | 'black' | 'red' | 'green') => {
    setSelectedColor(color);
  }, []);

  const handleConfirm = useCallback(() => {
    if (selectedColor) {
      onConfirm(selectedColor);
    }
  }, [selectedColor, onConfirm]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
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
          maxWidth: 550,
          width: '90%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#f59e0b' }}>
            Choose a Color
          </h2>
        </div>

        {/* Card info and image */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {cardImageUrl && (
            <div style={{ flexShrink: 0 }}>
              <img
                src={cardImageUrl}
                alt={cardName}
                style={{
                  width: 150,
                  height: 'auto',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#f59e0b' }}>
              {cardName}
            </div>
            <div style={{ 
              fontSize: 13, 
              color: '#ccc',
              padding: '10px 12px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
              lineHeight: 1.5,
            }}>
              {reason}
            </div>
          </div>
        </div>

        {/* Color selection buttons */}
        <div style={{ 
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '8px 0',
        }}>
          {colors.map(color => {
            const colorTheme = COLOR_DATA[color];
            const isSelected = selectedColor === color;
            const isHovered = hoveredColor === color;
            
            return (
              <button
                key={color}
                onClick={() => handleColorSelect(color)}
                onMouseEnter={() => setHoveredColor(color)}
                onMouseLeave={() => setHoveredColor(null)}
                style={{
                  padding: '16px 20px',
                  borderRadius: 8,
                  border: `2px solid ${isSelected ? colorTheme.hoverBorder : colorTheme.border}`,
                  background: isHovered || isSelected ? colorTheme.hoverBg : colorTheme.bg,
                  color: colorTheme.text,
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: isSelected ? 700 : 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  transition: 'all 0.2s ease',
                  transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                  boxShadow: isSelected 
                    ? `0 0 0 3px rgba(245,158,11,0.3), 0 4px 12px rgba(0,0,0,0.3)`
                    : '0 2px 4px rgba(0,0,0,0.2)',
                }}
              >
                {/* Mana symbol */}
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  fontWeight: 'bold',
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  border: `2px solid ${colorTheme.text}`,
                  flexShrink: 0,
                }}>
                  {colorTheme.symbol}
                </div>
                
                {/* Color name */}
                <div style={{ flex: 1, textAlign: 'left' }}>
                  {colorTheme.name}
                </div>
                
                {/* Selection indicator */}
                {isSelected && (
                  <div style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    backgroundColor: '#f59e0b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                  }}>
                    ✓
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #555',
              backgroundColor: 'transparent',
              color: '#aaa',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedColor}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: selectedColor ? '#f59e0b' : '#444',
              color: '#fff',
              cursor: selectedColor ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
              opacity: selectedColor ? 1 : 0.5,
            }}
          >
            Confirm {selectedColor ? COLOR_DATA[selectedColor].name : 'Color'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ColorChoiceModal;

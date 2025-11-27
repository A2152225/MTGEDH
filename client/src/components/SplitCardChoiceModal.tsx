/**
 * SplitCardChoiceModal.tsx
 * 
 * Modal for choosing which side/face of a split card or adventure card to cast.
 * Supports:
 * - Split cards (Fire // Ice)
 * - Adventure cards (Bonecrusher Giant // Stomp)
 * - Fuse cards (can cast both halves)
 * - Modal DFCs (Kazandu Mammoth // Kazandu Valley)
 */

import React, { useState } from 'react';
import type { CardFace } from '../../../shared/src';

export interface CardFaceOption {
  id: string;
  name: string;
  manaCost?: string;
  typeLine?: string;
  oracleText?: string;
  imageUrl?: string;
  isDefault?: boolean;
}

export interface SplitCardChoiceModalProps {
  open: boolean;
  cardName: string;
  layout: string; // 'split', 'adventure', 'modal_dfc', 'transform', etc.
  faces: CardFaceOption[];
  canFuse?: boolean; // For fuse split cards
  onChoose: (faceId: string, fused?: boolean) => void;
  onCancel: () => void;
}

/**
 * Get a human-readable label for the card layout
 */
function getLayoutLabel(layout: string): string {
  switch (layout?.toLowerCase()) {
    case 'split':
      return 'Split Card';
    case 'adventure':
      return 'Adventure Card';
    case 'modal_dfc':
      return 'Modal Double-Faced Card';
    case 'transform':
      return 'Transforming Card';
    case 'flip':
      return 'Flip Card';
    default:
      return 'Multi-Face Card';
  }
}

/**
 * Parse mana symbols in a mana cost string to colored spans
 */
function renderManaCost(manaCost?: string): React.ReactNode {
  if (!manaCost) return null;
  
  // Extract mana symbols like {W}, {U}, {B}, {R}, {G}, {C}, {1}, {2}, etc.
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];
  
  const colorMap: Record<string, string> = {
    'W': '#f9faf4',
    'U': '#0e68ab',
    'B': '#150b00',
    'R': '#d3202a',
    'G': '#00733e',
    'C': '#ccc2c0',
  };
  
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {symbols.map((sym, i) => {
        const inner = sym.replace(/[{}]/g, '');
        const color = colorMap[inner];
        const isNumber = /^\d+$/.test(inner);
        
        return (
          <span
            key={i}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: '50%',
              fontSize: 11,
              fontWeight: 600,
              background: color || (isNumber ? '#cbc5c0' : '#888'),
              color: inner === 'W' || isNumber ? '#111' : '#fff',
              border: '1px solid rgba(0,0,0,0.2)',
            }}
          >
            {inner}
          </span>
        );
      })}
    </span>
  );
}

export function SplitCardChoiceModal({
  open,
  cardName,
  layout,
  faces,
  canFuse,
  onChoose,
  onCancel,
}: SplitCardChoiceModalProps) {
  const [selectedFace, setSelectedFace] = useState<string | null>(null);
  const [fuseBoth, setFuseBoth] = useState(false);
  
  if (!open) return null;
  
  const layoutLabel = getLayoutLabel(layout);
  const isAdventure = layout?.toLowerCase() === 'adventure';
  const isSplit = layout?.toLowerCase() === 'split';
  
  const handleConfirm = () => {
    if (fuseBoth && canFuse) {
      onChoose('fuse', true);
    } else if (selectedFace) {
      onChoose(selectedFace, false);
    }
  };
  
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        zIndex: 8000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'linear-gradient(145deg, #1e1e2e 0%, #2d2d44 100%)',
          borderRadius: 12,
          border: '1px solid rgba(99,102,241,0.4)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          padding: 20,
          maxWidth: 600,
          width: '90%',
          color: '#e5e7eb',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#fff' }}>
            Choose which side to cast
          </h3>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
            {layoutLabel}: {cardName}
          </div>
        </div>
        
        {/* Face Options */}
        <div style={{ 
          display: 'flex', 
          gap: 12, 
          marginBottom: 16,
          flexWrap: 'wrap',
        }}>
          {faces.map((face) => {
            const isSelected = selectedFace === face.id;
            
            return (
              <button
                key={face.id}
                onClick={() => {
                  setSelectedFace(face.id);
                  setFuseBoth(false);
                }}
                style={{
                  flex: 1,
                  minWidth: 200,
                  padding: 12,
                  borderRadius: 8,
                  border: isSelected 
                    ? '2px solid #10b981' 
                    : '1px solid rgba(255,255,255,0.15)',
                  background: isSelected 
                    ? 'rgba(16,185,129,0.15)' 
                    : 'rgba(50,50,70,0.5)',
                  color: '#e5e7eb',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                {/* Face Image (if available) */}
                {face.imageUrl && (
                  <div style={{ marginBottom: 8 }}>
                    <img 
                      src={face.imageUrl} 
                      alt={face.name}
                      style={{ 
                        width: '100%', 
                        maxHeight: 120, 
                        objectFit: 'contain',
                        borderRadius: 4,
                      }}
                    />
                  </div>
                )}
                
                {/* Face Name and Cost */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: 4,
                }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{face.name}</span>
                  {renderManaCost(face.manaCost)}
                </div>
                
                {/* Type Line */}
                {face.typeLine && (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>
                    {face.typeLine}
                  </div>
                )}
                
                {/* Oracle Text Preview */}
                {face.oracleText && (
                  <div style={{ 
                    fontSize: 10, 
                    color: '#a0a0a0', 
                    maxHeight: 60, 
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.3,
                  }}>
                    {face.oracleText.slice(0, 150)}{face.oracleText.length > 150 ? '...' : ''}
                  </div>
                )}
                
                {/* Default indicator for adventure (creature is default) */}
                {isAdventure && face.isDefault && (
                  <div style={{ 
                    marginTop: 6, 
                    fontSize: 10, 
                    color: '#60a5fa',
                    fontStyle: 'italic',
                  }}>
                    ★ Main card
                  </div>
                )}
              </button>
            );
          })}
        </div>
        
        {/* Fuse Option (for split cards with fuse) */}
        {canFuse && isSplit && (
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={() => {
                setFuseBoth(true);
                setSelectedFace(null);
              }}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 8,
                border: fuseBoth 
                  ? '2px solid #f59e0b' 
                  : '1px solid rgba(255,255,255,0.15)',
                background: fuseBoth 
                  ? 'rgba(245,158,11,0.15)' 
                  : 'rgba(50,50,70,0.5)',
                color: '#e5e7eb',
                cursor: 'pointer',
                textAlign: 'center',
                fontWeight: 600,
              }}
            >
              <span style={{ color: '#f59e0b' }}>⚡ Fuse</span>
              <span style={{ fontWeight: 400, marginLeft: 8, fontSize: 12, color: '#9ca3af' }}>
                Cast both halves together
              </span>
            </button>
          </div>
        )}
        
        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedFace && !fuseBoth}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: (selectedFace || fuseBoth) ? '#10b981' : '#4b5563',
              color: '#fff',
              cursor: (selectedFace || fuseBoth) ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Cast {fuseBoth ? 'Fused' : selectedFace ? faces.find(f => f.id === selectedFace)?.name : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SplitCardChoiceModal;

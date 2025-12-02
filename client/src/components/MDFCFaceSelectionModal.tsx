/**
 * MDFCFaceSelectionModal.tsx
 * 
 * A modal for choosing which face of a Modal Double-Faced Card (MDFC) to play.
 * Used for cards like Blightstep Pathway / Searstep Pathway where both sides are lands.
 */

import React, { useCallback } from 'react';

export interface CardFace {
  index: number;
  name: string;
  typeLine: string;
  oracleText?: string;
  manaCost?: string;
  imageUrl?: string;
}

export interface MDFCFaceSelectionModalProps {
  open: boolean;
  cardName: string;
  title?: string;
  description?: string;
  faces: CardFace[];
  onConfirm: (selectedFace: number) => void;
  onCancel: () => void;
}

export function MDFCFaceSelectionModal({
  open,
  cardName,
  title,
  description,
  faces,
  onConfirm,
  onCancel,
}: MDFCFaceSelectionModalProps) {
  const handleSelectFace = useCallback((faceIndex: number) => {
    onConfirm(faceIndex);
  }, [onConfirm]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 600,
          width: '95%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#9b59b6' }}>
            {title || `Choose a Side for ${cardName}`}
          </h2>
          {description && (
            <p style={{ margin: '8px 0 0', fontSize: 14, color: '#888' }}>
              {description}
            </p>
          )}
        </div>

        {/* Card faces */}
        <div style={{ 
          display: 'flex', 
          gap: 16, 
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}>
          {faces.map((face) => (
            <button
              key={face.index}
              onClick={() => handleSelectFace(face.index)}
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '2px solid #444',
                borderRadius: 12,
                padding: 12,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                maxWidth: 200,
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#9b59b6';
                e.currentTarget.style.transform = 'translateY(-4px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#444';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {/* Card image */}
              {face.imageUrl ? (
                <img
                  src={face.imageUrl}
                  alt={face.name}
                  style={{
                    width: 150,
                    height: 'auto',
                    borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 150,
                    height: 209,
                    backgroundColor: '#333',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    color: '#666',
                  }}
                >
                  No Image
                </div>
              )}

              {/* Card name */}
              <div style={{ 
                fontSize: 14, 
                fontWeight: 600, 
                color: '#fff',
                textAlign: 'center',
              }}>
                {face.name}
              </div>

              {/* Type line */}
              <div style={{ 
                fontSize: 12, 
                color: '#888',
                textAlign: 'center',
              }}>
                {face.typeLine}
              </div>

              {/* Oracle text preview (truncated) */}
              {face.oracleText && (
                <div style={{ 
                  fontSize: 11, 
                  color: '#666',
                  textAlign: 'center',
                  maxHeight: 40,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {face.oracleText.substring(0, 80)}
                  {face.oracleText.length > 80 ? '...' : ''}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Cancel button */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 24px',
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
        </div>
      </div>
    </div>
  );
}

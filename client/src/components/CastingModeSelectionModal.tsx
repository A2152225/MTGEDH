/**
 * CastingModeSelectionModal.tsx
 * 
 * Modal for choosing between different casting modes for a spell:
 * - Overload: Cast normally vs with Overload (affects all permanents instead of targeting one)
 * - Abundant Harvest: Choose land vs nonland
 * - Other modal spells that need mode selection before targeting
 * 
 * Features:
 * - Shows spell image and description
 * - Displays available modes with costs and descriptions
 * - Highlights differences between modes (targeting vs each, cost differences)
 */

import React, { useState, useCallback, useEffect } from 'react';

export interface CastingMode {
  id: string;
  name: string;
  description: string;
  cost: string | null;
}

export interface CastingModeSelectionModalProps {
  open: boolean;
  cardId: string;
  cardName: string;
  source?: string;
  title: string;
  description: string;
  imageUrl?: string;
  modes: CastingMode[];
  effectId?: string;
  onConfirm: (selectedMode: string) => void;
  onCancel: () => void;
}

export function CastingModeSelectionModal({
  open,
  cardId,
  cardName,
  source,
  title,
  description,
  imageUrl,
  modes,
  effectId,
  onConfirm,
  onCancel,
}: CastingModeSelectionModalProps) {
  const [selectedMode, setSelectedMode] = useState<string | null>(null);

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      setSelectedMode(null);
    }
  }, [open, cardId, effectId]);

  const handleModeSelect = useCallback((modeId: string) => {
    setSelectedMode(modeId);
  }, []);

  const handleConfirm = useCallback(() => {
    if (selectedMode) {
      onConfirm(selectedMode);
    }
  }, [selectedMode, onConfirm]);

  if (!open) return null;

  const canConfirm = selectedMode !== null;
  const selectedModeData = modes.find(m => m.id === selectedMode);

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
          maxWidth: 650,
          width: '90%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#3b82f6' }}>
            {title}
          </h2>
        </div>

        {/* Card info */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {imageUrl && (
            <div style={{ flexShrink: 0 }}>
              <img
                src={imageUrl}
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
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#3b82f6' }}>
              {cardName}
            </div>
            <div style={{ 
              fontSize: 12, 
              color: '#aaa',
              padding: '10px 12px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
              lineHeight: 1.4,
              fontStyle: 'italic',
              maxHeight: '120px',
              overflowY: 'auto',
            }}>
              {description}
            </div>
          </div>
        </div>

        {/* Mode selection */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ fontSize: 14, color: '#aaa', marginBottom: 4 }}>
            Choose how to cast this spell:
          </div>
          
          {modes.map((mode) => {
            const isSelected = selectedMode === mode.id;
            const isOverload = mode.id === 'overload';
            const isNormal = mode.id === 'normal';
            
            return (
              <button
                key={mode.id}
                onClick={() => handleModeSelect(mode.id)}
                style={{
                  padding: '16px 20px',
                  borderRadius: 8,
                  border: isSelected ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.2)',
                  backgroundColor: isSelected 
                    ? 'rgba(59,130,246,0.2)' 
                    : 'rgba(255,255,255,0.05)',
                  color: '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                }}
              >
                {/* Mode header */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Icon */}
                    <div style={{
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      backgroundColor: isOverload 
                        ? 'rgba(239,68,68,0.3)' 
                        : isNormal 
                        ? 'rgba(34,197,94,0.3)' 
                        : 'rgba(168,85,247,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                    }}>
                      {isOverload ? '💥' : isNormal ? '🎯' : '✨'}
                    </div>
                    
                    {/* Mode name */}
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>
                        {mode.name}
                      </div>
                      {mode.cost && (
                        <div style={{ 
                          fontSize: 12, 
                          color: '#888',
                          fontFamily: 'monospace',
                        }}>
                          {mode.cost}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Selection indicator */}
                  {isSelected && (
                    <div style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      backgroundColor: '#3b82f6',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: 'bold',
                    }}>
                      ✓
                    </div>
                  )}
                </div>
                
                {/* Mode description */}
                <div style={{ 
                  fontSize: 13, 
                  color: '#ccc',
                  lineHeight: 1.5,
                  paddingLeft: 48,
                }}>
                  {mode.description}
                </div>
                
                {/* Overload badge */}
                {isOverload && (
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    padding: '4px 8px',
                    borderRadius: 4,
                    backgroundColor: 'rgba(239,68,68,0.2)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#fca5a5',
                    textTransform: 'uppercase',
                  }}>
                    Overload
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Info box for selected mode */}
        {selectedModeData && (
          <div style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.3)',
            borderRadius: 8,
            fontSize: 13,
            color: '#93c5fd',
          }}>
            <strong>Selected:</strong> {selectedModeData.name}
            {selectedModeData.cost && ` (${selectedModeData.cost})`}
          </div>
        )}

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
            disabled={!canConfirm}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: canConfirm ? '#3b82f6' : '#444',
              color: '#fff',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
              opacity: canConfirm ? 1 : 0.5,
            }}
          >
            Cast {selectedModeData ? `with ${selectedModeData.name}` : 'Spell'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CastingModeSelectionModal;

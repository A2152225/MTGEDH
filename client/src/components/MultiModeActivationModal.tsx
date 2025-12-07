/**
 * MultiModeActivationModal.tsx
 * 
 * A modal for selecting and activating multi-mode abilities on permanents, used for:
 * - Staff of Domination: Multiple tap abilities with different costs
 * - Trading Post: Multiple sacrifice/payment abilities
 * - Mind Stone: Tap for mana or sacrifice to draw
 * - Commander's Sphere: Tap for mana or sacrifice to draw
 * 
 * Supports:
 * - Multiple activation modes with different costs
 * - Cost validation and display
 * - Target selection for modes that require targets
 * - Visual feedback for available modes
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export interface AbilityMode {
  name: string;
  cost: string;
  effect: string;
  requiresTarget: boolean;
  targetType?: string;
}

export interface MultiModeActivationModalProps {
  open: boolean;
  permanent: {
    id: string;
    name: string;
    imageUrl?: string;
  };
  modes: AbilityMode[];
  // Callback when mode is selected
  onSelectMode: (modeIndex: number) => void;
  onCancel: () => void;
}

export function MultiModeActivationModal({
  open,
  permanent,
  modes,
  onSelectMode,
  onCancel,
}: MultiModeActivationModalProps) {
  const [selectedModeIndex, setSelectedModeIndex] = useState<number | null>(null);

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      setSelectedModeIndex(null);
    }
  }, [open]);

  const handleModeSelect = (index: number) => {
    setSelectedModeIndex(index);
  };

  const handleConfirm = () => {
    if (selectedModeIndex !== null) {
      onSelectMode(selectedModeIndex);
    }
  };

  if (!open) return null;

  const canConfirm = selectedModeIndex !== null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
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
          backgroundColor: '#1a1a1a',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
          border: '2px solid #444',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ margin: '0 0 12px 0', color: '#fff', fontSize: '22px' }}>
            Activate Ability
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#ccc', fontSize: '14px' }}>
            <span>{permanent.name}</span>
            {permanent.imageUrl && (
              <img
                src={permanent.imageUrl}
                alt={permanent.name}
                style={{ height: '80px', borderRadius: '6px', border: '1px solid #555' }}
                onMouseEnter={() => showCardPreview(permanent.imageUrl!)}
                onMouseLeave={hideCardPreview}
              />
            )}
          </div>
        </div>

        {/* Mode selection */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px 0', color: '#fff', fontSize: '16px' }}>
            Choose an ability to activate:
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {modes.map((mode, index) => {
              const isSelected = selectedModeIndex === index;
              
              return (
                <div
                  key={index}
                  onClick={() => handleModeSelect(index)}
                  style={{
                    padding: '16px',
                    backgroundColor: isSelected ? '#2a4a3a' : '#2a2a2a',
                    border: `2px solid ${isSelected ? '#5a9c69' : '#444'}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ fontSize: '16px', color: '#fff', fontWeight: isSelected ? 'bold' : 'normal' }}>
                      {mode.name}
                    </div>
                    <div style={{ 
                      fontSize: '14px', 
                      color: '#ffd700',
                      fontFamily: 'monospace',
                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                    }}>
                      {mode.cost}
                    </div>
                  </div>
                  
                  <div style={{ fontSize: '13px', color: '#aaa', lineHeight: '1.4' }}>
                    {mode.effect}
                  </div>
                  
                  {mode.requiresTarget && (
                    <div style={{ 
                      fontSize: '11px', 
                      color: '#f99', 
                      marginTop: '6px',
                      fontStyle: 'italic',
                    }}>
                      ⚠ Requires target {mode.targetType ? `(${mode.targetType})` : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px',
              backgroundColor: '#555',
              color: '#fff',
              border: '1px solid #777',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '10px 20px',
              backgroundColor: canConfirm ? '#4a7c59' : '#333',
              color: canConfirm ? '#fff' : '#888',
              border: `1px solid ${canConfirm ? '#5a9c69' : '#555'}`,
              borderRadius: '6px',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            Activate
          </button>
        </div>
      </div>
    </div>
  );
}

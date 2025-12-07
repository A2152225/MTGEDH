/**
 * CounterMovementModal.tsx
 * 
 * A modal for moving counters between permanents, used for abilities like:
 * - Nesting Grounds: "Move a counter from target permanent you control onto another target permanent"
 * - Clockspinning: "Choose a counter on target permanent or player. Remove or add another of those counters"
 * - Fate Transfer: "Move all counters from target creature onto another target creature"
 * 
 * Supports:
 * - Two-step selection: source permanent -> target permanent
 * - Counter type selection (when multiple types are present)
 * - Visual feedback for valid targets
 * - Preview of counter movement
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export interface CounterMovementModalProps {
  open: boolean;
  title: string;
  description?: string;
  source: { id: string; name: string; imageUrl?: string };
  // Filter for source permanent
  sourceFilter?: {
    controller?: 'you' | 'any';
  };
  // Filter for target permanent
  targetFilter?: {
    controller?: 'you' | 'any';
    excludeSource?: boolean;
  };
  // Available permanents that could potentially have counters or receive counters
  availablePermanents: BattlefieldPermanent[];
  // Current player ID
  playerId: string;
  // Callback when selection is confirmed
  onConfirm: (sourcePermanentId: string, targetPermanentId: string, counterType: string) => void;
  onCancel: () => void;
}

/**
 * Get all counter types on a permanent
 */
function getCounterTypes(perm: BattlefieldPermanent): string[] {
  const counters = (perm as any).counters || {};
  return Object.keys(counters).filter(type => counters[type] > 0);
}

/**
 * Check if a permanent can be a source (has counters)
 */
function canBeSource(
  perm: BattlefieldPermanent,
  filter: CounterMovementModalProps['sourceFilter'],
  playerId: string
): boolean {
  // Check controller requirement
  if (filter?.controller === 'you' && perm.controller !== playerId) return false;
  
  // Must have at least one counter
  const counterTypes = getCounterTypes(perm);
  return counterTypes.length > 0;
}

/**
 * Check if a permanent can be a target for counter movement
 */
function canBeTarget(
  perm: BattlefieldPermanent,
  sourcePerm: BattlefieldPermanent | null,
  filter: CounterMovementModalProps['targetFilter'],
  playerId: string
): boolean {
  // Check controller requirement
  if (filter?.controller === 'you' && perm.controller !== playerId) return false;
  
  // Cannot target source if excludeSource is true
  if (filter?.excludeSource && sourcePerm && perm.id === sourcePerm.id) return false;
  
  return true;
}

export function CounterMovementModal({
  open,
  title,
  description,
  source,
  sourceFilter,
  targetFilter,
  availablePermanents,
  playerId,
  onConfirm,
  onCancel,
}: CounterMovementModalProps) {
  const [step, setStep] = useState<'select-source' | 'select-counter' | 'select-target'>('select-source');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedCounterType, setSelectedCounterType] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setStep('select-source');
      setSelectedSourceId(null);
      setSelectedCounterType(null);
      setSelectedTargetId(null);
    }
  }, [open]);

  // Get source permanent
  const sourcePerm = useMemo(() => {
    if (!selectedSourceId) return null;
    return availablePermanents.find(p => p.id === selectedSourceId) || null;
  }, [selectedSourceId, availablePermanents]);

  // Filter permanents that can be sources
  const validSources = useMemo(() => {
    return availablePermanents.filter(perm => 
      canBeSource(perm, sourceFilter, playerId)
    );
  }, [availablePermanents, sourceFilter, playerId]);

  // Get counter types on selected source
  const availableCounterTypes = useMemo(() => {
    if (!sourcePerm) return [];
    return getCounterTypes(sourcePerm);
  }, [sourcePerm]);

  // Filter permanents that can be targets
  const validTargets = useMemo(() => {
    return availablePermanents.filter(perm => 
      canBeTarget(perm, sourcePerm, targetFilter, playerId)
    );
  }, [availablePermanents, sourcePerm, targetFilter, playerId]);

  const handleSourceSelect = (permanentId: string) => {
    setSelectedSourceId(permanentId);
    const perm = availablePermanents.find(p => p.id === permanentId);
    if (perm) {
      const counterTypes = getCounterTypes(perm);
      if (counterTypes.length === 1) {
        // Auto-select if only one counter type
        setSelectedCounterType(counterTypes[0]);
        setStep('select-target');
      } else {
        setStep('select-counter');
      }
    }
  };

  const handleCounterTypeSelect = (counterType: string) => {
    setSelectedCounterType(counterType);
    setStep('select-target');
  };

  const handleTargetSelect = (permanentId: string) => {
    setSelectedTargetId(permanentId);
  };

  const canConfirm = selectedSourceId && selectedCounterType && selectedTargetId;

  const handleConfirm = () => {
    if (canConfirm) {
      onConfirm(selectedSourceId!, selectedTargetId!, selectedCounterType!);
    }
  };

  const handleBack = () => {
    if (step === 'select-target') {
      if (availableCounterTypes.length > 1) {
        setStep('select-counter');
      } else {
        setStep('select-source');
      }
      setSelectedTargetId(null);
    } else if (step === 'select-counter') {
      setStep('select-source');
      setSelectedCounterType(null);
    }
  };

  if (!open) return null;

  const getStepTitle = () => {
    if (step === 'select-source') return 'Select source permanent';
    if (step === 'select-counter') return 'Select counter type to move';
    return 'Select target permanent';
  };

  const getStepDescription = () => {
    if (step === 'select-source') return 'Choose a permanent with counters';
    if (step === 'select-counter') {
      const card = sourcePerm?.card as KnownCardRef;
      return `Choose which counter to move from ${card?.name || 'permanent'}`;
    }
    return `Choose where to move the ${selectedCounterType} counter`;
  };

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
          maxWidth: '800px',
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
            {title}
          </h2>
          {description && (
            <p style={{ margin: '0 0 12px 0', color: '#aaa', fontSize: '14px', lineHeight: '1.5' }}>
              {description}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#ccc', fontSize: '14px' }}>
            <span>Source: {source.name}</span>
            {source.imageUrl && (
              <img
                src={source.imageUrl}
                alt={source.name}
                style={{ height: '60px', borderRadius: '4px', border: '1px solid #555' }}
              />
            )}
          </div>
        </div>

        {/* Progress indicator */}
        <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
          <div style={{ 
            padding: '6px 12px', 
            borderRadius: '4px', 
            backgroundColor: step === 'select-source' ? '#4a7c59' : '#333',
            color: '#fff',
            fontSize: '12px',
          }}>
            1. Source
          </div>
          {availableCounterTypes.length > 1 && (
            <div style={{ 
              padding: '6px 12px', 
              borderRadius: '4px', 
              backgroundColor: step === 'select-counter' ? '#4a7c59' : '#333',
              color: '#fff',
              fontSize: '12px',
            }}>
              2. Counter
            </div>
          )}
          <div style={{ 
            padding: '6px 12px', 
            borderRadius: '4px', 
            backgroundColor: step === 'select-target' ? '#4a7c59' : '#333',
            color: '#fff',
            fontSize: '12px',
          }}>
            {availableCounterTypes.length > 1 ? '3' : '2'}. Target
          </div>
        </div>

        {/* Step title */}
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 8px 0', color: '#fff', fontSize: '18px' }}>
            {getStepTitle()}
          </h3>
          <p style={{ margin: 0, color: '#bbb', fontSize: '13px' }}>
            {getStepDescription()}
          </p>
        </div>

        {/* Content */}
        <div style={{ marginBottom: '20px' }}>
          {/* Select source */}
          {step === 'select-source' && (
            <>
              {validSources.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: '14px' }}>
                  No permanents with counters available
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                  {validSources.map(perm => {
                    const card = perm.card as KnownCardRef;
                    const isSelected = selectedSourceId === perm.id;
                    const imageUrl = card?.image_uris?.small || card?.image_uris?.normal;
                    const counters = (perm as any).counters || {};
                    
                    return (
                      <div
                        key={perm.id}
                        onClick={() => handleSourceSelect(perm.id)}
                        onMouseEnter={() => imageUrl && showCardPreview(imageUrl)}
                        onMouseLeave={hideCardPreview}
                        style={{
                          padding: '8px',
                          backgroundColor: isSelected ? '#2a4a3a' : '#2a2a2a',
                          border: `2px solid ${isSelected ? '#5a9c69' : '#444'}`,
                          borderRadius: '8px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        {imageUrl && (
                          <img
                            src={imageUrl}
                            alt={card.name}
                            style={{
                              width: '100%',
                              borderRadius: '4px',
                              marginBottom: '6px',
                            }}
                          />
                        )}
                        <div style={{ fontSize: '12px', color: '#fff', fontWeight: 'bold' }}>
                          {card?.name || 'Unknown'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                          {Object.entries(counters).map(([type, count]) => (
                            <div key={type}>{count}x {type}</div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Select counter type */}
          {step === 'select-counter' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {availableCounterTypes.map(counterType => {
                const counters = (sourcePerm as any)?.counters || {};
                const count = counters[counterType] || 0;
                const isSelected = selectedCounterType === counterType;
                
                return (
                  <div
                    key={counterType}
                    onClick={() => handleCounterTypeSelect(counterType)}
                    style={{
                      padding: '16px',
                      backgroundColor: isSelected ? '#2a4a3a' : '#2a2a2a',
                      border: `2px solid ${isSelected ? '#5a9c69' : '#444'}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ fontSize: '16px', color: '#fff', fontWeight: 'bold' }}>
                      {counterType} counter
                    </div>
                    <div style={{ fontSize: '13px', color: '#aaa', marginTop: '4px' }}>
                      {count} available
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Select target */}
          {step === 'select-target' && (
            <>
              {validTargets.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: '14px' }}>
                  No valid target permanents available
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                  {validTargets.map(perm => {
                    const card = perm.card as KnownCardRef;
                    const isSelected = selectedTargetId === perm.id;
                    const imageUrl = card?.image_uris?.small || card?.image_uris?.normal;
                    const counters = (perm as any).counters || {};
                    
                    return (
                      <div
                        key={perm.id}
                        onClick={() => handleTargetSelect(perm.id)}
                        onMouseEnter={() => imageUrl && showCardPreview(imageUrl)}
                        onMouseLeave={hideCardPreview}
                        style={{
                          padding: '8px',
                          backgroundColor: isSelected ? '#2a4a3a' : '#2a2a2a',
                          border: `2px solid ${isSelected ? '#5a9c69' : '#444'}`,
                          borderRadius: '8px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        {imageUrl && (
                          <img
                            src={imageUrl}
                            alt={card.name}
                            style={{
                              width: '100%',
                              borderRadius: '4px',
                              marginBottom: '6px',
                            }}
                          />
                        )}
                        <div style={{ fontSize: '12px', color: '#fff', fontWeight: 'bold' }}>
                          {card?.name || 'Unknown'}
                        </div>
                        {Object.keys(counters).length > 0 && (
                          <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                            {Object.entries(counters).map(([type, count]) => (
                              <div key={type}>{count}x {type}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          {step !== 'select-source' && (
            <button
              onClick={handleBack}
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
              Back
            </button>
          )}
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
          {step === 'select-target' && (
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
              Move Counter
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

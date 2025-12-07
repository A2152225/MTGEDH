/**
 * TapUntapTargetModal.tsx
 * 
 * A modal for selecting permanents to tap or untap as part of an activated ability.
 * Used for abilities like:
 * - Saryth, the Viper's Fang: "Untap another target creature or land"
 * - Merrow Reejerey: "Tap or untap target permanent"
 * - Argothian Elder: "Untap two target lands"
 * - Civic Gardener: "Untap target creature or land"
 * - Elder Druid: "Tap or untap target artifact, creature, or land"
 * 
 * Supports:
 * - Filtering by permanent type (creature, land, artifact, permanent)
 * - Single or multiple target selection
 * - Tapping or untapping
 * - Visual feedback for valid targets
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export interface TapUntapTargetModalProps {
  open: boolean;
  title: string;
  description?: string;
  source: { id: string; name: string; imageUrl?: string };
  // Action to perform: 'tap', 'untap', or 'both' (let user choose)
  action: 'tap' | 'untap' | 'both';
  // Target filter
  targetFilter: {
    // Types of permanents that can be targeted
    types?: ('creature' | 'land' | 'artifact' | 'enchantment' | 'planeswalker' | 'permanent')[];
    // Controller requirement
    controller?: 'you' | 'opponent' | 'any';
    // Tap status requirement
    tapStatus?: 'tapped' | 'untapped' | 'any';
    // Exclude source permanent
    excludeSource?: boolean;
  };
  // Number of targets required
  targetCount: number;
  // Available permanents that could potentially be targeted
  availablePermanents: BattlefieldPermanent[];
  // Current player ID
  playerId: string;
  // Callback when selection is confirmed
  onConfirm: (selectedPermanentIds: string[], action: 'tap' | 'untap') => void;
  onCancel: () => void;
}

/**
 * Check if a permanent matches the target filter criteria
 */
function matchesFilter(
  perm: BattlefieldPermanent,
  filter: TapUntapTargetModalProps['targetFilter'],
  sourceId: string,
  playerId: string,
  requiredAction: 'tap' | 'untap' | 'both'
): boolean {
  const card = perm.card as KnownCardRef;
  if (!card) return false;
  
  // Check controller requirement
  if (filter.controller === 'you' && perm.controller !== playerId) return false;
  if (filter.controller === 'opponent' && perm.controller === playerId) return false;
  
  // Cannot target source if excludeSource is true
  if (filter.excludeSource && perm.id === sourceId) return false;
  
  // Check tap status requirement
  if (filter.tapStatus === 'tapped' && !perm.tapped) return false;
  if (filter.tapStatus === 'untapped' && perm.tapped) return false;
  
  // If action is specific (not 'both'), check if the permanent can be affected
  if (requiredAction === 'tap' && perm.tapped) return false; // Already tapped
  if (requiredAction === 'untap' && !perm.tapped) return false; // Already untapped
  
  // Check type filter
  if (filter.types && filter.types.length > 0) {
    const typeLine = (card.type_line || '').toLowerCase();
    
    // 'permanent' matches everything
    if (filter.types.includes('permanent')) return true;
    
    const matchesAnyType = filter.types.some(type => {
      if (type === 'permanent') return true;
      return typeLine.includes(type.toLowerCase());
    });
    if (!matchesAnyType) return false;
  }
  
  return true;
}

export function TapUntapTargetModal({
  open,
  title,
  description,
  source,
  action,
  targetFilter,
  targetCount,
  availablePermanents,
  playerId,
  onConfirm,
  onCancel,
}: TapUntapTargetModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [chosenAction, setChosenAction] = useState<'tap' | 'untap'>(action === 'both' ? 'untap' : action);

  // Reset selection when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
      setChosenAction(action === 'both' ? 'untap' : action);
    }
  }, [open, action]);

  // Filter permanents to only valid targets
  const validTargets = useMemo(() => {
    return availablePermanents.filter(perm => 
      matchesFilter(perm, targetFilter, source.id, playerId, action === 'both' ? chosenAction : action)
    );
  }, [availablePermanents, targetFilter, source.id, playerId, action, chosenAction]);

  const toggleSelect = useCallback((permanentId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(permanentId)) {
        next.delete(permanentId);
      } else if (next.size < targetCount) {
        next.add(permanentId);
      }
      return next;
    });
  }, [targetCount]);

  const canConfirm = selectedIds.size === targetCount;

  const handleConfirm = () => {
    if (canConfirm) {
      onConfirm(Array.from(selectedIds), chosenAction);
    }
  };

  if (!open) return null;

  const targetText = targetCount === 1 ? 'target' : `${targetCount} targets`;
  const actionText = action === 'both' ? `${chosenAction} ${targetText}` : `${action} ${targetText}`;

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

        {/* Action selector if 'both' */}
        {action === 'both' && (
          <div style={{ marginBottom: '16px', display: 'flex', gap: '12px' }}>
            <button
              onClick={() => {
                setChosenAction('tap');
                setSelectedIds(new Set()); // Clear selection when changing action
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: chosenAction === 'tap' ? '#4a7c59' : '#333',
                color: '#fff',
                border: `2px solid ${chosenAction === 'tap' ? '#5a9c69' : '#555'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: chosenAction === 'tap' ? 'bold' : 'normal',
              }}
            >
              Tap
            </button>
            <button
              onClick={() => {
                setChosenAction('untap');
                setSelectedIds(new Set()); // Clear selection when changing action
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: chosenAction === 'untap' ? '#4a7c59' : '#333',
                color: '#fff',
                border: `2px solid ${chosenAction === 'untap' ? '#5a9c69' : '#555'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: chosenAction === 'untap' ? 'bold' : 'normal',
              }}
            >
              Untap
            </button>
          </div>
        )}

        {/* Selection info */}
        <div style={{ marginBottom: '16px', color: '#bbb', fontSize: '14px' }}>
          Selected: {selectedIds.size} / {targetCount}
          {targetCount > 1 && selectedIds.size < targetCount && (
            <span style={{ color: '#f99', marginLeft: '8px' }}>
              (Select {targetCount - selectedIds.size} more)
            </span>
          )}
        </div>

        {/* Target list */}
        <div style={{ marginBottom: '20px' }}>
          {validTargets.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: '14px' }}>
              No valid targets available to {actionText}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
              {validTargets.map(perm => {
                const card = perm.card as KnownCardRef;
                const isSelected = selectedIds.has(perm.id);
                const imageUrl = card?.image_uris?.small || card?.image_uris?.normal;
                
                return (
                  <div
                    key={perm.id}
                    onClick={() => toggleSelect(perm.id)}
                    onMouseEnter={() => imageUrl && showCardPreview(imageUrl)}
                    onMouseLeave={hideCardPreview}
                    style={{
                      padding: '8px',
                      backgroundColor: isSelected ? '#2a4a3a' : '#2a2a2a',
                      border: `2px solid ${isSelected ? '#5a9c69' : '#444'}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      transform: isSelected ? 'scale(1.02)' : 'scale(1)',
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
                          opacity: perm.tapped ? 0.7 : 1,
                          transform: perm.tapped ? 'rotate(90deg)' : 'none',
                        }}
                      />
                    )}
                    <div style={{ fontSize: '12px', color: '#fff', fontWeight: isSelected ? 'bold' : 'normal' }}>
                      {card?.name || 'Unknown'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                      {perm.tapped ? '↻ Tapped' : '○ Untapped'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
            Confirm {actionText}
          </button>
        </div>
      </div>
    </div>
  );
}

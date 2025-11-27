/**
 * TapTargetSelectionModal.tsx
 * 
 * A modal for selecting permanents to tap as part of an activated ability cost.
 * Used for abilities like Drowner of Secrets that require tapping other permanents.
 * 
 * Supports:
 * - Filtering by creature type, controller, and tap status
 * - Multiple target selection
 * - Visual feedback for valid targets
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';
import type { TapOtherPermanentsCost } from '../utils/activatedAbilityParser';

export interface TapTargetSelectionModalProps {
  open: boolean;
  title: string;
  description?: string;
  source: { id: string; name: string; imageUrl?: string };
  cost: TapOtherPermanentsCost;
  // Available permanents that could potentially be tapped
  availablePermanents: BattlefieldPermanent[];
  // Callback when selection is confirmed
  onConfirm: (selectedPermanentIds: string[]) => void;
  onCancel: () => void;
}

/**
 * Check if a permanent matches the tap cost filter criteria
 */
function matchesFilter(
  perm: BattlefieldPermanent,
  cost: TapOtherPermanentsCost,
  sourceId: string
): boolean {
  const card = perm.card as KnownCardRef;
  if (!card) return false;
  
  // Must be untapped
  if (perm.tapped) return false;
  
  // Cannot tap the source permanent itself if notSelf is true
  if (cost.filter.notSelf && perm.id === sourceId) return false;
  
  // Check type filter
  if (cost.filter.types && cost.filter.types.length > 0) {
    const typeLine = (card.type_line || '').toLowerCase();
    const matchesAnyType = cost.filter.types.some(type => 
      typeLine.includes(type.toLowerCase())
    );
    if (!matchesAnyType) return false;
  }
  
  return true;
}

export function TapTargetSelectionModal({
  open,
  title,
  description,
  source,
  cost,
  availablePermanents,
  onConfirm,
  onCancel,
}: TapTargetSelectionModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
    }
  }, [open]);

  // Filter permanents to only valid targets
  const validTargets = useMemo(() => {
    return availablePermanents.filter(perm => 
      matchesFilter(perm, cost, source.id)
    );
  }, [availablePermanents, cost, source.id]);

  const toggleSelect = useCallback((permanentId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(permanentId)) {
        next.delete(permanentId);
      } else if (next.size < cost.count) {
        next.add(permanentId);
      }
      return next;
    });
  }, [cost.count]);

  const canConfirm = selectedIds.size === cost.count;

  const handleConfirm = () => {
    if (canConfirm) {
      onConfirm(Array.from(selectedIds));
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10002,
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
          padding: 20,
          maxWidth: 700,
          width: '90%',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {source.imageUrl && (
            <div
              style={{
                width: 60,
                height: 84,
                borderRadius: 6,
                overflow: 'hidden',
                flexShrink: 0,
                border: '1px solid #4a4a6a',
              }}
            >
              <img
                src={source.imageUrl}
                alt={source.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#f59e0b' }}>
              👆 {title}
            </h2>
            <div style={{ marginTop: 4, fontSize: 13, color: '#888' }}>
              {source.name}
            </div>
            {description && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#a0aec0' }}>
                {description}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
              Select {cost.count} {cost.filter.types?.join(' or ') || 'permanent'}{cost.count > 1 ? 's' : ''} to tap
              {selectedIds.size > 0 && ` • ${selectedIds.size}/${cost.count} selected`}
            </div>
          </div>
        </div>

        {/* Target Grid */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid #3a3a5a',
            borderRadius: 6,
            backgroundColor: '#252540',
            padding: 12,
          }}
        >
          {validTargets.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                gap: 8,
              }}
            >
              {validTargets.map(perm => {
                const card = perm.card as KnownCardRef;
                const isSelected = selectedIds.has(perm.id);
                const canSelect = isSelected || selectedIds.size < cost.count;

                return (
                  <div
                    key={perm.id}
                    onClick={() => canSelect && toggleSelect(perm.id)}
                    onMouseEnter={(e) => {
                      if (card && 'name' in card) {
                        showCardPreview(e.currentTarget as HTMLElement, card, { prefer: 'right' });
                      }
                    }}
                    onMouseLeave={(e) => {
                      hideCardPreview(e.currentTarget as HTMLElement);
                    }}
                    style={{
                      position: 'relative',
                      borderRadius: 6,
                      overflow: 'hidden',
                      border: isSelected ? '3px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: isSelected ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
                      cursor: canSelect ? 'pointer' : 'not-allowed',
                      opacity: canSelect ? 1 : 0.5,
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ width: '100%', aspectRatio: '0.72', overflow: 'hidden' }}>
                      {card?.image_uris?.small || card?.image_uris?.normal ? (
                        <img
                          src={card.image_uris.small || card.image_uris.normal}
                          alt={card.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            background: '#333',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            textAlign: 'center',
                            padding: 4,
                          }}
                        >
                          {card?.name || 'Unknown'}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        padding: '4px 6px',
                        fontSize: 10,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {card?.name || 'Unknown'}
                    </div>
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 4,
                          right: 4,
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          backgroundColor: '#f59e0b',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#000',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        ✓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
              No valid targets available. You need untapped {cost.filter.types?.join(' or ') || 'permanents'} you control.
            </div>
          )}
        </div>

        {/* Selected summary */}
        {selectedIds.size > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Selected to tap:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Array.from(selectedIds).map(id => {
                const perm = validTargets.find(p => p.id === id);
                const card = perm?.card as KnownCardRef;
                return perm ? (
                  <div
                    key={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 8px',
                      backgroundColor: 'rgba(245, 158, 11, 0.2)',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    {card?.name || 'Unknown'}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(id);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#888',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: 0,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px',
              borderRadius: 6,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
              color: '#fff',
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
              borderRadius: 6,
              border: 'none',
              backgroundColor: canConfirm ? '#f59e0b' : '#4a4a6a',
              color: canConfirm ? '#000' : '#888',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Tap {cost.count} {cost.filter.types?.[0] || 'Permanent'}{cost.count > 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TapTargetSelectionModal;

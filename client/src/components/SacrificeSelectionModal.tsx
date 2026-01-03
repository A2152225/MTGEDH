/**
 * SacrificeSelectionModal.tsx
 * 
 * Modal for selecting permanents to sacrifice.
 * Used for cards like Fleshbag Marauder, Grave Pact, 
 * Dictate of Erebos, and similar sacrifice effects.
 */

import React, { useState, useMemo } from 'react';
import type { BattlefieldPermanent, KnownCardRef, PlayerID } from '../../../shared/src';

export interface SacrificeSelectionProps {
  open: boolean;
  title: string;
  description: string;
  permanents: BattlefieldPermanent[];
  count: number;
  permanentType?: 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent' | 'artifact_or_creature' | 'artifact or creature';
  sourceImage?: string;
  onConfirm: (selectedIds: string[]) => void;
  onCancel?: () => void;
}

function getCardInfo(perm: BattlefieldPermanent): {
  name: string;
  typeLine: string;
  pt?: string;
  imageUrl?: string;
} {
  const card = perm.card as KnownCardRef | undefined;
  const name = card?.name || perm.id;
  const typeLine = card?.type_line || '';
  
  let pt: string | undefined;
  if (perm.basePower !== undefined && perm.baseToughness !== undefined) {
    const power = perm.basePower + (perm.counters?.['+1/+1'] || 0) - (perm.counters?.['-1/-1'] || 0);
    const toughness = perm.baseToughness + (perm.counters?.['+1/+1'] || 0) - (perm.counters?.['-1/-1'] || 0);
    pt = `${power}/${toughness}`;
  } else if (card?.power && card?.toughness) {
    pt = `${card.power}/${card.toughness}`;
  }
  
  const imageUrl = card?.image_uris?.small || card?.image_uris?.normal;
  
  return { name, typeLine, pt, imageUrl };
}

export function SacrificeSelectionModal({
  open,
  title,
  description,
  permanents,
  count,
  permanentType,
  sourceImage,
  onConfirm,
  onCancel,
}: SacrificeSelectionProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection when modal opens/closes
  React.useEffect(() => {
    if (open) {
      setSelected(new Set());
    }
  }, [open]);

  // Filter permanents by type if specified
  const filteredPermanents = useMemo(() => {
    if (!permanentType || permanentType === 'permanent') {
      return permanents;
    }
    return permanents.filter(perm => {
      const typeLine = (perm.card as KnownCardRef)?.type_line?.toLowerCase() || '';
      // Handle compound types like "artifact_or_creature" or "artifact or creature"
      if (permanentType === 'artifact_or_creature' || permanentType === 'artifact or creature') {
        return typeLine.includes('artifact') || typeLine.includes('creature');
      }
      return typeLine.includes(permanentType);
    });
  }, [permanents, permanentType]);

  const handleToggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < count) {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selected));
  };

  const canConfirm = selected.size === count;
  const needMore = count - selected.size;

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
          maxWidth: 700,
          width: '90%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          {sourceImage && (
            <img
              src={sourceImage}
              alt="Source"
              style={{
                width: 100,
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            />
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
              💀 {title}
            </h2>
            <div style={{
              fontSize: 14,
              color: '#ccc',
              padding: 12,
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderRadius: 8,
              lineHeight: 1.5,
            }}>
              {description}
            </div>
          </div>
        </div>

        {/* Selection status */}
        <div style={{
          fontSize: 14,
          color: canConfirm ? '#10b981' : '#f59e0b',
          marginBottom: 16,
          textAlign: 'center',
          fontWeight: 600,
        }}>
          {canConfirm
            ? `✓ Ready to sacrifice ${count} permanent${count !== 1 ? 's' : ''}`
            : `Select ${needMore} more ${permanentType || 'permanent'}${needMore !== 1 ? 's' : ''}`
          }
        </div>

        {/* Permanents grid */}
        {filteredPermanents.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: '#888',
            padding: 40,
            fontSize: 16,
          }}>
            No valid {permanentType || 'permanent'}s to sacrifice
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}>
            {filteredPermanents.map(perm => {
              const { name, typeLine, pt, imageUrl } = getCardInfo(perm);
              const isSelected = selected.has(perm.id);
              
              return (
                <button
                  key={perm.id}
                  onClick={() => handleToggle(perm.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: 8,
                    borderRadius: 8,
                    border: isSelected 
                      ? '3px solid #ef4444' 
                      : '2px solid #4a4a6a',
                    backgroundColor: isSelected 
                      ? 'rgba(239,68,68,0.2)' 
                      : 'rgba(0,0,0,0.3)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    textAlign: 'center',
                  }}
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={name}
                      style={{
                        width: '100%',
                        borderRadius: 4,
                        marginBottom: 6,
                        opacity: isSelected ? 0.8 : 1,
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      height: 140,
                      background: '#222',
                      borderRadius: 4,
                      marginBottom: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      padding: 8,
                      textAlign: 'center',
                    }}>
                      {name}
                    </div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>
                    {name}
                  </div>
                  {pt && (
                    <div style={{ fontSize: 10, color: '#888' }}>
                      {pt}
                    </div>
                  )}
                  {isSelected && (
                    <div style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: '#ef4444',
                      fontWeight: 600,
                    }}>
                      ⚰️ Sacrificing
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Action buttons */}
        <div style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'flex-end',
          paddingTop: 16,
          borderTop: '1px solid #333',
        }}>
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: '12px 24px',
                borderRadius: 8,
                border: '1px solid #4a4a6a',
                backgroundColor: 'transparent',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: canConfirm ? '#ef4444' : '#333',
              color: canConfirm ? '#fff' : '#666',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Sacrifice {selected.size > 0 ? selected.size : ''} {permanentType || 'Permanent'}{selected.size !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SacrificeSelectionModal;

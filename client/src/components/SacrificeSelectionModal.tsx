/**
 * SacrificeSelectionModal.tsx
 * 
 * Modal for selecting permanents to sacrifice.
 * Used for cards like Fleshbag Marauder, Grave Pact, 
 * Dictate of Erebos, and similar sacrifice effects.
 */

import React, { useState, useMemo } from 'react';
import type { BattlefieldPermanent, KnownCardRef, PlayerID } from '../../../shared/src';
import type { SacrificeType } from '../../../shared/src/textUtils';
import { getCardPreviewHandlers } from './CardPreviewLayer';
import {
  adjustStackSelection,
  expandStackSelection,
  stackMemberIds,
  stackSelectionTotal,
} from '../utils/sacrificeStackSelection';

export interface SacrificeSelectionProps {
  open: boolean;
  title: string;
  description: string;
  permanents: BattlefieldPermanent[];
  /** Exact number to pick, or the maximum when `minCount` is set. */
  count: number;
  /** Allow confirming with fewer than `count`, in multiples of `countStep` (repeatable activations). */
  minCount?: number;
  countStep?: number;
  /** 
   * Type of permanent required for sacrifice.
  * Use 'artifact_or_creature' or 'nonland_permanent' for compound restrictions.
   */
  permanentType?: Exclude<SacrificeType, 'self'>;
  creatureSubtype?: string;
  excludePermanentId?: string;
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
  if (typeof (perm as any).effectivePower === 'number' && typeof (perm as any).effectiveToughness === 'number') {
    pt = `${(perm as any).effectivePower}/${(perm as any).effectiveToughness}`;
  } else if (perm.basePower !== undefined && perm.baseToughness !== undefined) {
    const power = Number(perm.basePower) + (perm.counters?.['+1/+1'] || 0) - (perm.counters?.['-1/-1'] || 0);
    const toughness = Number(perm.baseToughness) + (perm.counters?.['+1/+1'] || 0) - (perm.counters?.['-1/-1'] || 0);
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
  minCount,
  countStep,
  permanentType,
  creatureSubtype,
  excludePermanentId,
  sourceImage,
  onConfirm,
  onCancel,
}: SacrificeSelectionProps) {
  // Tile id -> how many of its stack members are picked (stacked tokens share one tile).
  const [selected, setSelected] = useState<Map<string, number>>(new Map());

  // Reset selection when modal opens/closes
  React.useEffect(() => {
    if (open) {
      setSelected(new Map());
    }
  }, [open]);

  // Filter permanents by type if specified
  const filteredPermanents = useMemo(() => {
    if (!permanentType || permanentType === 'permanent') {
      return permanents.filter((perm) => String(perm.id || '') !== String(excludePermanentId || ''));
    }
    return permanents.filter(perm => {
      if (String(perm.id || '') === String(excludePermanentId || '')) return false;
      const typeLine = (perm.card as KnownCardRef)?.type_line?.toLowerCase() || '';
      // Handle compound type: "artifact_or_creature" matches either artifact or creature
      if (permanentType === 'artifact_or_creature') {
        const matches = typeLine.includes('artifact') || typeLine.includes('creature');
        if (!matches) return false;
        if (creatureSubtype && typeLine.includes('creature')) {
          return typeLine.includes(creatureSubtype.toLowerCase());
        }
        return true;
      }
      if (permanentType === 'nonland_permanent') {
        return !typeLine.includes('land');
      }
      if (!typeLine.includes(permanentType)) return false;
      if (creatureSubtype && permanentType === 'creature') {
        return typeLine.includes(creatureSubtype.toLowerCase());
      }
      return true;
    });
  }, [creatureSubtype, excludePermanentId, permanents, permanentType]);

  const setTileQuantity = (perm: BattlefieldPermanent, qty: number) => {
    setSelected(prev => adjustStackSelection(prev, perm, qty, count));
  };

  const handleToggle = (perm: BattlefieldPermanent) => {
    const current = selected.get(String(perm.id)) || 0;
    if (stackMemberIds(perm).length > 1) {
      setTileQuantity(perm, current + 1);
    } else {
      setTileQuantity(perm, current > 0 ? 0 : 1);
    }
  };

  const handleConfirm = () => {
    onConfirm(expandStackSelection(filteredPermanents, selected));
  };

  const selectedTotal = stackSelectionTotal(selected);
  const step = Math.max(1, countStep || 1);
  const minimum = typeof minCount === 'number' ? Math.max(1, Math.min(minCount, count)) : count;
  const canConfirm = selectedTotal >= minimum && selectedTotal <= count && selectedTotal % step === 0;
  const needMore = Math.max(0, minimum - selectedTotal);

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
            ? `✓ Ready to sacrifice ${selectedTotal} permanent${selectedTotal !== 1 ? 's' : ''}${minimum < count ? ` (up to ${count})` : ''}`
            : needMore > 0
              ? `Select ${needMore} more ${permanentType || 'permanent'}${needMore !== 1 ? 's' : ''}${minimum < count ? ` (up to ${count})` : ''}`
              : `Select a multiple of ${step}`
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
            No valid {creatureSubtype || permanentType || 'permanent'}s to sacrifice
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
              const stackSize = stackMemberIds(perm).length;
              const pickedQty = selected.get(String(perm.id)) || 0;
              const isSelected = pickedQty > 0;

              return (
                <div
                  key={perm.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleToggle(perm)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleToggle(perm);
                    }
                  }}
                  {...getCardPreviewHandlers({ imageUrl, name, type_line: typeLine })}
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
                    {name}{stackSize > 1 ? ` ×${stackSize}` : ''}
                  </div>
                  {pt && (
                    <div style={{ fontSize: 10, color: '#888' }}>
                      {pt}
                    </div>
                  )}
                  {stackSize > 1 && (
                    <div
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setTileQuantity(perm, pickedQty - 1)}
                        disabled={pickedQty <= 0}
                        style={{ width: 22, height: 22, padding: 0 }}
                        title="Sacrifice one fewer"
                      >
                        −
                      </button>
                      <span style={{ minWidth: 34, fontSize: 12, color: '#fff' }}>{pickedQty}/{stackSize}</span>
                      <button
                        type="button"
                        onClick={() => setTileQuantity(perm, pickedQty + 1)}
                        disabled={pickedQty >= stackSize || selectedTotal >= count}
                        style={{ width: 22, height: 22, padding: 0 }}
                        title="Sacrifice one more"
                      >
                        +
                      </button>
                    </div>
                  )}
                  {isSelected && (
                    <div style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: '#ef4444',
                      fontWeight: 600,
                    }}>
                      ⚰️ Sacrificing{stackSize > 1 ? ` ${pickedQty}` : ''}
                    </div>
                  )}
                </div>
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
            Sacrifice {selectedTotal > 0 ? selectedTotal : ''} {permanentType || 'Permanent'}{selectedTotal !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SacrificeSelectionModal;

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

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import { getCardPreviewHandlers, getCardThumbnailUrl } from './CardPreviewLayer';

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
    // Subtypes of permanents
    subtypes?: string[];
    // Require all types
    requireAllTypes?: boolean;
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
  /** Map of player id → display name (from game view). */
  playerNames?: Record<string, string>;
  // Whether the chosen action should also filter targets by current tap state.
  enforceActionAvailability?: boolean;
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
  requiredAction: 'tap' | 'untap' | 'both',
  enforceActionAvailability: boolean
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
  if (enforceActionAvailability) {
    if (requiredAction === 'tap' && perm.tapped) return false; // Already tapped
    if (requiredAction === 'untap' && !perm.tapped) return false; // Already untapped
  }
  
  // Check type filter
  if (filter.types && filter.types.length > 0) {
    const typeLine = (card.type_line || '').toLowerCase();
    
    // 'permanent' matches everything
    if (!filter.types.includes('permanent')) {
      const requireAllTypes = filter.requireAllTypes === true;
      if (requireAllTypes) {
        const matchesAll = filter.types.every(type => {
          if (type === 'permanent') return true;
          return typeLine.includes(type.toLowerCase());
        });
        if (!matchesAll) return false;
      } else {
        const matchesAnyType = filter.types.some(type => {
          if (type === 'permanent') return true;
          return typeLine.includes(type.toLowerCase());
        });
        if (!matchesAnyType) return false;
      }
    }
  }

  // Check subtype filter
  if (filter.subtypes && filter.subtypes.length > 0) {
    const typeLine = (card.type_line || '').toLowerCase();
    const matchesAllSub = filter.subtypes.every(sub => 
      typeLine.includes(sub.toLowerCase())
    );
    if (!matchesAllSub) return false;
  }
  
  return true;
}

function formatPlayerLabel(
  id: string | undefined,
  _viewerId: string,
  playerNames?: Record<string, string>,
): string {
  if (!id) return 'Unknown';
  // Always prefer the table display name for politics ("tap King's Command Tower").
  return playerNames?.[id] || id;
}

function groupTargetsByController(
  targets: BattlefieldPermanent[],
  viewerId: string,
): { controllerId: string; targets: BattlefieldPermanent[] }[] {
  const groups = new Map<string, BattlefieldPermanent[]>();
  for (const perm of targets) {
    const controllerId = String(perm.controller || 'unknown');
    const bucket = groups.get(controllerId) || [];
    bucket.push(perm);
    groups.set(controllerId, bucket);
  }

  return Array.from(groups.entries())
    .map(([controllerId, controllerTargets]) => ({
      controllerId,
      targets: controllerTargets.sort((a, b) => {
        const nameA = String((a.card as KnownCardRef)?.name || '').toLowerCase();
        const nameB = String((b.card as KnownCardRef)?.name || '').toLowerCase();
        if (nameA !== nameB) return nameA.localeCompare(nameB);
        if (Boolean(a.tapped) !== Boolean(b.tapped)) return a.tapped ? 1 : -1;
        return String(a.id).localeCompare(String(b.id));
      }),
    }))
    .sort((a, b) => {
      if (a.controllerId === viewerId && b.controllerId !== viewerId) return -1;
      if (b.controllerId === viewerId && a.controllerId !== viewerId) return 1;
      return a.controllerId.localeCompare(b.controllerId);
    });
}

function formatPermanentState(perm: BattlefieldPermanent): string[] {
  const badges: string[] = [];
  badges.push(perm.tapped ? 'Tapped' : 'Untapped');
  if (perm.summoningSickness) badges.push('Sick');
  if ((perm.card as KnownCardRef | undefined)?.faceDown || (perm as any).faceDown) badges.push('Face-down');
  if (perm.phasedOut) badges.push('Phased out');
  const counters = perm.counters || {};
  const counterParts = Object.entries(counters)
    .filter(([, count]) => Number(count) > 0)
    .map(([type, count]) => `${count} ${type}`)
    .slice(0, 3);
  if (counterParts.length > 0) badges.push(counterParts.join(', '));
  return badges;
}

function formatPowerToughness(perm: BattlefieldPermanent, card: KnownCardRef | undefined): string | null {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature') && !typeLine.includes('vehicle')) return null;
  if (typeof (perm as any).effectivePower === 'number' && typeof (perm as any).effectiveToughness === 'number') {
    return `${(perm as any).effectivePower}/${(perm as any).effectiveToughness}`;
  }
  if (perm.basePower !== undefined && perm.baseToughness !== undefined) {
    const plus = Number(perm.counters?.['+1/+1'] || 0);
    const minus = Number(perm.counters?.['-1/-1'] || 0);
    return `${Number(perm.basePower) + plus - minus}/${Number(perm.baseToughness) + plus - minus}`;
  }
  if (card?.power != null && card?.toughness != null) {
    return `${card.power}/${card.toughness}`;
  }
  return null;
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
  playerNames,
  enforceActionAvailability = true,
  onConfirm,
  onCancel,
}: TapUntapTargetModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [chosenAction, setChosenAction] = useState<'tap' | 'untap'>(action === 'both' ? 'untap' : action);

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
      setChosenAction(action === 'both' ? 'untap' : action);
    }
  }, [open, action]);

  // Filter permanents to only valid targets.
  // Grouped tokens (server optimization for many identical tokens) are expanded into
  // individual entries so the player can select any subset of them independently.
  const validTargets = useMemo(() => {
    const expanded: BattlefieldPermanent[] = [];
    const requiredAction = action === 'both' ? chosenAction : action;
    for (const perm of availablePermanents) {
      const groupedIds = (perm as any).groupedTokenIds as string[] | undefined;
      if ((perm as any).isGroupedTokens && Array.isArray(groupedIds) && groupedIds.length > 0) {
        // Expand each individual token from the group using its real permanent ID.
        // The server's battlefield holds real entries under these IDs, so submissions
        // with individual IDs will pass validation correctly.
        for (const tokenId of groupedIds) {
          const individual = { ...perm, id: tokenId, isGroupedTokens: false, tokenCount: 1 } as BattlefieldPermanent;
          if (matchesFilter(individual, targetFilter, source.id, playerId, requiredAction, enforceActionAvailability)) {
            expanded.push(individual);
          }
        }
      } else {
        if (matchesFilter(perm, targetFilter, source.id, playerId, requiredAction, enforceActionAvailability)) {
          expanded.push(perm);
        }
      }
    }
    return expanded;
  }, [availablePermanents, targetFilter, source.id, playerId, action, chosenAction, enforceActionAvailability]);

  const groupedTargets = useMemo(
    () => groupTargetsByController(validTargets, playerId),
    [validTargets, playerId],
  );

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
            groupedTargets.map(({ controllerId, targets }) => {
              const controllerLabel = formatPlayerLabel(controllerId, playerId, playerNames);
              const isYours = controllerId === playerId;
              return (
                <div key={controllerId} style={{ marginBottom: '16px' }}>
                  <div
                    style={{
                      marginBottom: '8px',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      backgroundColor: isYours ? 'rgba(8, 145, 178, 0.22)' : 'rgba(154, 52, 18, 0.22)',
                      border: `1px solid ${isYours ? 'rgba(56, 189, 248, 0.55)' : 'rgba(251, 146, 60, 0.55)'}`,
                      color: isYours ? '#a5f3fc' : '#fdba74',
                      fontSize: '13px',
                      fontWeight: 700,
                    }}
                  >
                    {controllerLabel}'s permanents ({targets.length})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                    {targets.map(perm => {
                      const card = perm.card as KnownCardRef;
                      const isSelected = selectedIds.has(perm.id);
                      const imageUrl = getCardThumbnailUrl(card);
                      const isTapped = Boolean(perm.tapped);
                      const ownerDiffers = Boolean(perm.owner) && perm.owner !== perm.controller;
                      const ownerLabel = ownerDiffers
                        ? formatPlayerLabel(perm.owner, playerId, playerNames)
                        : null;
                      const typeLine = String(card?.type_line || '').trim();
                      const pt = formatPowerToughness(perm, card);
                      const stateBadges = formatPermanentState(perm);

                      return (
                        <div
                          key={perm.id}
                          onClick={() => toggleSelect(perm.id)}
                          {...getCardPreviewHandlers({ card, imageUrl, name: card?.name, type_line: typeLine })}
                          style={{
                            padding: '8px',
                            backgroundColor: isSelected
                              ? '#2a4a3a'
                              : isYours
                                ? 'rgba(14, 116, 144, 0.18)'
                                : 'rgba(154, 52, 18, 0.14)',
                            border: `2px solid ${
                              isSelected
                                ? '#5a9c69'
                                : isYours
                                  ? 'rgba(56, 189, 248, 0.85)'
                                  : 'rgba(251, 146, 60, 0.8)'
                            }`,
                            borderRadius: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                          }}
                        >
                          <div style={{ position: 'relative', marginBottom: '6px', overflow: 'hidden', borderRadius: '4px' }}>
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={card?.name || 'Permanent'}
                                style={{
                                  width: '100%',
                                  aspectRatio: '0.72',
                                  objectFit: 'cover',
                                  borderRadius: '4px',
                                  display: 'block',
                                  opacity: isTapped ? 0.78 : 1,
                                  filter: isTapped ? 'grayscale(0.15) brightness(0.88)' : undefined,
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: '100%',
                                  aspectRatio: '0.72',
                                  borderRadius: '4px',
                                  backgroundColor: '#333',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '12px',
                                  color: '#ccc',
                                  textAlign: 'center',
                                  padding: '8px',
                                }}
                              >
                                {card?.name || 'Unknown'}
                              </div>
                            )}
                            <div
                              style={{
                                position: 'absolute',
                                top: 6,
                                left: 6,
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 800,
                                letterSpacing: '0.03em',
                                color: isYours ? '#ecfeff' : '#fff7ed',
                                backgroundColor: isYours ? 'rgba(8, 145, 178, 0.95)' : 'rgba(234, 88, 12, 0.95)',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                                maxWidth: '70%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {controllerLabel}
                            </div>
                            <div
                              style={{
                                position: 'absolute',
                                top: 6,
                                right: 6,
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 700,
                                letterSpacing: '0.02em',
                                color: '#fff',
                                backgroundColor: isTapped ? 'rgba(180, 120, 40, 0.92)' : 'rgba(40, 120, 70, 0.92)',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                              }}
                            >
                              {isTapped ? 'TAPPED' : 'UNTAPPED'}
                            </div>
                            {pt && (
                              <div
                                style={{
                                  position: 'absolute',
                                  right: 6,
                                  bottom: 6,
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  color: '#fff',
                                  backgroundColor: 'rgba(0,0,0,0.75)',
                                }}
                              >
                                {pt}
                              </div>
                            )}
                          </div>
                          <div style={{ fontSize: '12px', color: '#fff', fontWeight: isSelected ? 'bold' : 'normal' }}>
                            {card?.name || 'Unknown'}
                          </div>
                          {typeLine && (
                            <div style={{ fontSize: '10px', color: '#888', marginTop: '2px', lineHeight: 1.3 }}>
                              {typeLine}
                            </div>
                          )}
                          <div style={{ fontSize: '11px', color: isYours ? '#67e8f9' : '#fdba74', marginTop: '4px', fontWeight: 700 }}>
                            Controlled by {controllerLabel}
                          </div>
                          {ownerLabel && (
                            <div style={{ fontSize: '11px', color: '#b9a' }}>
                              Owner: {ownerLabel}
                            </div>
                          )}
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 4,
                              marginTop: 6,
                            }}
                          >
                            {stateBadges.map((badge) => (
                              <span
                                key={badge}
                                style={{
                                  fontSize: 10,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  backgroundColor: badge === 'Tapped'
                                    ? 'rgba(180, 120, 40, 0.25)'
                                    : badge === 'Untapped'
                                      ? 'rgba(40, 120, 70, 0.25)'
                                      : 'rgba(255,255,255,0.08)',
                                  color: badge === 'Tapped' ? '#fbbf24' : badge === 'Untapped' ? '#86efac' : '#bbb',
                                }}
                              >
                                {badge}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
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

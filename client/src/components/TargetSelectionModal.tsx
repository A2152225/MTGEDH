/**
 * TargetSelectionModal.tsx
 * 
 * A unified modal for selecting targets for spells, abilities, and effects.
 * Supports:
 * - Single or multiple target selection
 * - Targeting permanents on the battlefield
 * - Targeting players
 * - Targeting cards in zones (hand, graveyard, library)
 * 
 * The modal receives a list of valid targets and allows the player to select
 * the required number of targets.
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { KnownCardRef, BattlefieldPermanent } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export type TargetType = 'permanent' | 'player' | 'card';

export interface TargetOption {
  id: string;
  type: TargetType;
  name: string;
  displayName?: string;
  imageUrl?: string;
  // For permanents
  controller?: string;
  typeLine?: string;
  // For players
  life?: number;
  // For cards
  zone?: string;
  owner?: string;
  card?: KnownCardRef | BattlefieldPermanent;
}

export interface TargetSelectionModalProps {
  open: boolean;
  title: string;
  description?: string;
  contextSteps?: string[];
  selectedMode?: { name: string; description?: string };
  viewerPlayerId?: string;
  source?: { name: string; imageUrl?: string };
  targets: TargetOption[];
  minTargets: number;
  maxTargets: number;
  // Grouping
  groupByType?: boolean;
  groupByController?: boolean;
  // Selection handlers
  onConfirm: (selectedTargetIds: string[]) => void;
  onCancel: () => void;
}

export function TargetSelectionModal({
  open,
  title,
  description,
  contextSteps,
  selectedMode,
  viewerPlayerId,
  source,
  targets,
  minTargets,
  maxTargets,
  groupByType = true,
  groupByController = false,
  onConfirm,
  onCancel,
}: TargetSelectionModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection when modal opens or targets change
  React.useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
    }
  }, [open, targets]);

  const toggleSelect = useCallback((targetId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(targetId)) {
        next.delete(targetId);
      } else if (next.size < maxTargets) {
        next.add(targetId);
      }
      return next;
    });
  }, [maxTargets]);

  const modePreferredTypes = useMemo(() => {
    const text = `${selectedMode?.name || ''} ${selectedMode?.description || ''}`.toLowerCase();
    if (!text.trim()) return new Set<TargetType>();

    const prefers = new Set<TargetType>();
    if (text.includes('target player') || text.includes('target opponent') || text.includes('target yourself')) {
      prefers.add('player');
    }
    if (
      text.includes('target creature') ||
      text.includes('target permanent') ||
      text.includes('target artifact') ||
      text.includes('target enchantment') ||
      text.includes('target planeswalker')
    ) {
      prefers.add('permanent');
    }
    if (text.includes('target card') || text.includes('target spell') || text.includes('target instant') || text.includes('target sorcery')) {
      prefers.add('card');
    }
    return prefers;
  }, [selectedMode]);

  const isModePreferredTarget = useCallback((target: TargetOption): boolean => {
    if (!selectedMode?.name && !selectedMode?.description) return true;

    const text = `${selectedMode?.name || ''} ${selectedMode?.description || ''}`.toLowerCase();
    if (!text.trim()) return true;

    // If we can't infer anything from the mode text, don't penalize anything.
    const inferredTypes = modePreferredTypes;
    if (inferredTypes.size === 0) return true;

    if (target.type === 'player') {
      if (!inferredTypes.has('player')) return false;

      // Handle opponent/self constraints when possible.
      if (viewerPlayerId) {
        if (text.includes('target opponent')) return target.id !== viewerPlayerId;
        if (text.includes('target yourself') || text.includes('target you')) return target.id === viewerPlayerId;
      }

      return true;
    }

    const targetTypeLine = (
      target.typeLine ||
      (target.card && (target.card as any).type_line) ||
      ''
    ).toLowerCase();

    if (target.type === 'card') {
      // If mode references cards/spells, prefer card targets.
      // If we have a type line, use it to be a bit more precise.
      if (!inferredTypes.has('card')) return false;
      if (!targetTypeLine) return true;

      if (text.includes('instant') && !targetTypeLine.includes('instant')) return false;
      if (text.includes('sorcery') && !targetTypeLine.includes('sorcery')) return false;
      if (text.includes('creature card') && !targetTypeLine.includes('creature')) return false;
      return true;
    }

    // Permanent targets: use the type line where possible.
    if (!inferredTypes.has('permanent')) return false;
    if (!targetTypeLine) return true;

    const wantsCreature = text.includes('target creature');
    const wantsArtifact = text.includes('target artifact');
    const wantsEnchantment = text.includes('target enchantment');
    const wantsPlaneswalker = text.includes('target planeswalker');
    const wantsLand = text.includes('target land');
    const wantsPermanent = text.includes('target permanent');
    const wantsAnyTarget = text.includes('any target');

    // Controller constraints when we have controller info.
    if (viewerPlayerId && target.controller) {
      if (text.includes('you control') && target.controller !== viewerPlayerId) return false;
      if ((text.includes("an opponent controls") || text.includes("opponent controls")) && target.controller === viewerPlayerId) return false;
    }

    // "Any target" typically means creature/planeswalker/player.
    if (wantsAnyTarget) {
      if (targetTypeLine.includes('creature') || targetTypeLine.includes('planeswalker')) return true;
      return false;
    }

    if (wantsAnyTarget || wantsPermanent) return true;

    // If mode specifies a concrete permanent type, require it.
    if (wantsCreature && !targetTypeLine.includes('creature')) return false;
    if (wantsArtifact && !targetTypeLine.includes('artifact')) return false;
    if (wantsEnchantment && !targetTypeLine.includes('enchantment')) return false;
    if (wantsPlaneswalker && !targetTypeLine.includes('planeswalker')) return false;
    if (wantsLand && !targetTypeLine.includes('land')) return false;

    // If mode doesn't specify a particular permanent type, allow.
    return true;
  }, [modePreferredTypes, selectedMode, viewerPlayerId]);

  const sortTargetsByRelevance = useCallback((items: TargetOption[]): TargetOption[] => {
    if (!selectedMode?.name && !selectedMode?.description) return items;

    const score = (t: TargetOption): number => {
      const isSelected = selectedIds.has(t.id);
      const preferred = isModePreferredTarget(t);
      return (isSelected ? 1000 : 0) + (preferred ? 100 : 0);
    };

    return [...items].sort((a, b) => {
      const da = score(a);
      const db = score(b);
      if (db !== da) return db - da;

      const an = (a.displayName || a.name || '').toLowerCase();
      const bn = (b.displayName || b.name || '').toLowerCase();
      return an.localeCompare(bn);
    });
  }, [isModePreferredTarget, selectedMode, selectedIds]);

  // Group targets by type or controller
  const groupedTargets = useMemo(() => {
    if (!groupByType && !groupByController) {
      return { 'All Targets': targets };
    }

    const groups: Record<string, TargetOption[]> = {};

    for (const target of targets) {
      let groupKey: string;
      
      if (groupByController && target.controller) {
        groupKey = `${target.controller}'s ${target.type === 'permanent' ? 'Permanents' : 'Cards'}`;
      } else if (groupByType) {
        switch (target.type) {
          case 'player':
            groupKey = 'Players';
            break;
          case 'permanent':
            groupKey = 'Permanents';
            break;
          case 'card':
            groupKey = target.zone ? `Cards in ${target.zone}` : 'Cards';
            break;
          default:
            groupKey = 'Other';
        }
      } else {
        groupKey = 'All Targets';
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(target);
    }

    return groups;
  }, [targets, groupByType, groupByController]);

  const canConfirm = selectedIds.size >= minTargets && selectedIds.size <= maxTargets;

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
          // Only cancel if clicking the backdrop and minTargets is 0
          if (minTargets === 0) {
            onCancel();
          }
        }
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 20,
          maxWidth: 900,
          width: '95%',
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {source?.imageUrl && (
            <div
              style={{
                width: 80,
                height: 112,
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
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#f59e0b' }}>
              🎯 {title}
            </h2>
            {source?.name && (
              <div style={{ marginTop: 4, fontSize: 14, color: '#888' }}>
                {source.name}
              </div>
            )}
            {description && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#a0aec0' }}>
                {description}
              </div>
            )}

            {selectedMode?.name && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, border: '1px solid #3a3a5a', backgroundColor: '#20203a' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#a0aec0', marginBottom: 4 }}>
                  Chosen mode
                </div>
                <div style={{ fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>
                  {selectedMode.name}
                </div>
                {selectedMode.description && (
                  <div style={{ marginTop: 4, fontSize: 12, color: '#cbd5e1', lineHeight: 1.4 }}>
                    {selectedMode.description}
                  </div>
                )}
              </div>
            )}

            {contextSteps && contextSteps.length > 0 && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, border: '1px solid #3a3a5a', backgroundColor: '#20203a' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#a0aec0', marginBottom: 6 }}>
                  Effect steps (heuristic)
                </div>
                <ol style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 12, lineHeight: 1.4 }}>
                  {contextSteps.slice(0, 12).map((s, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}>{s}</li>
                  ))}
                </ol>
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
              {minTargets === maxTargets
                ? `Select exactly ${minTargets} target${minTargets !== 1 ? 's' : ''}`
                : minTargets === 0
                ? `Select up to ${maxTargets} target${maxTargets !== 1 ? 's' : ''}`
                : `Select ${minTargets} to ${maxTargets} targets`}
              {selectedIds.size > 0 && ` • ${selectedIds.size} selected`}
            </div>
          </div>
        </div>

        {/* Target Groups */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid #3a3a5a',
            borderRadius: 6,
            backgroundColor: '#252540',
          }}
        >
          {Object.entries(groupedTargets).map(([groupName, groupTargets]) => (
            <div key={groupName} style={{ marginBottom: 8 }}>
              {Object.keys(groupedTargets).length > 1 && (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#1a1a2e',
                    fontWeight: 600,
                    fontSize: 13,
                    color: '#a0aec0',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  {groupName} ({groupTargets.length})
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 8,
                  padding: 12,
                }}
              >
                {sortTargetsByRelevance(groupTargets).map(target => {
                  const isSelected = selectedIds.has(target.id);
                  const isPlayer = target.type === 'player';
                  const isModePreferred = isModePreferredTarget(target);

                  return (
                    <div
                      key={target.id}
                      onClick={() => toggleSelect(target.id)}
                      onMouseEnter={(e) => {
                        if (target.card && 'name' in target.card) {
                          showCardPreview(e.currentTarget as HTMLElement, target.card as any, { prefer: 'right' });
                        }
                      }}
                      onMouseLeave={(e) => {
                        hideCardPreview(e.currentTarget as HTMLElement);
                      }}
                      style={{
                        position: 'relative',
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: isSelected
                          ? '3px solid #f59e0b'
                          : isModePreferred
                          ? '1px solid rgba(245, 158, 11, 0.28)'
                          : '1px solid rgba(255,255,255,0.10)',
                        backgroundColor: isSelected
                          ? 'rgba(245, 158, 11, 0.2)'
                          : isModePreferred
                          ? 'rgba(245, 158, 11, 0.05)'
                          : 'transparent',
                        cursor: selectedIds.size >= maxTargets && !isSelected ? 'not-allowed' : 'pointer',
                        opacity: selectedIds.size >= maxTargets && !isSelected ? 0.5 : 1,
                        transition: 'all 0.15s',
                      }}
                    >
                      {isPlayer ? (
                        // Player target display
                        <div
                          style={{
                            padding: 12,
                            textAlign: 'center',
                            minHeight: 80,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                          }}
                        >
                          <div style={{ fontSize: 24 }}>👤</div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            {target.displayName || target.name}
                          </div>
                          {target.life !== undefined && (
                            <div style={{ fontSize: 11, color: '#888' }}>
                              {target.life} life
                            </div>
                          )}

                          {selectedMode?.name && (
                            <div style={{ fontSize: 10, color: isModePreferred ? '#f59e0b' : '#888' }}>
                              {isModePreferred ? 'Matches chosen mode' : 'Other mode'}
                            </div>
                          )}
                        </div>
                      ) : (
                        // Card/Permanent target display
                        <>
                          <div style={{ width: '100%', aspectRatio: '0.72', overflow: 'hidden', pointerEvents: 'none' }}>
                            {target.imageUrl ? (
                              <img
                                src={target.imageUrl}
                                alt={target.name}
                                draggable={false}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
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
                                  pointerEvents: 'none',
                                }}
                              >
                                {target.name}
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
                              pointerEvents: 'none',
                            }}
                          >
                            {target.displayName || target.name}
                          </div>

                          {selectedMode?.name && (
                            <div
                              style={{
                                padding: '0 6px 6px 6px',
                                fontSize: 10,
                                color: isModePreferred ? '#f59e0b' : '#888',
                                pointerEvents: 'none',
                              }}
                            >
                              {isModePreferred ? 'Matches chosen mode' : 'Other mode'}
                            </div>
                          )}
                        </>
                      )}
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
                            pointerEvents: 'none',
                          }}
                        >
                          ✓
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {targets.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
              No valid targets available.
            </div>
          )}
        </div>

        {/* Selected targets summary */}
        {selectedIds.size > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Selected:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Array.from(selectedIds).map(id => {
                const target = targets.find(t => t.id === id);
                return target ? (
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
                    {target.type === 'player' ? '👤 ' : ''}
                    {target.displayName || target.name}
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
            Confirm Targets
          </button>
        </div>
      </div>
    </div>
  );
}

export default TargetSelectionModal;

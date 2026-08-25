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
import { getCardPreviewHandlers } from './CardPreviewLayer';

import type {
  TargetType,
  TargetOption,
  TargetSelectionGroup,
  TargetSelectionModalProps,
} from './TargetSelectionModal-handlers/targetSelectionModalSupport';
import {
  isGroupedTargetSelectionComplete,
  formatControllerGroupLabel,
  ownershipStyle,
  PermanentOwnershipBadge,
  PermanentTargetCaption,
} from './TargetSelectionModal-handlers/targetSelectionModalSupport';
export type {
  TargetType,
  TargetOption,
  TargetSelectionGroup,
  TargetSelectionModalProps,
} from './TargetSelectionModal-handlers/targetSelectionModalSupport';
export { isGroupedTargetSelectionComplete } from './TargetSelectionModal-handlers/targetSelectionModalSupport';

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
  targetGroups,
  perOpponent = false,
  opponents,
  targetsPerOpponent,
  minTargetsPerOpponent = 0,
  maxTargetsPerOpponent = 1,
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

  const effectiveTargetGroups = useMemo<TargetSelectionGroup[]>(() => {
    if (Array.isArray(targetGroups) && targetGroups.length > 0) return targetGroups;
    if (!perOpponent || !targetsPerOpponent) return [];
    const orderedPlayers = opponents?.length
      ? opponents
      : Object.keys(targetsPerOpponent).map((id) => ({ id, name: id }));
    return orderedPlayers.map((opponent) => ({
      playerId: opponent.id,
      label: opponent.name,
      required: minTargetsPerOpponent > 0,
      minTargets: minTargetsPerOpponent,
      maxTargets: maxTargetsPerOpponent,
      targets: targetsPerOpponent[opponent.id] || [],
    }));
  }, [targetGroups, perOpponent, targetsPerOpponent, opponents, minTargetsPerOpponent, maxTargetsPerOpponent]);

  const groupForTarget = useCallback((targetId: string): TargetSelectionGroup | null => {
    for (const group of effectiveTargetGroups) {
      if (group.targets.some((target) => target.id === targetId)) return group;
    }
    return null;
  }, [effectiveTargetGroups]);

  const toggleSelect = useCallback((targetId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(targetId)) {
        next.delete(targetId);
        return next;
      }

      if (effectiveTargetGroups.length > 0) {
        const group = groupForTarget(targetId);
        if (group) {
          const selectedInGroup = group.targets.filter((target) => next.has(target.id));
          if (group.maxTargets <= 1) {
            for (const target of group.targets) {
              if (target.id !== targetId) next.delete(target.id);
            }
          } else if (selectedInGroup.length >= group.maxTargets) {
            return prev;
          }
        }
        if (next.size >= maxTargets) return prev;
        next.add(targetId);
        return next;
      }

      if (next.size < maxTargets) {
        next.add(targetId);
      }
      return next;
    });
  }, [maxTargets, effectiveTargetGroups, groupForTarget]);

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

  // Group targets by controller when ownership differs (Merrow Reejerey / any-permanent cases),
  // otherwise fall back to type grouping.
  const groupedTargets = useMemo(() => {
    const permanentControllers = new Set(
      targets
        .filter((target) => target.type === 'permanent' && target.controller)
        .map((target) => String(target.controller)),
    );
    const autoGroupByController = permanentControllers.size > 1;
    const useControllerGroups = groupByController || autoGroupByController;

    if (!groupByType && !useControllerGroups) {
      return { 'All Targets': targets };
    }

    const groups: Record<string, TargetOption[]> = {};
    const groupOrder: string[] = [];

    const pushGroup = (groupKey: string, target: TargetOption) => {
      if (!groups[groupKey]) {
        groups[groupKey] = [];
        groupOrder.push(groupKey);
      }
      groups[groupKey].push(target);
    };

    for (const target of targets) {
      let groupKey: string;

      if (useControllerGroups && target.controller && target.type === 'permanent') {
        groupKey = formatControllerGroupLabel(target.controller, target.controllerName, viewerPlayerId);
      } else if (useControllerGroups && target.controller) {
        if (target.type === 'stack') {
          groupKey = 'Spells & abilities on the stack';
        } else {
          groupKey = formatControllerGroupLabel(target.controller, target.controllerName, viewerPlayerId)
            .replace('permanents', target.type === 'card' ? 'cards' : 'targets');
        }
      } else if (groupByType) {
        switch (target.type) {
          case 'player':
            groupKey = 'Players';
            break;
          case 'permanent':
            groupKey = 'Permanents';
            break;
          case 'stack':
            groupKey = String(target.typeLine || '').toLowerCase().includes('ability')
              ? 'Abilities on the stack'
              : 'Spells on the stack';
            break;
          case 'card':
            groupKey = target.zone === 'stack'
              ? 'Spells on the stack'
              : (target.zone ? `Cards in ${target.zone}` : 'Cards');
            break;
          default:
            groupKey = 'Other';
        }
      } else {
        groupKey = 'All Targets';
      }

      pushGroup(groupKey, target);
    }

    // Keep the viewer's group first when controller-grouped.
    const ordered: Record<string, TargetOption[]> = {};
    const yoursKey = viewerPlayerId
      ? formatControllerGroupLabel(
          viewerPlayerId,
          targets.find((t) => t.controller === viewerPlayerId)?.controllerName,
          viewerPlayerId,
        )
      : null;
    if (yoursKey && groups[yoursKey]) ordered[yoursKey] = groups[yoursKey];
    for (const key of groupOrder) {
      if (yoursKey && key === yoursKey) continue;
      ordered[key] = groups[key];
    }
    return ordered;
  }, [targets, groupByType, groupByController, viewerPlayerId]);

  const canConfirm = useMemo(() => {
    return isGroupedTargetSelectionComplete(selectedIds, effectiveTargetGroups, minTargets, maxTargets);
  }, [
    selectedIds,
    minTargets,
    maxTargets,
    effectiveTargetGroups,
  ]);

  const perOpponentSections = useMemo(() => {
    if (effectiveTargetGroups.length === 0) return null;
    return effectiveTargetGroups.map((group) => ({
      opponent: { id: group.playerId, name: group.label || group.playerId },
      targets: group.targets,
      minTargets: group.minTargets,
      maxTargets: group.maxTargets,
    }));
  }, [effectiveTargetGroups]);

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
              {effectiveTargetGroups.length > 0
                ? `Select the required targets in every player section`
                : minTargets === maxTargets
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
          {perOpponentSections
            ? perOpponentSections.map(({ opponent, targets: opponentTargets, minTargets: sectionMin, maxTargets: sectionMax }) => (
              <div key={opponent.id} style={{ marginBottom: 8 }}>
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
                  {opponent.name} ({sectionMin === sectionMax ? `${sectionMin} required` : `${sectionMin}-${sectionMax}`})
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: 8,
                    padding: 12,
                  }}
                >
                  {sortTargetsByRelevance(opponentTargets).map((target) => {
                    const isSelected = selectedIds.has(target.id);
                    const isPlayer = target.type === 'player';
                    const isModePreferred = isModePreferredTarget(target);
                    const opponentAtMax =
                      opponentTargets.filter((entry) => selectedIds.has(entry.id)).length >= sectionMax;
                    const isYours = Boolean(viewerPlayerId && target.controller && target.controller === viewerPlayerId);
                    const ownership = !isPlayer && target.controller ? ownershipStyle(isYours) : null;
                    const controllerLabel = target.controllerName || target.controller;

                    return (
                      <div
                        key={target.id}
                        onClick={() => toggleSelect(target.id)}
                        {...getCardPreviewHandlers({
                          card: target.card as any,
                          imageUrl: target.imageUrl,
                          name: target.displayName || target.name,
                          type_line: target.typeLine,
                        })}
                        style={{
                          position: 'relative',
                          borderRadius: 6,
                          overflow: 'hidden',
                          border: isSelected
                            ? '3px solid #f59e0b'
                            : ownership
                            ? `2px solid ${ownership.border}`
                            : isModePreferred
                            ? '1px solid rgba(245, 158, 11, 0.28)'
                            : '1px solid rgba(255,255,255,0.10)',
                          backgroundColor: isSelected
                            ? 'rgba(245, 158, 11, 0.2)'
                            : ownership
                            ? ownership.tint
                            : isModePreferred
                            ? 'rgba(245, 158, 11, 0.05)'
                            : 'transparent',
                          cursor: opponentAtMax && !isSelected ? 'not-allowed' : 'pointer',
                          opacity: opponentAtMax && !isSelected ? 0.5 : 1,
                          transition: 'all 0.15s',
                        }}
                      >
                        {isPlayer ? (
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
                          </div>
                        ) : (
                          <>
                            <div style={{ width: '100%', aspectRatio: '0.72', overflow: 'hidden', pointerEvents: 'none', position: 'relative' }}>
                              {target.imageUrl ? (
                                <img
                                  src={target.imageUrl}
                                  alt={target.name}
                                  draggable={false}
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    pointerEvents: 'none',
                                    filter: target.tapped ? 'grayscale(0.2) brightness(0.82)' : undefined,
                                    opacity: target.tapped ? 0.92 : 1,
                                  }}
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
                              {target.controller ? (
                                <PermanentOwnershipBadge isYours={isYours} controllerLabel={controllerLabel} />
                              ) : null}
                              {typeof target.tapped === 'boolean' && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: 4,
                                    bottom: 4,
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    background: target.tapped ? 'rgba(245, 158, 11, 0.92)' : 'rgba(22, 163, 74, 0.9)',
                                    color: target.tapped ? '#111' : '#fff',
                                  }}
                                >
                                  {target.tapped ? 'TAPPED' : 'READY'}
                                </div>
                              )}
                            </div>
                            <PermanentTargetCaption target={target} viewerPlayerId={viewerPlayerId} />
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
            ))
            : Object.entries(groupedTargets).map(([groupName, groupTargets]) => {
              const isViewerGroup = Boolean(
                viewerPlayerId
                && groupTargets.some((target) => target.controller === viewerPlayerId),
              );
              const isControllerGroup = groupName.endsWith("'s permanents");
              return (
            <div key={groupName} style={{ marginBottom: 8 }}>
              {Object.keys(groupedTargets).length > 1 && (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: isViewerGroup
                      ? 'rgba(8, 145, 178, 0.22)'
                      : isControllerGroup
                        ? 'rgba(154, 52, 18, 0.22)'
                        : '#1a1a2e',
                    borderBottom: isViewerGroup
                      ? '1px solid rgba(56, 189, 248, 0.45)'
                      : isControllerGroup
                        ? '1px solid rgba(251, 146, 60, 0.45)'
                        : undefined,
                    fontWeight: 700,
                    fontSize: 13,
                    color: isViewerGroup
                      ? '#a5f3fc'
                      : isControllerGroup
                        ? '#fdba74'
                        : '#a0aec0',
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
                  const isYours = Boolean(viewerPlayerId && target.controller && target.controller === viewerPlayerId);
                  const ownership = !isPlayer && target.controller ? ownershipStyle(isYours) : null;
                  const controllerLabel = target.controllerName || target.controller;

                  return (
                    <div
                      key={target.id}
                      onClick={() => toggleSelect(target.id)}
                      {...getCardPreviewHandlers({
                        card: target.card as any,
                        imageUrl: target.imageUrl,
                        name: target.displayName || target.name,
                        type_line: target.typeLine,
                      })}
                      style={{
                        position: 'relative',
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: isSelected
                          ? '3px solid #f59e0b'
                          : ownership
                          ? `2px solid ${ownership.border}`
                          : isModePreferred
                          ? '1px solid rgba(245, 158, 11, 0.28)'
                          : '1px solid rgba(255,255,255,0.10)',
                        backgroundColor: isSelected
                          ? 'rgba(245, 158, 11, 0.2)'
                          : ownership
                          ? ownership.tint
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
                          <div style={{ width: '100%', aspectRatio: '0.72', overflow: 'hidden', pointerEvents: 'none', position: 'relative' }}>
                            {target.imageUrl ? (
                              <img
                                src={target.imageUrl}
                                alt={target.name}
                                draggable={false}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                  pointerEvents: 'none',
                                  filter: target.tapped ? 'grayscale(0.2) brightness(0.82)' : undefined,
                                  opacity: target.tapped ? 0.92 : 1,
                                }}
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
                            {target.controller ? (
                              <PermanentOwnershipBadge isYours={isYours} controllerLabel={controllerLabel} />
                            ) : null}
                            {typeof target.tapped === 'boolean' && (
                              <div
                                style={{
                                  position: 'absolute',
                                  left: 4,
                                  bottom: 4,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  fontSize: 9,
                                  fontWeight: 700,
                                  background: target.tapped ? 'rgba(245, 158, 11, 0.92)' : 'rgba(22, 163, 74, 0.9)',
                                  color: target.tapped ? '#111' : '#fff',
                                }}
                              >
                                {target.tapped ? 'TAPPED' : 'READY'}
                              </div>
                            )}
                          </div>
                          <PermanentTargetCaption target={target} viewerPlayerId={viewerPlayerId} />

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
              );
            })}

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
                    {target.controllerName || target.controller
                      ? ` (${target.controllerName || target.controller})`
                      : ''}
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

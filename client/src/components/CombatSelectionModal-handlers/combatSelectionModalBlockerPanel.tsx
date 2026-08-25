// Origin parent: client/src/components/CombatSelectionModal.tsx
// Cluster moved: nested blocker-selection JSX inside CombatSelectionModal.
// Public entry symbols: CombatBlockerSelectionPanel.
// Leaf must not import CombatSelectionModal.tsx or CombatSelectionModal-handlers/index.ts.

import React from 'react';
import type { BattlefieldPermanent } from '../../../../shared/src';
import { getBlockerCapacity } from '../../utils/blockerCapacity';
import { canBlockAttacker } from '../../utils/combatBlocking';
import {
  AttackTargetBadge,
  getCombatCardPreviewHandlers,
  resolveAttackTargetLabel,
} from './combatSelectionModalAttackTarget';
import { getCreatureInfo } from './combatSelectionModalCreatureInfo';
import { DangerIndicatorBadges } from './combatSelectionModalDangerBadges';
import type { CreatureGroup } from './combatSelectionModalGroupCreatures';
import {
  cloneSelectedBlockers,
  countBlockingCreatures,
  countTotalBlockAssignments,
  getBlockerAssignments,
} from './combatSelectionModalSelectionSupport';

export interface CombatBlockerSelectionPanelProps {
  mode: 'attackers' | 'blockers';
  lureViolations: Map<string, string>;
  handleAutoBlockLure: () => void;
  availableForBlock: BattlefieldPermanent[];
  attackingCreatures: BattlefieldPermanent[];
  selectedBlockers: Map<string, Set<string>>;
  setSelectedBlockers: React.Dispatch<React.SetStateAction<Map<string, Set<string>>>>;
  battlefieldForBlocking: BattlefieldPermanent[];
  playerNameById: ReadonlyMap<string, string>;
  menaceViolations: Map<string, string>;
  unblockableAttackers: Map<string, string>;
  stackBlockerGroups: CreatureGroup[];
  uniqueBlockerGroups: CreatureGroup[];
  handleToggleBlocker: (blocker: BattlefieldPermanent, attackerId: string) => void;
}

export function CombatBlockerSelectionPanel({
  mode,
  lureViolations,
  handleAutoBlockLure,
  availableForBlock,
  attackingCreatures,
  selectedBlockers,
  setSelectedBlockers,
  battlefieldForBlocking,
  playerNameById,
  menaceViolations,
  unblockableAttackers,
  stackBlockerGroups,
  uniqueBlockerGroups,
  handleToggleBlocker,
}: CombatBlockerSelectionPanelProps) {
  return (
    <>

        {/* Blocker Selection Mode */}
        {mode === 'blockers' && (
          <div>
            {/* Lure warning banner and auto-block button */}
            {lureViolations.size > 0 && (
              <div style={{
                padding: '12px 16px',
                backgroundColor: 'rgba(244,114,182,0.2)',
                border: '1px solid #f472b6',
                borderRadius: 8,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}>
                <div style={{ fontSize: 12, color: '#fbcfe8' }}>
                  🧲 <strong>Lure Effect:</strong> {Array.from(lureViolations.values()).join('. ')}
                </div>
                <button
                  onClick={handleAutoBlockLure}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#f472b6',
                    color: '#000',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Auto-Block Lure
                </button>
              </div>
            )}
            
            {/* Quick blocking controls */}
            {availableForBlock.length > 0 && attackingCreatures.length > 0 && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                marginBottom: 16,
                padding: '12px 16px',
                background: 'rgba(16,185,129,0.1)',
                borderRadius: 8,
                border: '1px solid rgba(16,185,129,0.3)',
              }}>
                <span style={{ fontWeight: 600, fontSize: 13, marginRight: 8 }}>Quick Block:</span>
                
                {/* Clear all blockers button */}
                {selectedBlockers.size > 0 && (
                  <button
                    onClick={() => setSelectedBlockers(new Map())}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid #666',
                      background: 'transparent',
                      color: '#aaa',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Clear All ({selectedBlockers.size})
                  </button>
                )}
              </div>
            )}
            
            {/* Show attacking creatures */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#ef4444' }}>
                ⚔️ Attacking Creatures ({attackingCreatures.length}) - WATCH FOR DANGER ABILITIES
              </div>
              
              {attackingCreatures.length === 0 ? (
                <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                  No creatures are attacking
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {attackingCreatures.map(attacker => {
                    const { name, pt, effectivePower, imageUrl, dangers } = getCreatureInfo(attacker);
                    const attackTargetLabel = resolveAttackTargetLabel(
                      attacker,
                      battlefieldForBlocking,
                      playerNameById,
                    );
                    const blockersForThis = Array.from(selectedBlockers.entries())
                      .filter(([_, attackerIds]) => attackerIds.has(attacker.id))
                      .map(([blockerId]) => blockerId);
                    const menaceViolation = menaceViolations.get(attacker.id);
                    const lureViolation = lureViolations.get(attacker.id);
                    const landwalkReason = unblockableAttackers.get(attacker.id);
                    const hasViolation = menaceViolation || lureViolation;
                    
                    return (
                      <div
                        key={attacker.id}
                        {...getCombatCardPreviewHandlers(attacker)}
                        style={{
                          width: 130,
                          padding: 8,
                          borderRadius: 8,
                          border: landwalkReason ? '2px solid #22c55e' : lureViolation ? '2px solid #f472b6' : menaceViolation ? '2px solid #f59e0b' : '2px solid #ef4444',
                          background: landwalkReason ? 'rgba(34,197,94,0.15)' : lureViolation ? 'rgba(244,114,182,0.2)' : menaceViolation ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.15)',
                        }}
                      >
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={name}
                            style={{
                              width: '100%',
                              borderRadius: 4,
                              marginBottom: 4,
                            }}
                          />
                        ) : (
                          <div style={{
                            width: '100%',
                            height: 140,
                            background: '#222',
                            borderRadius: 4,
                            marginBottom: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                          }}>
                            {name}
                          </div>
                        )}
                        <div style={{ fontSize: 11, textAlign: 'center' }}>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {name}
                          </div>
                          <div style={{ 
                            color: '#fff', 
                            fontWeight: 700,
                            fontSize: 14,
                            background: 'rgba(239,68,68,0.5)',
                            borderRadius: 4,
                            padding: '2px 6px',
                            marginTop: 2,
                            display: 'inline-block',
                          }}>
                            {pt}
                            {effectivePower !== undefined && (
                              <span style={{ fontSize: 10, color: '#fca5a5', marginLeft: 4 }}>
                                ({effectivePower} dmg)
                              </span>
                            )}
                          </div>
                          
                          {/* Danger indicators - very important for blockers! */}
                          <DangerIndicatorBadges dangers={dangers} />

                          {attackTargetLabel && (
                            <AttackTargetBadge label={attackTargetLabel} />
                          )}
                          
                          {blockersForThis.length > 0 && (
                            <div style={{ color: '#10b981', marginTop: 4, fontSize: 10 }}>
                              Blocked by {blockersForThis.length}
                            </div>
                          )}
                          {menaceViolation && (
                            <div style={{ color: '#f59e0b', marginTop: 2, fontSize: 9 }}>
                              ⚠️ {menaceViolation}
                            </div>
                          )}
                          {landwalkReason && (
                            <div style={{ color: '#86efac', marginTop: 2, fontSize: 9 }}>
                              🌲 Unblockable — {landwalkReason}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Show available blockers */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#10b981' }}>
                🛡️ Your Creatures ({availableForBlock.length} can block, {countBlockingCreatures(selectedBlockers)} blocking, {countTotalBlockAssignments(selectedBlockers)} assignments)
              </div>
              
              {availableForBlock.length === 0 ? (
                <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                  No untapped creatures available to block
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                {stackBlockerGroups.length > 0 && (
                /* Identical creatures / tokens: grouped rows with +/- assignment */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, order: 2 }}>
                  {stackBlockerGroups.map(group => {
                    // Count how many from this group are blocking
                    const blockingInGroup = group.creatures.filter(c => (selectedBlockers.get(c.id)?.size || 0) > 0).length;
                    const availableInGroup = group.creatures.reduce((total, creature) => {
                      const usedCapacity = selectedBlockers.get(creature.id)?.size || 0;
                      return total + Math.max(0, getBlockerCapacity(creature) - usedCapacity);
                    }, 0);
                    
                    // Get blocking assignments breakdown
                    const blockingBreakdown = attackingCreatures.map(attacker => {
                      const attackerInfo = getCreatureInfo(attacker);
                      const count = group.creatures.filter(c => selectedBlockers.get(c.id)?.has(attacker.id)).length;
                      return { attacker, attackerInfo, count };
                    }).filter(b => b.count > 0);
                    
                    return (
                      <div
                        key={group.key}
                        {...getCombatCardPreviewHandlers(group.creatures[0])}
                        style={{
                          padding: 12,
                          borderRadius: 8,
                          border: blockingInGroup > 0 ? '2px solid #10b981' : '2px solid #333',
                          background: blockingInGroup > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(0,0,0,0.3)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {/* Token image or placeholder */}
                          {group.imageUrl ? (
                            <img
                              src={group.imageUrl}
                              alt={group.name}
                              style={{ width: 50, height: 70, borderRadius: 4, objectFit: 'cover' }}
                            />
                          ) : (
                            <div style={{
                              width: 50,
                              height: 70,
                              background: '#222',
                              borderRadius: 4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 9,
                              textAlign: 'center',
                            }}>
                              {group.name}
                            </div>
                          )}
                          
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>
                              {group.name} {group.pt}
                              {group.isToken && <span style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>(Token)</span>}
                            </div>
                            <div style={{ fontSize: 12, color: '#aaa' }}>
                              {group.creatures.length} total • {blockingInGroup} blocking • {availableInGroup} available
                            </div>
                            {/* Show breakdown of blocking assignments */}
                            {blockingBreakdown.length > 0 && (
                              <div style={{ fontSize: 11, color: '#86efac', marginTop: 2 }}>
                                {blockingBreakdown.map((b, i) => (
                                  <span key={b.attacker.id}>
                                    {i > 0 && ', '}
                                    {b.count}→{b.attackerInfo.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            <DangerIndicatorBadges dangers={group.dangers} />
                          </div>
                          
                          {/* Group blocking controls */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {/* Assign blockers to specific attacker */}
                            {attackingCreatures.map(attacker => {
                              const attackerInfo = getCreatureInfo(attacker);
                              const attackerTargetLabel = resolveAttackTargetLabel(
                                attacker,
                                battlefieldForBlocking,
                                playerNameById,
                              );
                              const dangerText = [];
                              if (attackerInfo.dangers.deathtouch) dangerText.push('☠️');
                              if (attackerInfo.dangers.trample) dangerText.push('🦶');
                              if (attackerInfo.dangers.menace) dangerText.push('👹');
                              const dangerStr = dangerText.join('');
                              
                              // Count current blockers from this group for this attacker
                              const currentCount = group.creatures.filter(c => selectedBlockers.get(c.id)?.has(attacker.id)).length;
                              const groupCanBlock = group.creatures.some((creature) =>
                                canBlockAttacker(creature, attacker, battlefieldForBlocking).canBlock,
                              );
                              
                              return (
                                <div key={attacker.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 10, color: '#f87171', minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {dangerStr}{attackerInfo.name}
                                    {attackerTargetLabel && (
                                      <span style={{ color: '#fca5a5' }}> → {attackerTargetLabel}</span>
                                    )}
                                  </span>
                                  <button
                                    onClick={() => {
                                      // Remove one blocker from this attacker using functional
                                      // state so rapid clicks don't read a stale Map.
                                      setSelectedBlockers(prev => {
                                        const blockerToRemove = group.creatures.find(c => prev.get(c.id)?.has(attacker.id));
                                        if (!blockerToRemove) return prev;
                                        const next = cloneSelectedBlockers(prev);
                                        const assignments = next.get(blockerToRemove.id);
                                        if (assignments) {
                                          assignments.delete(attacker.id);
                                          if (assignments.size === 0) next.delete(blockerToRemove.id);
                                          else next.set(blockerToRemove.id, assignments);
                                        }
                                        return next;
                                      });
                                    }}
                                    disabled={currentCount === 0}
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: 10,
                                      borderRadius: 3,
                                      border: 'none',
                                      background: currentCount === 0 ? '#333' : '#dc2626',
                                      color: '#fff',
                                      cursor: currentCount === 0 ? 'not-allowed' : 'pointer',
                                    }}
                                  >
                                    −
                                  </button>
                                  <span style={{ fontSize: 11, minWidth: 20, textAlign: 'center', fontWeight: 600 }}>
                                    {currentCount}
                                  </span>
                                  <button
                                    onClick={() => {
                                      // Assign via functional update so consecutive + clicks
                                      // pick the next free token instead of toggling the same one off.
                                      setSelectedBlockers(prev => {
                                        const assignableBlocker = group.creatures.find(c => {
                                          if (!canBlockAttacker(c, attacker, battlefieldForBlocking).canBlock) return false;
                                          const assignments = prev.get(c.id) || new Set<string>();
                                          return !assignments.has(attacker.id) && assignments.size < getBlockerCapacity(c);
                                        });
                                        if (!assignableBlocker) return prev;
                                        const next = cloneSelectedBlockers(prev);
                                        const assignments = next.get(assignableBlocker.id) || new Set<string>();
                                        if (assignments.size >= getBlockerCapacity(assignableBlocker)) return prev;
                                        assignments.add(attacker.id);
                                        next.set(assignableBlocker.id, assignments);
                                        return next;
                                      });
                                    }}
                                    disabled={availableInGroup === 0 || !groupCanBlock}
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: 10,
                                      borderRadius: 3,
                                      border: 'none',
                                      background: availableInGroup === 0 ? '#333' : '#10b981',
                                      color: '#fff',
                                      cursor: availableInGroup === 0 ? 'not-allowed' : 'pointer',
                                    }}
                                  >
                                    +
                                  </button>
                                </div>
                              );
                            })}
                            
                            {/* Clear all from this group */}
                            {blockingInGroup > 0 && (
                              <button
                                onClick={() => {
                                  setSelectedBlockers(prev => {
                                    const next = cloneSelectedBlockers(prev);
                                    for (const c of group.creatures) {
                                      next.delete(c.id);
                                    }
                                    return next;
                                  });
                                }}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: 9,
                                  borderRadius: 3,
                                  border: '1px solid #666',
                                  background: 'transparent',
                                  color: '#aaa',
                                  cursor: 'pointer',
                                  marginTop: 4,
                                }}
                              >
                                Clear ({blockingInGroup})
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
                {uniqueBlockerGroups.length > 0 && (
                /* Unique creatures always use the card grid */
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: stackBlockerGroups.length > 0 ? 12 : 0, order: 1 }}>
                  {uniqueBlockerGroups.map(group => {
                    const blocker = group.creatures[0];
                    if (!blocker) return null;
                    const { name, pt, effectivePower, effectiveToughness, imageUrl, dangers } = getCreatureInfo(blocker);
                    const blockerAssignments = getBlockerAssignments(selectedBlockers, blocker.id);
                    const isBlocking = blockerAssignments.length > 0;
                    const blockerCapacity = getBlockerCapacity(blocker);
                    const capacityLabel = blockerCapacity === Number.POSITIVE_INFINITY ? 'any' : String(blockerCapacity);
                    
                    return (
                      <div
                        key={blocker.id}
                        {...getCombatCardPreviewHandlers(blocker)}
                        style={{
                          width: 130,
                          padding: 8,
                          borderRadius: 8,
                          border: isBlocking ? '2px solid #10b981' : '2px solid #333',
                          background: isBlocking ? 'rgba(16,185,129,0.2)' : 'rgba(0,0,0,0.3)',
                        }}
                      >
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={name}
                            style={{
                              width: '100%',
                              borderRadius: 4,
                              marginBottom: 4,
                            }}
                          />
                        ) : (
                          <div style={{
                            width: '100%',
                            height: 140,
                            background: '#222',
                            borderRadius: 4,
                            marginBottom: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                          }}>
                            {name}
                          </div>
                        )}
                        <div style={{ fontSize: 11, textAlign: 'center' }}>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {name}
                          </div>
                          <div style={{ 
                            color: '#fff', 
                            fontWeight: 700,
                            fontSize: 14,
                            background: 'rgba(16,185,129,0.5)',
                            borderRadius: 4,
                            padding: '2px 6px',
                            marginTop: 2,
                            display: 'inline-block',
                          }}>
                            {pt}
                          </div>
                          {effectiveToughness !== undefined && effectiveToughness > 0 && (
                            <div style={{ fontSize: 9, color: '#86efac', marginTop: 2 }}>
                              Can survive {effectiveToughness - 1} damage
                            </div>
                          )}
                          {effectiveToughness !== undefined && effectiveToughness <= 0 && (
                            <div style={{ fontSize: 9, color: '#ef4444', marginTop: 2 }}>
                              ⚠️ Will die (0 toughness)
                            </div>
                          )}
                          <div style={{ fontSize: 9, color: '#93c5fd', marginTop: 2 }}>
                            Capacity: {blockerAssignments.length}/{capacityLabel}
                          </div>
                        </div>
                        
                        {/* Blocker's own abilities */}
                        <DangerIndicatorBadges dangers={dangers} />
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                          {attackingCreatures.map(attacker => {
                            const attackerInfo = getCreatureInfo(attacker);
                            const isAssignedToAttacker = blockerAssignments.includes(attacker.id);
                            const blockCheck = canBlockAttacker(blocker, attacker, battlefieldForBlocking);
                            const canAssignMore = isAssignedToAttacker || (blockCheck.canBlock && blockerAssignments.length < blockerCapacity);
                            const dangerText = [];
                            if (attackerInfo.dangers.deathtouch) dangerText.push('DT');
                            if (attackerInfo.dangers.infect) dangerText.push('INF');
                            if (attackerInfo.dangers.trample) dangerText.push('TRM');
                            if (attackerInfo.dangers.menace) dangerText.push('MEN');
                            const dangerStr = dangerText.length > 0 ? ` ${dangerText.join('/')}` : '';
                            return (
                              <button
                                key={attacker.id}
                                onClick={() => handleToggleBlocker(blocker, attacker.id)}
                                disabled={!canAssignMore}
                                title={!blockCheck.canBlock ? blockCheck.reason : undefined}
                                style={{
                                  width: '100%',
                                  padding: '4px 6px',
                                  fontSize: 10,
                                  borderRadius: 4,
                                  border: isAssignedToAttacker ? '1px solid #10b981' : '1px solid #555',
                                  background: isAssignedToAttacker ? 'rgba(16,185,129,0.25)' : '#222',
                                  color: canAssignMore ? '#fff' : '#777',
                                  cursor: canAssignMore ? 'pointer' : 'not-allowed',
                                }}
                              >
                                {isAssignedToAttacker ? 'Unblock' : blockCheck.canBlock ? 'Block' : "Can't block"} {attackerInfo.name} ({attackerInfo.pt}){dangerStr}
                              </button>
                            );
                          })}
                          {isBlocking && (
                            <button
                              onClick={() => {
                                setSelectedBlockers(prev => {
                                  const next = cloneSelectedBlockers(prev);
                                  next.delete(blocker.id);
                                  return next;
                                });
                              }}
                              style={{
                                width: '100%',
                                padding: '4px 6px',
                                fontSize: 10,
                                borderRadius: 4,
                                border: '1px solid #666',
                                background: 'transparent',
                                color: '#aaa',
                                cursor: 'pointer',
                              }}
                            >
                              Clear All Blocks
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
                </div>
              )}
            </div>
          </div>
        )}
    </>
  );
}

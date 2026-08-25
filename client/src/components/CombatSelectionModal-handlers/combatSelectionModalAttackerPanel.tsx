// Origin parent: client/src/components/CombatSelectionModal.tsx
// Cluster moved: nested attacker-selection JSX inside CombatSelectionModal.
// Public entry symbols: CombatAttackerSelectionPanel.
// Leaf must not import CombatSelectionModal.tsx or CombatSelectionModal-handlers/index.ts.

import React from 'react';
import type { BattlefieldPermanent, PlayerRef } from '../../../../shared/src';
import {
  AttackTargetBadge,
  getCombatCardPreviewHandlers,
  resolveAttackTargetLabel,
} from './combatSelectionModalAttackTarget';
import { getCreatureInfo } from './combatSelectionModalCreatureInfo';
import { DangerIndicatorBadges } from './combatSelectionModalDangerBadges';
import type { CreatureGroup } from './combatSelectionModalGroupCreatures';
import type { DefenderAttackInfo } from './combatSelectionModalTypes';

export interface CombatAttackerSelectionPanelProps {
  mode: 'attackers' | 'blockers';
  isInteractive: boolean;
  availableForAttack: BattlefieldPermanent[];
  defenders: PlayerRef[];
  defenderInfoMap?: Record<string, DefenderAttackInfo>;
  selectedAttackers: Map<string, string | undefined>;
  unselectedCount: number;
  handleAttackAll: (targetId: string) => void;
  bulkAttackCount: number;
  setBulkAttackCount: React.Dispatch<React.SetStateAction<number>>;
  bulkAttackTarget: string;
  setBulkAttackTarget: React.Dispatch<React.SetStateAction<string>>;
  handleBulkAttack: (count: number, targetId: string) => void;
  handleClearAll: () => void;
  isReadOnlyAttackerView: boolean;
  stackAttackerGroups: CreatureGroup[];
  uniqueAttackerGroups: CreatureGroup[];
  groupTargets: Map<string, string>;
  setGroupTargets: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  handleAdjustGroupSelection: (group: CreatureGroup, delta: number, targetId: string) => void;
  handleToggleGroup: (group: CreatureGroup, targetId: string) => void;
  handleToggleAttacker: (creatureId: string) => void;
  handleSetAttackTarget: (creatureId: string, targetId: string) => void;
  battlefieldForBlocking: BattlefieldPermanent[];
  playerNameById: ReadonlyMap<string, string>;
}

export function CombatAttackerSelectionPanel({
  mode,
  isInteractive,
  availableForAttack,
  defenders,
  defenderInfoMap,
  selectedAttackers,
  unselectedCount,
  handleAttackAll,
  bulkAttackCount,
  setBulkAttackCount,
  bulkAttackTarget,
  setBulkAttackTarget,
  handleBulkAttack,
  handleClearAll,
  isReadOnlyAttackerView,
  stackAttackerGroups,
  uniqueAttackerGroups,
  groupTargets,
  setGroupTargets,
  handleAdjustGroupSelection,
  handleToggleGroup,
  handleToggleAttacker,
  handleSetAttackTarget,
  battlefieldForBlocking,
  playerNameById,
}: CombatAttackerSelectionPanelProps) {
  return (
    <>
        {/* Attacker Selection Mode */}
        {mode === 'attackers' && (
          <div>
            {/* Bulk Attack Controls */}
            {isInteractive && availableForAttack.length > 0 && defenders.length > 0 && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                marginBottom: 16,
                padding: '12px 16px',
                background: 'rgba(239,68,68,0.1)',
                borderRadius: 8,
                border: '1px solid rgba(239,68,68,0.3)',
              }}>
                <span style={{ fontWeight: 600, fontSize: 13, marginRight: 8 }}>Quick Attack:</span>
                
                {/* Defender info pills */}
                {defenderInfoMap && defenders.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    {defenders.map(d => {
                      const info = defenderInfoMap[d.id];
                      if (!info) return null;
                      return (
                        <div key={`info-${d.id}`} style={{
                          fontSize: 11, color: '#94a3b8',
                          background: 'rgba(0,0,0,0.3)', borderRadius: 4,
                          padding: '2px 8px', border: '1px solid #334155',
                        }}>
                          <strong style={{ color: '#f1f5f9' }}>{d.name}</strong>:
                          {' '}{info.untappedCreatureCount} untapped creature{info.untappedCreatureCount !== 1 ? 's' : ''}
                          {info.attackTaxPerCreature > 0 && (
                            <span style={{ color: '#fbbf24', marginLeft: 4 }}>
                              • {`{${info.attackTaxPerCreature}}`}/attacker tax
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Attack All buttons - one per defender */}
                {defenders.map(d => {
                  const attackTax = defenderInfoMap?.[d.id]?.attackTaxPerCreature ?? 0;
                  const attackersTargetingDefender = Array.from(selectedAttackers.values()).filter((target) => target === d.id).length;
                  const totalTax = attackTax * attackersTargetingDefender;
                  return (
                  <button
                    key={`attack-all-${d.id}`}
                    onClick={() => handleAttackAll(d.id)}
                    disabled={unselectedCount === 0}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: unselectedCount === 0 ? '#555' : '#ef4444',
                      color: '#fff',
                      cursor: unselectedCount === 0 ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Attack All → {d.name} ({unselectedCount})
                    {attackTax > 0 && totalTax > 0 && (
                      <span style={{ color: '#fde68a', marginLeft: 4 }}>
                        costs {`{${totalTax}}`}
                      </span>
                    )}
                  </button>
                  );
                })}
                
                {/* Bulk count selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                  <input
                    type="number"
                    min="0"
                    max={unselectedCount}
                    value={bulkAttackCount}
                    disabled={!isInteractive}
                    onChange={(e) => {
                      if (!isInteractive) return;
                      setBulkAttackCount(Math.min(Math.max(0, parseInt(e.target.value) || 0), unselectedCount));
                    }}
                    style={{
                      width: 60,
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: '1px solid #555',
                      background: '#222',
                      color: '#fff',
                      fontSize: 12,
                    }}
                    placeholder="Count"
                  />
                  <select
                    value={bulkAttackTarget}
                    disabled={!isInteractive}
                    onChange={(e) => {
                      if (!isInteractive) return;
                      setBulkAttackTarget(e.target.value);
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: '1px solid #555',
                      background: '#222',
                      color: '#fff',
                      fontSize: 12,
                    }}
                  >
                    {defenders.map(d => (
                      <option key={d.id} value={d.id}>→ {d.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleBulkAttack(bulkAttackCount, bulkAttackTarget)}
                    disabled={!isInteractive || bulkAttackCount === 0 || !bulkAttackTarget}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 4,
                      border: 'none',
                      background: (!isInteractive || bulkAttackCount === 0) ? '#555' : '#dc2626',
                      color: '#fff',
                      cursor: (!isInteractive || bulkAttackCount === 0) ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Add
                  </button>
                </div>
                
                {/* Clear all button */}
                {selectedAttackers.size > 0 && (
                  <button
                    onClick={handleClearAll}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid #666',
                      background: 'transparent',
                      color: '#aaa',
                      cursor: 'pointer',
                      fontSize: 12,
                      marginLeft: 'auto',
                    }}
                  >
                    Clear All ({selectedAttackers.size})
                  </button>
                )}
              </div>
            )}
            
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              {isReadOnlyAttackerView ? 'Attacking Creatures Preview' : 'Your Creatures'} ({availableForAttack.length} available, {selectedAttackers.size} selected)
            </div>
            
            {availableForAttack.length === 0 ? (
              <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                {isReadOnlyAttackerView ? 'No attackers previewed yet' : 'No untapped creatures available to attack'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
              {stackAttackerGroups.length > 0 && (
              /* Identical creatures / tokens: grouped rows with bulk assignment */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16, order: 2 }}>
                {stackAttackerGroups.map(group => {
                  const selectedInGroup = group.creatures.filter(c => selectedAttackers.has(c.id)).length;
                  const allSelected = selectedInGroup === group.creatures.length;
                  // Get group-specific target or default to first defender
                  const groupTarget = groupTargets.get(group.key) || defenders[0]?.id || '';
                  
                  // Calculate per-defender breakdown for this group
                  const attackBreakdown = defenders.map(d => {
                    const count = group.creatures.filter(c => selectedAttackers.get(c.id) === d.id).length;
                    return { defender: d, count };
                  }).filter(b => b.count > 0);
                  
                  const unselectedInGroup = group.creatures.length - selectedInGroup;
                  
                  return (
                    <div
                      key={group.key}
                      {...getCombatCardPreviewHandlers(group.creatures[0])}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        border: allSelected ? '2px solid #ef4444' : '2px solid #333',
                        background: allSelected ? 'rgba(239,68,68,0.2)' : selectedInGroup > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(0,0,0,0.3)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
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
                            {group.creatures.length} total • {selectedInGroup} attacking • {unselectedInGroup} available
                          </div>
                          {/* Show breakdown of attacks by defender */}
                          {attackBreakdown.length > 0 && (
                            <div style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>
                              {attackBreakdown.map((b, i) => (
                                <span key={b.defender.id}>
                                  {i > 0 && ', '}
                                  {b.count}→{b.defender.name}
                                </span>
                              ))}
                            </div>
                          )}
                          <DangerIndicatorBadges dangers={group.dangers} />
                        </div>
                        
                        {/* Group controls */}
                        {isInteractive && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {/* Target selector for group */}
                          {defenders.length > 1 && (
                            <select
                              value={groupTarget}
                              onChange={(e) => {
                                if (!isInteractive) return;
                                e.stopPropagation();
                                setGroupTargets(prev => {
                                  const next = new Map(prev);
                                  next.set(group.key, e.target.value);
                                  return next;
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              disabled={!isInteractive}
                              style={{
                                padding: '3px 6px',
                                borderRadius: 4,
                                border: '1px solid #555',
                                background: '#222',
                                color: '#fff',
                                fontSize: 10,
                                marginBottom: 4,
                              }}
                            >
                              {defenders.map(d => (
                                <option key={d.id} value={d.id}>
                                  → {d.name}
                                </option>
                              ))}
                            </select>
                          )}
                          
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => handleAdjustGroupSelection(group, -1, groupTarget)}
                              disabled={selectedInGroup === 0}
                              style={{
                                padding: '2px 8px',
                                fontSize: 12,
                                borderRadius: 3,
                                border: 'none',
                                background: selectedInGroup === 0 ? '#333' : '#dc2626',
                                color: '#fff',
                                cursor: selectedInGroup === 0 ? 'not-allowed' : 'pointer',
                              }}
                            >
                              −
                            </button>
                            <span style={{ fontSize: 12, minWidth: 36, textAlign: 'center', fontWeight: 600 }}>
                              {selectedInGroup}/{group.creatures.length}
                            </span>
                            <button
                              onClick={() => handleAdjustGroupSelection(group, 1, groupTarget)}
                              disabled={unselectedInGroup === 0}
                              style={{
                                padding: '2px 8px',
                                fontSize: 12,
                                borderRadius: 3,
                                border: 'none',
                                background: unselectedInGroup === 0 ? '#333' : '#ef4444',
                                color: '#fff',
                                cursor: unselectedInGroup === 0 ? 'not-allowed' : 'pointer',
                              }}
                            >
                              +
                            </button>
                          </div>

                          <button
                            onClick={() => handleToggleGroup(group, groupTarget)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 4,
                              border: 'none',
                              background: allSelected ? '#666' : '#ef4444',
                              color: '#fff',
                              cursor: 'pointer',
                              fontSize: 11,
                            }}
                          >
                            {allSelected ? 'Deselect All' : `Attack All (${group.creatures.length})`}
                          </button>
                        </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
              {uniqueAttackerGroups.length > 0 && (
              /* Unique creatures always use the card grid */
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, order: 1 }}>
                {uniqueAttackerGroups.map(group => {
                  const creature = group.creatures[0];
                  if (!creature) return null;
                  const { name, pt, effectivePower, imageUrl, dangers } = getCreatureInfo(creature);
                  const isSelected = selectedAttackers.has(creature.id);
                  const targetId = selectedAttackers.get(creature.id);
                  const attackTargetLabel = isSelected
                    ? resolveAttackTargetLabel(creature, battlefieldForBlocking, playerNameById, targetId)
                    : null;
                  
                  return (
                    <div
                      key={creature.id}
                      {...getCombatCardPreviewHandlers(creature)}
                      style={{
                        width: 130,
                        padding: 8,
                        borderRadius: 8,
                        border: isSelected ? '2px solid #ef4444' : '2px solid #333',
                        background: isSelected ? 'rgba(239,68,68,0.2)' : 'rgba(0,0,0,0.3)',
                        cursor: isInteractive ? 'pointer' : 'default',
                        transition: 'all 0.15s ease',
                      }}
                      onClick={isInteractive ? () => handleToggleAttacker(creature.id) : undefined}
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
                          background: 'rgba(0,0,0,0.5)',
                          borderRadius: 4,
                          padding: '2px 6px',
                          marginTop: 2,
                          display: 'inline-block',
                        }}>
                          {pt}
                          {effectivePower !== undefined && (
                            <span style={{ fontSize: 10, color: '#22c55e', marginLeft: 4 }}>
                              ({effectivePower} dmg)
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Danger indicators */}
                      <DangerIndicatorBadges dangers={dangers} />
                      
                      {/* Target selector for selected attackers */}
                      {isSelected && defenders.length > 0 && isInteractive && (
                        <select
                          value={targetId || ''}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleSetAttackTarget(creature.id, e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            width: '100%',
                            marginTop: 4,
                            padding: '2px 4px',
                            fontSize: 10,
                            borderRadius: 4,
                            border: '1px solid #555',
                            background: '#222',
                            color: '#fff',
                          }}
                        >
                          {defenders.map(d => (
                            <option key={d.id} value={d.id}>
                              → {d.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {isSelected && !isInteractive && (
                        <AttackTargetBadge label={attackTargetLabel || 'Unassigned'} />
                      )}
                    </div>
                  );
                })}
              </div>
              )}
              </div>
            )}
          </div>
        )}
    </>
  );
}

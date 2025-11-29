/**
 * CombatControlModal.tsx
 * 
 * Modal for Master Warcraft / Odric, Master Tactician style effects.
 * Allows a player to choose which creatures attack/block during combat,
 * overriding the normal combat declaration process.
 * 
 * This implements the UI for:
 * - Master Warcraft: "You choose which creatures attack this turn. 
 *   You choose which creatures block this turn and how those creatures block."
 * - Odric, Master Tactician: "Whenever Odric, Master Tactician and at least 
 *   three other creatures attack, you choose which creatures block this combat 
 *   and how those creatures block."
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { BattlefieldPermanent, PlayerRef, PlayerID, KnownCardRef, CombatControlEffect } from '../../../shared/src';

export interface CombatControlModalProps {
  open: boolean;
  mode: 'attackers' | 'blockers';
  combatControl: CombatControlEffect;
  /** All creatures on the battlefield */
  allCreatures: BattlefieldPermanent[];
  /** Current attackers (for blocker mode) */
  currentAttackers?: BattlefieldPermanent[];
  /** Potential defenders (for attacker mode) */
  defenders?: PlayerRef[];
  /** Players in the game for display */
  players: PlayerRef[];
  /** Current player ID (the one making decisions) */
  currentPlayerId: PlayerID;
  onConfirm: (selections: CombatControlDeclarations) => void;
  onCancel?: () => void;
}

export interface CombatControlDeclarations {
  attackers?: AttackerControlDeclaration[];
  blockers?: BlockerControlDeclaration[];
}

export interface AttackerControlDeclaration {
  creatureId: string;
  targetPlayerId: PlayerID;
}

export interface BlockerControlDeclaration {
  blockerId: string;
  attackerId: string;
}

interface CreatureInfo {
  id: string;
  name: string;
  pt: string;
  controller: PlayerID;
  controllerName: string;
  imageUrl?: string;
  tapped: boolean;
  canAttack: boolean;
  canBlock: boolean;
  keywords: string[];
  attackReason?: string;
  blockReason?: string;
}

/**
 * Get creature info from a permanent with controller info
 */
function getCreatureInfo(
  perm: BattlefieldPermanent, 
  players: PlayerRef[],
  mode: 'attackers' | 'blockers'
): CreatureInfo {
  const card = perm.card as KnownCardRef | undefined;
  const name = card?.name || perm.id;
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const typeLine = (card?.type_line || '').toLowerCase();
  
  // Calculate effective P/T
  const baseP = perm.basePower ?? (card?.power ? parseInt(String(card.power), 10) : undefined);
  const baseT = perm.baseToughness ?? (card?.toughness ? parseInt(String(card.toughness), 10) : undefined);
  const plusCounters = perm.counters?.['+1/+1'] ?? 0;
  const minusCounters = perm.counters?.['-1/-1'] ?? 0;
  const delta = plusCounters - minusCounters;
  
  const p = typeof baseP === 'number' ? baseP + delta : '?';
  const t = typeof baseT === 'number' ? baseT + delta : '?';
  const pt = `${p}/${t}`;
  
  const imageUrl = card?.image_uris?.small || card?.image_uris?.normal;
  const controller = players.find(pl => pl.id === perm.controller);
  
  // Determine if creature can attack/block
  let canAttack = true;
  let attackReason: string | undefined;
  let canBlock = true;
  let blockReason: string | undefined;
  
  // Check if it's a creature
  if (!typeLine.includes('creature')) {
    canAttack = false;
    attackReason = 'Not a creature';
    canBlock = false;
    blockReason = 'Not a creature';
  }
  
  // Check tapped status
  if (perm.tapped) {
    canAttack = false;
    attackReason = attackReason || 'Tapped';
    canBlock = false;
    blockReason = blockReason || 'Tapped';
  }
  
  // Check defender
  if (oracleText.includes('defender')) {
    canAttack = false;
    attackReason = attackReason || 'Has defender';
  }
  
  // Check summoning sickness for attackers
  if (mode === 'attackers' && perm.summoningSickness) {
    const hasHaste = oracleText.includes('haste') || 
      (perm.grantedAbilities || []).some(a => 
        typeof a === 'string' ? a.toLowerCase() === 'haste' : false
      );
    if (!hasHaste) {
      canAttack = false;
      attackReason = attackReason || 'Summoning sickness';
    }
  }
  
  // Check can't block
  if (oracleText.includes("can't block") && !oracleText.includes("can't be blocked")) {
    canBlock = false;
    blockReason = blockReason || "Can't block";
  }
  
  // Extract keywords for display
  const keywords: string[] = [];
  if (oracleText.includes('flying')) keywords.push('Flying');
  if (oracleText.includes('first strike')) keywords.push('First Strike');
  if (oracleText.includes('double strike')) keywords.push('Double Strike');
  if (oracleText.includes('trample')) keywords.push('Trample');
  if (oracleText.includes('vigilance')) keywords.push('Vigilance');
  if (oracleText.includes('lifelink')) keywords.push('Lifelink');
  if (oracleText.includes('deathtouch')) keywords.push('Deathtouch');
  if (oracleText.includes('haste')) keywords.push('Haste');
  if (oracleText.includes('reach')) keywords.push('Reach');
  if (oracleText.includes('defender')) keywords.push('Defender');
  
  return {
    id: perm.id,
    name,
    pt,
    controller: perm.controller,
    controllerName: controller?.name || perm.controller,
    imageUrl,
    tapped: perm.tapped || false,
    canAttack,
    canBlock,
    keywords,
    attackReason,
    blockReason,
  };
}

/**
 * Check if a blocker can legally block an attacker
 */
function canBlockAttacker(
  blocker: BattlefieldPermanent,
  attacker: BattlefieldPermanent
): { canBlock: boolean; reason?: string } {
  const blockerCard = blocker.card as KnownCardRef | undefined;
  const attackerCard = attacker.card as KnownCardRef | undefined;
  const blockerText = (blockerCard?.oracle_text || '').toLowerCase();
  const attackerText = (attackerCard?.oracle_text || '').toLowerCase();
  
  // Flying - need flying or reach
  if (attackerText.includes('flying')) {
    if (!blockerText.includes('flying') && !blockerText.includes('reach')) {
      return { canBlock: false, reason: "Can't block flying" };
    }
  }
  
  // Shadow - need shadow
  if (attackerText.includes('shadow')) {
    if (!blockerText.includes('shadow')) {
      return { canBlock: false, reason: "Can't block shadow" };
    }
  }
  
  // Horsemanship - need horsemanship
  if (attackerText.includes('horsemanship')) {
    if (!blockerText.includes('horsemanship')) {
      return { canBlock: false, reason: "Can't block horsemanship" };
    }
  }
  
  return { canBlock: true };
}

export function CombatControlModal({
  open,
  mode,
  combatControl,
  allCreatures,
  currentAttackers = [],
  defenders = [],
  players,
  currentPlayerId,
  onConfirm,
  onCancel,
}: CombatControlModalProps) {
  // Attackers: map creature ID to target player ID
  const [selectedAttackers, setSelectedAttackers] = useState<Map<string, PlayerID>>(new Map());
  // Blockers: map blocker ID to attacker ID
  const [selectedBlockers, setSelectedBlockers] = useState<Map<string, string>>(new Map());
  
  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setSelectedAttackers(new Map());
      setSelectedBlockers(new Map());
    }
  }, [open, mode]);
  
  // Get creatures grouped by controller for attacker mode
  const creaturesByController = useMemo(() => {
    const result = new Map<PlayerID, CreatureInfo[]>();
    
    for (const creature of allCreatures) {
      const card = creature.card as KnownCardRef | undefined;
      const typeLine = (card?.type_line || '').toLowerCase();
      
      // Only include creatures
      if (!typeLine.includes('creature')) continue;
      
      const info = getCreatureInfo(creature, players, mode);
      
      if (!result.has(creature.controller)) {
        result.set(creature.controller, []);
      }
      result.get(creature.controller)!.push(info);
    }
    
    return result;
  }, [allCreatures, players, mode]);
  
  // Get attackers for blocker mode
  const attackerInfos = useMemo(() => {
    return currentAttackers.map(a => getCreatureInfo(a, players, 'blockers'));
  }, [currentAttackers, players]);
  
  // Get potential blockers (creatures controlled by defending players)
  const potentialBlockers = useMemo(() => {
    if (mode !== 'blockers') return [];
    
    // Identify defending players
    const defendingPlayerIds = new Set<PlayerID>();
    for (const attacker of currentAttackers) {
      if (attacker.attacking && typeof attacker.attacking === 'string') {
        defendingPlayerIds.add(attacker.attacking);
      }
    }
    
    // Get creatures controlled by defending players
    const blockers: CreatureInfo[] = [];
    for (const creature of allCreatures) {
      if (!defendingPlayerIds.has(creature.controller)) continue;
      
      const card = creature.card as KnownCardRef | undefined;
      const typeLine = (card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      blockers.push(getCreatureInfo(creature, players, 'blockers'));
    }
    
    return blockers;
  }, [mode, allCreatures, currentAttackers, players]);
  
  const handleToggleAttacker = useCallback((creatureId: string, targetId?: PlayerID) => {
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      if (next.has(creatureId) && !targetId) {
        next.delete(creatureId);
      } else {
        const target = targetId || defenders[0]?.id;
        if (target) {
          next.set(creatureId, target);
        }
      }
      return next;
    });
  }, [defenders]);
  
  const handleSetBlocker = useCallback((blockerId: string, attackerId: string | null) => {
    setSelectedBlockers(prev => {
      const next = new Map(prev);
      if (attackerId === null) {
        next.delete(blockerId);
      } else {
        next.set(blockerId, attackerId);
      }
      return next;
    });
  }, []);
  
  const handleConfirm = useCallback(() => {
    if (mode === 'attackers') {
      const attackerDeclarations: AttackerControlDeclaration[] = [];
      selectedAttackers.forEach((targetPlayerId, creatureId) => {
        attackerDeclarations.push({ creatureId, targetPlayerId });
      });
      onConfirm({ attackers: attackerDeclarations });
    } else {
      const blockerDeclarations: BlockerControlDeclaration[] = [];
      selectedBlockers.forEach((attackerId, blockerId) => {
        blockerDeclarations.push({ blockerId, attackerId });
      });
      onConfirm({ blockers: blockerDeclarations });
    }
  }, [mode, selectedAttackers, selectedBlockers, onConfirm]);
  
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
        zIndex: 10002,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 1000,
          width: '95%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
          border: '2px solid #f59e0b',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f59e0b' }}>
              🎯 {combatControl.sourceName} - Combat Control
            </h2>
            <div style={{ fontSize: 13, color: '#aaa', marginTop: 4 }}>
              {mode === 'attackers' 
                ? 'You choose which creatures attack this combat'
                : 'You choose which creatures block this combat and how they block'}
            </div>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                fontSize: 28,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Attacker Control Mode */}
        {mode === 'attackers' && combatControl.controlsAttackers && (
          <div>
            <div style={{ 
              fontSize: 14, 
              color: '#f59e0b', 
              marginBottom: 12,
              padding: '8px 12px',
              background: 'rgba(245,158,11,0.1)',
              borderRadius: 8,
              border: '1px solid rgba(245,158,11,0.3)',
            }}>
              ⚔️ Select creatures to attack. Click a creature to toggle it, then choose a target.
            </div>
            
            {/* Show creatures by controller */}
            {Array.from(creaturesByController.entries()).map(([controllerId, creatures]) => {
              const controllerPlayer = players.find(p => p.id === controllerId);
              const controllerName = controllerPlayer?.name || controllerId;
              const isCurrentPlayer = controllerId === currentPlayerId;
              
              return (
                <div key={controllerId} style={{ marginBottom: 20 }}>
                  <div style={{ 
                    fontSize: 15, 
                    fontWeight: 600, 
                    marginBottom: 8,
                    color: isCurrentPlayer ? '#10b981' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    {isCurrentPlayer ? '👤' : '👥'} {controllerName}'s Creatures ({creatures.length})
                  </div>
                  
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {creatures.map(creature => {
                      const isSelected = selectedAttackers.has(creature.id);
                      const targetId = selectedAttackers.get(creature.id);
                      const canSelect = creature.canAttack;
                      
                      return (
                        <div
                          key={creature.id}
                          style={{
                            width: 130,
                            padding: 8,
                            borderRadius: 8,
                            border: isSelected 
                              ? '2px solid #ef4444' 
                              : canSelect 
                                ? '2px solid #444' 
                                : '2px solid #333',
                            background: isSelected 
                              ? 'rgba(239,68,68,0.2)' 
                              : canSelect 
                                ? 'rgba(0,0,0,0.3)' 
                                : 'rgba(60,60,60,0.3)',
                            cursor: canSelect ? 'pointer' : 'not-allowed',
                            opacity: canSelect ? 1 : 0.6,
                            transition: 'all 0.15s ease',
                          }}
                          onClick={() => canSelect && handleToggleAttacker(creature.id)}
                        >
                          {creature.imageUrl ? (
                            <img
                              src={creature.imageUrl}
                              alt={creature.name}
                              style={{
                                width: '100%',
                                borderRadius: 4,
                                marginBottom: 4,
                                filter: canSelect ? 'none' : 'grayscale(0.5)',
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
                              textAlign: 'center',
                              padding: 4,
                            }}>
                              {creature.name}
                            </div>
                          )}
                          
                          <div style={{ fontSize: 11, textAlign: 'center' }}>
                            <div style={{ 
                              fontWeight: 600, 
                              whiteSpace: 'nowrap', 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis' 
                            }}>
                              {creature.name}
                            </div>
                            <div style={{ color: '#888' }}>{creature.pt}</div>
                            {creature.keywords.length > 0 && (
                              <div style={{ color: '#666', fontSize: 9, marginTop: 2 }}>
                                {creature.keywords.slice(0, 3).join(', ')}
                              </div>
                            )}
                            {!canSelect && creature.attackReason && (
                              <div style={{ color: '#ef4444', fontSize: 9, marginTop: 2 }}>
                                {creature.attackReason}
                              </div>
                            )}
                          </div>
                          
                          {/* Target selector for selected attackers */}
                          {isSelected && defenders.length > 0 && (
                            <select
                              value={targetId || ''}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleToggleAttacker(creature.id, e.target.value);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                width: '100%',
                                marginTop: 4,
                                padding: '3px 4px',
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
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Blocker Control Mode */}
        {mode === 'blockers' && combatControl.controlsBlockers && (
          <div>
            <div style={{ 
              fontSize: 14, 
              color: '#f59e0b', 
              marginBottom: 12,
              padding: '8px 12px',
              background: 'rgba(245,158,11,0.1)',
              borderRadius: 8,
              border: '1px solid rgba(245,158,11,0.3)',
            }}>
              🛡️ Assign blockers to attackers. For each potential blocker, select which attacker (if any) it blocks.
            </div>
            
            {/* Show attacking creatures */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#ef4444' }}>
                ⚔️ Attacking Creatures ({attackerInfos.length})
              </div>
              
              {attackerInfos.length === 0 ? (
                <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                  No creatures are attacking
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {attackerInfos.map(attacker => {
                    const blockersForThis = Array.from(selectedBlockers.entries())
                      .filter(([_, attackerId]) => attackerId === attacker.id)
                      .map(([blockerId]) => {
                        const blocker = potentialBlockers.find(b => b.id === blockerId);
                        return blocker?.name || blockerId;
                      });
                    
                    return (
                      <div
                        key={attacker.id}
                        style={{
                          width: 130,
                          padding: 8,
                          borderRadius: 8,
                          border: '2px solid #ef4444',
                          background: 'rgba(239,68,68,0.15)',
                        }}
                      >
                        {attacker.imageUrl ? (
                          <img
                            src={attacker.imageUrl}
                            alt={attacker.name}
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
                            textAlign: 'center',
                            padding: 4,
                          }}>
                            {attacker.name}
                          </div>
                        )}
                        <div style={{ fontSize: 11, textAlign: 'center' }}>
                          <div style={{ 
                            fontWeight: 600, 
                            whiteSpace: 'nowrap', 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis' 
                          }}>
                            {attacker.name}
                          </div>
                          <div style={{ color: '#888' }}>{attacker.pt}</div>
                          <div style={{ color: '#aaa', fontSize: 9 }}>
                            Controlled by {attacker.controllerName}
                          </div>
                          {blockersForThis.length > 0 && (
                            <div style={{ 
                              color: '#10b981', 
                              marginTop: 4, 
                              fontSize: 10,
                              padding: '2px 4px',
                              background: 'rgba(16,185,129,0.2)',
                              borderRadius: 4,
                            }}>
                              Blocked by: {blockersForThis.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            
            {/* Show potential blockers */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#10b981' }}>
                🛡️ Potential Blockers ({potentialBlockers.length})
              </div>
              
              {potentialBlockers.length === 0 ? (
                <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                  No creatures can block
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {potentialBlockers.map(blocker => {
                    const blockedAttackerId = selectedBlockers.get(blocker.id);
                    const isBlocking = !!blockedAttackerId;
                    
                    return (
                      <div
                        key={blocker.id}
                        style={{
                          width: 130,
                          padding: 8,
                          borderRadius: 8,
                          border: isBlocking ? '2px solid #10b981' : '2px solid #444',
                          background: isBlocking ? 'rgba(16,185,129,0.2)' : 'rgba(0,0,0,0.3)',
                          opacity: blocker.canBlock ? 1 : 0.6,
                        }}
                      >
                        {blocker.imageUrl ? (
                          <img
                            src={blocker.imageUrl}
                            alt={blocker.name}
                            style={{
                              width: '100%',
                              borderRadius: 4,
                              marginBottom: 4,
                              filter: blocker.canBlock ? 'none' : 'grayscale(0.5)',
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
                            textAlign: 'center',
                            padding: 4,
                          }}>
                            {blocker.name}
                          </div>
                        )}
                        <div style={{ fontSize: 11, textAlign: 'center' }}>
                          <div style={{ 
                            fontWeight: 600, 
                            whiteSpace: 'nowrap', 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis' 
                          }}>
                            {blocker.name}
                          </div>
                          <div style={{ color: '#888' }}>{blocker.pt}</div>
                          <div style={{ color: '#aaa', fontSize: 9 }}>
                            Controlled by {blocker.controllerName}
                          </div>
                          {!blocker.canBlock && blocker.blockReason && (
                            <div style={{ color: '#ef4444', fontSize: 9, marginTop: 2 }}>
                              {blocker.blockReason}
                            </div>
                          )}
                        </div>
                        
                        {/* Attacker selector */}
                        {blocker.canBlock && (
                          <select
                            value={blockedAttackerId || ''}
                            onChange={(e) => {
                              const attackerId = e.target.value || null;
                              handleSetBlocker(blocker.id, attackerId);
                            }}
                            style={{
                              width: '100%',
                              marginTop: 4,
                              padding: '3px 4px',
                              fontSize: 10,
                              borderRadius: 4,
                              border: '1px solid #555',
                              background: '#222',
                              color: '#fff',
                            }}
                          >
                            <option value="">Don't block</option>
                            {attackerInfos.map(attacker => {
                              // Check if this blocker can legally block this attacker
                              const attackerPerm = currentAttackers.find(a => a.id === attacker.id);
                              const blockerPerm = allCreatures.find(c => c.id === blocker.id);
                              if (!attackerPerm || !blockerPerm) return null;
                              
                              const { canBlock, reason } = canBlockAttacker(blockerPerm, attackerPerm);
                              
                              return (
                                <option 
                                  key={attacker.id} 
                                  value={attacker.id}
                                  disabled={!canBlock}
                                >
                                  Block {attacker.name} {!canBlock ? `(${reason})` : ''}
                                </option>
                              );
                            })}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'flex-end',
            marginTop: 24,
            paddingTop: 16,
            borderTop: '1px solid #333',
          }}
        >
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: '10px 20px',
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
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: '#f59e0b',
              color: '#000',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {mode === 'attackers' 
              ? `Confirm Attackers (${selectedAttackers.size})`
              : `Confirm Blockers (${selectedBlockers.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CombatControlModal;

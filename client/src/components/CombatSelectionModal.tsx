/**
 * CombatSelectionModal.tsx
 * 
 * Modal for declaring attackers and blockers during combat phase.
 * Shows the player's available creatures and allows selection for combat.
 * Displays effective P/T and danger indicators for combat abilities.
 */

import React, { useState, useMemo } from 'react';
import type { BattlefieldPermanent, PlayerRef, PlayerID, KnownCardRef } from '../../../shared/src';

export interface CombatSelectionModalProps {
  open: boolean;
  mode: 'attackers' | 'blockers';
  availableCreatures: BattlefieldPermanent[];
  attackingCreatures?: BattlefieldPermanent[]; // For blocker mode: which creatures are attacking
  defenders?: PlayerRef[]; // For attacker mode: which players/planeswalkers can be attacked
  onConfirm: (selections: AttackerSelection[] | BlockerSelection[]) => void;
  onSkip: () => void;
  onCancel?: () => void;
  /** If true, the modal is view-only (for spectators or non-active players) */
  readOnly?: boolean;
  /** Whether it's the current player's turn (for attackers mode) */
  isYourTurn?: boolean;
}

export interface AttackerSelection {
  creatureId: string;
  targetPlayerId?: string;
  targetPermanentId?: string;
}

export interface BlockerSelection {
  blockerId: string;
  attackerId: string;
}

/**
 * Dangerous combat abilities that players should be warned about
 */
interface DangerIndicators {
  deathtouch: boolean;
  infect: boolean;
  toxic: number; // 0 if no toxic, otherwise the toxic value
  trample: boolean;
  menace: boolean;
  firstStrike: boolean;
  doubleStrike: boolean;
  lifelink: boolean;
  indestructible: boolean;
}

/**
 * Get creature info from a permanent, including effective P/T and danger indicators
 */
function getCreatureInfo(perm: BattlefieldPermanent): { 
  name: string; 
  pt: string; 
  effectivePower: number | undefined;
  effectiveToughness: number | undefined;
  imageUrl?: string;
  dangers: DangerIndicators;
} {
  // Defensive check for undefined/null permanent
  if (!perm) {
    return { 
      name: 'Unknown', 
      pt: '?/?', 
      effectivePower: undefined, 
      effectiveToughness: undefined,
      imageUrl: undefined,
      dangers: { deathtouch: false, infect: false, toxic: 0, trample: false, menace: false, firstStrike: false, doubleStrike: false, lifelink: false, indestructible: false }
    };
  }
  
  const card = perm.card as KnownCardRef | undefined;
  const name = card?.name || perm.id || 'Unknown';
  const oracleText = (card?.oracle_text || '').toLowerCase();
  
  // Use pre-calculated effective P/T if available
  let effectivePower = perm.effectivePower;
  let effectiveToughness = perm.effectiveToughness;
  
  // Fallback to manual calculation if not pre-calculated
  if (effectivePower === undefined || effectiveToughness === undefined) {
    let baseP: number | undefined;
    let baseT: number | undefined;
    
    try {
      if (perm.basePower !== undefined && perm.basePower !== null) {
        baseP = typeof perm.basePower === 'number' ? perm.basePower : parseInt(String(perm.basePower), 10);
        if (isNaN(baseP)) baseP = undefined;
      } else if (card?.power) {
        baseP = parseInt(String(card.power), 10);
        if (isNaN(baseP)) baseP = undefined;
      }
      
      if (perm.baseToughness !== undefined && perm.baseToughness !== null) {
        baseT = typeof perm.baseToughness === 'number' ? perm.baseToughness : parseInt(String(perm.baseToughness), 10);
        if (isNaN(baseT)) baseT = undefined;
      } else if (card?.toughness) {
        baseT = parseInt(String(card.toughness), 10);
        if (isNaN(baseT)) baseT = undefined;
      }
    } catch {
      // Ignore parsing errors
    }
    
    const plusCounters = perm.counters?.['+1/+1'] ?? 0;
    const minusCounters = perm.counters?.['-1/-1'] ?? 0;
    const delta = plusCounters - minusCounters;
    
    effectivePower = typeof baseP === 'number' ? baseP + delta : undefined;
    effectiveToughness = typeof baseT === 'number' ? baseT + delta : undefined;
  }
  
  const p = effectivePower !== undefined ? effectivePower : '?';
  const t = effectiveToughness !== undefined ? effectiveToughness : '?';
  const pt = `${p}/${t}`;
  
  const imageUrl = card?.image_uris?.small || card?.image_uris?.normal;
  
  // Check for granted abilities and card text for danger indicators
  const grantedAbilities = (perm.grantedAbilities || []).map(a => a.toLowerCase());
  const hasAbility = (keyword: string) => 
    grantedAbilities.some(a => a.includes(keyword)) || 
    oracleText.includes(keyword);
  
  // Parse toxic value
  let toxicValue = 0;
  const toxicMatch = oracleText.match(/toxic\s+(\d+)/i);
  if (toxicMatch) {
    toxicValue = parseInt(toxicMatch[1], 10);
  }
  
  const dangers: DangerIndicators = {
    deathtouch: hasAbility('deathtouch'),
    infect: hasAbility('infect'),
    toxic: toxicValue,
    trample: hasAbility('trample'),
    menace: hasAbility('menace'),
    firstStrike: hasAbility('first strike') || hasAbility('first_strike'),
    doubleStrike: hasAbility('double strike') || hasAbility('double_strike'),
    lifelink: hasAbility('lifelink'),
    indestructible: hasAbility('indestructible'),
  };
  
  return { name, pt, effectivePower, effectiveToughness, imageUrl, dangers };
}

/**
 * Danger badge component for displaying combat abilities
 */
function DangerBadge({ label, color, tooltip }: { label: string; color: string; tooltip: string }) {
  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-block',
        padding: '2px 4px',
        fontSize: 8,
        fontWeight: 600,
        borderRadius: 3,
        backgroundColor: color,
        color: '#fff',
        marginRight: 2,
        marginBottom: 2,
        textShadow: '0 1px 1px rgba(0,0,0,0.5)',
      }}
    >
      {label}
    </span>
  );
}

/**
 * Render danger indicators for a creature
 */
function DangerIndicatorBadges({ dangers }: { dangers: DangerIndicators }) {
  const badges: React.ReactNode[] = [];
  
  if (dangers.deathtouch) {
    badges.push(<DangerBadge key="dt" label="☠️DT" color="#10b981" tooltip="Deathtouch - Any damage destroys" />);
  }
  if (dangers.infect) {
    badges.push(<DangerBadge key="inf" label="☣️INF" color="#22c55e" tooltip="Infect - Deals damage as poison/−1/−1 counters" />);
  }
  if (dangers.toxic > 0) {
    badges.push(<DangerBadge key="tox" label={`☠️T${dangers.toxic}`} color="#84cc16" tooltip={`Toxic ${dangers.toxic} - Deals ${dangers.toxic} poison counter(s) on combat damage`} />);
  }
  if (dangers.trample) {
    badges.push(<DangerBadge key="trm" label="🦶TRM" color="#34d399" tooltip="Trample - Excess damage goes through" />);
  }
  if (dangers.menace) {
    badges.push(<DangerBadge key="men" label="👹MEN" color="#f87171" tooltip="Menace - Must be blocked by 2+ creatures" />);
  }
  if (dangers.firstStrike) {
    badges.push(<DangerBadge key="1st" label="⚡1ST" color="#ef4444" tooltip="First Strike - Deals damage first" />);
  }
  if (dangers.doubleStrike) {
    badges.push(<DangerBadge key="2x" label="⚡⚡2X" color="#dc2626" tooltip="Double Strike - Deals first strike and normal damage" />);
  }
  if (dangers.lifelink) {
    badges.push(<DangerBadge key="ll" label="❤️LL" color="#f0abfc" tooltip="Lifelink - Damage heals controller" />);
  }
  if (dangers.indestructible) {
    badges.push(<DangerBadge key="ind" label="🛡️IND" color="#eab308" tooltip="Indestructible - Cannot be destroyed" />);
  }
  
  if (badges.length === 0) return null;
  
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 4, justifyContent: 'center' }}>
      {badges}
    </div>
  );
}

/**
 * Check if a creature with menace can be legally blocked by the selected blockers
 */
function checkMenaceBlocking(
  attackerId: string, 
  attackerDangers: DangerIndicators, 
  selectedBlockers: Map<string, string>
): { isLegal: boolean; message?: string } {
  if (!attackerDangers.menace) {
    return { isLegal: true };
  }
  
  const blockersForAttacker = Array.from(selectedBlockers.entries())
    .filter(([_, aid]) => aid === attackerId)
    .length;
  
  if (blockersForAttacker === 0) {
    return { isLegal: true }; // Not blocking is legal
  }
  
  if (blockersForAttacker === 1) {
    return { isLegal: false, message: 'Menace requires 2+ blockers' };
  }
  
  return { isLegal: true };
}

export function CombatSelectionModal({
  open,
  mode,
  availableCreatures,
  attackingCreatures = [],
  defenders = [],
  onConfirm,
  onSkip,
  onCancel,
  readOnly = false,
  isYourTurn = true,
}: CombatSelectionModalProps) {
  // For attackers: selected creatures and their targets
  const [selectedAttackers, setSelectedAttackers] = useState<Map<string, string | undefined>>(new Map());
  
  // For blockers: which blockers block which attackers
  const [selectedBlockers, setSelectedBlockers] = useState<Map<string, string>>(new Map());
  
  // Determine if the modal should be interactive
  // For attackers mode, only the turn player can interact
  // For blockers mode, only the defending player can interact
  const isInteractive = !readOnly && (mode === 'blockers' || isYourTurn);
  
  // Reset selections when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedAttackers(new Map());
      setSelectedBlockers(new Map());
    }
  }, [open, mode]);

  // Filter to only untapped creatures for attackers
  const availableForAttack = useMemo(() => {
    return availableCreatures.filter(c => !c.tapped);
  }, [availableCreatures]);

  // Filter to only untapped creatures for blocking
  const availableForBlock = useMemo(() => {
    return availableCreatures.filter(c => !c.tapped);
  }, [availableCreatures]);

  // Check for menace violations
  const menaceViolations = useMemo(() => {
    const violations: Map<string, string> = new Map();
    for (const attacker of attackingCreatures) {
      const { dangers } = getCreatureInfo(attacker);
      const check = checkMenaceBlocking(attacker.id, dangers, selectedBlockers);
      if (!check.isLegal && check.message) {
        violations.set(attacker.id, check.message);
      }
    }
    return violations;
  }, [attackingCreatures, selectedBlockers]);

  const handleToggleAttacker = (creatureId: string) => {
    if (!isInteractive) return; // Don't allow interaction if read-only
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      if (next.has(creatureId)) {
        next.delete(creatureId);
      } else {
        // Default target is the first opponent
        const defaultTarget = defenders[0]?.id;
        next.set(creatureId, defaultTarget);
      }
      return next;
    });
  };

  const handleSetAttackTarget = (creatureId: string, targetId: string) => {
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      next.set(creatureId, targetId);
      return next;
    });
  };

  const handleToggleBlocker = (blockerId: string, attackerId: string) => {
    if (!isInteractive) return; // Don't allow interaction if read-only
    setSelectedBlockers(prev => {
      const next = new Map(prev);
      if (next.get(blockerId) === attackerId) {
        next.delete(blockerId);
      } else {
        next.set(blockerId, attackerId);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (!isInteractive) return; // Don't allow if read-only
    
    // Check for menace violations before confirming
    if (menaceViolations.size > 0) {
      alert('Invalid blocking: ' + Array.from(menaceViolations.values()).join(', '));
      return;
    }
    
    if (mode === 'attackers') {
      const selections: AttackerSelection[] = Array.from(selectedAttackers.entries()).map(([creatureId, target]) => ({
        creatureId,
        targetPlayerId: target,
      }));
      onConfirm(selections);
    } else {
      const selections: BlockerSelection[] = Array.from(selectedBlockers.entries()).map(([blockerId, attackerId]) => ({
        blockerId,
        attackerId,
      }));
      onConfirm(selections);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 900,
          width: '95%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {mode === 'attackers' ? '⚔️ Declare Attackers' : '🛡️ Declare Blockers'}
          </h2>
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                fontSize: 24,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          )}
        </div>

        <div style={{ fontSize: 13, color: '#aaa', marginBottom: 16 }}>
          {mode === 'attackers' 
            ? 'Click on creatures to select them as attackers. Choose a target for each attacker.'
            : 'Click on your creatures, then click an attacker to block it. Watch for dangerous abilities!'}
        </div>

        {/* Menace warning banner */}
        {mode === 'blockers' && menaceViolations.size > 0 && (
          <div style={{
            padding: '8px 12px',
            backgroundColor: 'rgba(239,68,68,0.2)',
            border: '1px solid #ef4444',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 12,
            color: '#fca5a5',
          }}>
            ⚠️ <strong>Illegal Blocking:</strong> {Array.from(menaceViolations.values()).join('. ')}
          </div>
        )}

        {/* Attacker Selection Mode */}
        {mode === 'attackers' && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              Your Creatures ({availableForAttack.length} available)
            </div>
            
            {availableForAttack.length === 0 ? (
              <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                No untapped creatures available to attack
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                {availableForAttack.map(creature => {
                  const { name, pt, effectivePower, imageUrl, dangers } = getCreatureInfo(creature);
                  const isSelected = selectedAttackers.has(creature.id);
                  const targetId = selectedAttackers.get(creature.id);
                  
                  return (
                    <div
                      key={creature.id}
                      style={{
                        width: 130,
                        padding: 8,
                        borderRadius: 8,
                        border: isSelected ? '2px solid #ef4444' : '2px solid #333',
                        background: isSelected ? 'rgba(239,68,68,0.2)' : 'rgba(0,0,0,0.3)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onClick={() => handleToggleAttacker(creature.id)}
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
                      {isSelected && defenders.length > 0 && (
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
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Blocker Selection Mode */}
        {mode === 'blockers' && (
          <div>
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
                    const blockersForThis = Array.from(selectedBlockers.entries())
                      .filter(([_, attackerId]) => attackerId === attacker.id)
                      .map(([blockerId]) => blockerId);
                    const menaceViolation = menaceViolations.get(attacker.id);
                    
                    return (
                      <div
                        key={attacker.id}
                        style={{
                          width: 130,
                          padding: 8,
                          borderRadius: 8,
                          border: menaceViolation ? '2px solid #f59e0b' : '2px solid #ef4444',
                          background: menaceViolation ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.15)',
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
                🛡️ Your Creatures ({availableForBlock.length} can block)
              </div>
              
              {availableForBlock.length === 0 ? (
                <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                  No untapped creatures available to block
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {availableForBlock.map(blocker => {
                    const { name, pt, effectivePower, effectiveToughness, imageUrl, dangers } = getCreatureInfo(blocker);
                    const blockedAttackerId = selectedBlockers.get(blocker.id);
                    const isBlocking = !!blockedAttackerId;
                    
                    return (
                      <div
                        key={blocker.id}
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
                          {effectiveToughness !== undefined && (
                            <div style={{ fontSize: 9, color: '#86efac', marginTop: 2 }}>
                              Can survive {effectiveToughness - 1} damage
                            </div>
                          )}
                        </div>
                        
                        {/* Blocker's own abilities */}
                        <DangerIndicatorBadges dangers={dangers} />
                        
                        {/* Attacker selector */}
                        <select
                          value={blockedAttackerId || ''}
                          onChange={(e) => {
                            if (e.target.value) {
                              handleToggleBlocker(blocker.id, e.target.value);
                            } else {
                              // Remove the blocker assignment
                              setSelectedBlockers(prev => {
                                const next = new Map(prev);
                                next.delete(blocker.id);
                                return next;
                              });
                            }
                          }}
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
                          <option value="">Don't block</option>
                          {attackingCreatures.map(attacker => {
                            const attackerInfo = getCreatureInfo(attacker);
                            const dangerText = [];
                            if (attackerInfo.dangers.deathtouch) dangerText.push('DT');
                            if (attackerInfo.dangers.infect) dangerText.push('INF');
                            if (attackerInfo.dangers.trample) dangerText.push('TRM');
                            if (attackerInfo.dangers.menace) dangerText.push('MEN');
                            const dangerStr = dangerText.length > 0 ? ` ⚠️${dangerText.join('/')}` : '';
                            return (
                              <option key={attacker.id} value={attacker.id}>
                                Block {attackerInfo.name} ({attackerInfo.pt}){dangerStr}
                              </option>
                            );
                          })}
                        </select>
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
          <button
            onClick={onSkip}
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
            {mode === 'attackers' ? "Don't Attack" : "Don't Block"}
          </button>
          <button
            onClick={handleConfirm}
            disabled={
              (mode === 'attackers' && selectedAttackers.size === 0) ||
              (mode === 'blockers' && menaceViolations.size > 0)
            }
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: mode === 'attackers' ? '#ef4444' : '#10b981',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              opacity: (
                (mode === 'attackers' && selectedAttackers.size === 0) ||
                (mode === 'blockers' && menaceViolations.size > 0)
              ) ? 0.5 : 1,
            }}
          >
            {mode === 'attackers' 
              ? `Attack with ${selectedAttackers.size} Creature${selectedAttackers.size !== 1 ? 's' : ''}`
              : `Confirm Blockers (${selectedBlockers.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CombatSelectionModal;

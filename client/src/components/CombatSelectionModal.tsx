/**
 * CombatSelectionModal.tsx
 * 
 * Modal for declaring attackers and blockers during combat phase.
 * Shows the player's available creatures and allows selection for combat.
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
 * Get creature info from a permanent
 */
function getCreatureInfo(perm: BattlefieldPermanent): { name: string; pt: string; imageUrl?: string } {
  const card = perm.card as KnownCardRef | undefined;
  const name = card?.name || perm.id;
  
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
  
  return { name, pt, imageUrl };
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
}: CombatSelectionModalProps) {
  // For attackers: selected creatures and their targets
  const [selectedAttackers, setSelectedAttackers] = useState<Map<string, string | undefined>>(new Map());
  
  // For blockers: which blockers block which attackers
  const [selectedBlockers, setSelectedBlockers] = useState<Map<string, string>>(new Map());
  
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

  const handleToggleAttacker = (creatureId: string) => {
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
          maxWidth: 800,
          width: '90%',
          maxHeight: '80vh',
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
            : 'Click on your creatures, then click an attacker to block it.'}
        </div>

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
                  const { name, pt, imageUrl } = getCreatureInfo(creature);
                  const isSelected = selectedAttackers.has(creature.id);
                  const targetId = selectedAttackers.get(creature.id);
                  
                  return (
                    <div
                      key={creature.id}
                      style={{
                        width: 120,
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
                        <div style={{ color: '#888' }}>{pt}</div>
                      </div>
                      
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
                Attacking Creatures ({attackingCreatures.length})
              </div>
              
              {attackingCreatures.length === 0 ? (
                <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                  No creatures are attacking
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {attackingCreatures.map(attacker => {
                    const { name, pt, imageUrl } = getCreatureInfo(attacker);
                    const blockersForThis = Array.from(selectedBlockers.entries())
                      .filter(([_, attackerId]) => attackerId === attacker.id)
                      .map(([blockerId]) => blockerId);
                    
                    return (
                      <div
                        key={attacker.id}
                        style={{
                          width: 120,
                          padding: 8,
                          borderRadius: 8,
                          border: '2px solid #ef4444',
                          background: 'rgba(239,68,68,0.15)',
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
                          <div style={{ color: '#888' }}>{pt}</div>
                          {blockersForThis.length > 0 && (
                            <div style={{ color: '#10b981', marginTop: 4, fontSize: 10 }}>
                              Blocked by {blockersForThis.length}
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
                Your Creatures ({availableForBlock.length} can block)
              </div>
              
              {availableForBlock.length === 0 ? (
                <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                  No untapped creatures available to block
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {availableForBlock.map(blocker => {
                    const { name, pt, imageUrl } = getCreatureInfo(blocker);
                    const blockedAttackerId = selectedBlockers.get(blocker.id);
                    const isBlocking = !!blockedAttackerId;
                    
                    return (
                      <div
                        key={blocker.id}
                        style={{
                          width: 120,
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
                          <div style={{ color: '#888' }}>{pt}</div>
                        </div>
                        
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
                            return (
                              <option key={attacker.id} value={attacker.id}>
                                Block {attackerInfo.name}
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
              (mode === 'blockers' && selectedBlockers.size === 0 && attackingCreatures.length > 0)
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
                (mode === 'blockers' && selectedBlockers.size === 0 && attackingCreatures.length > 0)
              ) ? 0.5 : 1,
            }}
          >
            {mode === 'attackers' 
              ? `Attack with ${selectedAttackers.size} Creature${selectedAttackers.size !== 1 ? 's' : ''}`
              : `Block with ${selectedBlockers.size} Creature${selectedBlockers.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CombatSelectionModal;

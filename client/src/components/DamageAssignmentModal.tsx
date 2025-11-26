/**
 * DamageAssignmentModal.tsx
 * 
 * Modal for assigning combat damage, especially when:
 * - An attacker is blocked by multiple blockers (blocker ordering)
 * - A creature with trample needs to assign excess damage
 * - First strike / double strike damage steps
 */

import React, { useState, useMemo, useEffect } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';

interface CreatureInfo {
  id: string;
  name: string;
  power: number;
  toughness: number;
  damage: number; // Damage already marked
  keywords: string[];
  imageUrl?: string;
}

function extractCreatureInfo(perm: BattlefieldPermanent): CreatureInfo {
  const card = perm.card as KnownCardRef | undefined;
  const basePower = perm.basePower ?? parseInt(card?.power || '0', 10) || 0;
  const baseToughness = perm.baseToughness ?? parseInt(card?.toughness || '0', 10) || 0;
  const plusCounters = perm.counters?.['+1/+1'] || 0;
  const minusCounters = perm.counters?.['-1/-1'] || 0;
  
  const keywords: string[] = [];
  const oracleText = (card?.oracle_text || '').toLowerCase();
  if (oracleText.includes('deathtouch')) keywords.push('Deathtouch');
  if (oracleText.includes('trample')) keywords.push('Trample');
  if (oracleText.includes('lifelink')) keywords.push('Lifelink');
  if (oracleText.includes('first strike')) keywords.push('First Strike');
  if (oracleText.includes('double strike')) keywords.push('Double Strike');
  
  return {
    id: perm.id,
    name: card?.name || 'Creature',
    power: basePower + plusCounters - minusCounters,
    toughness: baseToughness + plusCounters - minusCounters,
    damage: perm.counters?.damage || 0,
    keywords,
    imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
  };
}

export interface DamageAssignment {
  blockerId: string;
  damage: number;
}

export interface DamageAssignmentModalProps {
  open: boolean;
  attacker: BattlefieldPermanent;
  blockers: BattlefieldPermanent[];
  hasTrample: boolean;
  defendingPlayerId?: string;
  defendingPlayerName?: string;
  onConfirm: (assignments: DamageAssignment[], trampleDamage: number) => void;
  onCancel?: () => void;
}

export function DamageAssignmentModal({
  open,
  attacker,
  blockers,
  hasTrample,
  defendingPlayerId,
  defendingPlayerName = 'Opponent',
  onConfirm,
  onCancel,
}: DamageAssignmentModalProps) {
  const attackerInfo = useMemo(() => extractCreatureInfo(attacker), [attacker]);
  const blockersInfo = useMemo(() => blockers.map(extractCreatureInfo), [blockers]);
  
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [blockerOrder, setBlockerOrder] = useState<string[]>([]);
  
  const hasDeathtouch = attackerInfo.keywords.includes('Deathtouch');
  
  // Initialize blocker order
  useEffect(() => {
    if (open) {
      setBlockerOrder(blockersInfo.map(b => b.id));
      // Auto-assign lethal damage initially
      const initial: Record<string, number> = {};
      let remainingPower = attackerInfo.power;
      
      for (const blocker of blockersInfo) {
        const lethal = hasDeathtouch ? 1 : Math.max(1, blocker.toughness - blocker.damage);
        const assigned = Math.min(remainingPower, lethal);
        initial[blocker.id] = assigned;
        remainingPower -= assigned;
        if (remainingPower <= 0) break;
      }
      setAssignments(initial);
    }
  }, [open, blockersInfo, attackerInfo.power, hasDeathtouch]);
  
  // Calculate totals
  const totalAssigned = Object.values(assignments).reduce((sum, d) => sum + d, 0);
  const trampleDamage = hasTrample ? Math.max(0, attackerInfo.power - totalAssigned) : 0;
  const remainingToAssign = attackerInfo.power - totalAssigned - trampleDamage;
  
  // Check if assignments are valid (lethal to each before moving to next in order)
  const isValidAssignment = useMemo(() => {
    let reachedNonLethal = false;
    
    for (const blockerId of blockerOrder) {
      const blocker = blockersInfo.find(b => b.id === blockerId);
      if (!blocker) continue;
      
      const assigned = assignments[blockerId] || 0;
      const lethal = hasDeathtouch ? 1 : blocker.toughness - blocker.damage;
      
      if (assigned < lethal && assigned > 0) {
        // Partially assigned but not lethal - only ok if last in order
        const remainingBlockers = blockerOrder.slice(blockerOrder.indexOf(blockerId) + 1);
        const hasMoreAfter = remainingBlockers.some(id => (assignments[id] || 0) > 0);
        if (hasMoreAfter) {
          return false; // Can't skip to later blockers without lethal damage
        }
      }
      
      if (assigned < lethal) {
        reachedNonLethal = true;
      } else if (reachedNonLethal && assigned > 0) {
        return false; // Already gave up on lethal, can't assign more to later blockers
      }
    }
    
    return true;
  }, [assignments, blockerOrder, blockersInfo, hasDeathtouch]);
  
  const handleAdjustDamage = (blockerId: string, delta: number) => {
    setAssignments(prev => {
      const current = prev[blockerId] || 0;
      const newVal = Math.max(0, current + delta);
      const totalOthers = Object.entries(prev)
        .filter(([id]) => id !== blockerId)
        .reduce((sum, [, d]) => sum + d, 0);
      
      // Can't exceed attacker power
      const maxForThis = attackerInfo.power - totalOthers;
      return {
        ...prev,
        [blockerId]: Math.min(newVal, maxForThis),
      };
    });
  };
  
  const handleMoveBlocker = (blockerId: string, direction: 'up' | 'down') => {
    setBlockerOrder(prev => {
      const idx = prev.indexOf(blockerId);
      if (idx === -1) return prev;
      
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };
  
  const handleConfirm = () => {
    const assignmentList: DamageAssignment[] = blockerOrder
      .filter(id => (assignments[id] || 0) > 0)
      .map(id => ({ blockerId: id, damage: assignments[id] || 0 }));
    
    onConfirm(assignmentList, trampleDamage);
  };
  
  const canConfirm = isValidAssignment && (totalAssigned + trampleDamage === attackerInfo.power || totalAssigned === attackerInfo.power);

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
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, marginBottom: 16 }}>
          ⚔️ Assign Combat Damage
        </h2>

        {/* Attacker info */}
        <div style={{
          display: 'flex',
          gap: 16,
          marginBottom: 20,
          padding: 16,
          backgroundColor: 'rgba(239,68,68,0.1)',
          borderRadius: 8,
          border: '1px solid rgba(239,68,68,0.3)',
        }}>
          {attackerInfo.imageUrl && (
            <img
              src={attackerInfo.imageUrl}
              alt={attackerInfo.name}
              style={{ width: 80, borderRadius: 6 }}
            />
          )}
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{attackerInfo.name}</div>
            <div style={{ fontSize: 14, color: '#aaa', marginTop: 4 }}>
              {attackerInfo.power}/{attackerInfo.toughness}
            </div>
            {attackerInfo.keywords.length > 0 && (
              <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 4 }}>
                {attackerInfo.keywords.join(', ')}
              </div>
            )}
            <div style={{ fontSize: 14, color: '#10b981', marginTop: 8, fontWeight: 600 }}>
              Damage to assign: {attackerInfo.power}
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div style={{
          fontSize: 13,
          color: '#ccc',
          marginBottom: 16,
          padding: 12,
          backgroundColor: 'rgba(255,255,255,0.05)',
          borderRadius: 6,
        }}>
          {hasDeathtouch 
            ? 'With deathtouch, 1 damage is lethal. Assign at least 1 damage to each blocker before moving to the next.'
            : 'Assign lethal damage to blockers in order. You must assign lethal damage to a blocker before assigning damage to the next one.'}
          {hasTrample && ' Excess damage goes to the defending player.'}
        </div>

        {/* Blockers */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            🛡️ Blocking Creatures (damage order: top to bottom)
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {blockerOrder.map((blockerId, orderIdx) => {
              const blocker = blockersInfo.find(b => b.id === blockerId);
              if (!blocker) return null;
              
              const assigned = assignments[blockerId] || 0;
              const lethalDamage = hasDeathtouch ? 1 : blocker.toughness - blocker.damage;
              const isLethal = assigned >= lethalDamage;
              
              return (
                <div
                  key={blockerId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    backgroundColor: isLethal 
                      ? 'rgba(239,68,68,0.15)' 
                      : 'rgba(255,255,255,0.05)',
                    borderRadius: 8,
                    border: isLethal 
                      ? '1px solid rgba(239,68,68,0.4)' 
                      : '1px solid #4a4a6a',
                  }}
                >
                  {/* Order controls */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button
                      onClick={() => handleMoveBlocker(blockerId, 'up')}
                      disabled={orderIdx === 0}
                      style={{
                        width: 24,
                        height: 20,
                        border: 'none',
                        borderRadius: 4,
                        backgroundColor: orderIdx === 0 ? '#333' : '#4a4a6a',
                        color: orderIdx === 0 ? '#666' : '#fff',
                        cursor: orderIdx === 0 ? 'not-allowed' : 'pointer',
                        fontSize: 10,
                      }}
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => handleMoveBlocker(blockerId, 'down')}
                      disabled={orderIdx === blockerOrder.length - 1}
                      style={{
                        width: 24,
                        height: 20,
                        border: 'none',
                        borderRadius: 4,
                        backgroundColor: orderIdx === blockerOrder.length - 1 ? '#333' : '#4a4a6a',
                        color: orderIdx === blockerOrder.length - 1 ? '#666' : '#fff',
                        cursor: orderIdx === blockerOrder.length - 1 ? 'not-allowed' : 'pointer',
                        fontSize: 10,
                      }}
                    >
                      ▼
                    </button>
                  </div>

                  {/* Blocker image */}
                  {blocker.imageUrl && (
                    <img
                      src={blocker.imageUrl}
                      alt={blocker.name}
                      style={{ width: 50, borderRadius: 4 }}
                    />
                  )}

                  {/* Blocker info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {blocker.name}
                    </div>
                    <div style={{ fontSize: 12, color: '#aaa' }}>
                      {blocker.power}/{blocker.toughness}
                      {blocker.damage > 0 && ` (${blocker.damage} damage marked)`}
                    </div>
                    <div style={{ fontSize: 11, color: '#888' }}>
                      Lethal: {lethalDamage} damage
                    </div>
                  </div>

                  {/* Damage controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => handleAdjustDamage(blockerId, -1)}
                      disabled={assigned <= 0}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        border: 'none',
                        backgroundColor: assigned <= 0 ? '#333' : '#ef4444',
                        color: '#fff',
                        cursor: assigned <= 0 ? 'not-allowed' : 'pointer',
                        fontSize: 18,
                        fontWeight: 600,
                      }}
                    >
                      -
                    </button>
                    <span style={{
                      fontSize: 20,
                      fontWeight: 600,
                      minWidth: 40,
                      textAlign: 'center',
                      color: isLethal ? '#ef4444' : '#fff',
                    }}>
                      {assigned}
                    </span>
                    <button
                      onClick={() => handleAdjustDamage(blockerId, 1)}
                      disabled={totalAssigned >= attackerInfo.power}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        border: 'none',
                        backgroundColor: totalAssigned >= attackerInfo.power ? '#333' : '#10b981',
                        color: '#fff',
                        cursor: totalAssigned >= attackerInfo.power ? 'not-allowed' : 'pointer',
                        fontSize: 18,
                        fontWeight: 600,
                      }}
                    >
                      +
                    </button>
                  </div>

                  {/* Lethal indicator */}
                  {isLethal && (
                    <div style={{
                      fontSize: 12,
                      color: '#ef4444',
                      fontWeight: 600,
                    }}>
                      ☠️ Lethal
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Trample damage */}
        {hasTrample && (
          <div style={{
            padding: 12,
            backgroundColor: 'rgba(16,185,129,0.1)',
            borderRadius: 8,
            border: '1px solid rgba(16,185,129,0.3)',
            marginBottom: 20,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              🦵 Trample Damage to {defendingPlayerName}
            </div>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#10b981', marginTop: 4 }}>
              {trampleDamage}
            </div>
          </div>
        )}

        {/* Status */}
        <div style={{
          fontSize: 13,
          textAlign: 'center',
          marginBottom: 16,
          color: canConfirm ? '#10b981' : '#f59e0b',
          fontWeight: 600,
        }}>
          {canConfirm
            ? `✓ Damage assignment complete (${totalAssigned} to blockers${trampleDamage > 0 ? `, ${trampleDamage} trample` : ''})`
            : remainingToAssign > 0
              ? `Assign ${remainingToAssign} more damage`
              : 'Invalid assignment - must assign lethal damage in order'
          }
        </div>

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
            Confirm Damage Assignment
          </button>
        </div>
      </div>
    </div>
  );
}

export default DamageAssignmentModal;

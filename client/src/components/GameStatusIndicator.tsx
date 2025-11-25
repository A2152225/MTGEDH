// client/src/components/GameStatusIndicator.tsx
// Visual indicator for game-wide status (turn, phase, step, priority, etc.)

import React from 'react';
import type { PlayerRef, PlayerID } from '../../../shared/src';

interface Props {
  turn?: number;
  phase?: string;
  step?: string;
  turnPlayer?: PlayerID;
  priority?: PlayerID;
  players: PlayerRef[];
  you?: PlayerID;
  combat?: {
    phase: string;
    attackers?: readonly { permanentId: string; defending?: string }[];
  };
}

// Maps phase values to display names and colors
const phaseConfig: Record<string, { label: string; color: string; icon: string }> = {
  'PRE_GAME': { label: 'Pre-game', color: '#9ca3af', icon: '⏳' },
  'pre_game': { label: 'Pre-game', color: '#9ca3af', icon: '⏳' },
  'beginning': { label: 'Beginning', color: '#60a5fa', icon: '🌅' },
  'precombatMain': { label: 'Main 1', color: '#34d399', icon: '✨' },
  'main1': { label: 'Main 1', color: '#34d399', icon: '✨' },
  'combat': { label: 'Combat', color: '#f87171', icon: '⚔️' },
  'postcombatMain': { label: 'Main 2', color: '#34d399', icon: '✨' },
  'main2': { label: 'Main 2', color: '#34d399', icon: '✨' },
  'ending': { label: 'Ending', color: '#a78bfa', icon: '🌙' },
};

// Maps step values to display names
const stepConfig: Record<string, { label: string; subColor: string }> = {
  'untap': { label: 'Untap', subColor: '#93c5fd' },
  'upkeep': { label: 'Upkeep', subColor: '#93c5fd' },
  'draw': { label: 'Draw', subColor: '#93c5fd' },
  'main': { label: 'Main', subColor: '#6ee7b7' },
  'beginCombat': { label: 'Begin Combat', subColor: '#fca5a5' },
  'declareAttackers': { label: 'Attackers', subColor: '#fca5a5' },
  'declareBlockers': { label: 'Blockers', subColor: '#fca5a5' },
  'combatDamage': { label: 'Damage', subColor: '#fca5a5' },
  'endCombat': { label: 'End Combat', subColor: '#fca5a5' },
  'endStep': { label: 'End Step', subColor: '#c4b5fd' },
  'end': { label: 'End Step', subColor: '#c4b5fd' },
  'cleanup': { label: 'Cleanup', subColor: '#c4b5fd' },
};

export function GameStatusIndicator({ turn, phase, step, turnPlayer, priority, players, you, combat }: Props) {
  const phaseKey = String(phase || '').toLowerCase();
  const stepKey = String(step || '').toLowerCase();
  
  const phaseInfo = phaseConfig[phase || ''] || phaseConfig[phaseKey] || { label: phase || '-', color: '#6b7280', icon: '🎮' };
  const stepInfo = stepConfig[step || ''] || stepConfig[stepKey] || { label: step || '', subColor: '#9ca3af' };

  const turnPlayerName = players.find(p => p.id === turnPlayer)?.name || turnPlayer || '-';
  const priorityPlayerName = players.find(p => p.id === priority)?.name || priority || '-';
  
  const isYourTurn = turnPlayer === you;
  const youHavePriority = priority === you;

  // Combat info
  const isCombatPhase = phaseKey === 'combat';
  const attackerCount = combat?.attackers?.length || 0;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '8px 16px',
      background: 'linear-gradient(90deg, rgba(15,15,25,0.95), rgba(25,25,40,0.95))',
      borderRadius: 10,
      border: '1px solid rgba(99,102,241,0.3)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      color: '#e5e7eb',
      fontSize: 13,
    }}>
      {/* Turn number */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ 
          fontSize: 11, 
          color: '#9ca3af', 
          textTransform: 'uppercase', 
          letterSpacing: '0.05em' 
        }}>
          Turn
        </span>
        <span style={{ 
          fontWeight: 700, 
          fontSize: 18,
          color: '#fff',
          minWidth: 24,
          textAlign: 'center'
        }}>
          {turn || 1}
        </span>
      </div>

      {/* Vertical divider */}
      <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />

      {/* Turn player indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: isYourTurn ? '#10b981' : '#6b7280',
          boxShadow: isYourTurn ? '0 0 8px #10b981' : 'none',
        }} />
        <span style={{ color: '#9ca3af', fontSize: 11 }}>Active:</span>
        <span style={{ 
          fontWeight: 600, 
          color: isYourTurn ? '#34d399' : '#e5e7eb'
        }}>
          {isYourTurn ? 'You' : turnPlayerName}
        </span>
      </div>

      {/* Vertical divider */}
      <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />

      {/* Phase indicator */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 8,
        padding: '4px 12px',
        borderRadius: 6,
        background: `${phaseInfo.color}22`,
        border: `1px solid ${phaseInfo.color}44`,
      }}>
        <span style={{ fontSize: 16 }}>{phaseInfo.icon}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <span style={{ 
            fontWeight: 600, 
            color: phaseInfo.color,
            lineHeight: '1.2'
          }}>
            {phaseInfo.label}
          </span>
          {stepInfo.label && (
            <span style={{ 
              fontSize: 10, 
              color: stepInfo.subColor,
              lineHeight: '1.2'
            }}>
              {stepInfo.label}
            </span>
          )}
        </div>
      </div>

      {/* Combat indicator (when in combat) */}
      {isCombatPhase && attackerCount > 0 && (
        <>
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgba(239,68,68,0.2)',
            border: '1px solid rgba(239,68,68,0.4)',
          }}>
            <span style={{ fontSize: 14 }}>⚔️</span>
            <span style={{ color: '#fca5a5', fontWeight: 600 }}>
              {attackerCount} Attacker{attackerCount !== 1 ? 's' : ''}
            </span>
          </div>
        </>
      )}

      {/* Vertical divider */}
      <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />

      {/* Priority indicator */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 6,
        padding: '4px 10px',
        borderRadius: 6,
        background: youHavePriority ? 'rgba(16,185,129,0.2)' : 'transparent',
        border: youHavePriority ? '1px solid rgba(16,185,129,0.4)' : '1px solid transparent',
      }}>
        <span style={{ color: '#9ca3af', fontSize: 11 }}>Priority:</span>
        <span style={{ 
          fontWeight: 600, 
          color: youHavePriority ? '#34d399' : '#e5e7eb'
        }}>
          {youHavePriority ? '✓ You' : priorityPlayerName}
        </span>
      </div>
    </div>
  );
}

export default GameStatusIndicator;

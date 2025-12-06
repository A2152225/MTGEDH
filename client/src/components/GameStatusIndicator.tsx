// client/src/components/GameStatusIndicator.tsx
// Visual indicator for game-wide status (turn, phase, step, priority, special designations, etc.)
// Also includes control buttons (Concede, Leave Game, Undo) and randomness (Dice, Coin Flip) in the same row.
// Also includes AI control toggle for autopilot mode.

import React, { useState, useRef, useEffect } from 'react';
import type { PlayerRef, PlayerID } from '../../../shared/src';

interface AIStrategy {
  id: string;
  name: string;
  description: string;
}

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
  // Special game designations (Rules 724-730)
  monarch?: PlayerID | null;
  initiative?: PlayerID | null;
  dayNight?: 'day' | 'night' | null;
  cityBlessing?: Record<PlayerID, boolean>;
  // Control button handlers
  isYouPlayer?: boolean;
  gameOver?: boolean;
  onConcede?: () => void;
  onLeaveGame?: () => void;
  onUndo?: (count: number) => void;
  availableUndoCount?: number;
  // Randomness handlers
  onRollDie?: (sides: number) => void;
  onFlipCoin?: () => void;
  // AI control
  aiControlEnabled?: boolean;
  aiStrategy?: string;
  onToggleAIControl?: (enable: boolean, strategy?: string, difficulty?: number) => void;
  availableAIStrategies?: AIStrategy[];
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

export function GameStatusIndicator({ 
  turn, phase, step, turnPlayer, priority, players, you, combat,
  monarch, initiative, dayNight, cityBlessing,
  isYouPlayer, gameOver, onConcede, onLeaveGame, onUndo, availableUndoCount = 0,
  onRollDie, onFlipCoin,
  aiControlEnabled, aiStrategy, onToggleAIControl, availableAIStrategies
}: Props) {
  const [showDiceMenu, setShowDiceMenu] = useState(false);
  const [showAIMenu, setShowAIMenu] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState(aiStrategy || 'basic');
  const diceMenuRef = useRef<HTMLDivElement>(null);
  const aiMenuRef = useRef<HTMLDivElement>(null);
  
  // Default strategies if none provided
  const strategies = availableAIStrategies || [
    { id: 'basic', name: 'Basic', description: 'Simple decision-making for fast gameplay' },
    { id: 'aggressive', name: 'Aggressive', description: 'Prioritizes attacking and dealing damage' },
    { id: 'defensive', name: 'Defensive', description: 'Focuses on blocking and survival' },
    { id: 'control', name: 'Control', description: 'Values card advantage and removal' },
  ];
  
  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (diceMenuRef.current && !diceMenuRef.current.contains(event.target as Node)) {
        setShowDiceMenu(false);
      }
      if (aiMenuRef.current && !aiMenuRef.current.contains(event.target as Node)) {
        setShowAIMenu(false);
      }
    }
    if (showDiceMenu || showAIMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDiceMenu, showAIMenu]);
  
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

  // Special designations
  const monarchPlayer = monarch ? players.find(p => p.id === monarch) : null;
  const isYouMonarch = monarch === you;
  const initiativePlayer = initiative ? players.find(p => p.id === initiative) : null;
  const isYouInitiative = initiative === you;
  const youHaveBlessing = you ? cityBlessing?.[you] : false;
  const anyoneHasBlessing = cityBlessing ? Object.values(cityBlessing).some(v => v) : false;

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
      flexWrap: 'wrap',
      rowGap: 8,
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

      {/* Day/Night indicator */}
      {dayNight && (
        <>
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 6,
              background: dayNight === 'day' 
                ? 'rgba(251,191,36,0.2)' 
                : 'rgba(99,102,241,0.2)',
              border: dayNight === 'day' 
                ? '1px solid rgba(251,191,36,0.4)' 
                : '1px solid rgba(99,102,241,0.4)',
            }}
            aria-label={`It is currently ${dayNight}`}
          >
            <span style={{ fontSize: 16 }}>
              {dayNight === 'day' ? '☀️' : '🌙'}
            </span>
            <span style={{ 
              fontWeight: 600, 
              color: dayNight === 'day' ? '#fbbf24' : '#a5b4fc',
              textTransform: 'capitalize'
            }}>
              {dayNight}
            </span>
          </div>
        </>
      )}

      {/* Monarch indicator */}
      {monarch && (
        <>
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 6,
              background: isYouMonarch 
                ? 'rgba(234,179,8,0.25)' 
                : 'rgba(234,179,8,0.1)',
              border: isYouMonarch 
                ? '1px solid rgba(234,179,8,0.5)' 
                : '1px solid rgba(234,179,8,0.3)',
            }}
            aria-label={`${isYouMonarch ? 'You are' : (monarchPlayer?.name || monarch) + ' is'} the Monarch`}
          >
            <span style={{ fontSize: 16 }}>👑</span>
            <span style={{ 
              fontWeight: 600, 
              color: '#eab308'
            }}>
              {isYouMonarch ? 'You' : (monarchPlayer?.name || monarch)}
            </span>
          </div>
        </>
      )}

      {/* Initiative indicator */}
      {initiative && (
        <>
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 6,
              background: isYouInitiative 
                ? 'rgba(168,85,247,0.25)' 
                : 'rgba(168,85,247,0.1)',
              border: isYouInitiative 
                ? '1px solid rgba(168,85,247,0.5)' 
                : '1px solid rgba(168,85,247,0.3)',
            }}
            aria-label={`${isYouInitiative ? 'You have' : (initiativePlayer?.name || initiative) + ' has'} the Initiative`}
          >
            <span style={{ fontSize: 16 }}>🗡️</span>
            <span style={{ color: '#9ca3af', fontSize: 11 }}>Initiative:</span>
            <span style={{ 
              fontWeight: 600, 
              color: '#a855f7'
            }}>
              {isYouInitiative ? 'You' : (initiativePlayer?.name || initiative)}
            </span>
          </div>
        </>
      )}

      {/* City's Blessing indicator (only show if anyone has it) */}
      {anyoneHasBlessing && (
        <>
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 6,
              background: youHaveBlessing 
                ? 'rgba(20,184,166,0.25)' 
                : 'rgba(20,184,166,0.1)',
              border: youHaveBlessing 
                ? '1px solid rgba(20,184,166,0.5)' 
                : '1px solid rgba(20,184,166,0.3)',
            }}
            aria-label={youHaveBlessing ? "You have the City's Blessing" : "City's Blessing is active"}
          >
            <span style={{ fontSize: 16 }}>🏛️</span>
            <span style={{ 
              fontWeight: 600, 
              color: '#14b8a6'
            }}>
              {youHaveBlessing ? "City's Blessing ✓" : "City's Blessing"}
            </span>
          </div>
        </>
      )}

      {/* Randomness buttons - Dice & Coin Flip */}
      {(onRollDie || onFlipCoin) && (
        <>
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {/* Dice dropdown */}
            {onRollDie && (
              <div ref={diceMenuRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowDiceMenu(!showDiceMenu)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    background: showDiceMenu ? 'rgba(139, 92, 246, 0.4)' : 'rgba(139, 92, 246, 0.2)',
                    border: '1px solid rgba(139, 92, 246, 0.4)',
                    borderRadius: 4,
                    color: '#c4b5fd',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontWeight: 500,
                  }}
                  title="Roll dice"
                >
                  🎲 Dice ▼
                </button>
                {showDiceMenu && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: 4,
                      background: 'rgba(30, 30, 40, 0.98)',
                      border: '1px solid rgba(139, 92, 246, 0.5)',
                      borderRadius: 6,
                      padding: 4,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      zIndex: 1000,
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                      minWidth: 80,
                    }}
                  >
                    {[
                      { sides: 6, label: 'D6' },
                      { sides: 20, label: 'D20' },
                      { sides: 100, label: 'D100' },
                    ].map(({ sides, label }) => (
                      <button
                        key={sides}
                        onClick={() => {
                          onRollDie(sides);
                          setShowDiceMenu(false);
                        }}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          background: 'rgba(139, 92, 246, 0.15)',
                          border: '1px solid rgba(139, 92, 246, 0.3)',
                          borderRadius: 4,
                          color: '#c4b5fd',
                          cursor: 'pointer',
                          textAlign: 'left',
                          whiteSpace: 'nowrap',
                        }}
                        title={`Roll a ${sides}-sided die`}
                      >
                        🎲 {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Coin flip button */}
            {onFlipCoin && (
              <button
                onClick={onFlipCoin}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  background: 'rgba(234, 179, 8, 0.2)',
                  border: '1px solid rgba(234, 179, 8, 0.4)',
                  borderRadius: 4,
                  color: '#fcd34d',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontWeight: 500,
                }}
                title="Flip a coin"
              >
                🪙 Flip
              </button>
            )}
          </div>
        </>
      )}

      {/* Spacer to push control buttons to the right */}
      <div style={{ flex: 1, minWidth: 16 }} />

      {/* AI Control toggle */}
      {onToggleAIControl && isYouPlayer && !gameOver && (
        <>
          <div ref={aiMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => {
                if (aiControlEnabled) {
                  // If AI is enabled, disable it directly
                  onToggleAIControl(false);
                } else {
                  // If AI is disabled, show menu to select strategy
                  setShowAIMenu(!showAIMenu);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 4,
                border: aiControlEnabled 
                  ? '1px solid rgba(16, 185, 129, 0.6)' 
                  : '1px solid rgba(139, 92, 246, 0.4)',
                background: aiControlEnabled 
                  ? 'rgba(16, 185, 129, 0.25)' 
                  : 'rgba(139, 92, 246, 0.2)',
                color: aiControlEnabled ? '#34d399' : '#c4b5fd',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
              }}
              title={aiControlEnabled 
                ? `AI Autopilot ON (${aiStrategy || 'basic'}) - Click to disable` 
                : 'Enable AI Autopilot to control your turns'}
            >
              <span style={{ fontSize: 14 }}>🤖</span>
              <span>{aiControlEnabled ? 'AI: ON' : 'AI'}</span>
              {!aiControlEnabled && <span>▼</span>}
            </button>
            
            {/* AI Strategy dropdown menu */}
            {showAIMenu && !aiControlEnabled && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  right: 0,
                  marginBottom: 4,
                  background: 'rgba(30, 30, 40, 0.98)',
                  border: '1px solid rgba(139, 92, 246, 0.5)',
                  borderRadius: 8,
                  padding: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  zIndex: 1000,
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
                  minWidth: 200,
                }}
              >
                <div style={{ 
                  fontSize: 11, 
                  color: '#9ca3af', 
                  marginBottom: 4,
                  padding: '2px 4px',
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                }}>
                  🤖 Select AI Strategy
                </div>
                {strategies.map(strategy => (
                  <button
                    key={strategy.id}
                    onClick={() => {
                      setSelectedStrategy(strategy.id);
                      onToggleAIControl(true, strategy.id, 0.5);
                      setShowAIMenu(false);
                    }}
                    style={{
                      padding: '8px 12px',
                      fontSize: 11,
                      background: selectedStrategy === strategy.id 
                        ? 'rgba(139, 92, 246, 0.3)' 
                        : 'rgba(139, 92, 246, 0.1)',
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      borderRadius: 4,
                      color: '#e5e7eb',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                    title={strategy.description}
                  >
                    <span style={{ fontWeight: 600 }}>{strategy.name}</span>
                    <span style={{ fontSize: 10, color: '#9ca3af' }}>{strategy.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />
        </>
      )}

      {/* Control buttons (Concede, Leave, Undo) */}
      {(onConcede || onLeaveGame || onUndo) && (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 6,
        }}>
          {onConcede && (
            <button
              onClick={() => {
                if (confirm('Are you sure you want to concede? Your permanents will be removed at the start of your next turn.')) {
                  onConcede();
                }
              }}
              disabled={!isYouPlayer || gameOver}
              style={{
                background: isYouPlayer && !gameOver ? '#ef4444' : '#4b5563',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                cursor: isYouPlayer && !gameOver ? 'pointer' : 'not-allowed',
                fontSize: 11,
                opacity: isYouPlayer && !gameOver ? 1 : 0.6,
              }}
              title="Concede the game"
            >
              🏳️ Concede
            </button>
          )}
          {onLeaveGame && (
            <button
              onClick={() => {
                if (confirm('Are you sure you want to leave this game?')) {
                  onLeaveGame();
                }
              }}
              style={{
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                cursor: 'pointer',
                fontSize: 11,
              }}
              title="Leave this game"
            >
              🚪 Leave
            </button>
          )}
          {onUndo && availableUndoCount > 0 && (
            <button
              onClick={() => onUndo(1)}
              disabled={!isYouPlayer}
              style={{
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                cursor: isYouPlayer ? 'pointer' : 'not-allowed',
                fontSize: 11,
                opacity: isYouPlayer ? 1 : 0.6,
              }}
              title={`Undo (${availableUndoCount} available)`}
            >
              ⏪ Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default GameStatusIndicator;

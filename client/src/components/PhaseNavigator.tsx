/**
 * PhaseNavigator.tsx
 * 
 * A floating, draggable phase/step navigation component that allows players to quickly
 * advance through turn phases by clicking on the desired phase.
 * 
 * Features:
 * - Draggable to reposition anywhere on screen
 * - Simplified combat display (just "Combat" with normal step advancement)
 * - End Turn moves to end phase for cleanup/discard
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { PlayerID } from '../../../shared/src';

interface PhaseNavigatorProps {
  currentPhase?: string;
  currentStep?: string;
  turnPlayer?: PlayerID;
  you?: PlayerID;
  isYourTurn: boolean;
  hasPriority: boolean;
  stackEmpty: boolean;
  allPlayersReady?: boolean; // True if all players have decks and kept hands
  phaseAdvanceBlockReason?: string | null; // Reason why advancing is blocked
  // Replacement effect ordering quick-toggle (damage)
  showDamageReplacementToggle?: boolean;
  damageReplacementMode?: 'minimize' | 'maximize' | 'custom' | 'auto';
  onSetDamageReplacementMode?: (mode: 'minimize' | 'maximize' | 'custom' | 'auto') => void;
  onOpenReplacementEffectSettings?: () => void;
  onNextStep: () => void;
  onPassPriority: () => void;
  onAdvancingChange?: (isAdvancing: boolean) => void;
  onSkipToPhase?: (targetPhase: string, targetStep: string) => void;
}

// Define the order of phases/steps for navigation
// Simplified: Combat is now a single entry that advances through combat normally
// When you click Combat, it goes to begin combat, then attackers selection
// (if no attackers declared, blockers/damage are skipped automatically by the server)
// Note: Cleanup automatically advances to next turn after discarding to hand size
const PHASE_ORDER = [
  { id: 'untap', label: 'Untap', phase: 'beginning', icon: '🔓' },
  { id: 'upkeep', label: 'Upkeep', phase: 'beginning', icon: '⏰' },
  { id: 'draw', label: 'Draw', phase: 'beginning', icon: '🎴' },
  { id: 'main1', label: 'Main 1', phase: 'precombatMain', icon: '✨' },
  { id: 'combat', label: 'Combat', phase: 'combat', icon: '⚔️', isCombatPhase: true },
  { id: 'main2', label: 'Main 2', phase: 'postcombatMain', icon: '✨' },
  { id: 'endStep', label: 'End', phase: 'ending', icon: '🌙' },
  { id: 'cleanup', label: 'Cleanup', phase: 'ending', icon: '🧹' },
];

// Mapping of phase IDs to phase/step values for skip-to-phase functionality
// Note: We support skipping to any phase, not just post-combat
const PHASE_STEP_MAP: Record<string, { phase: string; step: string }> = {
  'draw': { phase: 'beginning', step: 'DRAW' },
  'main1': { phase: 'precombatMain', step: 'MAIN1' },
  'main2': { phase: 'postcombatMain', step: 'MAIN2' },
  'endStep': { phase: 'ending', step: 'END' },
  'cleanup': { phase: 'ending', step: 'CLEANUP' },
};

export function PhaseNavigator({
  currentPhase,
  currentStep,
  turnPlayer,
  you,
  isYourTurn,
  hasPriority,
  stackEmpty,
  allPlayersReady = true,
  phaseAdvanceBlockReason,
  showDamageReplacementToggle = false,
  damageReplacementMode = 'minimize',
  onSetDamageReplacementMode,
  onOpenReplacementEffectSettings,
  onNextStep,
  onPassPriority,
  onAdvancingChange,
  onSkipToPhase,
}: PhaseNavigatorProps) {
  // Default to expanded, but use cached preference if available
  const [isExpanded, setIsExpanded] = useState(() => {
    const cached = localStorage.getItem('phaseNavigatorExpanded');
    // Default to true (expanded) if no cached value
    return cached === null ? true : cached === 'true';
  });
  const [isAdvancing, setIsAdvancing] = useState(false); // Track if we're in the middle of advancing phases
  
  // Cache the expanded state when it changes
  useEffect(() => {
    localStorage.setItem('phaseNavigatorExpanded', String(isExpanded));
  }, [isExpanded]);
  
  // Notify parent when advancing state changes
  useEffect(() => {
    onAdvancingChange?.(isAdvancing);
  }, [isAdvancing, onAdvancingChange]);
  
  // Dragging state
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    // Try to restore saved position, otherwise use default bottom-right
    try {
      const saved = localStorage.getItem('mtgedh:phaseNavigatorPos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          // Validate saved position is still visible
          const maxX = Math.max(0, window.innerWidth - 100);
          const maxY = Math.max(0, window.innerHeight - 100);
          return { 
            x: Math.min(parsed.x, maxX), 
            y: Math.min(parsed.y, maxY) 
          };
        }
      }
    } catch { /* ignore */ }
    // Default to bottom-right with safe margins
    // Use percentage-based positioning that works on smaller screens
    const defaultX = Math.max(20, window.innerWidth - 340);
    const defaultY = Math.max(60, window.innerHeight - 340);
    return { x: defaultX, y: defaultY };
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const currentStepLower = (currentStep || '').toLowerCase();
  const currentPhaseLower = (currentPhase || '').toLowerCase();
  
  // Check if we're in any combat step
  const isInCombat = currentPhaseLower === 'combat' || 
    ['begincombat', 'begin_combat', 'declareattackers', 'declare_attackers', 
     'declareblockers', 'declare_blockers', 'combatdamage', 'combat_damage', 'damage',
     'endcombat', 'end_combat'].some(s => currentStepLower.includes(s) || currentStepLower === s);
  
  // Find current position in phase order
  // Priority: 1) Combat phase special case 2) Exact step match 3) Step contains id
  // Note: We do NOT match on phase alone, since multiple steps share the same phase
  const currentIndex = PHASE_ORDER.findIndex(p => {
    // For combat phase, match if we're in any combat step
    if (p.id === 'combat' && isInCombat) return true;
    // Exact step match (case-insensitive)
    if (p.id === currentStepLower) return true;
    // Step contains the phase id (e.g., step "MAIN1" contains "main1")
    if (currentStepLower.includes(p.id)) return true;
    // Special case for main phases - match on phase name with step verification
    if (p.id === 'main1' && currentPhaseLower === 'precombatmain') return true;
    if (p.id === 'main2' && currentPhaseLower === 'postcombatmain') return true;
    return false;
  });
  
  // Can only advance if it's your turn, stack is empty, not already advancing, and all players ready
  const canAdvance = isYourTurn && stackEmpty && !isAdvancing && allPlayersReady;
  
  // Handle clicking on a phase to advance to it
  // If jumping from pre-combat to post-combat, skip combat entirely without asking for attackers
  // This assumes player doesn't want to attack when they explicitly skip past combat
  const handlePhaseClick = useCallback(async (targetIndex: number) => {
    // Early exit checks - but set isAdvancing first to prevent double-clicks
    if (isAdvancing) return; // Already advancing, ignore click
    if (!canAdvance) return;
    if (targetIndex <= currentIndex) return; // Can't go backward
    
    const stepsToAdvance = targetIndex - currentIndex;
    if (stepsToAdvance <= 0) return;
    
    // Immediately disable further clicks
    setIsAdvancing(true);
    
    // Get target phase info
    const targetPhase = PHASE_ORDER[targetIndex];
    const targetMapping = PHASE_STEP_MAP[targetPhase.id];
    
    // Check if we're jumping from before combat to after combat
    // If current is Main 1 (index 3) or earlier, and target is Main 2 (index 5) or later
    // then skip combat entirely - player is explicitly choosing not to attack
    const isBeforeCombat = currentIndex <= 3; // Main 1 or earlier
    const isAfterCombat = targetIndex >= 5;   // Main 2 or later
    const skippingOverCombat = isBeforeCombat && isAfterCombat;
    
    // Use skipToPhase for reliable direct navigation when:
    // 1. We have a mapping for the target phase, AND
    // 2. Either we're skipping over combat, OR the target is in our phase map (for reliability)
    // This prevents the step-by-step loop from overshooting due to timing issues
    if (onSkipToPhase && targetMapping) {
      try {
        onSkipToPhase(targetMapping.phase, targetMapping.step);
      } finally {
        setTimeout(() => setIsAdvancing(false), 500);
      }
      return;
    }
    
    // Fallback to step-by-step only for phases not in the map (combat, untap, upkeep)
    // For these phases, step-by-step is needed because they don't have direct mappings
    try {
      for (let i = 0; i < stepsToAdvance; i++) {
        onNextStep();
        // Wait 0.75 seconds between steps (except after the last one)
        if (i < stepsToAdvance - 1) {
          await new Promise(resolve => setTimeout(resolve, 750));
        }
      }
    } finally {
      // Re-enable buttons after a longer delay to let the final state settle
      // This helps prevent accidental double-advances
      setTimeout(() => setIsAdvancing(false), 500);
    }
  }, [canAdvance, currentIndex, isAdvancing, onNextStep, onSkipToPhase]);
  
  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag from the header area
    const target = e.target as HTMLElement;
    if (!target.closest('[data-drag-handle]')) return;
    
    e.preventDefault();
    setIsDragging(true);
    dragStartPos.current = {
      x: position.x,
      y: position.y,
      startX: e.clientX,
      startY: e.clientY,
    };
  }, [position]);
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartPos.current) return;
    
    const dx = e.clientX - dragStartPos.current.startX;
    const dy = e.clientY - dragStartPos.current.startY;
    
    // Calculate new position, clamping to window bounds
    const newX = Math.max(0, Math.min(window.innerWidth - 340, dragStartPos.current.x + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 100, dragStartPos.current.y + dy));
    
    setPosition({ x: newX, y: newY });
  }, [isDragging]);
  
  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      dragStartPos.current = null;
      
      // Save position to localStorage
      try {
        localStorage.setItem('mtgedh:phaseNavigatorPos', JSON.stringify(position));
      } catch { /* ignore */ }
    }
  }, [isDragging, position]);
  
  // Attach global mouse event listeners when dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);
  
  if (!isExpanded) {
    // Collapsed view - just show current phase and expand button
    return (
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
          cursor: isDragging ? 'grabbing' : 'default',
          userSelect: 'none',
        }}
      >
        <button
          data-drag-handle
          onClick={() => !isDragging && setIsExpanded(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid rgba(99,102,241,0.4)',
            background: 'rgba(30,30,50,0.95)',
            color: '#e5e7eb',
            cursor: isDragging ? 'grabbing' : 'grab',
            fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
          title="Drag to move, click to expand phase navigator"
        >
          <span style={{ fontSize: 14 }}>⏩</span>
          <span>Phase Navigator</span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 100,
        background: 'rgba(20,20,35,0.98)',
        borderRadius: 12,
        border: '1px solid rgba(99,102,241,0.4)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        padding: 12,
        maxWidth: 320,
        color: '#e5e7eb',
        cursor: isDragging ? 'grabbing' : 'default',
        userSelect: 'none',
      }}
    >
      {/* Header - draggable */}
      <div 
        data-drag-handle
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>⏩ Phase Navigator</span>
        <button
          onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }}
          style={{
            background: 'none',
            border: 'none',
            color: '#9ca3af',
            cursor: 'pointer',
            fontSize: 16,
            padding: '2px 6px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Damage replacement ordering quick toggle (only when multiple effects are active) */}
      {showDamageReplacementToggle && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 10,
            padding: '6px 8px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <div style={{ fontSize: 10, color: '#cbd5e1' }}>
            Damage order
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSetDamageReplacementMode?.('minimize');
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: damageReplacementMode === 'minimize' || damageReplacementMode === 'auto'
                  ? '1px solid rgba(52,211,153,0.9)'
                  : '1px solid rgba(255,255,255,0.15)',
                background: damageReplacementMode === 'minimize' || damageReplacementMode === 'auto'
                  ? 'rgba(16,185,129,0.18)'
                  : 'rgba(0,0,0,0.15)',
                color: damageReplacementMode === 'minimize' || damageReplacementMode === 'auto'
                  ? '#34d399'
                  : '#cbd5e1',
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
              }}
              title="Prefer least damage taken (default)"
            >
              Least
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSetDamageReplacementMode?.('maximize');
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: damageReplacementMode === 'maximize'
                  ? '1px solid rgba(159,122,234,0.95)'
                  : '1px solid rgba(255,255,255,0.15)',
                background: damageReplacementMode === 'maximize'
                  ? 'rgba(159,122,234,0.18)'
                  : 'rgba(0,0,0,0.15)',
                color: damageReplacementMode === 'maximize'
                  ? '#c4b5fd'
                  : '#cbd5e1',
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
              }}
              title="Prefer most damage taken (Selfless Squire / redirect setups)"
            >
              Most
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenReplacementEffectSettings?.();
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(0,0,0,0.15)',
                color: '#cbd5e1',
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
              }}
              title="Open replacement effect settings"
            >
              Settings
            </button>
          </div>
        </div>
      )}
      
      {/* Phase grid - simplified 4 columns, 2 rows */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 4,
        marginBottom: 10,
      }}>
        {PHASE_ORDER.map((phase, index) => {
          const isCurrent = index === currentIndex;
          const isPast = index < currentIndex;
          const isFuture = index > currentIndex;
          const isClickable = canAdvance && isFuture;
          
          return (
            <button
              key={phase.id}
              onClick={(e) => { e.stopPropagation(); isClickable && handlePhaseClick(index); }}
              disabled={!isClickable}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '6px 4px',
                borderRadius: 6,
                border: isCurrent 
                  ? '2px solid #10b981' 
                  : '1px solid rgba(255,255,255,0.1)',
                background: isCurrent 
                  ? 'rgba(16,185,129,0.2)' 
                  : isPast 
                    ? 'rgba(100,100,100,0.2)' 
                    : 'rgba(50,50,70,0.5)',
                color: isCurrent 
                  ? '#34d399' 
                  : isPast 
                    ? '#6b7280' 
                    : '#e5e7eb',
                cursor: isClickable ? 'pointer' : 'default',
                opacity: isPast ? 0.5 : 1,
                fontSize: 10,
                transition: 'all 0.15s',
              }}
              title={isClickable ? `Click to advance to ${phase.label}` : phase.label}
            >
              <span style={{ fontSize: 14 }}>{phase.icon}</span>
              <span style={{ 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}>
                {phase.label}
              </span>
            </button>
          );
        })}
      </div>
      
      {/* Combat step indicator when in combat */}
      {isInCombat && (
        <div style={{
          marginBottom: 8,
          padding: '4px 8px',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 6,
          fontSize: 10,
          color: '#fca5a5',
          textAlign: 'center',
        }}>
          ⚔️ Combat: {currentStepLower.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')}
        </div>
      )}
      
      {/* Quick action buttons */}
      <div style={{ 
        display: 'flex', 
        gap: 6,
        paddingTop: 8,
        borderTop: '1px solid rgba(255,255,255,0.1)',
      }}>
        <button
          onClick={(e) => { e.stopPropagation(); onNextStep(); }}
          disabled={!canAdvance}
          style={{
            flex: 1,
            padding: '6px 10px',
            borderRadius: 6,
            border: 'none',
            background: canAdvance ? '#3b82f6' : '#4b5563',
            color: '#fff',
            cursor: canAdvance ? 'pointer' : 'not-allowed',
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          Next Step
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onPassPriority(); }}
          disabled={!hasPriority}
          style={{
            flex: 1,
            padding: '6px 10px',
            borderRadius: 6,
            border: 'none',
            background: hasPriority ? '#10b981' : '#4b5563',
            color: '#fff',
            cursor: hasPriority ? 'pointer' : 'not-allowed',
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          Pass
        </button>
      </div>
      
      {/* Advancing indicator */}
      {isAdvancing && (
        <div style={{ 
          marginTop: 8, 
          fontSize: 10, 
          color: '#fbbf24',
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}>
          <span style={{ animation: 'pulse 1s infinite' }}>⏳</span>
          Advancing phases...
        </div>
      )}
      
      {/* Status hint - blocked by players not ready */}
      {phaseAdvanceBlockReason && (
        <div style={{ 
          marginTop: 8, 
          fontSize: 10, 
          color: '#fbbf24',
          textAlign: 'center',
          padding: '4px 8px',
          background: 'rgba(251, 191, 36, 0.1)',
          borderRadius: 4,
        }}>
          ⚠️ {phaseAdvanceBlockReason}
        </div>
      )}
      
      {/* Status hint */}
      {!isYourTurn && !phaseAdvanceBlockReason && (
        <div style={{ 
          marginTop: 8, 
          fontSize: 10, 
          color: '#9ca3af',
          textAlign: 'center',
        }}>
          Waiting for opponent's turn...
        </div>
      )}
    </div>
  );
}

export default PhaseNavigator;

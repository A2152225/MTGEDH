/**
 * PhaseNavigator.tsx
 * 
 * A floating phase/step navigation component that allows players to quickly
 * advance through turn phases by clicking on the desired phase.
 */

import React, { useState } from 'react';
import type { PlayerID } from '../../../shared/src';

interface PhaseNavigatorProps {
  currentPhase?: string;
  currentStep?: string;
  turnPlayer?: PlayerID;
  you?: PlayerID;
  isYourTurn: boolean;
  hasPriority: boolean;
  stackEmpty: boolean;
  onNextStep: () => void;
  onNextTurn: () => void;
  onPassPriority: () => void;
}

// Define the order of phases/steps for navigation
const PHASE_ORDER = [
  { id: 'untap', label: 'Untap', phase: 'beginning', icon: '🔓' },
  { id: 'upkeep', label: 'Upkeep', phase: 'beginning', icon: '⏰' },
  { id: 'draw', label: 'Draw', phase: 'beginning', icon: '🎴' },
  { id: 'main1', label: 'Main 1', phase: 'precombatMain', icon: '✨' },
  { id: 'beginCombat', label: 'Begin Combat', phase: 'combat', icon: '⚔️' },
  { id: 'declareAttackers', label: 'Attackers', phase: 'combat', icon: '🗡️' },
  { id: 'declareBlockers', label: 'Blockers', phase: 'combat', icon: '🛡️' },
  { id: 'combatDamage', label: 'Damage', phase: 'combat', icon: '💥' },
  { id: 'endCombat', label: 'End Combat', phase: 'combat', icon: '🏁' },
  { id: 'main2', label: 'Main 2', phase: 'postcombatMain', icon: '✨' },
  { id: 'endStep', label: 'End Step', phase: 'ending', icon: '🌙' },
  { id: 'cleanup', label: 'Cleanup', phase: 'ending', icon: '🧹' },
];

export function PhaseNavigator({
  currentPhase,
  currentStep,
  turnPlayer,
  you,
  isYourTurn,
  hasPriority,
  stackEmpty,
  onNextStep,
  onNextTurn,
  onPassPriority,
}: PhaseNavigatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const currentStepLower = (currentStep || '').toLowerCase();
  const currentPhaseLower = (currentPhase || '').toLowerCase();
  
  // Find current position in phase order
  const currentIndex = PHASE_ORDER.findIndex(p => 
    p.id === currentStepLower || 
    p.phase === currentPhaseLower ||
    currentStepLower.includes(p.id) ||
    currentPhaseLower.includes(p.id)
  );
  
  // Can only advance if it's your turn and stack is empty
  const canAdvance = isYourTurn && stackEmpty;
  
  // Handle clicking on a phase to advance to it
  const handlePhaseClick = async (targetIndex: number) => {
    if (!canAdvance) return;
    if (targetIndex <= currentIndex) return; // Can't go backward
    
    // Advance step by step with delays to allow server processing
    const stepsToAdvance = targetIndex - currentIndex;
    for (let i = 0; i < stepsToAdvance; i++) {
      onNextStep();
      // Wait between steps to allow server to process
      if (i < stepsToAdvance - 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
  };
  
  if (!isExpanded) {
    // Collapsed view - just show current phase and expand button
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 60,
          right: 12,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        <button
          onClick={() => setIsExpanded(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid rgba(99,102,241,0.4)',
            background: 'rgba(30,30,50,0.95)',
            color: '#e5e7eb',
            cursor: 'pointer',
            fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
          title="Click to expand phase navigator"
        >
          <span style={{ fontSize: 14 }}>⏩</span>
          <span>Phase Navigator</span>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 60,
        right: 12,
        zIndex: 100,
        background: 'rgba(20,20,35,0.98)',
        borderRadius: 12,
        border: '1px solid rgba(99,102,241,0.4)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        padding: 12,
        maxWidth: 320,
        color: '#e5e7eb',
      }}
    >
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 10,
        paddingBottom: 8,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>⏩ Phase Navigator</span>
        <button
          onClick={() => setIsExpanded(false)}
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
      
      {/* Phase grid */}
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
              onClick={() => isClickable && handlePhaseClick(index)}
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
      
      {/* Quick action buttons */}
      <div style={{ 
        display: 'flex', 
        gap: 6,
        paddingTop: 8,
        borderTop: '1px solid rgba(255,255,255,0.1)',
      }}>
        <button
          onClick={onNextStep}
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
          onClick={onNextTurn}
          disabled={!canAdvance}
          style={{
            flex: 1,
            padding: '6px 10px',
            borderRadius: 6,
            border: 'none',
            background: canAdvance ? '#8b5cf6' : '#4b5563',
            color: '#fff',
            cursor: canAdvance ? 'pointer' : 'not-allowed',
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          End Turn
        </button>
        <button
          onClick={onPassPriority}
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
      
      {/* Status hint */}
      {!isYourTurn && (
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

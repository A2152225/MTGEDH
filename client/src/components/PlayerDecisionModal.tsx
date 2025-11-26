/**
 * PlayerDecisionSystem.tsx
 * 
 * Comprehensive UI component system for player decisions during gameplay.
 * Handles various choice types:
 * - Target selection
 * - Sacrifice selection
 * - Mode selection
 * - Damage assignment
 * - Combat ordering
 * - Counter placement
 * 
 * Based on MTG Comprehensive Rules for player choices.
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { BattlefieldPermanent, KnownCardRef, PlayerID } from '../../../shared/src';

// ============================================================================
// Types
// ============================================================================

export type DecisionType = 
  | 'target'
  | 'sacrifice'
  | 'mode'
  | 'damage_assignment'
  | 'blocker_order'
  | 'counter_placement'
  | 'may_ability'
  | 'pay_cost'
  | 'choose_number'
  | 'choose_color'
  | 'choose_creature_type';

export interface PlayerDecision {
  readonly id: string;
  readonly type: DecisionType;
  readonly sourceName: string;
  readonly sourceImage?: string;
  readonly description: string;
  readonly options: readonly DecisionOption[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly timeout?: number; // Optional timeout in seconds
}

export interface DecisionOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export interface DecisionResult {
  readonly decisionId: string;
  readonly selections: readonly string[];
  readonly cancelled: boolean;
}

// ============================================================================
// Decision Modal Props
// ============================================================================

export interface PlayerDecisionModalProps {
  open: boolean;
  decision: PlayerDecision | null;
  onSubmit: (result: DecisionResult) => void;
  onCancel?: () => void;
}

// ============================================================================
// Main Decision Modal Component
// ============================================================================

export function PlayerDecisionModal({
  open,
  decision,
  onSubmit,
  onCancel,
}: PlayerDecisionModalProps) {
  const [selections, setSelections] = useState<Set<string>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  // Reset selections when decision changes
  useEffect(() => {
    setSelections(new Set());
    if (decision?.timeout) {
      setTimeRemaining(decision.timeout);
    } else {
      setTimeRemaining(null);
    }
  }, [decision?.id]);

  // Handle timeout
  useEffect(() => {
    if (timeRemaining === null || timeRemaining <= 0) return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          // Auto-submit with current selections or empty
          if (decision) {
            onSubmit({
              decisionId: decision.id,
              selections: Array.from(selections),
              cancelled: false,
            });
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeRemaining, decision, selections, onSubmit]);

  const handleToggleSelection = (optionId: string) => {
    if (!decision) return;

    const option = decision.options.find(o => o.id === optionId);
    if (option?.disabled) return;

    setSelections(prev => {
      const next = new Set(prev);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        // If at max selections, remove oldest
        if (decision.maxSelections === 1) {
          next.clear();
        } else if (next.size >= decision.maxSelections) {
          const first = Array.from(next)[0];
          next.delete(first);
        }
        next.add(optionId);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    if (!decision) return;

    onSubmit({
      decisionId: decision.id,
      selections: Array.from(selections),
      cancelled: false,
    });
  };

  const handleCancel = () => {
    if (!decision) return;

    if (onCancel) {
      onCancel();
    } else {
      onSubmit({
        decisionId: decision.id,
        selections: [],
        cancelled: true,
      });
    }
  };

  const canSubmit = useMemo(() => {
    if (!decision) return false;
    return selections.size >= decision.minSelections && selections.size <= decision.maxSelections;
  }, [decision, selections]);

  if (!open || !decision) return null;

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
          maxWidth: 600,
          width: '90%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {getDecisionIcon(decision.type)} {getDecisionTitle(decision.type)}
          </h2>
          {timeRemaining !== null && (
            <div style={{
              backgroundColor: timeRemaining <= 10 ? '#ef4444' : '#3b82f6',
              padding: '4px 12px',
              borderRadius: 16,
              fontSize: 14,
              fontWeight: 600,
            }}>
              {timeRemaining}s
            </div>
          )}
        </div>

        {/* Source info */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          {decision.sourceImage && (
            <img
              src={decision.sourceImage}
              alt={decision.sourceName}
              style={{
                width: 100,
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              {decision.sourceName}
            </div>
            <div
              style={{
                fontSize: 14,
                color: '#ccc',
                padding: 12,
                backgroundColor: 'rgba(255,255,255,0.08)',
                borderRadius: 8,
                lineHeight: 1.5,
              }}
            >
              {decision.description}
            </div>
            {decision.minSelections > 0 && (
              <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
                Select {decision.minSelections === decision.maxSelections 
                  ? `exactly ${decision.minSelections}` 
                  : `${decision.minSelections}-${decision.maxSelections}`}
                {' '}option{decision.maxSelections !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {/* Options */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: decision.options.some(o => o.imageUrl) 
            ? 'repeat(auto-fill, minmax(140px, 1fr))' 
            : '1fr',
          gap: 12,
          marginBottom: 20,
        }}>
          {decision.options.map(option => {
            const isSelected = selections.has(option.id);
            const isDisabled = option.disabled;

            return (
              <button
                key={option.id}
                onClick={() => handleToggleSelection(option.id)}
                disabled={isDisabled}
                style={{
                  display: 'flex',
                  flexDirection: option.imageUrl ? 'column' : 'row',
                  alignItems: 'center',
                  gap: 8,
                  padding: option.imageUrl ? 8 : 12,
                  borderRadius: 8,
                  border: isSelected 
                    ? '2px solid #10b981' 
                    : isDisabled 
                      ? '2px solid #333' 
                      : '2px solid #4a4a6a',
                  backgroundColor: isSelected 
                    ? 'rgba(16,185,129,0.2)' 
                    : isDisabled
                      ? 'rgba(0,0,0,0.3)'
                      : 'rgba(255,255,255,0.05)',
                  color: isDisabled ? '#666' : '#fff',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: option.imageUrl ? 'center' : 'left',
                }}
                title={option.disabledReason || option.description}
              >
                {option.imageUrl && (
                  <img
                    src={option.imageUrl}
                    alt={option.label}
                    style={{
                      width: '100%',
                      borderRadius: 4,
                      opacity: isDisabled ? 0.5 : 1,
                    }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{option.label}</div>
                  {option.description && !option.imageUrl && (
                    <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
                      {option.description}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <div style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: '#10b981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 700,
                  }}>
                    ✓
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'flex-end',
            paddingTop: 16,
            borderTop: '1px solid #333',
          }}
        >
          {decision.type === 'may_ability' || decision.minSelections === 0 ? (
            <button
              onClick={handleCancel}
              style={{
                padding: '10px 24px',
                borderRadius: 8,
                border: '1px solid #4a4a6a',
                backgroundColor: 'transparent',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              {decision.type === 'may_ability' ? "Don't do this" : 'Skip'}
            </button>
          ) : null}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: canSubmit ? '#10b981' : '#333',
              color: canSubmit ? '#fff' : '#666',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {getSubmitButtonText(decision.type, selections.size)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function getDecisionIcon(type: DecisionType): string {
  switch (type) {
    case 'target': return '🎯';
    case 'sacrifice': return '💀';
    case 'mode': return '📋';
    case 'damage_assignment': return '⚔️';
    case 'blocker_order': return '🛡️';
    case 'counter_placement': return '➕';
    case 'may_ability': return '❓';
    case 'pay_cost': return '💰';
    case 'choose_number': return '🔢';
    case 'choose_color': return '🎨';
    case 'choose_creature_type': return '🐉';
    default: return '📝';
  }
}

function getDecisionTitle(type: DecisionType): string {
  switch (type) {
    case 'target': return 'Choose Target';
    case 'sacrifice': return 'Choose to Sacrifice';
    case 'mode': return 'Choose Mode';
    case 'damage_assignment': return 'Assign Damage';
    case 'blocker_order': return 'Order Blockers';
    case 'counter_placement': return 'Place Counters';
    case 'may_ability': return 'Optional Ability';
    case 'pay_cost': return 'Pay Cost';
    case 'choose_number': return 'Choose a Number';
    case 'choose_color': return 'Choose a Color';
    case 'choose_creature_type': return 'Choose a Creature Type';
    default: return 'Make a Choice';
  }
}

function getSubmitButtonText(type: DecisionType, count: number): string {
  switch (type) {
    case 'target': return count > 0 ? `Target ${count} selected` : 'Select Target';
    case 'sacrifice': return count > 0 ? `Sacrifice ${count}` : 'Sacrifice';
    case 'may_ability': return 'Yes, do this';
    case 'pay_cost': return 'Pay';
    default: return 'Confirm';
  }
}

// ============================================================================
// Specialized Decision Creators
// ============================================================================

/**
 * Create a target selection decision
 */
export function createTargetDecision(
  id: string,
  sourceName: string,
  description: string,
  validTargets: { id: string; name: string; imageUrl?: string }[],
  minTargets: number = 1,
  maxTargets: number = 1,
  sourceImage?: string
): PlayerDecision {
  return {
    id,
    type: 'target',
    sourceName,
    sourceImage,
    description,
    options: validTargets.map(t => ({
      id: t.id,
      label: t.name,
      imageUrl: t.imageUrl,
    })),
    minSelections: minTargets,
    maxSelections: maxTargets,
  };
}

/**
 * Create a sacrifice selection decision
 */
export function createSacrificeDecision(
  id: string,
  sourceName: string,
  description: string,
  validPermanents: BattlefieldPermanent[],
  count: number = 1,
  sourceImage?: string
): PlayerDecision {
  return {
    id,
    type: 'sacrifice',
    sourceName,
    sourceImage,
    description,
    options: validPermanents.map(p => {
      const card = p.card as KnownCardRef;
      return {
        id: p.id,
        label: card?.name || 'Permanent',
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      };
    }),
    minSelections: count,
    maxSelections: count,
  };
}

/**
 * Create a mode selection decision
 */
export function createModeDecision(
  id: string,
  sourceName: string,
  description: string,
  modes: { id: string; text: string }[],
  minModes: number = 1,
  maxModes: number = 1,
  sourceImage?: string
): PlayerDecision {
  return {
    id,
    type: 'mode',
    sourceName,
    sourceImage,
    description,
    options: modes.map(m => ({
      id: m.id,
      label: m.text,
    })),
    minSelections: minModes,
    maxSelections: maxModes,
  };
}

/**
 * Create a "may" ability decision
 */
export function createMayAbilityDecision(
  id: string,
  sourceName: string,
  abilityText: string,
  sourceImage?: string
): PlayerDecision {
  return {
    id,
    type: 'may_ability',
    sourceName,
    sourceImage,
    description: abilityText,
    options: [
      { id: 'yes', label: 'Yes' },
    ],
    minSelections: 0,
    maxSelections: 1,
  };
}

/**
 * Create a blocker ordering decision
 */
export function createBlockerOrderDecision(
  id: string,
  attackerName: string,
  blockers: BattlefieldPermanent[],
  attackerImage?: string
): PlayerDecision {
  return {
    id,
    type: 'blocker_order',
    sourceName: attackerName,
    sourceImage: attackerImage,
    description: 'Choose the order to assign damage to blockers. Damage will be assigned to the first blocker until lethal, then the next, and so on.',
    options: blockers.map((b, index) => {
      const card = b.card as KnownCardRef;
      return {
        id: b.id,
        label: card?.name || 'Blocker',
        description: `Order ${index + 1}`,
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      };
    }),
    minSelections: blockers.length,
    maxSelections: blockers.length,
  };
}

/**
 * Create a color choice decision
 */
export function createColorDecision(
  id: string,
  sourceName: string,
  description: string,
  sourceImage?: string
): PlayerDecision {
  return {
    id,
    type: 'choose_color',
    sourceName,
    sourceImage,
    description,
    options: [
      { id: 'W', label: 'White', description: '⚪' },
      { id: 'U', label: 'Blue', description: '🔵' },
      { id: 'B', label: 'Black', description: '⚫' },
      { id: 'R', label: 'Red', description: '🔴' },
      { id: 'G', label: 'Green', description: '🟢' },
    ],
    minSelections: 1,
    maxSelections: 1,
  };
}

// ============================================================================
// Export
// ============================================================================

export default PlayerDecisionModal;

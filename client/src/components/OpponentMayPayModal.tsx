/**
 * OpponentMayPayModal.tsx
 * 
 * Modal for "opponent may pay" triggered abilities like:
 * - Smothering Tithe (opponent may pay {2})
 * - Rhystic Study (opponent may pay {1})
 * - Mystic Remora (opponent may pay {4})
 * 
 * Features:
 * - Display the payment cost and effect
 * - Show what happens if payment is declined
 * - Integration with trigger shortcuts for auto-responses
 * - Clear UI for quick decisions
 */

import React, { useState } from 'react';
import type { ManaPool } from '../../../shared/src';

export interface OpponentMayPayPrompt {
  /** Unique ID for this prompt */
  promptId: string;
  /** Card that created this trigger */
  sourceName: string;
  /** Player who controls the trigger source */
  sourceController: string;
  /** Player who must make the payment decision */
  decidingPlayer: string;
  /** Mana cost to pay (e.g., "{1}", "{2}", "{4}") */
  manaCost: string;
  /** Description of what happens if payment is declined */
  declineEffect: string;
  /** Full trigger text for reference */
  triggerText: string;
  /** Player's current mana pool (optional, for UI hints) */
  availableMana?: ManaPool;
}

export interface OpponentMayPayModalProps {
  prompt: OpponentMayPayPrompt;
  /** Called when player chooses to pay */
  onPay: () => void;
  /** Called when player declines to pay */
  onDecline: () => void;
  /** Called when player wants to set a shortcut preference */
  onSetShortcut?: (preference: 'always_pay' | 'never_pay') => void;
}

/**
 * Parse mana cost to determine if player can afford it
 */
function canAffordCost(cost: string, manaPool?: ManaPool): boolean {
  if (!manaPool) return true; // Can't determine, assume yes
  
  // Simple parser for generic mana costs like {1}, {2}, {4}
  const genericMatch = cost.match(/\{(\d+)\}/);
  if (genericMatch) {
    const required = parseInt(genericMatch[1], 10);
    const total = Object.values(manaPool).reduce((sum, val) => sum + val, 0);
    return total >= required;
  }
  
  return true; // Unknown format, assume can pay
}

/**
 * Format mana cost for display
 */
function formatManaCost(cost: string): string {
  // Replace {X} with styled mana symbols
  return cost.replace(/\{(\w+)\}/g, '$1');
}

export function OpponentMayPayModal({
  prompt,
  onPay,
  onDecline,
  onSetShortcut,
}: OpponentMayPayModalProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  
  const canAfford = canAffordCost(prompt.manaCost, prompt.availableMana);
  const formattedCost = formatManaCost(prompt.manaCost);

  const handlePay = () => {
    onPay();
  };

  const handleDecline = () => {
    onDecline();
  };

  const handleSetShortcut = (preference: 'always_pay' | 'never_pay') => {
    if (onSetShortcut) {
      onSetShortcut(preference);
    }
    setShowShortcuts(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        zIndex: 10003,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          borderRadius: 16,
          width: 500,
          maxWidth: '95vw',
          padding: 24,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 12, 
          marginBottom: 20,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          paddingBottom: 16,
        }}>
          <span style={{ fontSize: 28 }}>💰</span>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
              Opponent May Pay
            </h2>
            <div style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>
              {prompt.sourceName} triggers
            </div>
          </div>
        </div>

        {/* Trigger Information */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            padding: 16,
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.1)',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, color: '#aaa', marginBottom: 8 }}>
              Triggered Ability:
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              {prompt.triggerText}
            </div>
          </div>

          {/* Payment Choice */}
          <div style={{
            padding: 20,
            background: 'rgba(255, 215, 0, 0.1)',
            borderRadius: 12,
            border: '2px solid rgba(255, 215, 0, 0.3)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              Pay {formattedCost}?
            </div>
            <div style={{ fontSize: 13, color: '#ccc' }}>
              or
            </div>
            <div style={{ fontSize: 14, color: '#ffa500', marginTop: 8 }}>
              {prompt.declineEffect}
            </div>
          </div>
        </div>

        {/* Mana availability hint */}
        {prompt.availableMana && (
          <div style={{
            padding: 12,
            background: canAfford 
              ? 'rgba(34, 197, 94, 0.1)' 
              : 'rgba(239, 68, 68, 0.1)',
            borderRadius: 8,
            fontSize: 12,
            color: canAfford ? '#22c55e' : '#ef4444',
            marginBottom: 16,
            textAlign: 'center',
          }}>
            {canAfford 
              ? '✓ You have enough mana' 
              : '⚠ Insufficient mana in pool'}
          </div>
        )}

        {/* Shortcut Settings Toggle */}
        {onSetShortcut && !showShortcuts && (
          <button
            onClick={() => setShowShortcuts(true)}
            style={{
              width: '100%',
              padding: '8px 12px',
              marginBottom: 12,
              borderRadius: 8,
              border: '1px solid #4a4a6a',
              background: 'transparent',
              color: '#aaa',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            ⚙️ Set Shortcut Preference
          </button>
        )}

        {/* Shortcut Options */}
        {showShortcuts && (
          <div style={{
            padding: 12,
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 8,
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
              Auto-respond for this trigger:
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleSetShortcut('always_pay')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #4a4a6a',
                  background: 'rgba(34, 197, 94, 0.2)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Always Pay
              </button>
              <button
                onClick={() => handleSetShortcut('never_pay')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #4a4a6a',
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Never Pay
              </button>
              <button
                onClick={() => setShowShortcuts(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #4a4a6a',
                  background: 'transparent',
                  color: '#aaa',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'flex-end',
          paddingTop: 16,
          borderTop: '1px solid rgba(255,255,255,0.1)',
        }}>
          <button
            onClick={handleDecline}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: '1px solid #ef4444',
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            Don't Pay
          </button>
          <button
            onClick={handlePay}
            disabled={!canAfford}
            style={{
              padding: '12px 28px',
              borderRadius: 8,
              border: 'none',
              background: canAfford
                ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                : '#555',
              color: '#fff',
              cursor: canAfford ? 'pointer' : 'not-allowed',
              fontSize: 15,
              fontWeight: 600,
              boxShadow: canAfford ? '0 4px 12px rgba(34, 197, 94, 0.3)' : 'none',
              opacity: canAfford ? 1 : 0.5,
            }}
            title={!canAfford ? 'Insufficient mana in pool' : ''}
          >
            ✓ Pay {formattedCost}
          </button>
        </div>
      </div>
    </div>
  );
}

export default OpponentMayPayModal;

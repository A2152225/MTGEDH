/**
 * AbilitySelectionModal.tsx
 * 
 * A modal for selecting which activated ability to activate when a card has multiple.
 * Used when double-clicking a battlefield permanent with multiple activated abilities.
 */

import React from 'react';
import type { ParsedActivatedAbility } from '../utils/activatedAbilityParser';
import { getAbilityIcon, formatAbilityCost } from '../utils/activatedAbilityParser';
import { KeywordHighlighter } from './KeywordHighlighter';

export interface AbilitySelectionModalProps {
  open: boolean;
  cardName: string;
  cardImageUrl?: string;
  abilities: {
    ability: ParsedActivatedAbility;
    canActivate: boolean;
    reason?: string;
  }[];
  onSelect: (ability: ParsedActivatedAbility) => void;
  onCancel: () => void;
}

export function AbilitySelectionModal({
  open,
  cardName,
  cardImageUrl,
  abilities,
  onSelect,
  onCancel,
}: AbilitySelectionModalProps) {
  if (!open) return null;

  // Get color based on ability type
  const getAbilityColor = (ability: ParsedActivatedAbility): { bg: string; border: string; accent: string } => {
    if (ability.isManaAbility) {
      return { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(52, 211, 153, 0.4)', accent: '#10b981' };
    }
    if (ability.isFetchAbility) {
      return { bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(167, 139, 250, 0.4)', accent: '#8b5cf6' };
    }
    if (ability.isLoyaltyAbility) {
      return { bg: 'rgba(168, 85, 247, 0.15)', border: 'rgba(192, 132, 252, 0.4)', accent: '#a855f7' };
    }
    if (ability.requiresSacrifice) {
      return { bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(252, 165, 165, 0.4)', accent: '#ef4444' };
    }
    return { bg: 'rgba(100, 116, 139, 0.1)', border: 'rgba(148, 163, 184, 0.3)', accent: '#64748b' };
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 500,
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          {cardImageUrl && (
            <img
              src={cardImageUrl}
              alt={cardName}
              style={{
                width: 80,
                height: 112,
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            />
          )}
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{cardName}</h2>
            <div style={{ marginTop: 6, fontSize: 13, color: '#888' }}>
              Select an ability to activate
            </div>
          </div>
        </div>

        {/* Abilities List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {abilities.map(({ ability, canActivate, reason }) => {
            const colors = getAbilityColor(ability);
            const icon = getAbilityIcon(ability);
            const costText = formatAbilityCost(ability);

            return (
              <button
                key={ability.id}
                onClick={() => {
                  if (canActivate) {
                    onSelect(ability);
                  }
                }}
                disabled={!canActivate}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 16,
                  borderRadius: 8,
                  border: `1px solid ${canActivate ? colors.border : 'rgba(75, 85, 99, 0.4)'}`,
                  backgroundColor: canActivate ? colors.bg : 'rgba(55, 65, 81, 0.3)',
                  color: canActivate ? '#fff' : '#9ca3af',
                  cursor: canActivate ? 'pointer' : 'not-allowed',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                  opacity: canActivate ? 1 : 0.6,
                }}
                onMouseEnter={(e) => {
                  if (canActivate) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = colors.bg.replace('0.15', '0.25');
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.02)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (canActivate) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = colors.bg;
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
                  }
                }}
              >
                {/* Ability header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>{icon}</span>
                  <span style={{ 
                    fontWeight: 600, 
                    fontSize: 14,
                    color: canActivate ? colors.accent : '#9ca3af',
                  }}>
                    {ability.label}
                  </span>
                </div>

                {/* Cost badge */}
                <div
                  style={{
                    fontSize: 11,
                    color: '#94a3b8',
                    padding: '4px 8px',
                    background: 'rgba(0,0,0,0.3)',
                    borderRadius: 4,
                    display: 'inline-block',
                    alignSelf: 'flex-start',
                  }}
                >
                  Cost: {costText}
                </div>

                {/* Description */}
                <div style={{ fontSize: 13 }}>
                  <KeywordHighlighter
                    text={ability.description}
                    fontSize={13}
                    baseColor={canActivate ? '#e2e8f0' : '#9ca3af'}
                  />
                </div>

                {/* Reason why can't activate */}
                {!canActivate && reason && (
                  <div
                    style={{
                      marginTop: 4,
                      padding: '4px 8px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: 4,
                      fontSize: 11,
                      color: '#fca5a5',
                    }}
                  >
                    ⚠️ {reason}
                  </div>
                )}

                {/* Timing restrictions */}
                {ability.timingRestriction && (
                  <div
                    style={{
                      fontSize: 10,
                      color: '#94a3b8',
                      fontStyle: 'italic',
                    }}
                  >
                    {ability.timingRestriction === 'sorcery'
                      ? '⏱️ Sorcery speed only'
                      : '⚡ Instant speed'}
                  </div>
                )}

                {ability.oncePerTurn && (
                  <div
                    style={{
                      fontSize: 10,
                      color: '#94a3b8',
                      fontStyle: 'italic',
                    }}
                  >
                    🔄 Once per turn
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Cancel button */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px',
              borderRadius: 6,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default AbilitySelectionModal;

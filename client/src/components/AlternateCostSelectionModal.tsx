/**
 * AlternateCostSelectionModal.tsx
 * 
 * A modal for selecting which cost to pay when casting a spell.
 * Displays all available casting options including:
 * - Normal mana cost
 * - Card's built-in alternate costs (Mutate, Evoke, Overload, etc.)
 * - External alternate costs (Jodah, Fist of Suns, Omniscience)
 * - Kicker and Multi-kicker options
 */

import React, { useState, useMemo } from 'react';

export interface CastingOption {
  /** Unique identifier for this option */
  id: string;
  /** Display name */
  name: string;
  /** Description of the cost/effect */
  description: string;
  /** Mana cost string (e.g., "{2}{U}{U}" or "{W}{U}{B}{R}{G}") */
  manaCost?: string;
  /** Type of alternate cost */
  costType: 'normal' | 'mutate' | 'evoke' | 'overload' | 'dash' | 'flashback' | 
            'wubrg' | 'free' | 'kicker' | 'multikicker' | 'surge' | 'spectacle' |
            'buyback' | 'madness' | 'emerge' | 'prowl' | 'ninjutsu' | 'other';
  /** If from an external source, its name (e.g., "Jodah, Archmage Eternal") */
  sourceName?: string;
  /** If from an external source, its ID */
  sourceId?: string;
  /** Whether this option requires additional input (like mutate target selection) */
  requiresAdditionalInput?: boolean;
  /** Additional effects that occur when using this cost */
  additionalEffects?: string[];
  /** For kicker - whether it's already being kicked */
  isKicked?: boolean;
  /** For kicker - cost to kick */
  kickerCost?: string;
}

export interface AlternateCostSelectionModalProps {
  open: boolean;
  /** The card being cast */
  card: {
    id: string;
    name: string;
    imageUrl?: string;
    manaCost?: string;
    typeLine?: string;
    oracleText?: string;
  };
  /** Available casting options */
  options: CastingOption[];
  /** Currently selected option */
  selectedOption?: string;
  onConfirm: (optionId: string) => void;
  onCancel: () => void;
}

/**
 * Get display icon for a cost type
 */
function getCostTypeIcon(costType: CastingOption['costType']): string {
  switch (costType) {
    case 'normal': return '💰';
    case 'mutate': return '🧬';
    case 'evoke': return '⚡';
    case 'overload': return '💥';
    case 'dash': return '🏃';
    case 'flashback': return '🔄';
    case 'wubrg': return '🌈';
    case 'free': return '✨';
    case 'kicker': return '👢';
    case 'multikicker': return '👢👢';
    case 'surge': return '🌊';
    case 'spectacle': return '🎭';
    case 'buyback': return '↩️';
    case 'madness': return '😈';
    case 'emerge': return '🦑';
    case 'prowl': return '🐱';
    case 'ninjutsu': return '🥷';
    default: return '🎯';
  }
}

/**
 * Format mana cost for display with symbols
 */
function formatManaCost(manaCost?: string): React.ReactNode {
  if (!manaCost) return <span style={{ color: '#888' }}>Free</span>;
  
  // Simple rendering - in a real implementation, you'd use mana symbol images
  return (
    <span style={{ fontFamily: 'monospace', letterSpacing: 1 }}>
      {manaCost}
    </span>
  );
}

export function AlternateCostSelectionModal({
  open,
  card,
  options,
  selectedOption,
  onConfirm,
  onCancel,
}: AlternateCostSelectionModalProps) {
  const [selected, setSelected] = useState<string | null>(selectedOption || null);

  // Reset selection when modal opens
  React.useEffect(() => {
    if (open) {
      // Default to 'normal' if available, otherwise first option
      const normalOption = options.find(o => o.costType === 'normal');
      setSelected(normalOption?.id || options[0]?.id || null);
    }
  }, [open, options]);

  // Group options by type for better organization
  const groupedOptions = useMemo(() => {
    const groups: Record<string, CastingOption[]> = {
      'Standard Costs': [],
      'Alternate Costs': [],
      'External Sources': [],
    };
    
    for (const option of options) {
      if (option.costType === 'normal') {
        groups['Standard Costs'].push(option);
      } else if (option.sourceName && option.sourceId) {
        groups['External Sources'].push(option);
      } else {
        groups['Alternate Costs'].push(option);
      }
    }
    
    // Remove empty groups
    return Object.fromEntries(
      Object.entries(groups).filter(([_, opts]) => opts.length > 0)
    );
  }, [options]);

  const handleConfirm = () => {
    if (selected) {
      onConfirm(selected);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10002,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 700,
          width: '95%',
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 20, alignItems: 'flex-start' }}>
          {card.imageUrl && (
            <div
              style={{
                width: 120,
                height: 168,
                borderRadius: 8,
                overflow: 'hidden',
                flexShrink: 0,
                border: '2px solid #4a4a6a',
              }}
            >
              <img
                src={card.imageUrl}
                alt={card.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#f59e0b' }}>
              ⚡ Select Casting Cost
            </h2>
            <div style={{ marginTop: 8, fontSize: 16, fontWeight: 500 }}>
              {card.name}
            </div>
            {card.manaCost && (
              <div style={{ marginTop: 4, fontSize: 14, color: '#a0aec0' }}>
                Normal cost: {card.manaCost}
              </div>
            )}
            {card.typeLine && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                {card.typeLine}
              </div>
            )}
          </div>
        </div>

        {/* Casting options */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid #3a3a5a',
            borderRadius: 8,
            backgroundColor: '#252540',
          }}
        >
          {Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
            <div key={groupName}>
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: '#1a1a2e',
                  fontWeight: 600,
                  fontSize: 13,
                  color: '#a0aec0',
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  borderBottom: '1px solid #3a3a5a',
                }}
              >
                {groupName}
              </div>
              <div style={{ padding: 12 }}>
                {groupOptions.map(option => {
                  const isSelected = option.id === selected;
                  
                  return (
                    <div
                      key={option.id}
                      onClick={() => setSelected(option.id)}
                      style={{
                        padding: 14,
                        marginBottom: 10,
                        borderRadius: 8,
                        border: isSelected ? '2px solid #f59e0b' : '1px solid #4a4a6a',
                        backgroundColor: isSelected ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 20 }}>
                            {getCostTypeIcon(option.costType)}
                          </span>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>
                              {option.name}
                            </div>
                            {option.sourceName && (
                              <div style={{ fontSize: 11, color: '#8b5cf6', marginTop: 2 }}>
                                via {option.sourceName}
                              </div>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            padding: '4px 10px',
                            borderRadius: 4,
                            backgroundColor: 'rgba(0,0,0,0.3)',
                            fontSize: 14,
                          }}
                        >
                          {formatManaCost(option.manaCost)}
                        </div>
                      </div>
                      
                      <div style={{ marginTop: 8, fontSize: 12, color: '#a0aec0' }}>
                        {option.description}
                      </div>
                      
                      {option.additionalEffects && option.additionalEffects.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          {option.additionalEffects.map((effect, idx) => (
                            <div
                              key={idx}
                              style={{
                                fontSize: 11,
                                color: '#888',
                                marginTop: 2,
                                paddingLeft: 10,
                              }}
                            >
                              • {effect}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {option.requiresAdditionalInput && (
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: 11,
                            color: '#f59e0b',
                            fontStyle: 'italic',
                          }}
                        >
                          ⚠️ Requires additional selection after choosing
                        </div>
                      )}
                      
                      {isSelected && (
                        <div
                          role="img"
                          aria-label="Selected option"
                          style={{
                            position: 'absolute',
                            right: 14,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            backgroundColor: '#f59e0b',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#000',
                            fontSize: 14,
                            fontWeight: 600,
                          }}
                        >
                          ✓
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          
          {options.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
              No casting options available.
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
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
          <button
            onClick={handleConfirm}
            disabled={!selected}
            style={{
              padding: '10px 24px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: selected ? '#f59e0b' : '#4a4a6a',
              color: selected ? '#000' : '#888',
              cursor: selected ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default AlternateCostSelectionModal;

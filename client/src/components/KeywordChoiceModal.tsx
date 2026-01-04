/**
 * KeywordChoiceModal.tsx
 * 
 * A modal for handling keyword ability choices.
 * Supports various keyword choice types:
 * - Riot: Choose +1/+1 counter or haste
 * - Unleash: Choose to enter with +1/+1 counter (can't block)
 * - Fabricate: Choose N counters or N tokens
 * - Tribute: Opponent chooses to put counters
 * - Exploit: Choose creature to sacrifice
 * - Backup: Choose target creature
 * - And more...
 */

import React, { useState } from 'react';

export type KeywordChoiceType = 
  | 'riot'
  | 'unleash'
  | 'fabricate'
  | 'tribute'
  | 'exploit'
  | 'backup'
  | 'modular'
  | 'mentor'
  | 'enlist'
  | 'extort'
  | 'soulshift'
  | 'myriad'
  | 'generic';

export interface KeywordChoice {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

export interface TargetOption {
  id: string;
  name: string;
  imageUrl?: string;
  power?: number | string;
  toughness?: number | string;
  typeLine?: string;
}

export interface KeywordChoiceModalProps {
  open: boolean;
  keyword: string;
  keywordType: KeywordChoiceType;
  permanentName: string;
  permanentImageUrl?: string;
  description?: string;
  
  // For binary choices (riot, unleash)
  choices?: KeywordChoice[];
  
  // For target selection (mentor, backup, exploit, etc.)
  targets?: TargetOption[];
  
  // For numeric choices (fabricate N)
  value?: number;
  
  // For tribute (opponent choosing)
  isOpponentChoice?: boolean;
  opponentName?: string;
  
  // Callbacks
  onConfirm: (selection: string | string[]) => void;
  onCancel?: () => void;
  canCancel?: boolean;
}

const KEYWORD_TITLES: Record<KeywordChoiceType, string> = {
  riot: 'Riot',
  unleash: 'Unleash',
  fabricate: 'Fabricate',
  tribute: 'Tribute',
  exploit: 'Exploit',
  backup: 'Backup',
  modular: 'Modular',
  mentor: 'Mentor',
  enlist: 'Enlist',
  extort: 'Extort',
  soulshift: 'Soulshift',
  myriad: 'Myriad',
  generic: 'Choose',
};

const KEYWORD_DESCRIPTIONS: Record<KeywordChoiceType, string> = {
  riot: 'This creature enters the battlefield with your choice of a +1/+1 counter or haste.',
  unleash: 'You may have this creature enter the battlefield with a +1/+1 counter on it. It can\'t block as long as it has a +1/+1 counter on it.',
  fabricate: 'When this creature enters the battlefield, put +1/+1 counters on it, or create 1/1 colorless Servo artifact creature tokens.',
  tribute: 'As this creature enters the battlefield, an opponent of your choice may put +1/+1 counters on it.',
  exploit: 'When this creature enters the battlefield, you may sacrifice a creature.',
  backup: 'When this creature enters the battlefield, put +1/+1 counters on target creature. If that\'s another creature, it gains this creature\'s other abilities until end of turn.',
  modular: 'When this creature dies, you may put its +1/+1 counters on target artifact creature.',
  mentor: 'Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.',
  enlist: 'As this creature attacks, you may tap a nonattacking creature you control without summoning sickness. When you do, add its power to this creature\'s until end of turn.',
  extort: 'Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.',
  soulshift: 'When this creature dies, you may return target Spirit card with mana value N or less from your graveyard to your hand.',
  myriad: 'Whenever this creature attacks, create token copies of it attacking each other opponent.',
  generic: 'Make a choice for this keyword ability.',
};

export function KeywordChoiceModal({
  open,
  keyword,
  keywordType,
  permanentName,
  permanentImageUrl,
  description,
  choices,
  targets,
  value,
  isOpponentChoice = false,
  opponentName,
  onConfirm,
  onCancel,
  canCancel = false,
}: KeywordChoiceModalProps) {
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());

  if (!open) return null;

  const title = KEYWORD_TITLES[keywordType] || keyword;
  const defaultDescription = KEYWORD_DESCRIPTIONS[keywordType] || description || '';

  // Determine what type of selection UI to show
  const showBinaryChoice = choices && choices.length > 0;
  const showTargetSelection = targets && targets.length > 0;

  const handleBinaryChoice = (choiceId: string) => {
    setSelectedChoice(choiceId);
  };

  const handleTargetToggle = (targetId: string) => {
    const newSelected = new Set(selectedTargets);
    if (newSelected.has(targetId)) {
      newSelected.delete(targetId);
    } else {
      // For most keywords, only 1 target
      newSelected.clear();
      newSelected.add(targetId);
    }
    setSelectedTargets(newSelected);
  };

  const handleConfirm = () => {
    if (showBinaryChoice && selectedChoice) {
      onConfirm(selectedChoice);
    } else if (showTargetSelection && selectedTargets.size > 0) {
      onConfirm(Array.from(selectedTargets));
    }
  };

  const canConfirm = showBinaryChoice ? !!selectedChoice : selectedTargets.size > 0;

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
        zIndex: 9000,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 500,
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <h2 style={{ 
            color: '#ffd700', 
            margin: '0 0 8px 0',
            fontSize: '1.5rem',
          }}>
            {title} {value ? value : ''}
          </h2>
          <p style={{ 
            color: '#888', 
            margin: 0,
            fontSize: '0.9rem',
          }}>
            {permanentName}
          </p>
          {isOpponentChoice && opponentName && (
            <p style={{ 
              color: '#f97316', 
              margin: '8px 0 0 0',
              fontSize: '0.9rem',
              fontStyle: 'italic',
            }}>
              {opponentName} is making this choice
            </p>
          )}
        </div>

        {/* Card image */}
        {permanentImageUrl && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <img 
              src={permanentImageUrl} 
              alt={permanentName}
              style={{ 
                maxWidth: 150,
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            />
          </div>
        )}

        {/* Description */}
        <p style={{ 
          color: '#ccc', 
          marginBottom: 20,
          fontSize: '0.9rem',
          textAlign: 'center',
          fontStyle: 'italic',
        }}>
          {description || defaultDescription}
        </p>

        {/* Binary Choice UI */}
        {showBinaryChoice && (
          <div style={{ 
            display: 'flex', 
            gap: 12, 
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}>
            {choices!.map((choice) => (
              <button
                key={choice.id}
                onClick={() => handleBinaryChoice(choice.id)}
                style={{
                  flex: '1 1 150px',
                  maxWidth: 200,
                  padding: '16px 12px',
                  borderRadius: 8,
                  border: `2px solid ${selectedChoice === choice.id ? '#ffd700' : '#444'}`,
                  backgroundColor: selectedChoice === choice.id ? '#2a2a4e' : '#222',
                  color: selectedChoice === choice.id ? '#ffd700' : '#ccc',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>
                  {choice.icon || (choice.id === 'counter' ? '⬆️' : choice.id === 'haste' ? '⚡' : choice.id === 'tokens' ? '👥' : '❓')}
                </div>
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                  {choice.name}
                </div>
                {choice.description && (
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>
                    {choice.description}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Target Selection UI */}
        {showTargetSelection && (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}>
            {targets!.map((target) => (
              <div
                key={target.id}
                onClick={() => handleTargetToggle(target.id)}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: `2px solid ${selectedTargets.has(target.id) ? '#ffd700' : '#444'}`,
                  backgroundColor: selectedTargets.has(target.id) ? '#2a2a4e' : '#222',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'center',
                }}
              >
                {target.imageUrl && (
                  <img 
                    src={target.imageUrl} 
                    alt={target.name}
                    style={{ 
                      maxWidth: '100%',
                      maxHeight: 100,
                      borderRadius: 4,
                      marginBottom: 8,
                    }}
                  />
                )}
                <div style={{ 
                  color: selectedTargets.has(target.id) ? '#ffd700' : '#ccc',
                  fontWeight: 'bold',
                  fontSize: '0.9rem',
                }}>
                  {target.name}
                </div>
                {target.power !== undefined && target.toughness !== undefined && (
                  <div style={{ color: '#888', fontSize: '0.8rem' }}>
                    {target.power}/{target.toughness}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ 
          display: 'flex', 
          gap: 12, 
          justifyContent: 'center',
          marginTop: 20,
        }}>
          {canCancel && onCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: '12px 24px',
                borderRadius: 8,
                border: '1px solid #666',
                backgroundColor: '#333',
                color: '#ccc',
                cursor: 'pointer',
                fontSize: '1rem',
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '12px 32px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: canConfirm ? '#ffd700' : '#444',
              color: canConfirm ? '#000' : '#888',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontWeight: 'bold',
              fontSize: '1rem',
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// Default choices for common keywords
export const RIOT_CHOICES: KeywordChoice[] = [
  { id: 'counter', name: '+1/+1 Counter', description: 'Enter with a +1/+1 counter', icon: '⬆️' },
  { id: 'haste', name: 'Haste', description: 'Can attack and use abilities immediately', icon: '⚡' },
];

export const UNLEASH_CHOICES: KeywordChoice[] = [
  { id: 'counter', name: '+1/+1 Counter', description: 'Bigger but can\'t block', icon: '⬆️' },
  { id: 'none', name: 'No Counter', description: 'Normal size, can block', icon: '🛡️' },
];

export const TRIBUTE_CHOICES: KeywordChoice[] = [
  { id: 'pay', name: 'Pay Tribute', description: 'Put the counters on it', icon: '✅' },
  { id: 'decline', name: 'Refuse Tribute', description: 'Trigger the bonus effect', icon: '❌' },
];

export const EXTORT_CHOICES: KeywordChoice[] = [
  { id: 'pay', name: 'Pay {W/B}', description: 'Drain each opponent for 1 life', icon: '💀' },
  { id: 'skip', name: 'Don\'t Pay', description: 'Skip extort this time', icon: '⏭️' },
];

export function getFabricateChoices(n: number): KeywordChoice[] {
  return [
    { id: 'counters', name: `${n} Counter${n > 1 ? 's' : ''}`, description: `Put ${n} +1/+1 counter${n > 1 ? 's' : ''} on this creature`, icon: '⬆️' },
    { id: 'tokens', name: `${n} Token${n > 1 ? 's' : ''}`, description: `Create ${n} 1/1 Servo token${n > 1 ? 's' : ''}`, icon: '🤖' },
  ];
}

export default KeywordChoiceModal;

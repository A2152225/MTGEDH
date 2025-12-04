/**
 * CommanderZoneChoiceModal.tsx
 * 
 * Modal for choosing whether to move a commander to the command zone 
 * instead of graveyard, exile, hand, or library (Rule 903.9a/903.9b).
 * 
 * When a commander would be put into any zone other than the battlefield or stack,
 * its owner may choose to put it into the command zone instead.
 */

import React from 'react';
import type { PendingCommanderZoneChoice } from '../../../shared/src';

export interface CommanderZoneChoiceModalProps {
  /** The pending choice to display */
  choice: PendingCommanderZoneChoice;
  /** Callback when player makes a choice */
  onChoice: (moveToCommandZone: boolean) => void;
}

/**
 * Get human-readable description of the destination zone
 */
function getDestinationDescription(zone: string, libraryPosition?: string): string {
  switch (zone) {
    case 'graveyard': return 'put into your graveyard';
    case 'exile': return 'exiled';
    case 'hand': return 'returned to your hand';
    case 'library': 
      if (libraryPosition === 'top') return 'put on top of your library';
      if (libraryPosition === 'bottom') return 'put on the bottom of your library';
      return 'shuffled into your library';
    default: return `moved to ${zone}`;
  }
}

/**
 * Get button text for letting commander go to destination
 */
function getLetGoButtonText(zone: string, libraryPosition?: string): string {
  switch (zone) {
    case 'graveyard': return 'Let it go to graveyard';
    case 'exile': return 'Let it be exiled';
    case 'hand': return 'Let it go to hand';
    case 'library': 
      if (libraryPosition === 'top') return 'Put on top of library';
      if (libraryPosition === 'bottom') return 'Put on bottom of library';
      return 'Shuffle into library';
    default: return `Let it go to ${zone}`;
  }
}

export function CommanderZoneChoiceModal({
  choice,
  onChoice,
}: CommanderZoneChoiceModalProps) {
  const { commanderName, destinationZone, card, libraryPosition } = choice as any;
  
  const cardImage = card.image_uris?.normal || card.image_uris?.small || card.image_uris?.art_crop;
  
  // Determine rule reference based on destination
  const getRuleRef = () => {
    switch (destinationZone) {
      case 'graveyard': return '903.9a';
      case 'exile': return '903.9b';
      case 'hand': return '903.9a';
      case 'library': return '903.9a';
      default: return '903.9';
    }
  };
  
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1100,
    }}>
      <div style={{
        backgroundColor: '#1a1a2e',
        borderRadius: 12,
        padding: 24,
        maxWidth: 450,
        width: '90%',
        border: '2px solid #8b5cf6',
        boxShadow: '0 8px 32px rgba(139, 92, 246, 0.3)',
      }}>
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 12, 
          marginBottom: 16 
        }}>
          <span style={{ fontSize: 28 }}>👑</span>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 18 }}>Commander Zone Choice</h2>
            <div style={{ color: '#a0a0c0', fontSize: 13 }}>
              Rule {getRuleRef()}
            </div>
          </div>
        </div>

        {/* Card Image */}
        {cardImage && (
          <div style={{ 
            marginBottom: 16, 
            textAlign: 'center',
            display: 'flex',
            justifyContent: 'center',
          }}>
            <img 
              src={cardImage} 
              alt={commanderName}
              style={{ 
                maxWidth: 200, 
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            />
          </div>
        )}

        {/* Message */}
        <div style={{
          backgroundColor: 'rgba(255,255,255,0.05)',
          padding: 16,
          borderRadius: 8,
          marginBottom: 20,
          color: '#d0d0e0',
          fontSize: 14,
          lineHeight: 1.6,
          textAlign: 'center',
        }}>
          Your commander <strong style={{ color: '#8b5cf6' }}>{commanderName}</strong> would be {getDestinationDescription(destinationZone, libraryPosition)}.
          <br /><br />
          Would you like to move it to the <strong style={{ color: '#22c55e' }}>command zone</strong> instead?
        </div>

        {/* Info about commander tax */}
        <div style={{
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: 6,
          padding: 12,
          marginBottom: 20,
          color: '#c4b5fd',
          fontSize: 12,
        }}>
          <strong>Note:</strong> Each time you cast your commander from the command zone, it costs {'{2}'} more 
          than the previous time (cumulative commander tax).
          {destinationZone === 'hand' && (
            <><br /><br /><strong>Tip:</strong> If moved to hand, you can cast it without commander tax, but it won't be public information.</>
          )}
          {destinationZone === 'library' && (
            <><br /><br /><strong>Tip:</strong> If moved to library, you'll need to draw it again to cast it.</>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ 
          display: 'flex', 
          gap: 12, 
          justifyContent: 'center',
          flexDirection: 'column',
        }}>
          <button
            type="button"
            onClick={() => onChoice(true)}
            style={{
              flex: 1,
              padding: '14px 24px',
              backgroundColor: '#22c55e',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 15,
              fontWeight: 600,
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#16a34a'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#22c55e'}
          >
            ✓ Move to Command Zone
          </button>
          
          <button
            type="button"
            onClick={() => onChoice(false)}
            style={{
              flex: 1,
              padding: '12px 24px',
              backgroundColor: 'transparent',
              color: '#9ca3af',
              border: '1px solid #4b5563',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
              transition: 'border-color 0.2s, color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#6b7280';
              e.currentTarget.style.color = '#d1d5db';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#4b5563';
              e.currentTarget.style.color = '#9ca3af';
            }}
          >
            {getLetGoButtonText(destinationZone, libraryPosition)}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CommanderZoneChoiceModal;

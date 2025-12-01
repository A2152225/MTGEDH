/**
 * ExploreModal.tsx
 * 
 * Modal for the Explore keyword action (Rule 701.44).
 * 
 * When a creature explores:
 * 1. Reveal the top card of your library
 * 2. If it's a land, put it into your hand
 * 3. If it's not a land, put a +1/+1 counter on the exploring creature
 *    and you may put the revealed card into your graveyard (otherwise it stays on top)
 */

import React, { useMemo } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export type ExploreCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;

export interface ExploreModalProps {
  /** The creature that is exploring */
  exploringCreature: {
    id: string;
    name: string;
    imageUrl?: string;
  };
  /** The revealed card from the top of the library */
  revealedCard: ExploreCard;
  /** Whether the revealed card is a land */
  isLand: boolean;
  /** Image preference for card display */
  imagePref: ImagePref;
  /** Called when the player confirms their choice */
  onConfirm: (payload: { 
    /** True if the card goes to graveyard (only for non-lands) */
    toGraveyard: boolean;
  }) => void;
}

export function ExploreModal({
  exploringCreature,
  revealedCard,
  isLand,
  imagePref,
  onConfirm,
}: ExploreModalProps) {
  const cardImage = revealedCard.image_uris?.[imagePref] || 
    revealedCard.image_uris?.normal || 
    revealedCard.image_uris?.small;

  // For lands, the only option is to put it in hand
  // For non-lands, player can choose to put it in graveyard or leave on top
  const handleKeepOnTop = () => {
    onConfirm({ toGraveyard: false });
  };

  const handlePutInGraveyard = () => {
    onConfirm({ toGraveyard: true });
  };

  const handleLandResolution = () => {
    // Lands always go to hand - no choice needed
    onConfirm({ toGraveyard: false });
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
          <span style={{ fontSize: 28 }}>🔍</span>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
              Explore
            </h2>
            <div style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>
              {exploringCreature.name} explores
            </div>
          </div>
        </div>

        {/* Revealed Card Display */}
        <div style={{ 
          display: 'flex', 
          gap: 20, 
          marginBottom: 24,
        }}>
          {/* Card Image */}
          <div
            onMouseEnter={(e) => showCardPreview(
              e.currentTarget as HTMLElement, 
              // ExploreCard is compatible with CardLike (has name, type_line, image_uris)
              revealedCard, 
              { prefer: 'right', anchorPadding: 8 }
            )}
            onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
            style={{
              width: 180,
              height: 250,
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
              border: isLand ? '3px solid #22c55e' : '3px solid #3b82f6',
              flexShrink: 0,
            }}
          >
            {cardImage ? (
              <img
                src={cardImage}
                alt={revealedCard.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#2a2a4a',
                fontSize: 14,
                textAlign: 'center',
                padding: 12,
              }}>
                {revealedCard.name}
              </div>
            )}
          </div>

          {/* Card Info & Result */}
          <div style={{ flex: 1 }}>
            <div style={{ 
              fontSize: 18, 
              fontWeight: 600, 
              marginBottom: 8,
            }}>
              {revealedCard.name}
            </div>
            <div style={{ 
              fontSize: 13, 
              color: '#aaa', 
              marginBottom: 16,
            }}>
              {revealedCard.type_line}
            </div>

            {/* Result Explanation */}
            <div style={{
              padding: 16,
              background: isLand 
                ? 'rgba(34, 197, 94, 0.15)' 
                : 'rgba(59, 130, 246, 0.15)',
              borderRadius: 12,
              border: isLand 
                ? '1px solid rgba(34, 197, 94, 0.3)' 
                : '1px solid rgba(59, 130, 246, 0.3)',
            }}>
              {isLand ? (
                <>
                  <div style={{ 
                    fontSize: 15, 
                    fontWeight: 600, 
                    color: '#22c55e',
                    marginBottom: 8,
                  }}>
                    ✨ Land Revealed!
                  </div>
                  <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>
                    Put <strong>{revealedCard.name}</strong> into your hand.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ 
                    fontSize: 15, 
                    fontWeight: 600, 
                    color: '#3b82f6',
                    marginBottom: 8,
                  }}>
                    ➕ Not a Land
                  </div>
                  <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>
                    Put a +1/+1 counter on <strong>{exploringCreature.name}</strong>.
                    <br />
                    You may put <strong>{revealedCard.name}</strong> into your graveyard.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'flex-end',
          paddingTop: 16,
          borderTop: '1px solid rgba(255,255,255,0.1)',
        }}>
          {isLand ? (
            <button
              onClick={handleLandResolution}
              style={{
                padding: '12px 28px',
                borderRadius: 8,
                border: 'none',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
              }}
            >
              ✓ Put Land in Hand
            </button>
          ) : (
            <>
              <button
                onClick={handleKeepOnTop}
                style={{
                  padding: '12px 24px',
                  borderRadius: 8,
                  border: '1px solid #4a4a6a',
                  background: 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Keep on Top of Library
              </button>
              <button
                onClick={handlePutInGraveyard}
                style={{
                  padding: '12px 24px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 15,
                  fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                }}
              >
                Put in Graveyard
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ExploreModal;

/**
 * BatchExploreModal.tsx
 * 
 * Modal for handling multiple explore actions at once (e.g., from Hakbal triggers).
 * 
 * Features:
 * - Display multiple revealed cards simultaneously
 * - "Resolve All" option for quick batch resolution
 * - Individual resolution for each explore
 * - Works with the existing ExploreModal for single explores
 */

import React, { useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export type BatchExploreCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;

export interface ExploreResult {
  /** The permanent that is exploring */
  permanentId: string;
  /** Name of the exploring permanent */
  permanentName: string;
  /** The revealed card */
  revealedCard: BatchExploreCard;
  /** Whether the revealed card is a land */
  isLand: boolean;
}

export interface BatchExploreModalProps {
  /** All explore results to resolve */
  explores: ExploreResult[];
  /** Image preference for card display */
  imagePref: ImagePref;
  /** Called when the player resolves all explores at once */
  onResolveAll: (decisions: { permanentId: string; toGraveyard: boolean }[]) => void;
  /** Called when the player wants to resolve individually */
  onResolveIndividually: () => void;
}

/**
 * Automatically determine the default choice for a non-land explore:
 * - If it's a good card (low CMC, useful), keep on top
 * - Otherwise, put in graveyard
 */
function getDefaultChoice(card: BatchExploreCard): boolean {
  // For now, default to putting in graveyard (most common choice)
  // This can be enhanced with more logic later
  return true;
}

export function BatchExploreModal({
  explores,
  imagePref,
  onResolveAll,
  onResolveIndividually,
}: BatchExploreModalProps) {
  // Track individual decisions for each explore
  const [decisions, setDecisions] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    explores.forEach(exp => {
      // Lands don't need a decision (always go to hand)
      // For non-lands, default to graveyard
      if (!exp.isLand) {
        initial[exp.permanentId] = getDefaultChoice(exp.revealedCard);
      }
    });
    return initial;
  });

  const handleResolveAll = () => {
    const allDecisions = explores.map(exp => ({
      permanentId: exp.permanentId,
      toGraveyard: exp.isLand ? false : decisions[exp.permanentId],
    }));
    onResolveAll(allDecisions);
  };

  const toggleDecision = (permanentId: string) => {
    setDecisions(prev => ({
      ...prev,
      [permanentId]: !prev[permanentId],
    }));
  };

  const landCount = explores.filter(e => e.isLand).length;
  const nonLandCount = explores.filter(e => !e.isLand).length;

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
          width: Math.min(800, 95 * window.innerWidth / 100),
          maxWidth: '95vw',
          maxHeight: '90vh',
          padding: 24,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          gap: 12, 
          marginBottom: 20,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          paddingBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>🔍</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
                Batch Explore
              </h2>
              <div style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>
                {explores.length} creature{explores.length !== 1 ? 's' : ''} exploring
              </div>
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#aaa' }}>
            {landCount > 0 && <div>🌳 {landCount} land{landCount !== 1 ? 's' : ''}</div>}
            {nonLandCount > 0 && <div>➕ {nonLandCount} non-land{nonLandCount !== 1 ? 's' : ''}</div>}
          </div>
        </div>

        {/* Scrollable results */}
        <div style={{ 
          flex: 1,
          overflowY: 'auto',
          marginBottom: 16,
        }}>
          {explores.map((exp, idx) => {
            const cardImage = exp.revealedCard.image_uris?.[imagePref] || 
              exp.revealedCard.image_uris?.normal || 
              exp.revealedCard.image_uris?.small;

            const toGraveyard = decisions[exp.permanentId] ?? false;

            return (
              <div
                key={exp.permanentId}
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: 16,
                  marginBottom: idx < explores.length - 1 ? 12 : 0,
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 12,
                  border: exp.isLand 
                    ? '2px solid rgba(34, 197, 94, 0.3)' 
                    : '2px solid rgba(59, 130, 246, 0.3)',
                }}
              >
                {/* Card Image */}
                <div
                  onMouseEnter={(e) => showCardPreview(
                    e.currentTarget as HTMLElement, 
                    exp.revealedCard, 
                    { prefer: 'right', anchorPadding: 8 }
                  )}
                  onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
                  style={{
                    width: 120,
                    height: 167,
                    borderRadius: 8,
                    overflow: 'hidden',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    flexShrink: 0,
                  }}
                >
                  {cardImage ? (
                    <img
                      src={cardImage}
                      alt={exp.revealedCard.name}
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
                      fontSize: 11,
                      textAlign: 'center',
                      padding: 8,
                    }}>
                      {exp.revealedCard.name}
                    </div>
                  )}
                </div>

                {/* Info and Choices */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#aaa' }}>
                      {exp.permanentName} explores
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>
                      {exp.revealedCard.name}
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      {exp.revealedCard.type_line}
                    </div>
                  </div>

                  {/* Result */}
                  {exp.isLand ? (
                    <div style={{
                      padding: 12,
                      background: 'rgba(34, 197, 94, 0.15)',
                      borderRadius: 8,
                      fontSize: 13,
                      color: '#22c55e',
                    }}>
                      ✨ Land → Put in hand
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => toggleDecision(exp.permanentId)}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: toGraveyard ? '2px solid #3b82f6' : '1px solid #4a4a6a',
                          background: toGraveyard ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {toGraveyard ? '✓ ' : ''}To Graveyard
                      </button>
                      <button
                        onClick={() => toggleDecision(exp.permanentId)}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: !toGraveyard ? '2px solid #3b82f6' : '1px solid #4a4a6a',
                          background: !toGraveyard ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {!toGraveyard ? '✓ ' : ''}Keep on Top
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'flex-end',
          paddingTop: 16,
          borderTop: '1px solid rgba(255,255,255,0.1)',
        }}>
          <button
            onClick={onResolveIndividually}
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
            Resolve One by One
          </button>
          <button
            onClick={handleResolveAll}
            style={{
              padding: '12px 28px',
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
            ✓ Resolve All ({explores.length})
          </button>
        </div>
      </div>
    </div>
  );
}

export default BatchExploreModal;

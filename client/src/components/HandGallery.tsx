import React, { useState, useRef } from 'react';
import type { CardRef, KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

/**
 * Cost reduction info for a card
 */
export interface CardCostReduction {
  originalCost: string;
  reducedCost: string;
  genericReduction: number;
  colorReduction: Record<string, number>;
  sources: string[];
}

export interface HandGalleryProps {
  cards: CardRef[];
  handCount?: number;               // total count (for hidden hands)
  imagePref: 'small' | 'normal' | 'art_crop';
  onPlayLand?: (cardId: string) => void;
  onCast?: (cardId: string) => void;
  reasonCannotPlayLand?: (card: { type_line?: string }) => string | null;
  reasonCannotCast?: (card: { type_line?: string }) => string | null;
  thumbWidth?: number;
  zoomScale?: number;
  // NEW: support wrap7 for 7-cards-per-row layout
  layout?: 'wrap2' | 'wrap7' | 'row';
  overlapPx?: number;
  rowGapPx?: number;
  enableReorder?: boolean;
  onReorder?: (order: string[]) => void;  // changed to card IDs instead of indices
  hidden?: boolean;                 // if true, render facedown placeholders (no leak)
  // NEW: cost reduction info for displaying modified costs
  costReductions?: Record<string, CardCostReduction>;
}

function isLand(tl?: string): boolean {
  return !!tl && /\bland\b/i.test(tl);
}

/**
 * Get the type_line for a card, handling cards with card_faces
 */
function getTypeLine(card: KnownCardRef): string | undefined {
  // First check the card's root type_line
  if (card.type_line) {
    return card.type_line;
  }
  // For cards with card_faces (like DFCs), check the first face
  const faces = (card as any).card_faces;
  if (Array.isArray(faces) && faces.length > 0 && faces[0].type_line) {
    return faces[0].type_line;
  }
  return undefined;
}

export function HandGallery(props: HandGalleryProps) {
  const {
    cards,
    handCount,
    imagePref,
    onPlayLand,
    onCast,
    reasonCannotPlayLand,
    reasonCannotCast,
    thumbWidth = 110,
    zoomScale = 1,
    layout = 'wrap2',
    overlapPx = 0,
    rowGapPx = 10,
    enableReorder = false,
    onReorder,
    hidden = false,
    costReductions = {},
  } = props;

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  const visibleCards = hidden ? [] : cards;

  // Layout:
  // - 'row': horizontal strip (used rarely)
  // - 'wrap2': legacy wrap layout (2-ish rows depending on count)
  // - 'wrap7': approximate 7-cards-per-row using flex-basis
  const WRAP7_GAP = 10; // Gap between cards in wrap7 layout
  let widthStyle: React.CSSProperties;
  if (layout === 'row') {
    widthStyle = {
      display: 'flex',
      gap: overlapPx > 0 ? 0 : 8,
      paddingBottom: 4,
      overflowX: 'auto',
    };
  } else if (layout === 'wrap7') {
    // Each card gets ~1/7 of the width, with a gap; fits 7 cards per row
    widthStyle = {
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
      columnGap: WRAP7_GAP,
      rowGap: rowGapPx,
    };
  } else {
    // default wrap2 behavior
    widthStyle = {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      rowGap: rowGapPx,
    };
  }

  function handleDragStart(i: number) {
    if (!enableReorder) return;
    setDragIdx(i);
  }
  function handleDragEnter(i: number) {
    if (!enableReorder || dragIdx === null) return;
    setDragOver(i);
  }
  function handleDragEnd() {
    if (!enableReorder) return;
    if (dragIdx !== null && dragOver !== null && dragIdx !== dragOver) {
      // Build index permutation
      const orderIdx = [...Array(visibleCards.length).keys()];
      const [removedIdx] = orderIdx.splice(dragIdx, 1);
      orderIdx.splice(dragOver, 0, removedIdx);

      // Map index permutation to card IDs
      const idOrder = orderIdx
        .map((idx) => (visibleCards[idx] as any)?.id)
        .filter((id): id is string => typeof id === 'string');

      if (idOrder.length === visibleCards.length && onReorder) {
        onReorder(idOrder);
      }
    }
    setDragIdx(null);
    setDragOver(null);
  }

  // Card container base style; adjust width for wrap7 so rows hold ~7 cards
  const baseCardStyle: React.CSSProperties = {
    aspectRatio: '0.72',
    border: '2px solid #2b2b2b',
    borderRadius: 6,
    background: '#0f0f0f',
    position: 'relative',
    overflow: 'hidden',
    cursor: 'pointer',
  };

  // For wrap7 we override width to use a fraction, otherwise respect thumbWidth
  function cardWidthStyle(): React.CSSProperties {
    if (layout === 'wrap7') {
      // Calculate width so exactly 7 cards fit per row with gaps
      // Using calc to account for gaps: (100% - 6 * gap) / 7
      return {
        flex: `0 0 calc((100% - 6 * ${WRAP7_GAP}px) / 7)`,
        maxWidth: thumbWidth,
        minWidth: 90, // Minimum card width to ensure readability
      };
    }
    return { width: thumbWidth };
  }

  return (
    <div ref={galleryRef} style={{ position: 'relative', ...widthStyle }}>
      {/* Hidden hand placeholders */}
      {hidden && handCount && handCount > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Array.from({ length: handCount }).map((_, i) => (
            <div
              key={i}
              style={{
                width: thumbWidth,
                aspectRatio: '0.72',
                background: 'linear-gradient(135deg,#222,#444)',
                border: '2px solid #2b2b2b',
                borderRadius: 6,
                position: 'relative'
              }}
              title="Hidden card"
            >
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#888', fontSize: 12
              }}>Hidden</div>
            </div>
          ))}
        </div>
      )}

      {/* Visible cards */}
      {visibleCards.map((c, i) => {
        const isKnown = (c as KnownCardRef).name !== undefined && !(c as any).faceDown;
        const kc = isKnown ? c as KnownCardRef : null;
        const name = kc?.name || 'Card';
        const tl = kc ? getTypeLine(kc) : undefined;
        const img = kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small;

        const cantPlayLand = kc && isLand(tl) && reasonCannotPlayLand ? reasonCannotPlayLand(kc) : null;
        const cantCast = kc && reasonCannotCast ? reasonCannotCast(kc) : null;

        return (
          <div
            key={(c as any).id || i}
            draggable={enableReorder}
            onDragStart={() => handleDragStart(i)}
            onDragEnter={() => handleDragEnter(i)}
            onDragEnd={handleDragEnd}
            onMouseEnter={(e) =>
              isKnown &&
              showCardPreview(e.currentTarget as HTMLElement, kc, {
                prefer: 'above',
                anchorPadding: 0,
              })
            }
            onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
            style={{
              ...baseCardStyle,
              ...cardWidthStyle(),
              transform: dragIdx === i ? 'scale(0.95)' : 'none',
              boxShadow:
                dragIdx === i
                  ? '0 0 0 2px #2b6cb0'
                  : dragOver === i
                  ? '0 0 0 2px #38a169'
                  : 'none',
            }}
            title={name}
            onDoubleClick={() => {
              if (!kc) return;
              if (onPlayLand && isLand(tl) && !cantPlayLand) {
                onPlayLand(kc.id);
              } else if (onCast && !isLand(tl)) {
                // Allow cast attempt for non-land cards
                // Server will validate priority and return appropriate error if needed
                onCast(kc.id);
              }
            }}
          >
            {img ? (
              <img
                src={img}
                alt={name}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            ) : (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#eee', fontSize: 12, padding: 8
              }}>{name}</div>
            )}

            {/* Cost reduction badge - show modified cost when Banneret effects apply */}
            {kc && !isLand(tl) && costReductions[kc.id] && (
              <div 
                style={{
                  position: 'absolute', 
                  bottom: 4, 
                  left: 4,
                  background: 'rgba(34, 197, 94, 0.9)', 
                  color: '#fff',
                  fontSize: 10, 
                  padding: '2px 6px', 
                  borderRadius: 4,
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title={`Cost reduced by ${costReductions[kc.id].sources.join(', ')}`}
              >
                <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>
                  {costReductions[kc.id].originalCost}
                </span>
                <span>→</span>
                <span>{costReductions[kc.id].reducedCost}</span>
              </div>
            )}

            {/* Action badges (show Land ✕ only on actual lands; Cast ✕ only if spell cannot be cast) */}
            {kc && isLand(tl) && cantPlayLand && (
              <div style={{
                position: 'absolute', top: 4, left: 4,
                background: 'rgba(0,0,0,0.6)', color: '#f6ad55',
                fontSize: 10, padding: '2px 4px', borderRadius: 4
              }}>Land ✕</div>
            )}
            {kc && !isLand(tl) && cantCast && (
              <div style={{
                position: 'absolute', top: 4, right: 4,
                background: 'rgba(0,0,0,0.6)', color: '#fc8181',
                fontSize: 10, padding: '2px 4px', borderRadius: 4
              }}>Cast ✕</div>
            )}
          </div>
        );
      })}
      {visibleCards.length === 0 && !hidden && (
        <div style={{ color: '#777', fontSize: 12 }}>Empty hand</div>
      )}
    </div>
  );
}
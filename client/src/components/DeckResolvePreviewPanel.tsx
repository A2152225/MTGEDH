import React, { useEffect, useRef } from 'react';

import { getPrimaryCardImageUrl } from '../utils/cardImages';
import type { DeckCardLookupResult } from '../utils/serverDeckApi';

export type DeckResolvePreviewCard = {
  query: string;
  found: true;
  name: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  image_uris?: DeckCardLookupResult['image_uris'];
};

export function DeckResolvePreviewPanel({
  cards,
  compact,
  fillHeight,
}: {
  cards: DeckResolvePreviewCard[];
  compact?: boolean;
  /** Stretch to parent row height (decklist editor). */
  fillHeight?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Keep the latest decklist position in view when the list grows from the bottom.
    el.scrollTop = el.scrollHeight;
  }, [cards.length]);

  if (cards.length === 0) return null;

  return (
    <div
      style={{
        border: '1px solid #333',
        borderRadius: 6,
        background: '#16181a',
        display: 'flex',
        flexDirection: 'column',
        minHeight: fillHeight ? 0 : (compact ? 120 : 180),
        height: fillHeight ? '100%' : undefined,
        maxHeight: fillHeight ? '100%' : (compact ? 220 : 320),
        overflow: 'hidden',
        alignSelf: fillHeight ? 'stretch' : undefined,
      }}
    >
      <div
        style={{
          fontSize: 11,
          padding: '6px 8px',
          borderBottom: '1px solid #333',
          color: '#aaa',
          flexShrink: 0,
        }}
      >
        Resolved ({cards.length})
      </div>
      <div
        ref={scrollerRef}
        style={{ overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        {cards.map((card, index) => {
          const thumb = getPrimaryCardImageUrl(card, 'small');
          const tip = [card.type_line, card.oracle_text].filter(Boolean).join('\n\n');
          return (
            <div
              key={`${card.name.toLowerCase()}-${index}`}
              title={tip || card.name}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                padding: 4,
                borderRadius: 4,
                background: 'transparent',
              }}
            >
              {thumb ? (
                <img
                  src={thumb}
                  alt=""
                  width={40}
                  height={56}
                  loading="lazy"
                  style={{
                    width: 40,
                    height: 56,
                    objectFit: 'cover',
                    borderRadius: 3,
                    flexShrink: 0,
                    background: '#111',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 40,
                    height: 56,
                    borderRadius: 3,
                    background: '#222',
                    flexShrink: 0,
                    border: '1px solid #333',
                  }}
                />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.25, wordBreak: 'break-word' }}>
                  {card.name}
                </div>
                {card.type_line && (
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2, lineHeight: 1.3 }}>
                    {card.type_line}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

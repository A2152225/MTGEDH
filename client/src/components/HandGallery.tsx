import React, { useRef } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

type HandCard = {
  id: string;
  name?: string;
  type_line?: string;
  image_uris?: KnownCardRef['image_uris'];
  faceDown?: boolean;
};

export function HandGallery(props: {
  cards: HandCard[];
  imagePref: ImagePref;
  onPlayLand: (cardId: string) => void;
  onCast: (cardId: string) => void;
  reasonCannotPlayLand: (card: HandCard) => string | null;
  reasonCannotCast: (card: HandCard) => string | null;
  thumbWidth?: number;  // default 110
  zoomScale?: number;   // default 1 (no tile growth; rely on overlay preview)
}) {
  const {
    cards,
    imagePref,
    onPlayLand,
    onCast,
    reasonCannotPlayLand,
    reasonCannotCast,
    thumbWidth = 110,
    zoomScale = 1,
  } = props;

  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${thumbWidth}px, 1fr))`, gap: 8 }}>
      {cards.map((c, idx) => {
        const localKey = `${c.id}-${idx}`;
        const tl = (c.type_line || '').toLowerCase();
        const isLand = /\bland\b/.test(tl);
        const cannotPlay = isLand ? (reasonCannotPlayLand(c) || null) : null;
        const cannotCast = !isLand ? (reasonCannotCast(c) || null) : null;

        const img =
          c.image_uris?.[imagePref] ||
          c.image_uris?.normal ||
          c.image_uris?.small;

        return (
          <div
            key={localKey}
            ref={(el) => {
              if (el) itemRefs.current.set(localKey, el);
              else itemRefs.current.delete(localKey);
            }}
            onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, c, { prefer: 'above', anchorPadding: 0 })}
            onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
            style={{
              position: 'relative',
              width: thumbWidth,
              aspectRatio: '0.72',
              overflow: 'visible',
              border: '1px solid #2b2b2b',
              borderRadius: 8,
              background: '#111',
              margin: '0 auto',
              transform: `scale(${zoomScale})`,
              transition: 'transform 120ms ease',
            }}
            title={c.name || c.id}
          >
            {img ? (
              <img
                src={img}
                alt={c.name || c.id}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  borderRadius: 8,
                }}
              />
            ) : (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#eee',
                  borderRadius: 8,
                  background: 'linear-gradient(180deg, #2a2a2a, #1a1a1a)',
                }}
              >
                <div style={{ fontSize: 12, padding: '0 6px', textAlign: 'center' }}>{c.name || 'Card'}</div>
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>{c.type_line || ''}</div>
              </div>
            )}

            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                padding: '6px 8px',
                fontSize: 11,
                color: '#fff',
                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                borderBottomLeftRadius: 8,
                borderBottomRightRadius: 8,
                zIndex: 2,
                pointerEvents: 'none',
              }}
            >
              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.name || 'Card'}
              </div>
            </div>

            <div
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                display: 'flex',
                gap: 6,
                zIndex: 3,
              }}
            >
              {isLand ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onPlayLand(c.id); }}
                  disabled={!!cannotPlay}
                  title={cannotPlay || 'Play land'}
                  style={{ padding: '2px 6px', fontSize: 11, borderRadius: 6 }}
                >
                  Play
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onCast(c.id); }}
                  disabled={!!cannotCast}
                  title={cannotCast || 'Cast'}
                  style={{ padding: '2px 6px', fontSize: 11, borderRadius: 6 }}
                >
                  Cast
                </button>
              )}
            </div>
          </div>
        );
      })}
      {cards.length === 0 && <div style={{ opacity: 0.6, color: '#ccc' }}>Empty</div>}
    </div>
  );
}
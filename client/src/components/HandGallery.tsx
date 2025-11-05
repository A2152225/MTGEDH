import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function buildOccurrenceKeys(cards: HandCard[]): string[] {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  for (const c of cards) {
    const n = (counts.get(c.id) ?? 0) + 1;
    counts.set(c.id, n);
    keys.push(`${c.id}#${n}`);
  }
  return keys;
}

type Layout = 'grid' | 'row' | 'wrap2';

export function HandGallery(props: {
  cards: HandCard[];
  imagePref: ImagePref;
  onPlayLand: (cardId: string) => void;
  onCast: (cardId: string) => void;
  reasonCannotPlayLand: (card: HandCard) => string | null;
  reasonCannotCast: (card: HandCard) => string | null;
  thumbWidth?: number;  // default 110
  zoomScale?: number;   // default 1
  enableReorder?: boolean;
  onReorder?: (order: number[]) => void; // order[i] = old index at new index i
  layout?: Layout;           // 'wrap2' => wrap into up to two rows
  overlapPx?: number;        // for layout='row', negative spacing (overlap), default 0
  rowGapPx?: number;         // gap between cards when not overlapping, default 8
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
    enableReorder = false,
    onReorder,
    layout = 'wrap2',
    overlapPx = 0,
    rowGapPx = 8
  } = props;

  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());

  const incomingKeys = useMemo(() => buildOccurrenceKeys(cards), [cards]);
  const [orderKeys, setOrderKeys] = useState<string[]>(incomingKeys);

  useEffect(() => { setOrderKeys(incomingKeys); }, [incomingKeys]);

  const keyToCard = useMemo(() => {
    const map = new Map<string, HandCard>();
    const counts = new Map<string, number>();
    for (const c of cards) {
      const n = (counts.get(c.id) ?? 0) + 1;
      counts.set(c.id, n);
      const key = `${c.id}#${n}`;
      map.set(key, c);
    }
    return map;
  }, [cards]);

  const orderedCards: HandCard[] = useMemo(() => {
    const arr: HandCard[] = [];
    for (const k of orderKeys) {
      const c = keyToCard.get(k);
      if (c) arr.push(c);
    }
    return arr;
  }, [orderKeys, keyToCard]);

  const dragKeyRef = useRef<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const commitServerOrder = (nextKeys: string[]) => {
    if (!onReorder) return;
    const order: number[] = [];
    for (let i = 0; i < nextKeys.length; i++) {
      const k = nextKeys[i];
      const oldIdx = incomingKeys.indexOf(k);
      order.push(oldIdx);
    }
    onReorder(order);
  };

  const onDragStart = (key: string, ev: React.DragEvent) => {
    if (!enableReorder) return;
    dragKeyRef.current = key;
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', key); } catch {}
  };
  const onDragOver = (ev: React.DragEvent) => {
    if (!enableReorder) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
  };
  const onDropOn = (targetKey: string, ev: React.DragEvent) => {
    if (!enableReorder) return;
    ev.preventDefault();
    const fromKey = dragKeyRef.current || (() => {
      try { return ev.dataTransfer.getData('text/plain'); } catch { return null; }
    })();
    if (!fromKey || fromKey === targetKey) return;
    setOrderKeys(prev => {
      const arr = prev.slice();
      const fromIdx = arr.indexOf(fromKey);
      const toIdx = arr.indexOf(targetKey);
      if (fromIdx < 0 || toIdx < 0) return prev;
      arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, fromKey);
      commitServerOrder(arr);
      return arr;
    });
    dragKeyRef.current = null;
  };

  const isRow = layout === 'row';
  const isWrap2 = layout === 'wrap2';

  const containerStyle: React.CSSProperties = isRow
    ? { display: 'flex', alignItems: 'flex-start', gap: overlapPx > 0 ? 0 : rowGapPx, overflowX: 'auto', paddingBottom: 4 }
    : isWrap2
      ? {
          display: 'flex',
          flexWrap: 'wrap',
          gap: rowGapPx,
          maxHeight: `calc(${(thumbWidth / 0.72).toFixed(0)}px * 2 + ${rowGapPx}px)`,
          overflowY: 'auto'
        }
      : { display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${thumbWidth}px, 1fr))`, gap: 8 };

  return (
    <div style={containerStyle}>
      {orderedCards.map((c, viewIdx) => {
        let occ = 0;
        for (let i = 0; i <= viewIdx; i++) {
          if (orderedCards[i].id === c.id) occ++;
        }
        const key = `${c.id}#${occ}`;
        const tl = (c.type_line || '').toLowerCase();
        const isLand = /\bland\b/.test(tl);
        const cannotPlay = isLand ? (reasonCannotPlayLand(c) || null) : null;
        const cannotCast = !isLand ? (reasonCannotCast(c) || null) : null;

        const img =
          c.image_uris?.[imagePref] ||
          c.image_uris?.normal ||
          c.image_uris?.small;

        const zIndex = hoverKey === key ? 2 : 1;

        return (
          <div
            key={key}
            ref={(el) => {
              if (el) itemRefs.current.set(key, el);
              else itemRefs.current.delete(key);
            }}
            onMouseEnter={(e) => { setHoverKey(key); showCardPreview(e.currentTarget as HTMLElement, c, { prefer: 'above', anchorPadding: 0 }); }}
            onMouseLeave={(e) => { setHoverKey(prev => (prev === key ? null : prev)); hideCardPreview(e.currentTarget as HTMLElement); }}
            draggable={enableReorder}
            onDragStart={(e) => onDragStart(key, e)}
            onDragOver={onDragOver}
            onDrop={(e) => onDropOn(key, e)}
            style={{
              position: 'relative',
              width: thumbWidth,
              aspectRatio: '0.72',
              overflow: 'visible',
              border: '1px solid #2b2b2b',
              borderRadius: 8,
              background: '#111',
              marginLeft: isRow && overlapPx > 0 && viewIdx > 0 ? -overlapPx : undefined,
              transform: `scale(${zoomScale})`,
              transition: 'transform 120ms ease',
              cursor: enableReorder ? 'grab' : 'default',
              zIndex
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
                  userSelect: 'none',
                  pointerEvents: 'none'
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

            {/* Controls shown only on hover */}
            {hoverKey === key && (
              <div
                style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 6, zIndex: 3 }}
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
            )}
          </div>
        );
      })}
      {cards.length === 0 && <div style={{ opacity: 0.6, color: '#ccc' }}>Empty</div>}
    </div>
  );
}
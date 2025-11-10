import React, { useMemo, useState } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

function canonicalLandKey(typeLine?: string, name?: string) {
  const tl = (typeLine || '').toLowerCase();
  if (/\bplains\b/.test(tl)) return 'plains';
  if (/\bisland\b/.test(tl)) return 'island';
  if (/\bswamp\b/.test(tl)) return 'swamp';
  if (/\bmountain\b/.test(tl)) return 'mountain';
  if (/\bforest\b/.test(tl)) return 'forest';
  if (/\bwastes\b/.test(tl)) return 'wastes';
  return (name || '').toLowerCase() || 'land';
}

export function LandRow(props: {
  lands: BattlefieldPermanent[];
  imagePref: ImagePref;
  tileWidth?: number;     // default 110
  overlapRatio?: number;  // consecutive same-type overlap (0..1), default 0.33 (33%)
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onCardClick?: (id: string) => void;
  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
}) {
  const {
    lands,
    imagePref,
    tileWidth = 110,
    overlapRatio = 0.33,
    highlightTargets,
    selectedTargets,
    onCardClick,
    onRemove,
    onCounter
  } = props;

  const items = useMemo(() => lands.map(p => {
    const kc = p.card as KnownCardRef;
    return {
      id: p.id,
      name: kc?.name || p.id,
      typeLine: kc?.type_line || '',
      img: kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small,
      tapped: !!p.tapped,
      counters: p.counters || {},
      key: canonicalLandKey(kc?.type_line, kc?.name)
    };
  }), [lands, imagePref]);

  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, overflowX: 'auto', paddingBottom: 4, overscrollBehavior: 'contain' as any }}
      data-no-zoom
      onWheel={(e) => e.stopPropagation()}
    >
      {items.map((it, idx) => {
        const prev = items[idx - 1];
        const sameTypeAsPrev = prev && prev.key === it.key;
        const overlapPx = sameTypeAsPrev ? Math.floor(tileWidth * overlapRatio) : 0;

        const isHighlight = highlightTargets?.has(it.id) ?? false;
        const isSelected = selectedTargets?.has(it.id) ?? false;
        const isHovered = hovered === it.id;

        const baseBorder = isSelected ? '#2b6cb0' : isHighlight ? '#38a169' : '#2b2b2b';
        const borderColor = isHovered && isHighlight && !isSelected ? '#2ecc71' : baseBorder;
        const boxShadow = isSelected
          ? '0 0 0 2px rgba(43,108,176,0.6)'
          : isHighlight
            ? '0 0 0 2px rgba(56,161,105,0.45)'
            : 'none';

        return (
          <div
            key={it.id}
            onMouseEnter={(e) => { setHovered(it.id); showCardPreview(e.currentTarget as HTMLElement, (lands[idx].card as any), { prefer: 'above', anchorPadding: 0 }); }}
            onMouseLeave={(e) => { setHovered(prev => prev === it.id ? null : prev); hideCardPreview(e.currentTarget as HTMLElement); }}
            onClick={onCardClick ? () => onCardClick(it.id) : undefined}
            style={{
              position: 'relative',
              width: tileWidth,
              aspectRatio: '0.72',
              overflow: 'hidden',
              border: `2px solid ${borderColor}`,
              borderRadius: 6,
              background: '#0f0f0f',
              transform: it.tapped ? 'rotate(14deg)' : 'none',
              marginLeft: overlapPx ? -overlapPx : undefined,
              boxShadow,
              cursor: onCardClick ? 'pointer' : 'default'
            }}
            title={it.name + (it.tapped ? ' (tapped)' : '')}
          >
            {it.img ? (
              <img src={it.img} alt={it.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eee', fontSize: 12, padding: 8 }}>
                {it.name}
              </div>
            )}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
              color: '#fff', fontSize: 12, padding: '6px 8px',
              borderBottomLeftRadius: 6, borderBottomRightRadius: 6
            }}>
              <div title={it.name} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
            </div>

            {/* Tapped badge */}
            {it.tapped && (
              <div style={{
                position: 'absolute',
                top: 6,
                left: 6,
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4
              }}>
                Tapped
              </div>
            )}

            {/* Controls only when hovered */}
            {isHovered && (onCounter || onRemove) && (
              <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                {onCounter && (<>
                  <button onClick={(e) => { e.stopPropagation(); onCounter!(it.id, '+1/+1', +1); }} title="+1/+1 +1">+1</button>
                  <button onClick={(e) => { e.stopPropagation(); onCounter!(it.id, '+1/+1', -1); }} title="+1/+1 -1">-1</button>
                </>)}
                {onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove!(it.id); }} title="Remove">✕</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
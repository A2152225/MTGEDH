import React, { useState } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export type ImagePref = 'small' | 'normal' | 'art_crop';

export function BattlefieldGrid(props: {
  perms: BattlefieldPermanent[];
  imagePref: ImagePref;
  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
  // Targeting support
  highlightTargets?: ReadonlySet<string>;   // permanent ids that are valid targets
  selectedTargets?: ReadonlySet<string>;    // permanent ids that are already selected
  onCardClick?: (id: string) => void;       // toggle choose
}) {
  const { perms, imagePref, onRemove, onCounter, highlightTargets, selectedTargets, onCardClick } = props;
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, position: 'relative' }}>
      {perms.map(p => {
        const kc = p.card as KnownCardRef;
        const img = kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small;
        const name = kc?.name || p.id;
        const counters = p.counters || {};
        const isHighlight = highlightTargets?.has(p.id) ?? false;
        const isSelected = selectedTargets?.has(p.id) ?? false;
        const isHovered = hovered === p.id;
		const isTapped = !!p.tapped;

        const baseBorder = isSelected ? '#2b6cb0' : isHighlight ? '#38a169' : '#ddd';
        const borderColor = isHovered && isHighlight && !isSelected ? '#2ecc71' : baseBorder;

        const baseShadow = isSelected
          ? '0 0 0 2px rgba(43,108,176,0.6)'
          : isHighlight
            ? '0 0 0 2px rgba(56,161,105,0.45)'
            : 'none';
        const boxShadow = isHovered && isHighlight && !isSelected ? '0 0 0 3px rgba(46,204,113,0.5)' : baseShadow;

        return (
          <div
            key={p.id}
            data-perm-id={p.id}
            onMouseEnter={(e) => {
              setHovered(p.id);
              // Prefer preview above the tile to keep tile controls visible
              showCardPreview(e.currentTarget as HTMLElement, p.card as any, { prefer: 'above', anchorPadding: 0 });
            }}
            onMouseLeave={(e) => { setHovered(null); hideCardPreview(e.currentTarget as HTMLElement); }}
            onClick={onCardClick ? () => onCardClick(p.id) : undefined}
            style={{
              position: 'relative',
              border: `2px solid ${borderColor}`,
              borderRadius: 6,
              overflow: 'hidden',
              background: '#f6f6f6',
              cursor: onCardClick ? 'pointer' : 'default',
              boxShadow,
			  transform: isTapped ? 'rotate(14deg)' : 'none',
			  transformOrigin: '50% 50%',
              transition: 'box-shadow 120ms ease, border-color 120ms ease',
            }}
            title={`${name}${isTapped ? ' (tapped)' : ''}`}
          >
            {img ? (
              <img src={img} alt={name} style={{ width: '100%', display: 'block', aspectRatio: '0.72', objectFit: 'cover' }} />
            ) : (
              <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, padding: 8 }}>{name}</div>
            )}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.6))', color: '#fff', fontSize: 12, padding: '6px 8px' }}>
              <div title={name} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
              {Object.keys(counters).length > 0 && (
                <div style={{ marginTop: 2 }}>
                  {Object.entries(counters).map(([k, v]) => <span key={k} style={{ marginRight: 8 }}>{k}:{v}</span>)}
                </div>
              )}
            </div>
			 {isTapped && (
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
            {(onCounter || onRemove) && (
              <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                {onCounter && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); onCounter(p.id, '+1/+1', +1); }} title="+1/+1 +1">+1</button>
                    <button onClick={(e) => { e.stopPropagation(); onCounter(p.id, '+1/+1', -1); }} title="+1/+1 -1">-1</button>
                  </>
                )}
                {onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove(p.id); }} title="Remove">✕</button>}
              </div>
            )}
            {(p as any).attachedTo && (
              <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, padding: '2px 4px', borderRadius: 4 }}>
                Attached
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
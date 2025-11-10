import React, { useState } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export type ImagePref = 'small' | 'normal' | 'art_crop';
type LayoutMode = 'grid' | 'row';

function parsePT(raw?: string): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return undefined;
}

function computeDisplayPT(perm: BattlefieldPermanent): {
  baseP?: number;
  baseT?: number;
  p?: number;
  t?: number;
} {
  // Prefer stored basePower/baseToughness from server,
  // else parse from card (for simple numeric P/T).
  const kc = perm.card as KnownCardRef;
  const baseP = typeof perm.basePower === 'number' ? perm.basePower : parsePT(kc?.power);
  const baseT = typeof perm.baseToughness === 'number' ? perm.baseToughness : parsePT(kc?.toughness);

  // If server provided effective stats (includes counters + continuous buffs), prefer them.
  const effP = (perm as any).effectivePower as number | undefined;
  const effT = (perm as any).effectiveToughness as number | undefined;

  if (typeof effP === 'number' && typeof effT === 'number') {
    return { baseP, baseT, p: effP, t: effT };
  }

  // Fallback: base + (+1/+1 -1/-1) counters only (client-side approximation).
  if (typeof baseP === 'number' && typeof baseT === 'number') {
    const plus = perm.counters?.['+1/+1'] ?? 0;
    const minus = perm.counters?.['-1/-1'] ?? 0;
    const delta = plus - minus;
    return { baseP, baseT, p: baseP + delta, t: baseT + delta };
  }

  return { baseP, baseT, p: undefined, t: undefined };
}

function ptBadgeColors(baseP?: number, baseT?: number, p?: number, t?: number): { bg: string; border: string } {
  if (typeof baseP === 'number' && typeof baseT === 'number' && typeof p === 'number' && typeof t === 'number') {
    const delta = (p - baseP) + (t - baseT);
    if (delta > 0) return { bg: 'rgba(56,161,105,0.85)', border: 'rgba(46,204,113,0.95)' }; // green
    if (delta < 0) return { bg: 'rgba(229,62,62,0.85)', border: 'rgba(245,101,101,0.95)' }; // red
  }
  return { bg: 'rgba(0,0,0,0.65)', border: 'rgba(255,255,255,0.25)' }; // neutral
}

const abilityLabelMap: Record<string, string> = {
  flying: 'F',
  indestructible: 'I',
  vigilance: 'V',
  trample: 'T',
  hexproof: 'H',
  shroud: 'S',
};

export function BattlefieldGrid(props: {
  perms: BattlefieldPermanent[];
  imagePref: ImagePref;
  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
  // Targeting support
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onCardClick?: (id: string) => void;
  // Layout controls
  layout?: LayoutMode;
  tileWidth?: number;     // default 110
  rowOverlapPx?: number;  // for layout='row'; default 0
  gapPx?: number;         // grid gap; default 10
}) {
  const {
    perms, imagePref, onRemove, onCounter,
    highlightTargets, selectedTargets, onCardClick,
    layout = 'grid',
    tileWidth,
    rowOverlapPx = 0,
    gapPx = 10
  } = props;

  const [hovered, setHovered] = useState<string | null>(null);

  const tw = typeof tileWidth === 'number'
    ? Math.max(60, Math.min(220, tileWidth | 0))
    : 110;

  const isRow = layout === 'row';

  return (
    <div
      style={
        isRow
          ? {
              display: 'flex',
              alignItems: 'flex-start',
              gap: rowOverlapPx > 0 ? 0 : 8,
              overflowX: 'auto',
              paddingBottom: 4
            }
          : {
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(${tw}px, 1fr))`,
              gap: gapPx,
              position: 'relative'
            }
      }
    >
      {perms.map((p, idx) => {
        const kc = p.card as KnownCardRef;
        const img = kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small;
        const name = kc?.name || p.id;
        const counters = p.counters || {};
        const isHighlight = highlightTargets?.has(p.id) ?? false;
        const isSelected = selectedTargets?.has(p.id) ?? false;
        const isHovered = hovered === p.id;
        const isTapped = !!p.tapped;

        const baseBorder = isSelected ? '#2b6cb0' : isHighlight ? '#38a169' : '#2b2b2b';
        const borderColor = isHovered && isHighlight && !isSelected ? '#2ecc71' : baseBorder;

        const baseShadow = isSelected
          ? '0 0 0 2px rgba(43,108,176,0.6)'
          : isHighlight
            ? '0 0 0 2px rgba(56,161,105,0.45)'
            : 'none';
        const boxShadow = isHovered && isHighlight && !isSelected ? '0 0 0 3px rgba(46,204,113,0.5)' : baseShadow;

        const tl = (kc?.type_line || '').toLowerCase();
        const isCreature = /\bcreature\b/.test(tl);

        const { baseP, baseT, p: dispP, t: dispT } = computeDisplayPT(p);
        const colors = ptBadgeColors(baseP, baseT, dispP, dispT);

        const grantedAbilities: readonly string[] | undefined = (p as any).grantedAbilities;

        return (
          <div
            key={p.id}
            data-perm-id={p.id}
            onMouseEnter={(e) => {
              setHovered(p.id);
              showCardPreview(e.currentTarget as HTMLElement, p.card as any, { prefer: 'above', anchorPadding: 0 });
            }}
            onMouseLeave={(e) => { setHovered(null); hideCardPreview(e.currentTarget as HTMLElement); }}
            onClick={onCardClick ? () => onCardClick(p.id) : undefined}
            style={{
              position: 'relative',
              width: tw,
              aspectRatio: '0.72',
              overflow: 'hidden',
              background: '#0f0f0f',
              cursor: onCardClick ? 'pointer' : 'default',
              border: `2px solid ${borderColor}`,
              borderRadius: 6,
              boxShadow,
              transform: isTapped ? 'rotate(14deg)' : 'none',
              transformOrigin: '50% 50%',
              transition: 'box-shadow 120ms ease, border-color 120ms ease',
              marginLeft: isRow && rowOverlapPx > 0 && idx > 0 ? -rowOverlapPx : undefined
            }}
            title={`${name}${isTapped ? ' (tapped)' : ''}`}
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
              }}>
                {name}
              </div>
            )}

            {/* Abilities badges (from continuous effects) */}
            {Array.isArray(grantedAbilities) && grantedAbilities.length > 0 && (
              <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                {grantedAbilities.map((a) => {
                  const label = abilityLabelMap[a.toLowerCase()] || a[0]?.toUpperCase() || '?';
                  return (
                    <span key={a} title={a} style={{
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      border: '1px solid #555',
                      borderRadius: 4,
                      fontSize: 10,
                      padding: '2px 4px',
                      lineHeight: '10px'
                    }}>{label}</span>
                  );
                })}
              </div>
            )}

            {/* Name / counters ribbon */}
            <div style={{
              position: 'absolute',
              left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
              color: '#fff',
              fontSize: 12,
              padding: '6px 8px',
              borderBottomLeftRadius: 6,
              borderBottomRightRadius: 6,
              pointerEvents: 'none'
            }}>
              <div title={name} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
              {Object.keys(counters).length > 0 && (
                <div style={{ marginTop: 2 }}>
                  {Object.entries(counters).map(([k, v]) => <span key={k} style={{ marginRight: 8 }}>{k}:{v as number}</span>)}
                </div>
              )}
            </div>

            {/* P/T overlay for creatures with color-coded delta vs base */}
            {isCreature && typeof dispP === 'number' && typeof dispT === 'number' && (
              <div style={{
                position: 'absolute',
                right: 6,
                bottom: 26,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 2
              }}>
                <div style={{
                  padding: '2px 6px',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6
                }}>
                  {dispP}/{dispT}
                </div>
                {(typeof baseP === 'number' && typeof baseT === 'number') && (
                  <div style={{ fontSize: 10, color: '#ddd', opacity: 0.9 }}>
                    base {baseP}/{baseT}
                  </div>
                )}
              </div>
            )}

            {/* Tapped badge */}
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

            {/* Attached badge */}
            {(p as any).attachedTo && (
              <div style={{
                position: 'absolute',
                top: 6,
                left: 6,
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                fontSize: 10,
                padding: '2px 4px',
                borderRadius: 4
              }}>
                Attached
              </div>
            )}

            {/* Controls (only on hover) */}
            {isHovered && (onCounter || onRemove) && (
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
          </div>
        );
      })}
      {perms.length === 0 && <div style={{ opacity: 0.6, color: '#ccc' }}>Empty</div>}
    </div>
  );
}
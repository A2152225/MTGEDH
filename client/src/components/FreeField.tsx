import React, { useMemo, useRef, useState } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

function parsePT(raw?: string): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return undefined;
}
function ptBadgeColors(delta: number): { bg: string; border: string } {
  if (delta > 0) return { bg: 'rgba(56,161,105,0.85)', border: 'rgba(46,204,113,0.95)' };
  if (delta < 0) return { bg: 'rgba(229,62,62,0.85)', border: 'rgba(245,101,101,0.95)' };
  return { bg: 'rgba(0,0,0,0.65)', border: 'rgba(255,255,255,0.25)' };
}

export function FreeField(props: {
  perms: BattlefieldPermanent[];
  imagePref: ImagePref;
  tileWidth: number;
  widthPx: number;
  heightPx: number;
  draggable?: boolean;
  onMove?: (id: string, x: number, y: number, z?: number) => void;
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onCardClick?: (id: string) => void;
}) {
  const {
    perms, imagePref, tileWidth, widthPx, heightPx,
    draggable = false, onMove, highlightTargets, selectedTargets, onCardClick
  } = props;

  const tileH = Math.round(tileWidth / 0.72);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; baseX: number; baseY: number; z?: number } | null>(null);

  // Auto placement for those without pos
  const items = useMemo(() => {
    const gap = 10;
    const cols = Math.max(1, Math.floor((widthPx + gap) / (tileWidth + gap)));
    let autoIndex = 0;
    function nextAuto() {
      const i = autoIndex++;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = Math.min(widthPx - tileWidth, col * (tileWidth + gap));
      const y = Math.min(heightPx - tileH, row * (tileH + gap));
      return { x, y };
    }
    return perms.map(p => {
      const kc = p.card as KnownCardRef;
      const img = kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small || null;
      const name = kc?.name || p.id;
      const tl = (kc?.type_line || '').toLowerCase();
      const isCreature = /\bcreature\b/.test(tl);
      const baseP = typeof p.basePower === 'number' ? p.basePower : parsePT(kc?.power);
      const baseT = typeof p.baseToughness === 'number' ? p.baseToughness : parsePT(kc?.toughness);
      const pos = (p as any).pos || nextAuto();
      return { id: p.id, p, kc, img, name, isCreature, baseP, baseT, pos, counters: p.counters || {}, tapped: p.tapped };
    });
  }, [perms, imagePref, tileWidth, tileH, widthPx, heightPx]);

  const onPointerDown = (id: string, e: React.PointerEvent) => {
    if (!draggable) return;
    const it = items.find(x => x.id === id);
    if (!it) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, startX: e.clientX, startY: e.clientY, baseX: it.pos.x, baseY: it.pos.y, z: (it.pos as any).z };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    e.preventDefault();
  };
  const onPointerUp = (id: string, e: React.PointerEvent) => {
    if (!drag.current) return;
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    let nx = Math.round(drag.current.baseX + dx);
    let ny = Math.round(drag.current.baseY + dy);
    nx = clamp(nx, 0, Math.max(0, widthPx - tileWidth));
    ny = clamp(ny, 0, Math.max(0, heightPx - tileH));
    const bumpZ = e.altKey ? ((drag.current.z ?? 0) + 1) : drag.current.z;
    onMove && onMove(drag.current.id, nx, ny, bumpZ);
    drag.current = null;
  };
  function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

  return (
    <div style={{
      position: 'relative',
      width: widthPx,
      height: heightPx,
      border: '1px dashed rgba(255,255,255,0.15)',
      borderRadius: 8,
      background: 'rgba(0,0,0,0.25)',
      overflow: 'hidden'
    }}>
      {items.map(it => {
        const { id, img, name, isCreature, baseP, baseT, counters, tapped } = it;
        const x = clamp(it.pos.x, 0, Math.max(0, widthPx - tileWidth));
        const y = clamp(it.pos.y, 0, Math.max(0, heightPx - tileH));
        const isHighlight = highlightTargets?.has(id) ?? false;
        const isSelected = selectedTargets?.has(id) ?? false;
        const borderColor = isSelected ? '#2b6cb0' : isHighlight ? '#38a169' : '#2b2b2b';

        const plus = counters['+1/+1'] ?? 0;
        const minus = counters['-1/-1'] ?? 0;
        const delta = (typeof baseP === 'number' && typeof baseT === 'number') ? (plus - minus) : 0;
        const pt = (typeof baseP === 'number' && typeof baseT === 'number') ? { p: baseP + delta, t: baseT + delta, delta } : null;
        const colors = pt ? ptBadgeColors(pt.delta) : null;
        const hovered = hoverId === id;

        return (
          <div
            key={id}
            onPointerDown={(e) => onPointerDown(id, e)}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerUp(id, e)}
            onMouseEnter={(e) => { setHoverId(id); showCardPreview(e.currentTarget as HTMLElement, it.kc as any, { prefer: 'above', anchorPadding: 0 }); }}
            onMouseLeave={(e) => { setHoverId(prev => prev === id ? null : prev); hideCardPreview(e.currentTarget as HTMLElement); }}
            onClick={() => onCardClick && onCardClick(id)}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: tileWidth,
              aspectRatio: '0.72',
              userSelect: 'none',
              touchAction: 'none',
              zIndex: 10 + (hovered ? 50 : 0),
              cursor: draggable ? 'grab' : (onCardClick ? 'pointer' : 'default'),
              border: `2px solid ${borderColor}`,
              borderRadius: 6,
              overflow: 'hidden',
              background: '#0f0f0f',
              transform: tapped ? 'rotate(14deg)' : 'none',
              transformOrigin: '50% 50%'
            }}
            title={name + (tapped ? ' (tapped)' : '')}
          >
            {img ? (
              <img src={img} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eee', fontSize: 12, padding: 8 }}>
                {name}
              </div>
            )}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
              color: '#fff', fontSize: 12, padding: '6px 8px',
              borderBottomLeftRadius: 6, borderBottomRightRadius: 6, pointerEvents: 'none'
            }}>
              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
            </div>
            {isCreature && pt && (
              <div style={{
                position: 'absolute', right: 6, bottom: 26,
                padding: '2px 6px', fontSize: 12, fontWeight: 700, color: '#fff',
                background: colors!.bg, border: `1px solid ${colors!.border}`, borderRadius: 6
              }}>
                {pt.p}/{pt.t}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
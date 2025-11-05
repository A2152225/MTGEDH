import React, { useRef, useState } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

// Absolute-positioned battlefield area with draggable cards (for your permanents).
export function FreeField(props: {
  perms: BattlefieldPermanent[];
  imagePref: ImagePref;
  tileWidth: number;
  widthPx: number;
  heightPx: number;
  draggable?: boolean;
  onMove?: (id: string, x: number, y: number, z?: number) => void; // send to server
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onCardClick?: (id: string) => void;
}) {
  const {
    perms, imagePref, tileWidth, widthPx, heightPx,
    draggable = false, onMove, highlightTargets, selectedTargets, onCardClick
  } = props;

  const tileH = Math.round(tileWidth / 0.72);
  const [drag, setDrag] = useState<{ id: string; ox: number; oy: number; sx: number; sy: number; z?: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const startDrag = (id: string, e: React.PointerEvent, z?: number) => {
    if (!draggable) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pos = ((perms.find(p => p.id === id) as any)?.pos) || { x: 8, y: 8 };
    setDrag({ id, ox: pos.x, oy: pos.y, sx: e.clientX, sy: e.clientY, z });
  };
  const onMovePtr = (e: React.PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    const nx = clamp(Math.round(drag.ox + dx), 0, Math.max(0, widthPx - tileWidth));
    const ny = clamp(Math.round(drag.oy + dy), 0, Math.max(0, heightPx - tileH));
    setDrag({ ...drag, ox: nx, oy: ny, sx: e.clientX, sy: e.clientY });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
    const nx = drag.ox;
    const ny = drag.oy;
    const bumpZ = e.altKey ? ((drag.z ?? 0) + 1) : drag.z;
    onMove && onMove(drag.id, nx, ny, bumpZ);
    setDrag(null);
  };

  return (
    <div
      style={{
        position: 'relative',
        width: widthPx,
        height: heightPx,
        border: '1px dashed rgba(255,255,255,0.15)',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.25)',
        overflow: 'hidden'
      }}
      data-no-zoom
      onWheel={(e) => e.stopPropagation()}
    >
      {perms.map((p) => {
        const kc = p.card as KnownCardRef;
        const img = kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small;
        const name = kc?.name || p.id;
        const pos = (p as any).pos || null;
        const tl = (kc?.type_line || '').toLowerCase();
        const isCreature = /\bcreature\b/.test(tl);
        const counters = p.counters || {};
        const isHighlight = highlightTargets?.has(p.id) ?? false;
        const isSelected = selectedTargets?.has(p.id) ?? false;

        // current PT
        const plus = counters['+1/+1'] ?? 0;
        const minus = counters['-1/-1'] ?? 0;
        const baseP = typeof (p as any).basePower === 'number' ? (p as any).basePower : undefined;
        const baseT = typeof (p as any).baseToughness === 'number' ? (p as any).baseToughness : undefined;
        const pt = baseP !== undefined && baseT !== undefined ? { p: baseP + (plus - minus), t: baseT + (plus - minus) } : null;

        const x = pos?.x ?? 8;
        const y = pos?.y ?? 8;
        const z = pos?.z ?? 0;

        const hovered = hoverId === p.id;
        const borderColor = (isSelected ? '#2b6cb0' : (isHighlight ? '#38a169' : '#2b2b2b'));

        return (
          <div
            key={p.id}
            onPointerDown={(e) => startDrag(p.id, e, z)}
            onPointerMove={onMovePtr}
            onPointerUp={endDrag}
            onMouseEnter={(e) => { setHoverId(p.id); showCardPreview(e.currentTarget as HTMLElement, p.card as any, { prefer: 'above', anchorPadding: 0 }); }}
            onMouseLeave={(e) => { setHoverId(prev => prev === p.id ? null : prev); hideCardPreview(e.currentTarget as HTMLElement); }}
            onClick={() => onCardClick && onCardClick(p.id)}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: tileWidth,
              aspectRatio: '0.72',
              userSelect: 'none',
              touchAction: 'none',
              zIndex: 10 + z + (hovered ? 100 : 0),
              cursor: draggable ? 'grab' : (onCardClick ? 'pointer' : 'default'),
              border: `2px solid ${borderColor}`,
              borderRadius: 6,
              overflow: 'hidden',
              background: '#0f0f0f',
              transform: p.tapped ? 'rotate(14deg)' : 'none',
              transformOrigin: '50% 50%'
            }}
            title={name + (p.tapped ? ' (tapped)' : '')}
          >
            {img ? (
              <img src={img} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eee', fontSize: 12, padding: 8 }}>
                {name}
              </div>
            )}
            {/* name ribbon */}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
              color: '#fff', fontSize: 12, padding: '6px 8px',
              borderBottomLeftRadius: 6, borderBottomRightRadius: 6, pointerEvents: 'none'
            }}>
              <div title={name} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
            </div>
            {/* PT overlay */}
            {isCreature && pt && (
              <div style={{
                position: 'absolute', right: 6, bottom: 26,
                padding: '2px 6px', fontSize: 12, fontWeight: 700, color: '#fff',
                background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 6
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
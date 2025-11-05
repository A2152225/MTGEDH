import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BattlefieldPermanent, PlayerRef, PlayerID, PlayerZones, CommanderInfo } from '../../../shared/src';
import { BattlefieldGrid, type ImagePref } from './BattlefieldGrid';
import { TokenGroups } from './TokenGroups';
import { AttachmentLines } from './AttachmentLines';
import { HandGallery } from './HandGallery';
import { LandRow } from './LandRow';
import { ZonesPiles } from './ZonesPiles';
import { FreeField } from './FreeField';

type PlayerBoard = {
  player: PlayerRef;
  permanents: BattlefieldPermanent[];
};

function isLandTypeLine(tl?: string) {
  return /\bland\b/i.test(tl || '');
}

function polarPos(index: number, total: number, radius: number, startAngleRad = Math.PI / 2) {
  const angle = startAngleRad + (index / total) * 2 * Math.PI;
  const x = radius * Math.cos(angle);
  const y = radius * Math.sin(angle);
  const rotateDeg = (angle * 180) / Math.PI + 90;
  return { x, y, rotateDeg };
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

export function TableLayout(props: {
  players: PlayerRef[];
  permanentsByPlayer: Map<PlayerID, BattlefieldPermanent[]>;
  imagePref: ImagePref;
  isYouPlayer: boolean;

  splitLands?: boolean;
  enableReorderForYou?: boolean;

  you?: PlayerID | null;
  zones?: Record<PlayerID, PlayerZones>;
  commandZone?: Record<PlayerID, CommanderInfo>;
  format?: string;
  showYourHandBelow?: boolean;

  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
  onBulkCounter?: (ids: string[], deltas: Record<string, number>) => void;

  highlightPermTargets?: ReadonlySet<string>;
  selectedPermTargets?: ReadonlySet<string>;
  onPermanentClick?: (id: string) => void;
  highlightPlayerTargets?: ReadonlySet<string>;
  selectedPlayerTargets?: ReadonlySet<string>;
  onPlayerClick?: (playerId: string) => void;

  onPlayLandFromHand?: (cardId: string) => void;
  onCastFromHand?: (cardId: string) => void;
  reasonCannotPlayLand?: (card: { type_line?: string }) => string | null;
  reasonCannotCast?: (card: { type_line?: string }) => string | null;

  onReorderHand?: (order: number[]) => void;
  onShuffleHand?: () => void;

  threeD?: { enabled: boolean; rotateXDeg: number; rotateYDeg: number; perspectivePx?: number };
  enablePanZoom?: boolean;
  tableCloth?: { imageUrl?: string; color?: string };
  worldSize?: number;
  onUpdatePermPos?: (id: string, x: number, y: number, z?: number) => void;
}) {
  const {
    players, permanentsByPlayer, imagePref, isYouPlayer,
    splitLands = true, enableReorderForYou = false,
    you, zones, commandZone, format, showYourHandBelow = true,
    onRemove, onCounter, onBulkCounter,
    highlightPermTargets, selectedPermTargets, onPermanentClick,
    highlightPlayerTargets, selectedPlayerTargets, onPlayerClick,
    onPlayLandFromHand, onCastFromHand, reasonCannotPlayLand, reasonCannotCast,
    onReorderHand, onShuffleHand,
    threeD,
    enablePanZoom = true,
    tableCloth,
    worldSize,
    onUpdatePermPos
  } = props;

  const ordered = useMemo<PlayerBoard[]>(() => {
    const ps = [...players].sort((a, b) => a.seat - b.seat);
    const idxYou = you ? ps.findIndex(p => p.id === you) : -1;
    const rotated = idxYou >= 0 ? [...ps.slice(idxYou), ...ps.slice(0, idxYou)] : ps;
    return rotated.map(p => ({ player: p, permanents: permanentsByPlayer.get(p.id) || [] }));
  }, [players, permanentsByPlayer, you]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<{ w: number; h: number }>({ w: 1200, h: 800 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (cr) setContainer({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setContainer({ w: rect.width, h: rect.height });
    return () => ro.disconnect();
  }, []);

  // Camera state and “Space to pan” toggle
  const [cam, setCam] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 1 });
  const dragRef = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number; active: boolean } | null>(null);
  const [panKey, setPanKey] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space') setPanKey(true); };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setPanKey(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Auto-fit once on first render or when seat count changes
  const didFit = useRef(false);
  useEffect(() => {
    if (!container.w || !container.h) return;
    if (didFit.current) return;
    // compute fit
    const total = Math.max(ordered.length, 1);
    const TILE_W = 110;
    const tileH = Math.round(TILE_W / 0.72);
    const ZONES_W = 96;
    const CONTENT_W = 6 * TILE_W + 5 * 10 + 16;
    const BOARD_W = CONTENT_W + ZONES_W + 24;
    const BOARD_H = Math.round(3 * tileH + 220); // approx height
    const minGap = 40;
    const denom = total > 1 ? Math.sin(Math.PI / total) : 1;
    const radius = Math.max(1800, denom > 0 ? (BOARD_W + minGap) / (2 * denom) : 0);
    const R_x = radius + BOARD_W / 2 + 40;
    const R_y = radius + BOARD_H / 2 + 40;
    const margin = 40;
    const zx = (container.w / 2 - margin) / R_x;
    const zy = (container.h / 2 - margin) / R_y;
    const fitZ = Math.max(0.2, Math.min(2.0, Math.min(zx, zy)));
    setCam({ x: 0, y: 0, z: fitZ });
    didFit.current = true;
  }, [container.w, container.h, ordered.length]);

  const onWheel = (e: React.WheelEvent) => {
    if (!enablePanZoom) return;
    const el = e.target as HTMLElement;
    if (el && el.closest('[data-no-zoom]')) return;
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const cx = container.w / 2;
    const cy = container.h / 2;

    const wx = cam.x + (sx - cx) / cam.z;
    const wy = cam.y + (sy - cy) / cam.z;

    const factor = Math.exp(-e.deltaY * 0.0015);
    const newZ = clamp(cam.z * factor, 0.2, 2.0);

    const newCamX = wx - (sx - cx) / newZ;
    const newCamY = wy - (sy - cy) / newZ;

    setCam({ x: newCamX, y: newCamY, z: newZ });
  };

  const beginPan = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, active: true };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!enablePanZoom) return;
    const isPanButton = e.button === 1 || e.button === 2 || panKey;
    if (isPanButton) {
      e.preventDefault();
      beginPan(e);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!enablePanZoom || !d || !d.active || d.id !== e.pointerId) return;
    const dx = (e.clientX - d.sx) / cam.z;
    const dy = (e.clientY - d.sy) / cam.z;
    setCam(prev => ({ ...prev, x: d.cx - dx, y: d.cy - dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!enablePanZoom) return;
    if (dragRef.current && dragRef.current.id === e.pointerId) {
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }
      dragRef.current = null;
    }
  };
  const onDoubleClick = () => { if (enablePanZoom) setCam({ x: 0, y: 0, z: 1 }); };

  // Layout sizing
  const TILE_W = 110;
  const tileH = Math.round(TILE_W / 0.72);
  const ZONES_W = 96;
  const CONTENT_W = 6 * TILE_W + 5 * 10 + 16;
  const BOARD_W = CONTENT_W + ZONES_W + 24;

  const layout = useMemo(() => {
    const total = Math.max(ordered.length, 1);
    const minGap = 40;
    const denom = total > 1 ? Math.sin(Math.PI / total) : 1;
    const chordRadius = denom > 0 ? (BOARD_W + minGap) / (2 * denom) : 0;
    const baseRadius = 1800;
    const radius = Math.max(baseRadius, chordRadius);
    return { radius, boardWidth: BOARD_W };
  }, [ordered.length]);

  const attachedToSet = useMemo(() => {
    const set = new Set<string>();
    for (const arr of permanentsByPlayer.values()) {
      for (const perm of arr) {
        if ((perm as any).attachedTo) set.add((perm as any).attachedTo);
        if ((perm as any).attachedTo) set.add((perm as any).attachedTo);
      }
    }
    return set;
  }, [permanentsByPlayer]);

  const cameraTransform = `translate(${container.w / 2}px, ${container.h / 2}px) scale(${cam.z}) translate(${-cam.x}px, ${-cam.y}px)`;

  const perspective = threeD?.enabled ? (threeD.perspectivePx ?? 1100) : undefined;
  const tiltTransform = threeD?.enabled ? `rotateX(${threeD.rotateXDeg}deg) rotateY(${threeD.rotateYDeg}deg)` : undefined;

  const clothBg: React.CSSProperties = tableCloth?.imageUrl
    ? { backgroundImage: `url(${tableCloth.imageUrl})`, backgroundSize: 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }
    : { background: 'radial-gradient(ellipse at center, rgba(0,128,64,0.9) 0%, rgba(3,62,35,0.95) 60%, rgba(2,40,22,1) 100%)' };

  const WORLD_SIZE = Math.max(2000, Math.floor((worldSize ?? 12000)));

  const sendMove = (id: string, x: number, y: number, z?: number) => {
    if (onUpdatePermPos) onUpdatePermPos(id, x, y, z);
  };

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'relative',
        width: '100%',
        height: '72vh',
        overflow: 'hidden',
        background: '#0b0b0b',
        border: '1px solid #222',
        borderRadius: 12,
        userSelect: 'none',
        cursor: enablePanZoom ? (dragRef.current ? 'grabbing' : (panKey ? 'grab' : 'default')) : 'default'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: cameraTransform,
          transformOrigin: '0 0',
          willChange: 'transform'
        }}
      >
        {/* World origin at center */}
        <div style={{ position: 'absolute', left: '50%', top: '50%', transformStyle: 'preserve-3d', perspective: perspective ? `${perspective}px` : undefined }}>
          <div style={{ position: 'relative', transform: tiltTransform, transformOrigin: '50% 50%', willChange: threeD?.enabled ? 'transform' : undefined, zIndex: 0 }}>
            {/* Cloth */}
            <div
              style={{
                position: 'absolute',
                left: -WORLD_SIZE / 2,
                top: -WORLD_SIZE / 2,
                width: WORLD_SIZE,
                height: WORLD_SIZE,
                ...clothBg,
                boxShadow: 'inset 0 0 120px rgba(0,0,0,0.6)',
                zIndex: 0,
                pointerEvents: 'none'
              }}
            />
            {/* Center marker */}
            <div
              style={{
                position: 'absolute', left: -80, top: -80, width: 160, height: 160,
                borderRadius: '50%', background: 'rgba(31,31,31,0.9)', border: '2px solid #333', color: '#aaa',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, zIndex: 1
              }}
            >Table</div>

            {/* Seats */}
            <div style={{ position: 'relative', zIndex: 2 }}>
              {ordered.map((pb, i) => {
                const total = Math.max(ordered.length, 1);
                const { x, y, rotateDeg } = polarPos(i, total, layout.radius, Math.PI / 2);

                const perms = pb.permanents;
                const tokens = perms.filter(x => (x.card as any)?.type_line === 'Token');
                const nonTokens = perms.filter(x => (x.card as any)?.type_line !== 'Token');

                const lands = splitLands ? nonTokens.filter(x => isLandTypeLine((x.card as any)?.type_line)) : [];
                const others = splitLands ? nonTokens.filter(x => !isLandTypeLine((x.card as any)?.type_line)) : nonTokens;

                const canTargetPlayer = highlightPlayerTargets?.has(pb.player.id) ?? false;
                const isPlayerSelected = selectedPlayerTargets?.has(pb.player.id) ?? false;

                const sectionRef = useRef<HTMLDivElement>(null);
                const isYouThis = you && pb.player.id === you;
                const allowReorderHere = Boolean(isYouThis && enableReorderForYou && !onPermanentClick);

                const yourHand = (isYouThis && zones?.[you!]?.hand ? (zones![you!].hand as any as Array<{
                  id: string; name?: string; type_line?: string; image_uris?: { small?: string; normal?: string; art_crop?: string }; faceDown?: boolean;
                }>) : []) || [];

                const zObj = zones?.[pb.player.id];
                const cmdObj = commandZone?.[pb.player.id];
                const isCommander = (format || '').toLowerCase() === 'commander';

                // Free-field size
                const FREE_W = CONTENT_W;
                const FREE_H = Math.round(2 * tileH + 80);

                return (
                  <div key={pb.player.id} style={{ position: 'absolute', left: 0, top: 0, width: layout.boardWidth, transform: `translate(${x}px, ${y}px) rotate(${rotateDeg}deg)`, transformOrigin: '50% 50%', pointerEvents: 'auto' }}>
                    <div
                      ref={sectionRef}
                      style={{
                        position: 'relative',
                        transform: `rotate(${-rotateDeg}deg)`,
                        background: 'rgba(255,255,255,0.04)',
                        backdropFilter: 'blur(2px)',
                        borderRadius: 10,
                        padding: 10,
                        border: '1px solid rgba(255,255,255,0.08)',
                        display: 'grid',
                        gridTemplateColumns: `${CONTENT_W}px ${ZONES_W}px`,
                        columnGap: 12,
                        rowGap: 10
                      }}
                    >
                      {/* Main column */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <div style={{ fontWeight: 700, color: '#fff' }}>{pb.player.name}</div>
                          {onPlayerClick && (
                            <button
                              onClick={() => onPlayerClick(pb.player.id)}
                              disabled={!canTargetPlayer}
                              style={{
                                border: '1px solid',
                                borderColor: isPlayerSelected ? '#2b6cb0' : canTargetPlayer ? '#38a169' : '#555',
                                color: isPlayerSelected ? '#2b6cb0' : canTargetPlayer ? '#38a169' : '#888',
                                background: 'transparent',
                                padding: '2px 8px',
                                borderRadius: 6,
                                fontSize: 12
                              }}
                              title={canTargetPlayer ? 'Target player' : 'Not a valid player target'}
                            >
                              {isPlayerSelected ? 'Selected' : 'Target'}
                            </button>
                          )}
                        </div>

                        <AttachmentLines containerRef={sectionRef as any} permanents={pb.permanents} opacity={0.5} />

                        {/* Free-position non-lands */}
                        <FreeField
                          perms={others}
                          imagePref={imagePref}
                          tileWidth={TILE_W}
                          widthPx={FREE_W}
                          heightPx={FREE_H}
                          draggable={!!isYouThis}
                          onMove={(id, xx, yy, zz) => sendMove(id, xx, yy, zz)}
                          highlightTargets={highlightPermTargets}
                          selectedTargets={selectedPermTargets}
                          onCardClick={onPermanentClick}
                        />

                        {/* Lands row */}
                        {lands.length > 0 && (
                          <div style={{ marginTop: 12 }} data-no-zoom onWheel={(e) => e.stopPropagation()}>
                            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Lands</div>
                            <LandRow
                              lands={lands}
                              imagePref={imagePref}
                              tileWidth={TILE_W}
                              overlapRatio={0.33}
                              highlightTargets={highlightPermTargets}
                              selectedTargets={selectedPermTargets}
                              onCardClick={onPermanentClick}
                              onRemove={isYouPlayer ? onRemove : undefined}
                              onCounter={isYouPlayer ? onCounter : undefined}
                            />
                          </div>
                        )}

                        {/* Tokens */}
                        {tokens.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <TokenGroups
                              tokens={tokens}
                              groupMode='name+pt+attach'
                              attachedToSet={attachedToSet}
                              onBulkCounter={(ids, deltas) => onBulkCounter?.(ids, deltas)}
                              highlightTargets={highlightPermTargets}
                              selectedTargets={selectedPermTargets}
                              onTokenClick={onPermanentClick}
                            />
                          </div>
                        )}

                        {/* Hand */}
                        {isYouThis && showYourHandBelow && zones && (
                          <div style={{ marginTop: 12, background: 'rgba(0,0,0,0.7)', border: '1px solid #333', borderRadius: 8, padding: 8 }} data-no-zoom onWheel={(e) => e.stopPropagation()}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                              <div style={{ fontSize: 12, color: '#ddd' }}>Your Hand</div>
                              {onShuffleHand && (<button onClick={() => onShuffleHand()} style={{ fontSize: 12, padding: '2px 8px' }}>Shuffle hand</button>)}
                            </div>
                            <HandGallery
                              cards={yourHand}
                              imagePref={imagePref}
                              onPlayLand={(cardId) => onPlayLandFromHand?.(cardId)}
                              onCast={(cardId) => onCastFromHand?.(cardId)}
                              reasonCannotPlayLand={(c) => reasonCannotPlayLand ? reasonCannotPlayLand(c) : null}
                              reasonCannotCast={(c) => reasonCannotCast ? reasonCannotCast(c) : null}
                              thumbWidth={TILE_W}
                              zoomScale={1}
                              layout='wrap2'
                              overlapPx={0}
                              rowGapPx={10}
                              enableReorder={Boolean(allowReorderHere)}
                              onReorder={onReorderHand}
                            />
                          </div>
                        )}
                      </div>

                      {/* Zones column */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
                        {zObj && (<ZonesPiles zones={zObj} commander={cmdObj} isCommanderFormat={isCommander} />)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Overlay camera controls */}
      {enablePanZoom && (
        <div style={{ position: 'absolute', left: 8, bottom: 8, zIndex: 12, display: 'inline-flex', gap: 6, alignItems: 'center', background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '6px 8px', borderRadius: 6, fontSize: 12 }}>
          <button onClick={() => setCam(prev => ({ ...prev, z: clamp(prev.z * 1.15, 0.2, 2.0) }))} title="Zoom in">+</button>
          <button onClick={() => setCam(prev => ({ ...prev, z: clamp(prev.z / 1.15, 0.2, 2.0) }))} title="Zoom out">−</button>
          <button onClick={() => setCam({ x: 0, y: 0, z: 1 })} title="Reset view">Reset</button>
          <button onClick={() => {
            const total = Math.max(ordered.length, 1);
            const denom = total > 1 ? Math.sin(Math.PI / total) : 1;
            const radius = Math.max(1800, denom > 0 ? (BOARD_W + 40) / (2 * denom) : 0);
            const BOARD_H = Math.round(3 * tileH + 220);
            const R_x = radius + BOARD_W / 2 + 40;
            const R_y = radius + BOARD_H / 2 + 40;
            const margin = 40;
            const zx = (container.w / 2 - margin) / R_x;
            const zy = (container.h / 2 - margin) / R_y;
            const fitZ = Math.max(0.2, Math.min(2.0, Math.min(zx, zy)));
            setCam({ x: 0, y: 0, z: fitZ });
          }} title="Fit all seats">Fit All</button>
          <span style={{ opacity: 0.8 }}>Zoom: {cam.z.toFixed(2)} • Pan: Right/Middle or Space+Drag</span>
        </div>
      )}
    </div>
  );
}
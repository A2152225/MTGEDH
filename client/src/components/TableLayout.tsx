import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BattlefieldPermanent, PlayerRef, PlayerID, PlayerZones, CommanderInfo, GameID } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { TokenGroups } from './TokenGroups';
import { AttachmentLines } from './AttachmentLines';
import { HandGallery } from './HandGallery';
import { LandRow } from './LandRow';
import { ZonesPiles } from './ZonesPiles';
import { FreeField } from './FreeField';
import { DeckManagerModal } from './DeckManagerModal';
import { CommanderConfirmModal } from './CommanderConfirmModal';
import { socket } from '../socket';

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function isLandTypeLine(tl?: string) { return /\bland\b/i.test(tl || ''); }
type Side = 0 | 1 | 2 | 3;
type PlayerBoard = { player: PlayerRef; permanents: BattlefieldPermanent[] };

function sidePlan(total: number): Side[] { const pattern: Side[] = [0, 1, 2, 3]; return Array.from({ length: total }, (_, i) => pattern[i % pattern.length]); }
function buildPositions(opts: {
  total: number; boardW: number; boardH: number;
  seatGapX: number; seatGapY: number;
  centerClearX: number; centerClearY: number;
  sidePad: number; sideOrder: Side[];
}): Array<{ x: number; y: number; rotateDeg: number; side: Side }> {
  const { total, boardW, boardH, seatGapX, seatGapY, centerClearX, centerClearY, sidePad, sideOrder } = opts;
  const counts: Record<Side, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }; sideOrder.forEach(s => counts[s]++);
  const stepX = boardW + seatGapX, stepY = boardH + seatGapY;
  const offsets = (count: number, step: number) => count <= 0 ? [] : count === 1 ? [0] : Array.from({ length: count }, (_, i) => -((count - 1) * step) / 2 + i * step);
  const xBottoms = offsets(counts[0], stepX), xTops = offsets(counts[1], stepX), yRights = offsets(counts[2], stepY), yLefts = offsets(counts[3], stepY);
  const halfGapX = Math.max((counts[0] ? ((counts[0] - 1) / 2) * stepX + boardW / 2 : 0), (counts[1] ? ((counts[1] - 1) / 2) * stepX + boardW / 2 : 0)) + centerClearX + sidePad;
  const halfGapY = Math.max((counts[2] ? ((counts[2] - 1) / 2) * stepY + boardH / 2 : 0), (counts[3] ? ((counts[3] - 1) / 2) * stepY + boardH / 2 : 0)) + centerClearY + sidePad;
  const yBottom = halfGapY + boardH / 2, yTop = -halfGapY - boardH / 2, xRight = halfGapX + boardW / 2, xLeft = -halfGapX - boardW / 2;
  const nextIdx: Record<Side, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }; const positions: Array<{ x: number; y: number; rotateDeg: number; side: Side }> = [];
  for (let i = 0; i < total; i++) { const side = sideOrder[i]; const idx = nextIdx[side]++; switch (side) {
    case 0: positions.push({ x: xBottoms[idx] ?? 0, y: yBottom, rotateDeg: 0, side }); break;
    case 1: positions.push({ x: xTops[idx] ?? 0, y: yTop, rotateDeg: 180, side }); break;
    case 2: positions.push({ x: xRight, y: yRights[idx] ?? 0, rotateDeg: -90, side }); break;
    case 3: positions.push({ x: xLeft, y: yLefts[idx] ?? 0, rotateDeg: 90, side }); break;
  }} return positions;
}
function computeExtents(positions: Array<{ x: number; y: number }>, boardW: number, boardH: number) {
  let maxX = 0, maxY = 0; for (const p of positions) { maxX = Math.max(maxX, Math.abs(p.x) + boardW / 2); maxY = Math.max(maxY, Math.abs(p.y) + boardH / 2); }
  return { halfW: maxX, halfH: maxY };
}

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
  onImportDeckText?: (text: string, name?: string) => void;
  gameId?: GameID;
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
    threeD, enablePanZoom = true,
    tableCloth, worldSize, onUpdatePermPos,
    onImportDeckText, gameId
  } = props;

  const ordered = useMemo<PlayerBoard[]>(() => {
    const ps = [...players].sort((a, b) => a.seat - b.seat);
    const idxYou = you ? ps.findIndex(p => p.id === you) : -1;
    const rotated = idxYou >= 0 ? [...ps.slice(idxYou), ...ps.slice(0, idxYou)] : ps;
    return rotated.map(p => ({ player: p, permanents: permanentsByPlayer.get(p.id) || [] }));
  }, [players, permanentsByPlayer, you]);

  const sideOrder = useMemo(() => sidePlan(ordered.length), [ordered.length]);

  // Layout constants
  const TILE_W = 110; const tileH = Math.round(TILE_W / 0.72); const ZONES_W = 96; const GRID_GAP = 10;
  const FREE_W = 6 * TILE_W + 5 * GRID_GAP + 16; const FREE_H = Math.round(2 * tileH + 80);
  const BOARD_W = FREE_W + ZONES_W + 24; const BOARD_H = Math.round(FREE_H + tileH + 220);
  const SEAT_GAP_X = 72, SEAT_GAP_Y = 72, CENTER_CLEAR_X = 120, CENTER_CLEAR_Y = 120, SIDE_PAD = 24;

  const seatPositions = useMemo(() => buildPositions({
    total: ordered.length,
    boardW: BOARD_W,
    boardH: BOARD_H,
    seatGapX: SEAT_GAP_X,
    seatGapY: SEAT_GAP_Y,
    centerClearX: CENTER_CLEAR_X,
    centerClearY: CENTER_CLEAR_Y,
    sidePad: SIDE_PAD,
    sideOrder
  }), [ordered.length, BOARD_W, BOARD_H, SEAT_GAP_X, SEAT_GAP_Y, CENTER_CLEAR_X, CENTER_CLEAR_Y, SIDE_PAD, sideOrder]);

  const { halfW, halfH } = useMemo(() => computeExtents(seatPositions, BOARD_W, BOARD_H), [seatPositions]);

  // Pan / zoom
  const containerRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (cr) setContainer({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setContainer({ w: rect.width, h: rect.height });
    return () => ro.disconnect();
  }, []);
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  const camRef = useRef(cam);
  useEffect(() => { camRef.current = cam; }, [cam]);
  const dragRef = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number; active: boolean } | null>(null);
  const [panKey, setPanKey] = useState(false);
  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space') setPanKey(true); };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') setPanKey(false); };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!enablePanZoom) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-no-zoom]')) return;
      e.preventDefault();
      const { x, y, z } = camRef.current;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const cx = container.w / 2, cy = container.h / 2;
      const wx = x + (sx - cx) / z, wy = y + (sy - cy) / z;
      const factor = Math.exp(-(e.deltaY) * 0.00125);
      const newZ = clamp(z * factor, 0.15, 2.5);
      const newCamX = wx - (sx - cx) / newZ;
      const newCamY = wy - (sy - cy) / newZ;
      setCam({ x: newCamX, y: newCamY, z: newZ });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [enablePanZoom, container.w, container.h]);
  const beginPan = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y, active: true };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!enablePanZoom) return;
    const isPan = e.button === 1 || e.button === 2 || panKey;
    if (isPan) { e.preventDefault(); beginPan(e); }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !d.active || d.id !== e.pointerId) return;
    const dx = (e.clientX - d.sx) / camRef.current.z;
    const dy = (e.clientY - d.sy) / camRef.current.z;
    setCam(prev => ({ ...prev, x: d.cx - dx, y: d.cy - dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current && dragRef.current.id === e.pointerId) {
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  // Recenter helpers
  function centerOnBoardIndex(idx: number, preserveZoom = true) {
    const pos = seatPositions[idx];
    if (!pos) return;
    setCam(c => ({ x: pos.x, y: pos.y, z: preserveZoom ? c.z : c.z }));
  }
  function centerOnNearestWorldPoint(wx: number, wy: number, preserveZoom = true) {
    if (seatPositions.length === 0) return;
    let best = 0, bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < seatPositions.length; i++) {
      const dx = seatPositions[i].x - wx;
      const dy = seatPositions[i].y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    centerOnBoardIndex(best, preserveZoom);
  }
  function centerOnYou(preserveZoom = true) {
    if (!you || ordered.length === 0 || seatPositions.length === 0) {
      // Fallback: nearest board to current camera center
      const cx = camRef.current.x, cy = camRef.current.y;
      centerOnNearestWorldPoint(cx, cy, preserveZoom);
      return;
    }
    centerOnBoardIndex(0, preserveZoom); // ordered is rotated so index 0 is you
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!enablePanZoom) return;
    // Ignore when modals are open
    if ((window as any).__mtg_deckMgrOpen || (window as any).__mtg_cmdConfirmOpen) return;
    // Ignore double-clicks on UI controls inside the table
    const el = e.target as HTMLElement;
    if (el && el.closest('button, input, textarea, select, [role="button"], [data-no-center], [data-no-zoom]')) return;

    const host = containerRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const cx = container.w / 2, cy = container.h / 2;
    const { x, y, z } = camRef.current;
    const wx = x + (sx - cx) / z;
    const wy = y + (sy - cy) / z;
    centerOnNearestWorldPoint(wx, wy, true);
  };

  const didFit = useRef(false);
  useEffect(() => {
    if (!container.w || !container.h) return;
    const margin = 24;
    const zx = (container.w / 2 - margin) / (halfW + 40);
    const zy = (container.h / 2 - margin) / (halfH + 40);
    const fitZ = clamp(Math.min(zx, zy), 0.2, 2.0);
    if (!didFit.current || ordered.length !== (didFit as any).lastN) {
      centerOnYou(true);
      setCam(prev => ({ x: prev.x, y: prev.y, z: fitZ }));
      didFit.current = true; (didFit as any).lastN = ordered.length;
    }
  }, [container.w, container.h, ordered.length, halfW, halfH]);

  const attachedToSet = useMemo(() => {
    const s = new Set<string>();
    for (const arr of permanentsByPlayer.values()) {
      for (const perm of arr) {
        if ((perm as any).attachedTo) s.add((perm as any).attachedTo);
        if (perm.attachedTo) s.add(perm.attachedTo);
      }
    }
    return s;
  }, [permanentsByPlayer]);

  const cameraTransform = `translate(${container.w / 2}px, ${container.h / 2}px) scale(${cam.z}) translate(${-cam.x}px, ${-cam.y}px)`;
  const perspective = threeD?.enabled ? (threeD.perspectivePx ?? 1100) : undefined;
  const tiltTransform = threeD?.enabled ? `rotateX(${threeD.rotateXDeg}deg) rotateY(${threeD.rotateYDeg}deg)` : undefined;

  const clothW = Math.max(2 * (halfW + 120), worldSize ?? 0, 2000);
  const clothH = Math.max(2 * (halfH + 120), worldSize ?? 0, 1600);
  const clothBg: React.CSSProperties = tableCloth?.imageUrl
    ? { backgroundImage: `url(${tableCloth.imageUrl})`, backgroundSize: 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }
    : { background: 'radial-gradient(ellipse at center, rgba(0,128,64,0.9) 0%, rgba(3,62,35,0.95) 60%, rgba(2,40,22,1) 100%)' };

  const [deckMgrOpen, setDeckMgrOpen] = useState(false);
  useEffect(() => { (window as any).__mtg_deckMgrOpen = deckMgrOpen; }, [deckMgrOpen]);
  const decksBtnRef = useRef<HTMLButtonElement | null>(null);

  // Commander confirmation state
  const [confirmCmdOpen, setConfirmCmdOpen] = useState(false);
  useEffect(() => { (window as any).__mtg_cmdConfirmOpen = confirmCmdOpen; }, [confirmCmdOpen]);
  const [confirmCmdSuggested, setConfirmCmdSuggested] = useState<string[]>([]);
  useEffect(() => {
    const onSuggest = ({ gameId: gid, names }: { gameId: GameID; names: string[] }) => {
      if (!gameId || gid !== gameId) return;
      setConfirmCmdSuggested(Array.isArray(names) ? names.slice(0, 2) : []);
      setConfirmCmdOpen(true);
    };
    (socket as any).on('suggestCommanders', onSuggest);
    return () => { (socket as any).off('suggestCommanders', onSuggest); };
  }, [gameId]);

  return (
    <div
      ref={containerRef}
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
        cursor: enablePanZoom ? (dragRef.current ? 'grabbing' : (panKey ? 'grab' : 'default')) : 'default',
        overscrollBehavior: 'none'
      }}
    >
      <div style={{ position: 'absolute', inset: 0, transform: cameraTransform, transformOrigin: '0 0', willChange: 'transform' }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transformStyle: 'preserve-3d', perspective: perspective ? `${perspective}px` : undefined }}>
          <div style={{ position: 'relative', transform: tiltTransform, transformOrigin: '50% 50%', zIndex: 0 }}>
            <div
              style={{
                position: 'absolute', left: -clothW / 2, top: -clothH / 2, width: clothW, height: clothH,
                ...clothBg, boxShadow: 'inset 0 0 60px rgba(0,0,0,0.4)', pointerEvents: 'none'
              }}
            />
            <div
              style={{
                position: 'absolute', left: -50, top: -50, width: 100, height: 100,
                borderRadius: '50%', background: 'rgba(31,31,31,0.85)', border: '2px solid #333',
                color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, zIndex: 1
              }}
              data-no-center
            >Table</div>

            <div style={{ position: 'relative', zIndex: 2 }}>
              {ordered.map((pb, i) => {
                const pos = seatPositions[i];
                const perms = pb.permanents;
                const tokens = perms.filter(x => (x.card as any)?.type_line === 'Token');
                const nonTokens = perms.filter(x => (x.card as any)?.type_line !== 'Token');
                const lands = splitLands ? nonTokens.filter(x => isLandTypeLine((x.card as any)?.type_line)) : [];
                const others = splitLands ? nonTokens.filter(x => !isLandTypeLine((x.card as any)?.type_line)) : nonTokens;

                const canTargetPlayer = highlightPlayerTargets?.has(pb.player.id) ?? false;
                const isPlayerSelected = selectedPlayerTargets?.has(pb.player.id) ?? false;

                const isYouThis = you && pb.player.id === you;
                const allowReorderHere = Boolean(isYouThis && enableReorderForYou && !onPermanentClick);

                const yourHand = (isYouThis && zones?.[you!]?.hand ? (zones![you!].hand as any as Array<{
                  id: string; name?: string; type_line?: string;
                  image_uris?: { small?: string; normal?: string; art_crop?: string }; faceDown?: boolean;
                }>) : []) || [];

                const zObj = zones?.[pb.player.id];
                const cmdObj = commandZone?.[pb.player.id];
                const isCommander = (format || '').toLowerCase() === 'commander';

                return (
                  <div
                    key={pb.player.id}
                    style={{
                      position: 'absolute',
                      left: 0, top: 0,
                      width: BOARD_W,
                      transform: `translate(${pos.x}px, ${pos.y}px) rotate(${isYouThis ? 0 : pos.rotateDeg}deg)`,
                      transformOrigin: '50% 50%'
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        background: 'rgba(255,255,255,0.045)',
                        backdropFilter: 'blur(2px)',
                        borderRadius: 10,
                        padding: 10,
                        border: '1px solid rgba(255,255,255,0.08)',
                        display: 'grid',
                        gridTemplateColumns: `${FREE_W}px ${ZONES_W}px`,
                        columnGap: 12,
                        rowGap: 10
                      }}
                      data-no-center
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <div style={{ fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{pb.player.name}</span>
                            {isYouThis && (
                              <button
                                ref={decksBtnRef}
                                type="button"
                                onClick={() => setDeckMgrOpen(true)}
                                style={{ fontSize: 11 }}
                                title="Manage / Import Deck"
                              >Decks</button>
                            )}
                          </div>
                          {onPlayerClick && (
                            <button
                              type="button"
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
                            >
                              {isPlayerSelected ? 'Selected' : 'Target'}
                            </button>
                          )}
                        </div>

                        <AttachmentLines containerRef={{ current: null } as any} permanents={pb.permanents} opacity={0.5} />

                        <FreeField
                          perms={others}
                          imagePref={imagePref}
                          tileWidth={TILE_W}
                          widthPx={FREE_W}
                          heightPx={FREE_H}
                          draggable={!!isYouThis}
                          onMove={(id, xx, yy, zz) => onUpdatePermPos?.(id, xx, yy, zz)}
                          highlightTargets={highlightPermTargets}
                          selectedTargets={selectedPermTargets}
                          onCardClick={onPermanentClick}
                        />

                        {lands.length > 0 && (
                          <div style={{ marginTop: 12 }} data-no-zoom data-no-center>
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

                        {tokens.length > 0 && (
                          <div style={{ marginTop: 12 }} data-no-zoom data-no-center>
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

                        {isYouThis && showYourHandBelow && (
                          <div
                            style={{
                              marginTop: 12,
                              background: 'rgba(0,0,0,0.7)',
                              border: '1px solid #333',
                              borderRadius: 8,
                              padding: 8,
                              maxHeight: '32vh',
                              overflowY: 'auto'
                            }}
                            data-no-zoom
                            data-no-center
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                              <div style={{ fontSize: 12, color: '#ddd' }}>Your Hand</div>
                              {onShuffleHand && <button type="button" onClick={() => onShuffleHand()} style={{ fontSize: 12, padding: '2px 8px' }}>Shuffle</button>}
                            </div>
                            <HandGallery
                              cards={yourHand}
                              imagePref={imagePref}
                              onPlayLand={(cardId) => onPlayLandFromHand?.(cardId)}
                              onCast={(cardId) => onCastFromHand?.(cardId)}
                              reasonCannotPlayLand={c => reasonCannotPlayLand ? reasonCannotPlayLand(c) : null}
                              reasonCannotCast={c => reasonCannotCast ? reasonCannotCast(c) : null}
                              thumbWidth={TILE_W}
                              zoomScale={1}
                              layout='wrap2'
                              overlapPx={0}
                              rowGapPx={10}
                              enableReorder={allowReorderHere}
                              onReorder={onReorderHand}
                            />
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }} data-no-center>
                        {zObj && (
                          <ZonesPiles
                            zones={zObj}
                            commander={cmdObj}
                            isCommanderFormat={isCommander}
                            showHandCount={!isYouThis ? (zObj.handCount ?? (Array.isArray(zObj.hand) ? zObj.hand.length : 0)) : undefined}
                            hideHandDetails={!isYouThis}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <DeckManagerModal
              open={deckMgrOpen}
              onClose={() => setDeckMgrOpen(false)}
              onImportText={(txt, nm) => { onImportDeckText?.(txt, nm); setDeckMgrOpen(false); }}
              gameId={gameId}
              canServer={!!isYouPlayer}
              anchorEl={decksBtnRef.current}
              wide
            />
            {gameId && (
              <CommanderConfirmModal
                open={confirmCmdOpen}
                gameId={gameId}
                suggested={confirmCmdSuggested}
                onClose={() => setConfirmCmdOpen(false)}
              />
            )}
          </div>
        </div>
      </div>

      {enablePanZoom && (
        <div style={{
          position: 'absolute', left: 8, bottom: 8, zIndex: 12,
          display: 'inline-flex', gap: 6, alignItems: 'center',
          background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '6px 8px', borderRadius: 6, fontSize: 12
        }}>
          <button type="button" onClick={() => setCam(prev => ({ ...prev, z: clamp(prev.z * 1.15, 0.2, 2.5) }))}>+</button>
          <button type="button" onClick={() => setCam(prev => ({ ...prev, z: clamp(prev.z / 1.15, 0.15, 2.5) }))}>−</button>
          <button type="button" onClick={() => centerOnYou(true)}>Center You</button>
          <button type="button" onClick={() => {
            const margin = 24;
            const zx = (container.w / 2 - margin) / (halfW + 40);
            const zy = (container.h / 2 - margin) / (halfH + 40);
            const fitZ = clamp(Math.min(zx, zy), 0.15, 2.5);
            centerOnYou(true);
            setCam(c => ({ x: c.x, y: c.y, z: fitZ }));
          }}>Fit All</button>
          <span style={{ opacity: 0.85 }}>Zoom: {cam.z.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
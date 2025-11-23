// client/src/components/TableLayout.tsx
// Full TableLayout component — layout + pan/zoom + deck manager.
// Commander selection UI has been moved up into App.tsx, so this file no longer
// handles suggestCommanders or commander modals directly.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BattlefieldPermanent,
  PlayerRef,
  PlayerID,
  PlayerZones,
  CommanderInfo,
  GameID,
  KnownCardRef,
  ClientGameView,
  ChatMsg,
} from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { TokenGroups } from './TokenGroups';
import { AttachmentLines } from './AttachmentLines';
import { HandGallery } from './HandGallery';
import { LandRow } from './LandRow';
import { ZonesPiles } from './ZonesPiles';
import { FreeField } from './FreeField';
import { DeckManagerModal } from './DeckManagerModal';
import { socket } from '../socket';

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function isLandTypeLine(tl?: string) { return /\bland\b/i.test(tl || ''); }

type Side = 0 | 1 | 2 | 3;
type PlayerBoard = { player: PlayerRef; permanents: BattlefieldPermanent[] };

type HandCard = {
  id: string;
  name?: string;
  type_line?: string;
  image_uris?: { small?: string; normal?: string };
  faceDown?: boolean;
  known?: boolean; // visibility to this client
};

function sidePlan(total: number): Side[] {
  const pattern: Side[] = [0, 1, 2, 3];
  return Array.from({ length: total }, (_, i) => pattern[i % pattern.length]);
}

function buildPositions(opts: {
  total: number; boardW: number; boardH: number;
  seatGapX: number; seatGapY: number;
  centerClearX: number; centerClearY: number;
  sidePad: number; sideOrder: Side[];
}): Array<{ x: number; y: number; rotateDeg: number; side: Side }> {
  const { total, boardW, boardH, seatGapX, seatGapY, centerClearX, centerClearY, sidePad, sideOrder } = opts;
  const counts: Record<Side, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }; sideOrder.forEach(s => counts[s]++);
  const stepX = boardW + seatGapX, stepY = boardH + seatGapY;
  const offsets = (count: number, step: number) =>
    count <= 0 ? [] :
    count === 1 ? [0] :
    Array.from({ length: count }, (_, i) => -((count - 1) * step) / 2 + i * step);
  const xBottoms = offsets(counts[0], stepX), xTops = offsets(counts[1], stepX), yRights = offsets(counts[2], stepY), yLefts = offsets(counts[3], stepY);
  const halfGapX = Math.max((counts[0] ? ((counts[0] - 1) / 2) * stepX + boardW / 2 : 0), (counts[1] ? ((counts[1] - 1) / 2) * stepX + boardW / 2 : 0)) + centerClearX + sidePad;
  const halfGapY = Math.max((counts[2] ? ((counts[2] - 1) / 2) * stepY + boardH / 2 : 0), (counts[3] ? ((counts[3] - 1) / 2) * stepY + boardH / 2 : 0)) + centerClearY + sidePad;
  const yBottom = halfGapY + boardH / 2, yTop = -halfGapY - boardH / 2, xRight = halfGapX + boardW / 2, xLeft = -halfGapX - boardW / 2;
  const nextIdx: Record<Side, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const positions: Array<{ x: number; y: number; rotateDeg: number; side: Side }> = [];
  for (let i = 0; i < total; i++) {
    const side = sideOrder[i];
    const idx = nextIdx[side]++;
    switch (side) {
      case 0: positions.push({ x: xBottoms[idx] ?? 0, y: yBottom, rotateDeg: 0, side }); break;
      case 1: positions.push({ x: xTops[idx] ?? 0, y: yTop, rotateDeg: 180, side }); break;
      case 2: positions.push({ x: xRight, y: yRights[idx] ?? 0, rotateDeg: -90, side }); break;
      case 3: positions.push({ x: xLeft, y: yLefts[idx] ?? 0, rotateDeg: 90, side }); break;
    }
  }
  return positions;
}

function computeExtents(positions: Array<{ x: number; y: number }>, boardW: number, boardH: number) {
  let maxX = 0, maxY = 0;
  for (const p of positions) {
    maxX = Math.max(maxX, Math.abs(p.x) + boardW / 2);
    maxY = Math.max(maxY, Math.abs(p.y) + boardH / 2);
  }
  return { halfW: maxX, halfH: maxY };
}

export function TableLayout(props: {
  players: PlayerRef[];
  permanentsByPlayer: Map<PlayerID, BattlefieldPermanent[]>;
  imagePref?: ImagePref;
  isYouPlayer?: boolean;
  splitLands?: boolean;
  enableReorderForYou?: boolean;
  you?: PlayerID;
  zones?: Record<PlayerID, PlayerZones>;
  commandZone?: Record<PlayerID, CommanderInfo | undefined>;
  format?: string;
  showYourHandBelow?: boolean;
  onReorderHand?: (order: string[]) => void;
  onShuffleHand?: () => void;
  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
  onBulkCounter?: (ids: string[], deltas: Record<string, number>) => void;
  highlightPermTargets?: Set<string> | undefined;
  selectedPermTargets?: Set<string> | undefined;
  onPermanentClick?: ((id: string) => void) | undefined;
  highlightPlayerTargets?: Set<string> | undefined;
  selectedPlayerTargets?: Set<string> | undefined;
  onPlayerClick?: ((pid: string) => void) | undefined;
  onPlayLandFromHand?: (cardId: string) => void;
  onCastFromHand?: (cardId: string) => void;
  reasonCannotPlayLand?: (card: any) => string | null;
  reasonCannotCast?: (card: any) => string | null;
  onImportDeckText?: (txt: string, name?: string) => void;
  onUseSavedDeck?: (deckId: string) => void;
  onLocalImportConfirmChange?: (open: boolean) => void;
  gameId?: GameID;
  stackItems?: any[];
  importedCandidates?: KnownCardRef[]; // no longer used for commander UI, but kept for potential future UI
  energyCounters?: Record<PlayerID, number>;
  energy?: Record<PlayerID, number>;
  // chat overlay props
  chatMessages?: ChatMsg[];
  onSendChat?: (text: string) => void;
  chatView?: ClientGameView;
  chatYou?: PlayerID;
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
    onImportDeckText, onUseSavedDeck, onLocalImportConfirmChange,
    gameId, importedCandidates, energyCounters, energy,
    chatMessages, onSendChat, chatView, chatYou,
  } = props;

  // Snapshot debug
  useEffect(() => {
    try {
      console.debug("[TableLayout] snapshot", {
        gameId,
        you,
        playersCount: Array.isArray(players) ? players.length : undefined,
        importedCandidatesCount: (importedCandidates || []).length,
        hasImportHandler: typeof onImportDeckText === "function",
        hasUseSavedHandler: typeof onUseSavedDeck === "function",
      });
    } catch { /* ignore */ }
  }, [gameId, you, players, importedCandidates, onImportDeckText, onUseSavedDeck]);

  const ordered = useMemo<PlayerBoard[]>(() => {
    const ps = [...players].sort((a, b) => a.seat - b.seat);
    const idxYou = you ? ps.findIndex(p => p.id === you) : -1;
    const rotated = idxYou >= 0 ? [...ps.slice(idxYou), ...ps.slice(0, idxYou)] : ps;
    return rotated.map(p => ({ player: p, permanents: permanentsByPlayer.get(p.id) || [] }));
  }, [players, permanentsByPlayer, you]);

  const sideOrder = useMemo(() => sidePlan(ordered.length), [ordered.length]);

  // Layout constants
  const TILE_W = 110; const tileH = Math.round(TILE_W / 0.72);
  const ZONES_W = 140;
  const GRID_GAP = 10;
  const FREE_W = 7 * TILE_W + 6 * GRID_GAP + 20;
  const FREE_H = Math.round(2 * tileH + 100);
  const BOARD_W = FREE_W + ZONES_W + 24;
  const BOARD_H = Math.round(FREE_H + tileH + 240);
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

  // Pan/Zoom and camera
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
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId))
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  function centerOnBoardIndex(idx: number, preserveZoom = true) {
    const pos = seatPositions[idx];
    if (!pos) return;
    setCam(c => ({ x: pos.x, y: pos.y, z: preserveZoom ? c.z : c.z }));
  }

  function centerOnNearestWorldPoint(wx: number, wy: number, preserveZoom = true) {
    if (seatPositions.length === 0) return;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < seatPositions.length; i++) {
      const dx = seatPositions[i].x - wx;
      const dy = seatPositions[i].y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    centerOnBoardIndex(best, preserveZoom);
  }

  function centerOnYou(preserveZoom = true) {
    try {
      if (you && containerRef.current) {
        const el = document.getElementById(`hand-area-${you}`);
        const containerEl = containerRef.current;
        if (el && containerEl) {
          const containerRect = containerEl.getBoundingClientRect();
          const elemRect = el.getBoundingClientRect();
          const z = camRef.current.z || 1;
          const sx = (elemRect.left - containerRect.left) + elemRect.width / 2;
          const sy = (elemRect.bottom - containerRect.top);
          const worldX = camRef.current.x + (sx - container.w / 2) / z;
          const worldY = camRef.current.y + (sy - container.h / 2) / z;
          const targetSX = container.w / 2;
          const targetSY = Math.round(container.h * 0.72);
          const newCamX = worldX - (targetSX - container.w / 2) / z;
          const newCamY = worldY - (targetSY - container.h / 2) / z;
          setCam(c => ({ x: newCamX, y: newCamY, z: preserveZoom ? c.z : c.z }));
          return;
        }
      }
    } catch (err) {
      console.warn('centerOnYou DOM centering failed', err);
    }

    if (!you || ordered.length === 0 || seatPositions.length === 0) {
      const cx = camRef.current.x, cy = camRef.current.y;
      centerOnNearestWorldPoint(cx, cy, preserveZoom);
      return;
    }
    let idx = -1;
    for (let i = 0; i < ordered.length; i++) {
      const o = ordered[i];
      if (o.player.id === you) { idx = i; break; }
    }
    if (idx === -1) {
      const cx = camRef.current.x, cy = camRef.current.y;
      centerOnNearestWorldPoint(cx, cy, preserveZoom);
      return;
    }
    const pos = seatPositions[idx];
    if (!pos) { centerOnBoardIndex(idx, preserveZoom); return; }
    const dirX = -pos.x;
    const dirY = -pos.y;
    const mag = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / mag;
    const ny = dirY / mag;
    const shift = Math.min(Math.max(halfH * 0.18, 120), 600);
    const cx2 = pos.x + nx * shift;
    const cy2 = pos.y + ny * shift;
    setCam(c => ({ x: cx2, y: cy2, z: preserveZoom ? c.z : c.z }));
  }

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
      didFit.current = true;
      (didFit as any).lastN = ordered.length;
    }
  }, [container.w, container.h, ordered.length, halfW, halfH]);

  const attachedToSet = useMemo(() => {
    const s = new Set<string>();
    for (const arr of permanentsByPlayer.values()) {
      for (const perm of arr) {
        if ((perm as any).attachedTo) s.add((perm as any).attachedTo);
      }
    }
    return s;
  }, [permanentsByPlayer]);

  const cameraTransform =
    `translate(${container.w / 2}px, ${container.h / 2}px) scale(${cam.z}) translate(${-cam.x}px, ${-cam.y}px)`;

  // deck manager + import confirm
  const [deckMgrOpen, setDeckMgrOpen] = useState(false);
  const decksBtnRef = useRef<HTMLButtonElement | null>(null);

  const tableHasContent = useMemo(() => {
    for (const arr of permanentsByPlayer.values()) {
      if (arr.length > 0) return true;
    }
    return false;
  }, [permanentsByPlayer]);

  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [importPending, setImportPending] = useState<
    { type: 'text'; text: string; name?: string } |
    { type: 'server'; deckId: string } |
    null
  >(null);

  function askServerImporterOnlyThen(action: () => void, fallbackOpenConfirm: () => void) {
    if (!props.gameId) {
      fallbackOpenConfirm();
      return;
    }

    let handled = false;
    const TIMEOUT_MS = 1200;
    const timer = window.setTimeout(() => {
      if (!handled) {
        handled = true;
        fallbackOpenConfirm();
      }
    }, TIMEOUT_MS);

    try {
      (socket as any).emit('canImportWithoutWipe', { gameId: props.gameId }, (resp: any) => {
        if (handled) return;
        handled = true;
        window.clearTimeout(timer as unknown as number);
        if (resp && resp.importerOnly) {
          action();
        } else {
          fallbackOpenConfirm();
        }
      });
    } catch (e) {
      if (!handled) {
        handled = true;
        window.clearTimeout(timer as unknown as number);
        fallbackOpenConfirm();
      }
    }
  }

  const handleRequestImportText = (text: string, name?: string) => {
    setImportPending({ type: 'text', text, name });

    askServerImporterOnlyThen(
      () => {
        try { if (typeof onImportDeckText === 'function') onImportDeckText(text, name); } catch (e) { console.warn("onImportDeckText failed:", e); }
        setImportPending(null);
        setDeckMgrOpen(false);
        onLocalImportConfirmChange?.(false);
      },
      () => {
        setImportConfirmOpen(true);
        onLocalImportConfirmChange?.(true);
      }
    );
  };

  const handleRequestUseSavedDeck = (deckId: string) => {
    setImportPending({ type: 'server', deckId });

    askServerImporterOnlyThen(
      () => {
        try { if (typeof onUseSavedDeck === 'function') onUseSavedDeck(deckId); } catch (e) { console.warn("onUseSavedDeck failed:", e); }
        setImportPending(null);
        setDeckMgrOpen(false);
        onLocalImportConfirmChange?.(false);
      },
      () => {
        setImportConfirmOpen(true);
        onLocalImportConfirmChange?.(true);
      }
    );
  };

  const confirmAndImport = () => {
    if (!importPending) { setImportConfirmOpen(false); onLocalImportConfirmChange?.(false); return; }
    if (importPending.type === 'text') {
      onImportDeckText?.(importPending.text, importPending.name);
    } else {
      onUseSavedDeck?.(importPending.deckId);
    }
    setImportPending(null);
    setImportConfirmOpen(false);
    onLocalImportConfirmChange?.(false);
    setDeckMgrOpen(false);
  };

  const cancelImportPending = () => {
    setImportPending(null);
    setImportConfirmOpen(false);
    onLocalImportConfirmChange?.(false);
  };

  const clothBg: React.CSSProperties = props.tableCloth?.imageUrl
    ? { backgroundImage: `url(${props.tableCloth.imageUrl})`, backgroundSize: 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }
    : { background: 'radial-gradient(ellipse at center, rgba(0,128,64,0.9) 0%, rgba(3,62,35,0.95) 60%, rgba(2,40,22,1) 100%)' };

  // local chat input state for overlay
  const [chatText, setChatText] = useState("");

  const handleSendChat = () => {
    if (!chatText.trim() || !onSendChat) return;
    onSendChat(chatText.trim());
    setChatText("");
  };

  const displaySender = (from: string | "system") => {
    if (from === "system") return "system";
    const player = chatView?.players?.find((p: any) => p.id === from);
    return player?.name || from;
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        // TODO: custom game-actions context menu can be triggered here
      }}
      style={{
        width: '100%',
        height: '72vh',
        overflow: 'hidden',
        background: '#0b0b0b',
        border: '1px solid #222',
        borderRadius: 12,
        userSelect: 'none',
        cursor: enablePanZoom ? (dragRef.current ? 'grabbing' : (panKey ? 'grab' : 'default')) : 'default',
        overscrollBehavior: 'none',
        position: 'relative'
      }}
    >
      <div style={{ position: 'absolute', inset: 0, transform: cameraTransform, transformOrigin: '0 0', willChange: 'transform' }}>

        <div style={{ position: 'absolute', left: '50%', top: '50%', transformStyle: 'preserve-3d' }}>
          <div style={{ position: 'relative' }}>

            <div
              style={{
                position: 'absolute',
                left: -Math.max(2 * (halfW + 120), props.worldSize ?? 0, 2000) / 2,
                top: -Math.max(2 * (halfW + 120), props.worldSize ?? 0, 2000) / 2,
                width: Math.max(2 * (halfW + 120), props.worldSize ?? 0, 2000),
                height: Math.max(2 * (halfW + 120), props.worldSize ?? 0, 2000),
                ...clothBg,
                boxShadow: 'inset 0 0 60px rgba(0,0,0,0.4)',
                pointerEvents: 'none'
              }}
            />

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

                const zObj = zones?.[pb.player.id];
                const cmdObj = commandZone?.[pb.player.id];
                const isCommanderFormat = (format || '').toLowerCase() === 'commander';

                // unified hand objects for this player
                const playerHandCards: HandCard[] =
                  (zObj && Array.isArray(zObj.hand) ? (zObj.hand as any as HandCard[]) : []) || [];

                const playerHandCount =
                  typeof zObj?.handCount === 'number'
                    ? zObj.handCount
                    : playerHandCards.length;

                const yourHand: HandCard[] = isYouThis ? playerHandCards : [];

                const lifeVal =
                  (props as any).life?.[pb.player.id] ??
                  (props as any).state?.startingLife ??
                  40;
                const poisonVal = (props as any).poisonCounters?.[pb.player.id] ?? 0;
                const xpVal =
                  (props as any).experienceCounters?.[pb.player.id] ?? 0;
                const energyVal =
                  (props as any).energyCounters?.[pb.player.id] ??
                  (props as any).energy?.[pb.player.id] ??
                  0;

                return (
                  <div
                    key={pb.player.id}
                    style={{
                      position: 'absolute',
                      left: pos.x - BOARD_W / 2,
                      top: pos.y - BOARD_H / 2,
                      width: BOARD_W,
                      transform: `translate(0,0) rotate(${isYouThis ? 0 : pos.rotateDeg}deg)`,
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
                    >
                      <div>
                        {/* Header row */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 8
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 700,
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10
                            }}
                          >
                            <span>{pb.player.name}</span>
                            <div
                              style={{
                                display: 'flex',
                                gap: 6,
                                fontSize: 11
                              }}
                            >
                              <span title="Life" style={{ color: '#4ade80' }}>
                                L:{lifeVal}
                              </span>
                              <span
                                title="Poison Counters"
                                style={{
                                  color:
                                    poisonVal > 0 ? '#f87171' : '#aaa'
                                }}
                              >
                                P:{poisonVal}
                              </span>
                              <span
                                title="Experience Counters"
                                style={{
                                  color: xpVal > 0 ? '#60a5fa' : '#aaa'
                                }}
                              >
                                XP:{xpVal}
                              </span>
                              <span
                                title="Energy Counters"
                                style={{ color: '#ffd166' }}
                              >
                                E:{energyVal}
                              </span>
                            </div>
                            {isYouThis && (
                              <button
                                ref={decksBtnRef}
                                type="button"
                                onClick={() => setDeckMgrOpen(true)}
                                style={{ fontSize: 11 }}
                                title={gameId ? "Manage / Import Deck" : "Waiting for game to be ready"}
                                disabled={!gameId}
                              >
                                Decks
                              </button>
                            )}
                          </div>
                          {onPlayerClick && (
                            <button
                              type="button"
                              onClick={() => onPlayerClick(pb.player.id)}
                              disabled={!canTargetPlayer}
                              style={{
                                border: '1px solid',
                                borderColor: isPlayerSelected
                                  ? '#2b6cb0'
                                  : canTargetPlayer
                                  ? '#38a169'
                                  : '#555',
                                background: 'transparent',
                                color: isPlayerSelected
                                  ? '#2b6cb0'
                                  : canTargetPlayer
                                  ? '#38a169'
                                  : '#888',
                                padding: '2px 8px',
                                borderRadius: 6,
                                fontSize: 12
                              }}
                            >
                              {isPlayerSelected ? 'Selected' : 'Target'}
                            </button>
                          )}
                        </div>

                        <AttachmentLines
                          containerRef={{ current: null } as any}
                          permanents={pb.permanents}
                          opacity={0.5}
                        />

                        <FreeField
                          perms={others}
                          imagePref={imagePref}
                          tileWidth={TILE_W}
                          widthPx={FREE_W}
                          heightPx={FREE_H}
                          draggable={!!isYouThis}
                          onMove={(id, xx, yy, zz) =>
                            onUpdatePermPos?.(id, xx, yy, zz)
                          }
                          highlightTargets={highlightPermTargets}
                          selectedTargets={selectedPermTargets}
                          onCardClick={onPermanentClick}
                        />

                        {lands.length > 0 && (
                          <div style={{ marginTop: 12 }} data-no-zoom>
                            <div
                              style={{
                                fontSize: 12,
                                opacity: 0.7,
                                marginBottom: 6
                              }}
                            >
                              Lands
                            </div>
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
                          <div style={{ marginTop: 12 }} data-no-zoom>
                            <TokenGroups
                              tokens={tokens}
                              groupMode="name+pt+attach"
                              attachedToSet={attachedToSet}
                              onBulkCounter={(ids, deltas) =>
                                onBulkCounter?.(ids, deltas)
                              }
                              highlightTargets={highlightPermTargets}
                              selectedTargets={selectedPermTargets}
                              onTokenClick={onPermanentClick}
                            />
                          </div>
                        )}

                        {/* YOUR hand (full details) */}
                        {isYouThis && showYourHandBelow && (
                          <div
                            id={`hand-area-${pb.player.id}`}
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
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 6
                              }}
                            >
                              <div
                                style={{ fontSize: 12, color: '#ddd' }}
                              >
                                Your Hand
                              </div>
                              {onShuffleHand && (
                                <button
                                  type="button"
                                  onClick={() => onShuffleHand()}
                                  style={{
                                    fontSize: 12,
                                    padding: '2px 8px'
                                  }}
                                >
                                  Shuffle
                                </button>
                              )}
                            </div>
                            <HandGallery
                              cards={yourHand}
                              imagePref={imagePref}
                              onPlayLand={(cardId) =>
                                onPlayLandFromHand?.(cardId)
                              }
                              onCast={(cardId) =>
                                onCastFromHand?.(cardId)
                              }
                              reasonCannotPlayLand={(c) =>
                                reasonCannotPlayLand
                                  ? reasonCannotPlayLand(c)
                                  : null
                              }
                              reasonCannotCast={(c) =>
                                reasonCannotCast ? reasonCannotCast(c) : null
                              }
                              thumbWidth={TILE_W}
                              zoomScale={1}
                              layout="wrap2"
                              overlapPx={0}
                              rowGapPx={10}
                              enableReorder={allowReorderHere}
                              onReorder={onReorderHand}
                            />
                          </div>
                        )}

{/* OPPONENTS' hand strip: same objects, known -> face/back */}
{!isYouThis && playerHandCount > 0 && (
  <div
    style={{
      marginTop: 8,
      padding: 6,
      borderRadius: 6,
      background: 'rgba(0,0,0,0.8)',
      border: '1px solid #4b5563',
      color: '#e5e7eb',
      fontSize: 11,
      minHeight: 54,               // ensure room for cards
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}
    data-no-zoom
  >
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span>Hand</span>
      <span>{playerHandCount} cards</span>
    </div>
    <div
      style={{
        display: 'flex',
        gap: 4,
        overflowX: 'hidden',
        alignItems: 'center',
        minHeight: 40,             // height for the card row
      }}
    >
      {playerHandCards.slice(0, 12).map((card, idx) => {
        const visibleToYou =
          !!card.known && !card.faceDown;

        if (!visibleToYou) {
          // hidden: card back
          return (
            <div
              key={card.id || idx}
              title="Hidden card"
              style={{
                width: 28,
                height: 38,
                borderRadius: 4,
                background:
                  'linear-gradient(135deg, #111827, #020617)',
                border: '1px solid #9ca3af',
                boxShadow: '0 0 4px rgba(0,0,0,0.7)',
                flex: '0 0 auto'
              }}
            />
          );
        }

        // known/visible: small face-up thumbnail
        const art =
          (card.image_uris &&
            (card.image_uris.small ||
              card.image_uris.normal)) ||
          undefined;
        return (
          <div
            key={card.id || idx}
            title={card.name || ''}
            style={{
              width: 28,
              height: 38,
              borderRadius: 4,
              overflow: 'hidden',
              border: '1px solid #a3e635',
              boxShadow:
                '0 0 4px rgba(34,197,94,0.7)',
              flex: '0 0 auto',
              background: '#000'
            }}
          >
            {art ? (
              <img
                src={art}
                alt={card.name || ''}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 8,
                  padding: 2
                }}
              >
                {card.name || 'Known card'}
              </div>
            )}
          </div>
        );
      })}
      {playerHandCount > 12 && (
        <div
          style={{
            alignSelf: 'center',
            marginLeft: 4,
            fontSize: 10,
            opacity: 0.8
          }}
        >
          +{playerHandCount - 12} more
        </div>
      )}
    </div>
  </div>
)}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'center'
                        }}
                      >
                        {zObj && (
                          <ZonesPiles
                            zones={zObj}
                            commander={cmdObj}
                            isCommanderFormat={isCommanderFormat}
                            showHandCount={
                              !isYouThis
                                ? zObj.handCount ??
                                  (Array.isArray(zObj.hand)
                                    ? zObj.hand.length
                                    : 0)
                                : undefined
                            }
                            hideHandDetails={!isYouThis}
                            canCastCommander={!!(isCommanderFormat && isYouThis && gameId)}
                            onCastCommander={(commanderIdOrName) => {
                              if (!gameId) return;
                              socket.emit('castCommander', {
                                gameId,
                                commanderNameOrId: commanderIdOrName
                              });
                            }}
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
              onImportText={(txt, nm) => handleRequestImportText(txt, nm)}
              gameId={gameId}
              canServer={!!isYouPlayer}
              anchorEl={decksBtnRef.current}
              wide
              onUseSavedDeck={(deckId) => handleRequestUseSavedDeck(deckId)}
            />
          </div>
        </div>
      </div>

      {enablePanZoom && (
        <div style={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          zIndex: 12,
          display: 'inline-flex',
          gap: 6,
          alignItems: 'center',
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          padding: '6px 8px',
          borderRadius: 6,
          fontSize: 12
        }}>
          <button type="button" onClick={() => setCam(prev => ({ ...prev, z: clamp(prev.z * 1.15, 0.2, 2.5) }))}>+</button>
          <button type="button" onClick={() => setCam(prev => ({ ...prev, z: clamp(prev.z / 1.15, 0.15, 2.5) }))}>−</button>
          <button type="button" onClick={() => centerOnYou(true)}>Center You</button>
          <button
            type="button"
            onClick={() => {
              const margin = 24;
              const zx = (container.w / 2 - margin) / (halfW + 40);
              const zy = (container.h / 2 - margin) / (halfH + 40);
              const fitZ = clamp(Math.min(zx, zy), 0.15, 2.5);
              centerOnYou(true);
              setCam(c => ({ x: c.x, y: c.y, z: fitZ }));
            }}
          >Fit All</button>
          <span style={{ opacity: 0.85 }}>Zoom: {cam.z.toFixed(2)}</span>
        </div>
      )}

      {/* Inline chat overlay in bottom-left of play area */}
      {onSendChat && (
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: enablePanZoom ? 52 : 8, // just above zoom controls
            zIndex: 11,
            maxWidth: '28%',
            maxHeight: '40%',
            background: 'rgba(10,10,10,0.6)',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.18)',
            padding: 6,
            color: '#f9f9f9',
            fontSize: 11,
            display: 'flex',
            flexDirection: 'column',
            opacity: 0.35,
            transition: 'opacity 0.15s ease-in-out',
            pointerEvents: 'auto',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.opacity = '0.35';
          }}
        >
          <div
            style={{
              fontWeight: 600,
              marginBottom: 4,
              fontSize: 11,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Chat</span>
            <span style={{ opacity: 0.7, fontSize: 10 }}>
              {chatMessages?.length ?? 0} msg
            </span>
          </div>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              marginBottom: 4,
              paddingRight: 2,
            }}
          >
            {(!chatMessages || chatMessages.length === 0) && (
              <div style={{ color: '#bbb' }}>No messages</div>
            )}
            {chatMessages &&
              chatMessages.slice(-40).map((m) => (
                <div key={m.id} style={{ marginBottom: 3 }}>
                  <span style={{ fontWeight: 600 }}>
                    {displaySender(m.from)}:
                  </span>{" "}
                  <span>{m.message}</span>
                </div>
              ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendChat();
              }}
              placeholder="Type..."
              style={{
                flex: 1,
                fontSize: 11,
                padding: '2px 4px',
                borderRadius: 4,
                border: '1px solid #444',
                background: '#111',
                color: '#f9f9f9',
              }}
            />
            <button
              type="button"
              onClick={handleSendChat}
              style={{
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid #4ade80',
                background: '#166534',
                color: '#f9f9f9',
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {importConfirmOpen && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', zIndex: 8000
        }}>
          <div style={{ width: 520, background: '#1e1e1e', color: '#fff', padding: 16, borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Confirm Import — wipe current table?</h3>
            <div style={{ marginBottom: 12 }}>
              Importing this deck will wipe the current playfield and reset decks for this game. Do you want to continue?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={cancelImportPending}>Cancel</button>
              <button onClick={confirmAndImport} style={{ background: '#0a8', color: '#fff' }}>Yes, import and wipe</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TableLayout;
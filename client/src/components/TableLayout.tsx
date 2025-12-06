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
  CardRef,
  ClientGameView,
  ChatMsg,
  ManaPool,
} from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { AttachmentLines } from './AttachmentLines';
import { HandGallery } from './HandGallery';
import { LandRow } from './LandRow';
import { ZonesPiles } from './ZonesPiles';
import { FreeField } from './FreeField';
import { DeckManagerModal } from './DeckManagerModal';
import { CentralStack } from './CentralStack';
import { FloatingManaPool } from './FloatingManaPool';
import { socket } from '../socket';
import type { AppearanceSettings } from '../utils/appearanceSettings';
import { getPlayAreaGradientStyle, getBackgroundStyle } from '../utils/appearanceSettings';

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function isLandTypeLine(tl?: string) { return /\bland\b/i.test(tl || ''); }

// Minimum zoom for initial board fit when joining a game.
// Higher than manual zoom limits (0.15-0.2) to ensure UI elements are readable.
const MIN_INITIAL_ZOOM = 0.7;

/**
 * Identifies mana sources (mana rocks and mana dorks).
 * Mana rocks: Artifacts that produce mana (e.g., Sol Ring, Mana Crypt, signets)
 * Mana dorks: Creatures that produce mana (e.g., Llanowar Elves, Birds of Paradise)
 */
function isManaSource(perm: BattlefieldPermanent): boolean {
  const card = perm.card as any;
  if (!card) return false;
  const typeLine = (card.type_line || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  const name = (card.name || '').toLowerCase();
  
  // Don't classify lands as mana sources here - they're handled separately
  if (typeLine.includes('land')) return false;
  
  // Common mana rock patterns
  const manaArtifacts = [
    'sol ring', 'mana crypt', 'mana vault', 'grim monolith', 'lotus petal',
    'chrome mox', 'mox diamond', 'mox opal', 'mox amber', 'lion\'s eye diamond',
    'jeweled lotus', 'arcane signet', 'signet', 'talisman', 'fellwar stone',
    'mind stone', 'thought vessel', 'commander\'s sphere', 'gilded lotus',
    'thran dynamo', 'basalt monolith', 'worn powerstone', 'hedron archive',
    'everflowing chalice', 'astral cornucopia', 'coalition relic',
  ];
  
  // Common mana dork patterns
  const manaDorks = [
    'llanowar elves', 'elvish mystic', 'fyndhorn elves', 'birds of paradise',
    'noble hierarch', 'bloom tender', 'priest of titania', 'elvish archdruid',
    'deathrite shaman', 'sylvan caryatid', 'paradise druid', 'incubation druid',
  ];
  
  // Cards that are NOT mana sources even though they mention mana/tokens
  // These create tokens or have triggered abilities, not tap abilities
  const notManaSources = [
    'skullport merchant',   // Creates treasure on ETB, has sacrifice ability
    'tireless provisioner', // Landfall creates food/treasure tokens
    'feldon of the third path', // Creates token copies, not mana
    'treasure nabber',      // Steals treasures, doesn't produce mana itself
    'dockside extortionist', // ETB creates treasures, not a tap ability
    'smothering tithe',     // Creates treasures on opponent draw
    'pitiless plunderer',   // Creates treasures when creatures die
    'revel in riches',      // Creates treasures when opponents' creatures die
    'goldspan dragon',      // Creates treasures on attack/targeting
    'professional face-breaker', // Creates treasures on combat damage
    'monologue tax',        // Creates treasures when opponent casts 2nd spell
    'ruthless technomancer', // ETB creates treasures
    'storm-kiln artist',    // Creates treasures on casting spells
    'academy manufactor',   // Multiplies food/clue/treasure creation
    'westvale abbey',       // Land that transforms, not a mana source
    'chitterspitter',       // Creates tokens, has activated ability
  ];
  
  // Check if this is in the exclusion list
  for (const excluded of notManaSources) {
    if (name.includes(excluded)) return false;
  }
  
  // Check by name
  for (const pattern of manaArtifacts) {
    if (name.includes(pattern)) return true;
  }
  for (const pattern of manaDorks) {
    if (name.includes(pattern)) return true;
  }
  
  // Check oracle text for mana production abilities (only for artifacts and creatures)
  if ((typeLine.includes('artifact') || typeLine.includes('creature'))) {
    // Look for "{T}: Add" mana ability patterns - the key pattern for mana abilities
    // This must be a direct tap ability, not a triggered or activated ability with other costs
    if (oracleText.match(/\{t\}:\s*add\s*\{/i) || oracleText.match(/\{t\}:\s*add\s+one\s+mana/i)) {
      // Exclude equipment and vehicles
      if (!typeLine.includes('equipment') && !typeLine.includes('vehicle')) {
        // Also exclude if the text mentions "sacrifice" before "add" (e.g., Ashnod's Altar)
        // Those require sacrifice as a cost, making them different from pure mana sources
        if (!oracleText.match(/sacrifice.*:\s*add/i)) {
          return true;
        }
      }
    }
    
    // Specifically check for "{T}, Sacrifice": patterns that add mana
    // These are altar-style cards that sacrifice for mana
    // While technically mana sources, they behave differently
    // Include them only if explicitly tap and sacrifice
    if (oracleText.includes('{t}, sacrifice') && oracleText.match(/:\s*add\s*\{/i)) {
      // Include as mana source - these are like Chromatic Sphere
      if (!typeLine.includes('equipment') && !typeLine.includes('vehicle')) {
        return true;
      }
    }
  }
  
  return false;
}

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
  life?: Record<PlayerID, number>; // Life totals for each player
  poisonCounters?: Record<PlayerID, number>; // Poison counters for each player
  experienceCounters?: Record<PlayerID, number>; // Experience counters for each player
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
  onCastCommander?: (commanderId: string, commanderName: string, manaCost?: string, tax?: number) => void;
  reasonCannotPlayLand?: (card: any) => string | null;
  reasonCannotCast?: (card: any) => string | null;
  onImportDeckText?: (txt: string, name?: string) => void;
  onUseSavedDeck?: (deckId: string) => void;
  onLocalImportConfirmChange?: (open: boolean) => void;
  // External control for deck manager visibility
  externalDeckMgrOpen?: boolean;
  onDeckMgrOpenChange?: (open: boolean) => void;
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
  // Special game designations (Rules 724-730)
  monarch?: PlayerID | null;
  initiative?: PlayerID | null;
  dayNight?: 'day' | 'night' | null;
  cityBlessing?: Record<PlayerID, boolean>;
  // Game state for activated ability buttons
  priority?: PlayerID | null;
  phase?: string;
  step?: string;
  turnPlayer?: PlayerID | null;
  // Thousand-Year Elixir effect
  hasThousandYearElixirEffect?: boolean;
  // Appearance customization
  appearanceSettings?: AppearanceSettings;
  // Graveyard view handler
  onViewGraveyard?: (playerId: PlayerID) => void;
  onViewExile?: (playerId: PlayerID) => void;
  // Ignored trigger sources for auto-resolve shortcut
  ignoredTriggerSources?: Map<string, { sourceName: string; count: number; effect: string; imageUrl?: string }>;
  onIgnoreTriggerSource?: (sourceId: string, sourceName: string, effect: string, imageUrl?: string) => void;
  onStopIgnoringSource?: (sourceKey: string) => void;
  // Mana pool for displaying floating mana
  manaPool?: ManaPool | null;
  // Mulligan UI props - moved from App.tsx control bar
  showMulliganUI?: boolean;
  hasKeptHand?: boolean;
  mulligansTaken?: number;
  pendingBottomCount?: number;
  canKeepHand?: boolean;
  canMulligan?: boolean;
  isPreGame?: boolean;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  onRandomizeStart?: () => void;
  // Legacy 3D/pan-zoom props (kept for backwards compatibility)
  threeD?: any;
  enablePanZoom?: boolean;
  tableCloth?: { imageUrl?: string };
  worldSize?: number;
  onUpdatePermPos?: (id: string, x: number, y: number, z: number) => void;
}) {
  const {
    players, permanentsByPlayer, imagePref, isYouPlayer,
    splitLands = true, enableReorderForYou = false,
    you, zones, commandZone, format, life, poisonCounters, experienceCounters, showYourHandBelow = true,
    onRemove, onCounter, onBulkCounter,
    highlightPermTargets, selectedPermTargets, onPermanentClick,
    highlightPlayerTargets, selectedPlayerTargets, onPlayerClick,
    onPlayLandFromHand, onCastFromHand, onCastCommander, reasonCannotPlayLand, reasonCannotCast,
    onReorderHand, onShuffleHand,
    threeD, enablePanZoom = true,
    tableCloth, worldSize, onUpdatePermPos,
    onImportDeckText, onUseSavedDeck, onLocalImportConfirmChange,
    externalDeckMgrOpen, onDeckMgrOpenChange,
    gameId, stackItems, importedCandidates, energyCounters, energy,
    chatMessages, onSendChat, chatView, chatYou,
    monarch, initiative, dayNight, cityBlessing,
    priority, phase, step, turnPlayer,
    hasThousandYearElixirEffect = false,
    appearanceSettings,
    onViewGraveyard, onViewExile,
    ignoredTriggerSources, onIgnoreTriggerSource, onStopIgnoringSource,
    manaPool,
    // Mulligan UI props
    showMulliganUI, hasKeptHand, mulligansTaken = 0, pendingBottomCount = 0,
    canKeepHand, canMulligan, isPreGame,
    onKeepHand, onMulligan, onRandomizeStart,
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

  // Compute game state for activated ability buttons
  const hasPriority = useMemo(() => you && priority === you, [you, priority]);
  const isOwnTurn = useMemo(() => you && turnPlayer === you, [you, turnPlayer]);
  const isMainPhase = useMemo(() => {
    const p = (phase || '').toLowerCase();
    return p.includes('main') || p.includes('precombat') || p.includes('postcombat');
  }, [phase]);
  const stackEmpty = useMemo(() => !stackItems || stackItems.length === 0, [stackItems]);

  // Layout constants - sized for comfortable 7-card display in hand
  // Extended play areas by ~15% for better card visibility
  const CARD_ASPECT_RATIO = 0.72; // Standard MTG card width/height ratio (2.5" x 3.5")
  const TILE_W = 135; // Card width in px (increased from 115 for better visibility)
  const tileH = Math.round(TILE_W / CARD_ASPECT_RATIO);
  const ZONES_W = 175; // Zones panel width in px (slightly increased)
  const GRID_GAP = 12; // Gap between cards in px (slightly increased)
  
  // Padding and sizing constants (in pixels) for extended play area layout
  const HAND_EXTRA_PADDING = 80; // Extra horizontal padding to ensure 7 cards fit
  const FIELD_HEIGHT_PADDING = 160; // Additional height for play field rows
  const BOARD_SIDE_PADDING = 40; // Horizontal margin for board container
  const BOARD_HEIGHT_PADDING = 320; // Additional height for hand area below field
  // Height offset for play area container to account for header/join section above
  const PLAY_AREA_TOP_OFFSET = 140;
  
  // Hand row: 7 cards wide + gaps + generous padding for shuffle button header
  const FREE_W = 7 * TILE_W + 6 * GRID_GAP + HAND_EXTRA_PADDING;
  const FREE_H = Math.round(3 * tileH + FIELD_HEIGHT_PADDING);
  const BOARD_W = FREE_W + ZONES_W + BOARD_SIDE_PADDING;
  const BOARD_H = Math.round(FREE_H + tileH + BOARD_HEIGHT_PADDING);
  const SEAT_GAP_X = 90, SEAT_GAP_Y = 90, CENTER_CLEAR_X = 160, CENTER_CLEAR_Y = 160, SIDE_PAD = 30;

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
          // Position player field at 92% from top (was 72%) to account for mulligan bar
          // This moves the view down an extra 20% of screen height
          const targetSY = Math.round(container.h * 0.92);
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
    // Add a vertical offset to push view down 20% of screen height
    // This prevents the mulligan bar from overlapping the deck import button on join
    const mulliganBarOffset = Math.round(container.h * 0.20);
    const cy2 = pos.y + ny * shift + mulliganBarOffset;
    setCam(c => ({ x: cx2, y: cy2, z: preserveZoom ? c.z : c.z }));
  }

  const didFit = useRef(false);
  useEffect(() => {
    if (!container.w || !container.h) return;
    const margin = 24;
    const zx = (container.w / 2 - margin) / (halfW + 40);
    const zy = (container.h / 2 - margin) / (halfH + 40);
    const fitZ = clamp(Math.min(zx, zy), MIN_INITIAL_ZOOM, 2.0);
    if (!didFit.current || ordered.length !== (didFit as any).lastN) {
      centerOnYou(true);
      setCam(prev => ({ x: prev.x, y: prev.y, z: fitZ }));
      didFit.current = true;
      (didFit as any).lastN = ordered.length;
    }
  }, [container.w, container.h, ordered.length, halfW, halfH]);

  // Auto-center on player's playfield when `you` prop changes (player joins the game)
  // Note: centerOnYou is intentionally not in deps - it uses refs/state that don't cause stale closures
  // and including it would cause unnecessary re-runs since it's not wrapped in useCallback
  const prevYou = useRef<PlayerID | undefined>(undefined);
  useEffect(() => {
    if (you && you !== prevYou.current && container.w && container.h) {
      // Small delay to allow the DOM to update with player's hand area
      const timer = setTimeout(() => {
        centerOnYou(true);
      }, 100);
      prevYou.current = you;
      return () => clearTimeout(timer);
    }
    prevYou.current = you;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [you, container.w, container.h]);

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
  const [deckMgrOpenInternal, setDeckMgrOpenInternal] = useState(false);
  // Use external prop if provided, otherwise use internal state
  const deckMgrOpen = externalDeckMgrOpen !== undefined ? externalDeckMgrOpen : deckMgrOpenInternal;
  const setDeckMgrOpen = (open: boolean) => {
    if (onDeckMgrOpenChange) {
      onDeckMgrOpenChange(open);
    } else {
      setDeckMgrOpenInternal(open);
    }
  };
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

  // Table surface background (the large "tablecloth" area behind all player boards)
  // Uses tableBackground setting for the outer table surface
  const clothBg: React.CSSProperties = useMemo(() => {
    if (appearanceSettings) {
      return getBackgroundStyle(appearanceSettings.tableBackground);
    }
    // Legacy support for tableCloth prop
    if (props.tableCloth?.imageUrl) {
      return {
        backgroundImage: `url(${props.tableCloth.imageUrl})`,
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      };
    }
    // Default dark background for table surface
    return {
      background: '#0a0a12',
    };
  }, [appearanceSettings, props.tableCloth?.imageUrl]);

  // Table container background (outer viewport container)
  const tableContainerBg: React.CSSProperties = useMemo(() => {
    if (appearanceSettings) {
      return getBackgroundStyle(appearanceSettings.tableBackground);
    }
    // Default dark background
    return { background: '#0a0a12' };
  }, [appearanceSettings]);

  // Player board background (the individual field sections where each player's cards are)
  // Uses playAreaBackground setting for per-player card areas
  const playerBoardBg: React.CSSProperties = useMemo(() => {
    if (appearanceSettings) {
      return getPlayAreaGradientStyle(appearanceSettings.playAreaBackground);
    }
    // Default semi-transparent gradient overlay
    return {
      background: 'linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
    };
  }, [appearanceSettings]);

  // local chat input state for overlay
  const [chatText, setChatText] = useState("");
  
  // Chat panel state: collapsed and size
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatSize, setChatSize] = useState<'small' | 'medium' | 'large'>('small');
  
  // Chat auto-scroll: ref and state to track if user has manually scrolled up
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [chatUserScrolledUp, setChatUserScrolledUp] = useState(false);
  
  // Chat size dimensions
  const chatSizeConfig = {
    small: { width: 220, height: 150 },
    medium: { width: 300, height: 220 },
    large: { width: 400, height: 300 },
  };
  
  // Auto-scroll chat to bottom when new messages arrive (unless user has scrolled up)
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container || chatUserScrolledUp) return;
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }, [chatMessages, chatUserScrolledUp]);
  
  // Handle chat scroll: detect if user scrolled up or back to bottom
  const SCROLL_BOTTOM_THRESHOLD = 10; // Pixels from bottom to consider "at bottom"
  const handleChatScroll = () => {
    const container = chatContainerRef.current;
    if (!container) return;
    
    // Check if user is at the bottom (with a small threshold for rounding errors)
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < SCROLL_BOTTOM_THRESHOLD;
    
    // If user scrolls back to bottom, resume auto-scroll
    if (isAtBottom && chatUserScrolledUp) {
      setChatUserScrolledUp(false);
    }
    // If user scrolls up (away from bottom), pause auto-scroll
    else if (!isAtBottom && !chatUserScrolledUp) {
      setChatUserScrolledUp(true);
    }
  };

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

  // Opponent-hand thumbnail sizing (≈50% larger than before)
  const OPP_THUMB_W = 42;  // was 28
  const OPP_THUMB_H = 57;  // was 38

  return (
    <>
      {/* Keyframes for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.03); }
        }
      `}</style>
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
          height: `calc(100vh - ${PLAY_AREA_TOP_OFFSET}px)`,
          minHeight: '500px',
          overflow: 'hidden',
          ...tableContainerBg,
          border: '1px solid #222',
          borderRadius: 12,
          userSelect: 'none',
          cursor: enablePanZoom ? (dragRef.current ? 'grabbing' : (panKey ? 'grab' : 'default')) : 'default',
          overscrollBehavior: 'none',
          position: 'relative'
        }}
      >
      {/* Mulligan UI overlay at top of play area */}
      {showMulliganUI && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            padding: '8px 16px',
            borderRadius: 8,
            border: !hasKeptHand && !isPreGame ? '2px solid #ef4444' : '1px solid rgba(167, 139, 250, 0.6)',
            background: !hasKeptHand && !isPreGame 
              ? 'rgba(239, 68, 68, 0.15)' 
              : 'rgba(30, 30, 50, 0.95)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            color: '#fff',
            pointerEvents: 'auto',
          }}
        >
          {hasKeptHand ? (
            <span style={{ fontSize: 13, color: '#a78bfa', fontWeight: 500 }}>
              ✓ Hand kept{mulligansTaken > 0 ? ` (${7 - mulligansTaken} cards)` : ''}
            </span>
          ) : pendingBottomCount > 0 ? (
            <span style={{ fontSize: 13, color: '#fbbf24', fontWeight: 500 }}>
              Select {pendingBottomCount} card{pendingBottomCount !== 1 ? 's' : ''} to put on bottom...
            </span>
          ) : (
            <>
              {!isPreGame && (
                <span style={{ fontSize: 12, color: '#fca5a5', fontWeight: 600 }}>
                  ⚠️ Keep your hand to continue!
                </span>
              )}
              <span style={{ fontSize: 12, color: '#c4b5fd' }}>
                Mulligans: {mulligansTaken}
              </span>
              <button
                onClick={onKeepHand}
                disabled={!canKeepHand}
                style={{
                  background: canKeepHand ? '#10b981' : '#4b5563',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 14px',
                  cursor: canKeepHand ? 'pointer' : 'not-allowed',
                  opacity: canKeepHand ? 1 : 0.5,
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Keep Hand
              </button>
              <button
                onClick={onMulligan}
                disabled={!canMulligan}
                style={{
                  background: canMulligan ? '#f59e0b' : '#4b5563',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 14px',
                  cursor: canMulligan ? 'pointer' : 'not-allowed',
                  opacity: canMulligan ? 1 : 0.5,
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Mulligan
              </button>
              {isPreGame && onRandomizeStart && (
                <button
                  onClick={onRandomizeStart}
                  style={{
                    background: '#8b5cf6',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 14px',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                  title="Randomly select which player goes first"
                >
                  🎲 Random Start
                </button>
              )}
            </>
          )}
        </div>
      )}

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
                // Tokens are now shown as regular battlefield cards, not in a separate section
                // This gives them proper card display with images like other permanents
                const lands = splitLands ? perms.filter(x => isLandTypeLine((x.card as any)?.type_line)) : [];
                // Separate mana sources (mana rocks/dorks) from other permanents
                // Include ALL non-land permanents (both tokens and non-tokens)
                const nonLands = splitLands ? perms.filter(x => !isLandTypeLine((x.card as any)?.type_line)) : perms;
                const manaSources = nonLands.filter(x => isManaSource(x));
                const others = nonLands.filter(x => !isManaSource(x));
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
                  life?.[pb.player.id] ??
                  40;
                const poisonVal = poisonCounters?.[pb.player.id] ?? 0;
                const xpVal = experienceCounters?.[pb.player.id] ?? 0;
                const energyVal =
                  energyCounters?.[pb.player.id] ??
                  energy?.[pb.player.id] ??
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
                        ...playerBoardBg,
                        backdropFilter: 'blur(4px)',
                        borderRadius: 12,
                        padding: 12,
                        border: '1px solid rgba(255,255,255,0.12)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
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
                            marginBottom: 10,
                            paddingBottom: 8,
                            borderBottom: '1px solid rgba(255,255,255,0.08)'
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12
                            }}
                          >
                            <span style={{ fontSize: 14 }}>{pb.player.name}</span>
                            {/* Enhanced Counter Display Panel */}
                            <div
                              style={{
                                display: 'flex',
                                gap: 10,
                                fontSize: 12,
                                background: 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(20,20,30,0.6) 100%)',
                                padding: '6px 12px',
                                borderRadius: 6,
                                border: '1px solid rgba(255,255,255,0.1)',
                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)'
                              }}
                            >
                              {/* Life Counter - Always visible, larger */}
                              <span 
                                aria-label={`Life: ${lifeVal}`} 
                                title="Life Total"
                                style={{ 
                                  color: lifeVal <= 10 ? '#ef4444' : lifeVal <= 20 ? '#fbbf24' : '#4ade80', 
                                  fontWeight: 700,
                                  fontSize: 14,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3
                                }}
                              >
                                ❤️ {lifeVal}
                              </span>
                              {/* Separator */}
                              <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>|</span>
                              {/* Poison Counter - Critical warning at 7+ */}
                              <span
                                aria-label={`Poison Counters: ${poisonVal}`}
                                title={`Poison Counters (Lose at 10)`}
                                style={{
                                  color: poisonVal >= 7 ? '#dc2626' : poisonVal > 0 ? '#f87171' : 'rgba(136,136,136,0.6)',
                                  fontWeight: poisonVal > 0 ? 700 : 400,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3,
                                  animation: poisonVal >= 7 ? 'pulse 1.5s infinite' : 'none'
                                }}
                              >
                                ☠️ {poisonVal}{poisonVal >= 7 && <span style={{ fontSize: 9, marginLeft: 2 }}>⚠</span>}
                              </span>
                              {/* Experience Counter */}
                              <span
                                aria-label={`Experience Counters: ${xpVal}`}
                                title="Experience Counters"
                                style={{
                                  color: xpVal > 0 ? '#60a5fa' : 'rgba(136,136,136,0.6)',
                                  fontWeight: xpVal > 0 ? 600 : 400,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3
                                }}
                              >
                                ⭐ {xpVal}
                              </span>
                              {/* Energy Counter - Resource to spend */}
                              <span
                                aria-label={`Energy Counters: ${energyVal}`}
                                title="Energy Counters (Resource)"
                                style={{ 
                                  color: energyVal > 0 ? '#fbbf24' : 'rgba(136,136,136,0.6)',
                                  fontWeight: energyVal > 0 ? 600 : 400,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3
                                }}
                              >
                                ⚡ {energyVal}
                              </span>
                            </div>
                            {/* Floating Mana Pool - Show next to counters for current player */}
                            {isYouThis && manaPool && (
                              <FloatingManaPool manaPool={manaPool} compact />
                            )}
                            {isYouThis && (
                              <button
                                ref={decksBtnRef}
                                type="button"
                                onClick={() => setDeckMgrOpen(true)}
                                style={{ 
                                  fontSize: 12, 
                                  fontWeight: 600,
                                  padding: '6px 14px',
                                  borderRadius: 6,
                                  background: (zObj?.libraryCount || 0) === 0 
                                    ? 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)' 
                                    : 'rgba(59, 130, 246, 0.2)',
                                  border: (zObj?.libraryCount || 0) === 0 
                                    ? '2px solid #a78bfa'
                                    : '1px solid rgba(59, 130, 246, 0.4)',
                                  color: '#fff',
                                  cursor: 'pointer',
                                  boxShadow: (zObj?.libraryCount || 0) === 0 
                                    ? '0 0 20px rgba(124, 58, 237, 0.5), 0 4px 12px rgba(37, 99, 235, 0.4)' 
                                    : 'none',
                                  animation: (zObj?.libraryCount || 0) === 0 
                                    ? 'pulse 2s ease-in-out infinite' 
                                    : 'none',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                                title={gameId ? "Manage / Import Deck" : "Waiting for game to be ready"}
                                disabled={!gameId}
                              >
                                📚 {(zObj?.libraryCount || 0) === 0 ? 'Import Deck' : 'Decks'}
                              </button>
                            )}
                            {/* 
                              Special game designation badges (MTG Rules 724-730):
                              - Monarch (Rule 724): Player draws extra card at end step
                              - Initiative (Rule 725): Player ventures into Undercity at upkeep
                              - City's Blessing (Ascend): Permanent designation after controlling 10+ permanents
                            */}
                            {monarch === pb.player.id && (
                              <span
                                aria-label="This player is the Monarch"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: 'rgba(234,179,8,0.2)',
                                  border: '1px solid rgba(234,179,8,0.4)',
                                  color: '#eab308',
                                  fontSize: 11,
                                  fontWeight: 600
                                }}
                              >
                                👑 Monarch
                              </span>
                            )}
                            {initiative === pb.player.id && (
                              <span
                                aria-label="This player has the Initiative"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: 'rgba(168,85,247,0.2)',
                                  border: '1px solid rgba(168,85,247,0.4)',
                                  color: '#a855f7',
                                  fontSize: 11,
                                  fontWeight: 600
                                }}
                              >
                                🗡️ Initiative
                              </span>
                            )}
                            {cityBlessing?.[pb.player.id] && (
                              <span
                                aria-label="This player has the City's Blessing"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: 'rgba(20,184,166,0.2)',
                                  border: '1px solid rgba(20,184,166,0.4)',
                                  color: '#14b8a6',
                                  fontSize: 11,
                                  fontWeight: 600
                                }}
                              >
                                🏛️ Ascended
                              </span>
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
                          imagePref={imagePref || 'small'}
                          tileWidth={TILE_W}
                          widthPx={FREE_W}
                          heightPx={FREE_H}
                          draggable={!!isYouThis}
                          onMove={(id, xx, yy, zz) =>
                            onUpdatePermPos?.(id, xx, yy, zz ?? 0)
                          }
                          highlightTargets={highlightPermTargets}
                          selectedTargets={selectedPermTargets}
                          onCardClick={onPermanentClick}
                          players={players.map(p => ({ id: p.id, name: p.name }))}
                          onTap={isYouThis && gameId ? (id) => socket.emit('tapPermanent', { gameId, permanentId: id }) : undefined}
                          onUntap={isYouThis && gameId ? (id) => socket.emit('untapPermanent', { gameId, permanentId: id }) : undefined}
                          onActivateAbility={isYouThis && gameId ? (permanentId, abilityId) => socket.emit('activateBattlefieldAbility', { gameId, permanentId, abilityId: typeof abilityId === 'number' ? String(abilityId) : (abilityId || '0') }) : undefined}
                          onAddCounter={isYouThis ? onCounter : undefined}
                          onSacrifice={isYouThis && gameId ? (id) => socket.emit('sacrificePermanent', { gameId, permanentId: id }) : undefined}
                          onRemove={isYouThis ? onRemove : undefined}
                          canActivate={isYouThis || false}
                          playerId={isYouThis ? you : undefined}
                          hasPriority={hasPriority || false}
                          isOwnTurn={!!isOwnTurn}
                          isMainPhase={!!isMainPhase}
                          stackEmpty={stackEmpty}
                          hasThousandYearElixirEffect={hasThousandYearElixirEffect}
                          showActivatedAbilityButtons={!!isYouThis}
                        />

                        {/* Mana Sources Row (mana rocks, dorks) - positioned above lands */}
                        {manaSources.length > 0 && (
                          <div style={{ marginTop: 8 }} data-no-zoom>
                            <div
                              style={{
                                fontSize: 11,
                                opacity: 0.65,
                                marginBottom: 4,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6
                              }}
                            >
                              <span style={{ color: '#fbbf24' }}>💎</span>
                              <span>Mana Sources ({manaSources.length})</span>
                            </div>
                            <LandRow
                              lands={manaSources}
                              imagePref={imagePref || 'small'}
                              tileWidth={Math.round(TILE_W * 0.85)}
                              overlapRatio={0.4}
                              highlightTargets={highlightPermTargets}
                              selectedTargets={selectedPermTargets}
                              onCardClick={onPermanentClick}
                              onRemove={isYouPlayer ? onRemove : undefined}
                              onCounter={isYouPlayer ? onCounter : undefined}
                              onTap={isYouThis && gameId ? (id) => socket.emit('tapPermanent', { gameId, permanentId: id }) : undefined}
                              onUntap={isYouThis && gameId ? (id) => socket.emit('untapPermanent', { gameId, permanentId: id }) : undefined}
                              onActivateAbility={isYouThis && gameId ? (permanentId, abilityId) => socket.emit('activateBattlefieldAbility', { gameId, permanentId, abilityId: typeof abilityId === 'number' ? String(abilityId) : (abilityId || '0') }) : undefined}
                              onSacrifice={isYouThis && gameId ? (id) => socket.emit('sacrificePermanent', { gameId, permanentId: id }) : undefined}
                              canActivate={isYouThis || false}
                              playerId={isYouThis ? you : undefined}
                              hasPriority={hasPriority || false}
                              isOwnTurn={!!isOwnTurn}
                              isMainPhase={!!isMainPhase}
                              stackEmpty={stackEmpty}
                            />
                          </div>
                        )}

                        {/* Lands Row - positioned at bottom, just above hand */}
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
                              imagePref={imagePref || 'small'}
                              tileWidth={TILE_W}
                              overlapRatio={0.33}
                              highlightTargets={highlightPermTargets}
                              selectedTargets={selectedPermTargets}
                              onCardClick={onPermanentClick}
                              onRemove={isYouPlayer ? onRemove : undefined}
                              onCounter={isYouPlayer ? onCounter : undefined}
                              onTap={isYouThis && gameId ? (id) => socket.emit('tapPermanent', { gameId, permanentId: id }) : undefined}
                              onUntap={isYouThis && gameId ? (id) => socket.emit('untapPermanent', { gameId, permanentId: id }) : undefined}
                              onActivateAbility={isYouThis && gameId ? (permanentId, abilityId) => socket.emit('activateBattlefieldAbility', { gameId, permanentId, abilityId: typeof abilityId === 'number' ? String(abilityId) : (abilityId || '0') }) : undefined}
                              onSacrifice={isYouThis && gameId ? (id) => socket.emit('sacrificePermanent', { gameId, permanentId: id }) : undefined}
                              canActivate={isYouThis || false}
                              playerId={isYouThis ? you : undefined}
                              hasPriority={hasPriority || false}
                              isOwnTurn={!!isOwnTurn}
                              isMainPhase={!!isMainPhase}
                              stackEmpty={stackEmpty}
                            />
                          </div>
                        )}

                        {/* YOUR hand (full details) */}
                        {isYouThis && showYourHandBelow && (
                          <div
                            id={`hand-area-${pb.player.id}`}
                            style={{
                              marginTop: 12,
                              background: 'linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.85) 100%)',
                              border: '1px solid rgba(255,255,255,0.15)',
                              borderRadius: 10,
                              padding: 10,
                              maxHeight: '32vh',
                              overflowY: 'auto',
                              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
                            }}
                            data-no-zoom
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 8
                              }}
                            >
                              <div
                                style={{ fontSize: 12, color: '#e5e5e5', fontWeight: 500 }}
                              >
                                Your Hand
                              </div>
                              {onShuffleHand && (
                                <button
                                  type="button"
                                  onClick={() => onShuffleHand()}
                                  style={{
                                    fontSize: 11,
                                    padding: '3px 10px',
                                    borderRadius: 4,
                                    background: 'rgba(255,255,255,0.1)',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    color: '#ccc',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Shuffle
                                </button>
                              )}
                            </div>
                            <HandGallery
                              cards={yourHand as CardRef[]}
                              imagePref={imagePref || 'small'}
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
                              // 7 cards per row for your own hand
                              layout="wrap7"
                              overlapPx={0}
                              rowGapPx={10}
                              enableReorder={allowReorderHere}
                              onReorder={onReorderHand}
                            />
                          </div>
                        )}

                        {/* OPPONENTS' hand strip: thumbnails, larger + hover for known cards */}
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
                              minHeight: OPP_THUMB_H + 16,
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
                                minHeight: OPP_THUMB_H,
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
                                        width: OPP_THUMB_W,
                                        height: OPP_THUMB_H,
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

                                // known/visible: small face-up thumbnail with preview support
                                const art =
                                  (card.image_uris &&
                                    (card.image_uris.small ||
                                      card.image_uris.normal)) ||
                                  undefined;
                                const previewPayload = JSON.stringify({
                                  id: card.id,
                                  name: card.name,
                                  type_line: card.type_line,
                                  image_uris: card.image_uris,
                                });

                                return (
                                  <div
                                    key={card.id || idx}
                                    title={card.name || ''}
                                    style={{
                                      width: OPP_THUMB_W,
                                      height: OPP_THUMB_H,
                                      borderRadius: 4,
                                      overflow: 'hidden',
                                      border: '1px solid #a3e635',
                                      boxShadow:
                                        '0 0 4px rgba(34,197,94,0.7)',
                                      flex: '0 0 auto',
                                      background: '#000',
                                      cursor: 'pointer',
                                    }}
                                    // Let CardPreviewLayer hook this via dataset, same as other cards
                                    data-preview-card={previewPayload}
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
                                          fontSize: 9,
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
                            onCastCommander={(commanderId, commanderName, manaCost, tax) => {
                              if (!gameId) return;
                              // Use the callback if provided, otherwise emit directly
                              if (onCastCommander) {
                                onCastCommander(commanderId, commanderName, manaCost, tax);
                              } else {
                                socket.emit('castCommander', {
                                  gameId,
                                  commanderNameOrId: commanderId
                                });
                              }
                            }}
                            onViewGraveyard={onViewGraveyard ? () => onViewGraveyard(pb.player.id) : undefined}
                            onViewExile={onViewExile ? () => onViewExile(pb.player.id) : undefined}
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
              // "Fit All" uses a lower minimum zoom (0.15) than initial fit (MIN_INITIAL_ZOOM)
              // because the user explicitly wants to see the entire board
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
            width: chatCollapsed ? 'auto' : chatSizeConfig[chatSize].width,
            height: chatCollapsed ? 'auto' : chatSizeConfig[chatSize].height,
            background: 'rgba(10,10,10,0.6)',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.18)',
            padding: 6,
            color: '#f9f9f9',
            fontSize: 11,
            display: 'flex',
            flexDirection: 'column',
            opacity: chatCollapsed ? 0.6 : 0.35,
            transition: 'opacity 0.15s ease-in-out, width 0.2s ease-in-out, height 0.2s ease-in-out',
            pointerEvents: 'auto',
            overflow: 'hidden',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.opacity = chatCollapsed ? '0.6' : '0.35';
          }}
        >
          <div
            style={{
              fontWeight: 600,
              marginBottom: chatCollapsed ? 0 : 4,
              fontSize: 11,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={() => setChatCollapsed(!chatCollapsed)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#f9f9f9',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 10,
                }}
                title={chatCollapsed ? 'Expand chat' : 'Collapse chat'}
              >
                {chatCollapsed ? '▶' : '▼'}
              </button>
              <span>Chat</span>
              <span style={{ opacity: 0.7, fontSize: 10 }}>
                ({chatMessages?.length ?? 0})
              </span>
            </div>
            {!chatCollapsed && (
              <div style={{ display: 'flex', gap: 2 }}>
                <button
                  type="button"
                  onClick={() => setChatSize('small')}
                  style={{
                    background: chatSize === 'small' ? 'rgba(255,255,255,0.2)' : 'none',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 3,
                    color: '#f9f9f9',
                    cursor: 'pointer',
                    padding: '1px 4px',
                    fontSize: 9,
                  }}
                  title="Small"
                >
                  S
                </button>
                <button
                  type="button"
                  onClick={() => setChatSize('medium')}
                  style={{
                    background: chatSize === 'medium' ? 'rgba(255,255,255,0.2)' : 'none',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 3,
                    color: '#f9f9f9',
                    cursor: 'pointer',
                    padding: '1px 4px',
                    fontSize: 9,
                  }}
                  title="Medium"
                >
                  M
                </button>
                <button
                  type="button"
                  onClick={() => setChatSize('large')}
                  style={{
                    background: chatSize === 'large' ? 'rgba(255,255,255,0.2)' : 'none',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 3,
                    color: '#f9f9f9',
                    cursor: 'pointer',
                    padding: '1px 4px',
                    fontSize: 9,
                  }}
                  title="Large"
                >
                  L
                </button>
              </div>
            )}
          </div>
          {!chatCollapsed && (
            <>
              <div
                ref={chatContainerRef}
                onScroll={handleChatScroll}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  marginBottom: 4,
                  paddingRight: 2,
                  minHeight: 0, // Allow flex child to shrink below content size for proper scrolling
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
            </>
          )}
        </div>
      )}

      {/* Stack display - shows when stack is not empty */}
      {stackItems && stackItems.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 100, // Above other elements
            pointerEvents: 'none', // Allow clicks through container
          }}
        >
          <CentralStack
            stack={stackItems}
            battlefield={chatView?.battlefield}
            players={chatView?.players}
            you={you}
            priorityPlayer={chatView?.priority}
            onPass={() => {
              if (gameId && you) socket.emit('passPriority', { gameId, by: you });
            }}
            onResolveAll={() => {
              if (gameId && you) socket.emit('resolveAllTriggers', { gameId });
            }}
            ignoredSources={ignoredTriggerSources}
            onIgnoreTriggerSource={onIgnoreTriggerSource}
            onStopIgnoring={onStopIgnoringSource}
          />
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
    </>
  );
}

export default TableLayout;
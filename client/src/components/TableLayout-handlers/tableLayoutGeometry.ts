// Origin parent: client/src/components/TableLayout.tsx
// Cluster moved: clamp, isLandTypeLine, rotatePoint, getTotalFloatingMana,
// MIN_INITIAL_ZOOM, Side, PlayerBoard, HandCard, sidePlan, buildPositions, computeExtents.
// Public entry symbols: clamp, isLandTypeLine, rotatePoint, getTotalFloatingMana,
// MIN_INITIAL_ZOOM, sidePlan, buildPositions, computeExtents, Side, PlayerBoard, HandCard.

import type { BattlefieldPermanent, ManaPool, PlayerRef } from '../../../../shared/src';

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function isLandTypeLine(tl?: string) { return /\bland\b/i.test(tl || ''); }
function rotatePoint(x: number, y: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

function getTotalFloatingMana(manaPool?: ManaPool | null) {
  if (!manaPool) return 0;

  const unrestricted =
    Number(manaPool.white || 0) +
    Number(manaPool.blue || 0) +
    Number(manaPool.black || 0) +
    Number(manaPool.red || 0) +
    Number(manaPool.green || 0) +
    Number(manaPool.colorless || 0) +
    Number(manaPool.generic || 0);
  const restricted = Array.isArray(manaPool.restricted)
    ? manaPool.restricted.reduce((sum, entry) => sum + Number(entry?.amount || 0), 0)
    : 0;

  return unrestricted + restricted;
}

// Minimum zoom for initial board fit when joining a game.
// Higher than manual zoom limits (0.15-0.2) to ensure UI elements are readable.
const MIN_INITIAL_ZOOM = 0.7;

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

export {
  clamp,
  isLandTypeLine,
  rotatePoint,
  getTotalFloatingMana,
  MIN_INITIAL_ZOOM,
  sidePlan,
  buildPositions,
  computeExtents,
};
export type { Side, PlayerBoard, HandCard };

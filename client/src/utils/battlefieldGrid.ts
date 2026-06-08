/**
 * Battlefield grid layout: snap permanents to cells, cascade-stack cards in the same cell.
 */

export interface BattlefieldGridLayout {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  columnGap: number;
  rowGap: number;
  tileWidth: number;
  tileH: number;
}

export const BATTLEFIELD_COLUMN_GAP = 12;
export const BATTLEFIELD_ROW_GAP = 18;
/** Horizontal cascade per card in a stack (reveals left edge of cards behind). */
export const BATTLEFIELD_STACK_OFFSET_X = 18;
/** Vertical cascade per card in a stack. */
export const BATTLEFIELD_STACK_OFFSET_Y = 8;
export const BATTLEFIELD_MAX_STACK_CASCADE = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createBattlefieldGrid(
  widthPx: number,
  heightPx: number,
  tileWidth: number,
): BattlefieldGridLayout {
  const columnGap = BATTLEFIELD_COLUMN_GAP;
  const rowGap = BATTLEFIELD_ROW_GAP;
  const tileH = Math.round(tileWidth / 0.72);
  const cellW = tileWidth + columnGap;
  const cellH = tileH + rowGap;
  const cols = Math.max(1, Math.floor((widthPx + columnGap) / cellW));
  const rows = Math.max(1, Math.floor((heightPx + rowGap) / cellH));
  return { cols, rows, cellW, cellH, columnGap, rowGap, tileWidth, tileH };
}

export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function parseCellKey(key: string): { col: number; row: number } | null {
  const [colRaw, rowRaw] = key.split(',');
  const col = Number.parseInt(colRaw, 10);
  const row = Number.parseInt(rowRaw, 10);
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
  return { col, row };
}

export function cellOrigin(col: number, row: number, grid: BattlefieldGridLayout): { x: number; y: number } {
  return { x: col * grid.cellW, y: row * grid.cellH };
}

/** Snap a pixel position to the top-left of the nearest grid cell. */
export function snapPixelToCell(
  pixelX: number,
  pixelY: number,
  grid: BattlefieldGridLayout,
): { col: number; row: number; x: number; y: number } {
  const col = clamp(Math.round(pixelX / grid.cellW), 0, grid.cols - 1);
  const row = clamp(Math.round(pixelY / grid.cellH), 0, grid.rows - 1);
  const origin = cellOrigin(col, row, grid);
  return { col, row, x: origin.x, y: origin.y };
}

export function originToCellKey(x: number, y: number, grid: BattlefieldGridLayout): string {
  const snapped = snapPixelToCell(x, y, grid);
  return cellKey(snapped.col, snapped.row);
}

/** Cascade offset so stacked cards show a strip of each card's left/top edge. */
export function stackCascadeOffset(stackIndex: number): { dx: number; dy: number } {
  const capped = Math.min(Math.max(0, stackIndex), BATTLEFIELD_MAX_STACK_CASCADE);
  return {
    dx: capped * BATTLEFIELD_STACK_OFFSET_X,
    dy: capped * BATTLEFIELD_STACK_OFFSET_Y,
  };
}

export function displayPositionFromCell(
  cellX: number,
  cellY: number,
  stackIndex: number,
): { x: number; y: number } {
  const { dx, dy } = stackCascadeOffset(stackIndex);
  return { x: cellX + dx, y: cellY + dy };
}

/** First empty cell in row-major order. */
export function nextEmptyCell(
  occupied: Set<string>,
  grid: BattlefieldGridLayout,
): { col: number; row: number; x: number; y: number; key: string } | null {
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const key = cellKey(col, row);
      if (!occupied.has(key)) {
        const origin = cellOrigin(col, row, grid);
        return { col, row, x: origin.x, y: origin.y, key };
      }
    }
  }
  return null;
}

export type CellPlacement = {
  permanentId: string;
  cellX: number;
  cellY: number;
  col: number;
  row: number;
  z?: number;
};

/**
 * Assign each permanent to a grid cell (origin). Multiple permanents may share a cell (stack).
 */
export function assignPermanentsToCells(
  entries: Array<{ id: string; preferred: { x: number; y: number; z?: number } | null }>,
  grid: BattlefieldGridLayout,
): CellPlacement[] {
  const occupied = new Set<string>();
  const cellMembers = new Map<string, string[]>();
  const placements: CellPlacement[] = [];

  const registerInCell = (id: string, col: number, row: number, x: number, y: number, z?: number) => {
    const key = cellKey(col, row);
    occupied.add(key);
    const list = cellMembers.get(key) || [];
    list.push(id);
    cellMembers.set(key, list);
    placements.push({ permanentId: id, cellX: x, cellY: y, col, row, z });
  };

  for (const entry of entries) {
    if (entry.preferred) {
      const snapped = snapPixelToCell(entry.preferred.x, entry.preferred.y, grid);
      registerInCell(entry.id, snapped.col, snapped.row, snapped.x, snapped.y, entry.preferred.z);
      continue;
    }
    const empty = nextEmptyCell(occupied, grid);
    if (!empty) {
      const fallback = snapPixelToCell(0, 0, grid);
      registerInCell(entry.id, fallback.col, fallback.row, fallback.x, fallback.y);
      continue;
    }
    registerInCell(entry.id, empty.col, empty.row, empty.x, empty.y);
  }

  return placements;
}

export function sortStackOrder(
  ids: string[],
  zById: Map<string, number>,
): string[] {
  return [...ids].sort((a, b) => {
    const za = zById.get(a) ?? 0;
    const zb = zById.get(b) ?? 0;
    if (za !== zb) return za - zb;
    return a.localeCompare(b);
  });
}

export type GridShiftDirection = 'up' | 'down' | 'left' | 'right';

const ARROW_TO_SHIFT: Record<string, GridShiftDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function arrowKeyToShiftDirection(key: string): GridShiftDirection | null {
  return ARROW_TO_SHIFT[key] ?? null;
}

/** Move one cell in the given direction (clamped to the grid). */
export function shiftCell(
  col: number,
  row: number,
  direction: GridShiftDirection,
  grid: BattlefieldGridLayout,
): { col: number; row: number; x: number; y: number } {
  let nextCol = col;
  let nextRow = row;
  if (direction === 'left') nextCol -= 1;
  if (direction === 'right') nextCol += 1;
  if (direction === 'up') nextRow -= 1;
  if (direction === 'down') nextRow += 1;

  nextCol = clamp(nextCol, 0, grid.cols - 1);
  nextRow = clamp(nextRow, 0, grid.rows - 1);
  const origin = cellOrigin(nextCol, nextRow, grid);
  return { col: nextCol, row: nextRow, x: origin.x, y: origin.y };
}

export function buildDisplayPositions(
  placements: CellPlacement[],
  grid: BattlefieldGridLayout,
): Map<string, { x: number; y: number; stackIndex: number; stackTotal: number; cellX: number; cellY: number }> {
  const byCell = new Map<string, CellPlacement[]>();
  for (const p of placements) {
    const key = cellKey(p.col, p.row);
    const list = byCell.get(key) || [];
    list.push(p);
    byCell.set(key, list);
  }

  const zById = new Map(placements.map((p) => [p.permanentId, p.z ?? 0]));
  const result = new Map<string, { x: number; y: number; stackIndex: number; stackTotal: number; cellX: number; cellY: number }>();

  for (const list of byCell.values()) {
    const ordered = sortStackOrder(list.map((p) => p.permanentId), zById);
    const total = ordered.length;
    const origin = list[0];
    ordered.forEach((id, stackIndex) => {
      const display = displayPositionFromCell(origin.cellX, origin.cellY, stackIndex);
      result.set(id, {
        x: display.x,
        y: display.y,
        stackIndex,
        stackTotal: total,
        cellX: origin.cellX,
        cellY: origin.cellY,
      });
    });
  }

  return result;
}

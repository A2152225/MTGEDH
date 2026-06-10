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
/** Default minimum rows for the main battlefield grid. */
export const BATTLEFIELD_MIN_ROWS = 3;
/** Rows visible before scrolling (compact playmat viewport). */
export const BATTLEFIELD_SCROLL_VISIBLE_ROWS = 5;
/** Hard cap on auto-grown rows to keep layouts performant. */
export const BATTLEFIELD_MAX_ROWS = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function columnCountFromWidth(widthPx: number, tileWidth: number): number {
  const columnGap = BATTLEFIELD_COLUMN_GAP;
  const cellW = tileWidth + columnGap;
  return Math.max(1, Math.floor((widthPx + columnGap) / cellW));
}

export function createBattlefieldGridFromDimensions(
  cols: number,
  rows: number,
  tileWidth: number,
): BattlefieldGridLayout {
  const columnGap = BATTLEFIELD_COLUMN_GAP;
  const rowGap = BATTLEFIELD_ROW_GAP;
  const tileH = Math.round(tileWidth / 0.72);
  const cellW = tileWidth + columnGap;
  const cellH = tileH + rowGap;
  return {
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
    cellW,
    cellH,
    columnGap,
    rowGap,
    tileWidth,
    tileH,
  };
}

/** Pixel height of the grid canvas for a given row count. */
export function battlefieldGridContentHeightForRows(rows: number, tileWidth: number): number {
  return battlefieldGridContentHeight(createBattlefieldGridFromDimensions(1, rows, tileWidth));
}

export function battlefieldGridContentHeight(grid: BattlefieldGridLayout): number {
  if (grid.rows <= 0) return grid.tileH;
  return grid.rows * grid.cellH - grid.rowGap;
}

export function createBattlefieldGrid(
  widthPx: number,
  heightPx: number,
  tileWidth: number,
): BattlefieldGridLayout {
  const cols = columnCountFromWidth(widthPx, tileWidth);
  const probe = createBattlefieldGridFromDimensions(cols, 1, tileWidth);
  const rows = Math.max(1, Math.floor((heightPx + probe.rowGap) / probe.cellH));
  return createBattlefieldGridFromDimensions(cols, rows, tileWidth);
}

/**
 * Rows required to place all entries without falling back to (0,0).
 * Grows up to `maxRows` when auto-placement would overflow.
 */
export function computeRequiredGridRows(
  entries: Array<{ preferred: { x: number; y: number } | null }>,
  cols: number,
  tileWidth: number,
  minRows: number = BATTLEFIELD_MIN_ROWS,
  maxRows: number = BATTLEFIELD_MAX_ROWS,
): number {
  const probe = createBattlefieldGridFromDimensions(cols, minRows, tileWidth);
  let highestRow = minRows - 1;
  for (const entry of entries) {
    if (!entry.preferred) continue;
    highestRow = Math.max(highestRow, Math.max(0, Math.round(entry.preferred.y / probe.cellH)));
  }

  let rows = Math.max(minRows, highestRow + 1);
  while (rows <= maxRows) {
    const grid = createBattlefieldGridFromDimensions(cols, rows, tileWidth);
    const { overflow } = assignPermanentsToCellsInternal(entries, grid);
    if (!overflow) return rows;
    rows += 1;
  }
  return maxRows;
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

/** When the grid is full, stack overflow permanents in the bottom-right cell. */
function assignPermanentsToCellsWithStackFallback(
  entries: Array<{ id: string; preferred: { x: number; y: number; z?: number } | null }>,
  grid: BattlefieldGridLayout,
): CellPlacement[] {
  const occupied = new Set<string>();
  const placements: CellPlacement[] = [];

  const registerInCell = (id: string, col: number, row: number, x: number, y: number, z?: number) => {
    const key = cellKey(col, row);
    occupied.add(key);
    placements.push({ permanentId: id, cellX: x, cellY: y, col, row, z });
  };

  const fallbackCol = Math.max(0, grid.cols - 1);
  const fallbackRow = Math.max(0, grid.rows - 1);
  const fallbackOrigin = cellOrigin(fallbackCol, fallbackRow, grid);

  for (const entry of entries) {
    if (entry.preferred) {
      const snapped = snapPixelToCell(entry.preferred.x, entry.preferred.y, grid);
      registerInCell(entry.id, snapped.col, snapped.row, snapped.x, snapped.y, entry.preferred.z);
      continue;
    }
    const empty = nextEmptyCell(occupied, grid);
    if (empty) {
      registerInCell(entry.id, empty.col, empty.row, empty.x, empty.y);
      continue;
    }
    registerInCell(entry.id, fallbackCol, fallbackRow, fallbackOrigin.x, fallbackOrigin.y);
  }

  return placements;
}

function assignPermanentsToCellsInternal(
  entries: Array<{ id: string; preferred: { x: number; y: number; z?: number } | null }>,
  grid: BattlefieldGridLayout,
): { placements: CellPlacement[]; overflow: boolean } {
  const occupied = new Set<string>();
  const placements: CellPlacement[] = [];

  const registerInCell = (id: string, col: number, row: number, x: number, y: number, z?: number) => {
    const key = cellKey(col, row);
    occupied.add(key);
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
      return { placements, overflow: true };
    }
    registerInCell(entry.id, empty.col, empty.row, empty.x, empty.y);
  }

  return { placements, overflow: false };
}

/**
 * Assign each permanent to a grid cell (origin). Multiple permanents may share a cell (stack).
 * When `allowGrow` is true, expands row count up to `maxRows` instead of stacking at (0,0).
 */
export function assignPermanentsToCells(
  entries: Array<{ id: string; preferred: { x: number; y: number; z?: number } | null }>,
  grid: BattlefieldGridLayout,
  options?: { allowGrow?: boolean; maxRows?: number },
): CellPlacement[] {
  const allowGrow = options?.allowGrow ?? true;
  const maxRows = options?.maxRows ?? BATTLEFIELD_MAX_ROWS;
  let workingGrid = grid;

  for (;;) {
    const { placements, overflow } = assignPermanentsToCellsInternal(entries, workingGrid);
    if (!overflow) return placements;
    if (!allowGrow || workingGrid.rows >= maxRows) {
      return assignPermanentsToCellsWithStackFallback(entries, workingGrid);
    }
    workingGrid = createBattlefieldGridFromDimensions(
      workingGrid.cols,
      workingGrid.rows + 1,
      workingGrid.tileWidth,
    );
  }
}

/** Count distinct occupied cells (stacks count as one slot). */
export function countOccupiedCells(placements: CellPlacement[]): number {
  const keys = new Set<string>();
  for (const placement of placements) {
    keys.add(cellKey(placement.col, placement.row));
  }
  return keys.size;
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

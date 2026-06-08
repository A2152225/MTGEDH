import { describe, expect, it } from 'vitest';
import {
  assignPermanentsToCells,
  arrowKeyToShiftDirection,
  buildDisplayPositions,
  createBattlefieldGrid,
  shiftCell,
  snapPixelToCell,
  stackCascadeOffset,
} from './battlefieldGrid';

describe('battlefieldGrid', () => {
  const grid = createBattlefieldGrid(1000, 600, 135);

  it('snaps pixels to cell origins', () => {
    const snapped = snapPixelToCell(200, 50, grid);
    expect(snapped.x % grid.cellW).toBe(0);
    expect(snapped.y % grid.cellH).toBe(0);
  });

  it('cascades stacked cards in the same cell', () => {
    const placements = assignPermanentsToCells(
      [
        { id: 'a', preferred: { x: 0, y: 0 } },
        { id: 'b', preferred: { x: 5, y: 3 } },
      ],
      grid,
    );
    const display = buildDisplayPositions(placements, grid);
    const a = display.get('a')!;
    const b = display.get('b')!;
    expect(a.stackIndex).toBe(0);
    expect(b.stackIndex).toBe(1);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
    const offset = stackCascadeOffset(1);
    expect(b.x - a.x).toBe(offset.dx);
    expect(b.y - a.y).toBe(offset.dy);
  });

  it('shifts one cell with arrow directions', () => {
    expect(arrowKeyToShiftDirection('ArrowRight')).toBe('right');
    const moved = shiftCell(1, 1, 'right', grid);
    expect(moved.col).toBe(2);
    expect(moved.x).toBe(2 * grid.cellW);
  });

  it('places new permanents in empty cells', () => {
    const placements = assignPermanentsToCells(
      [
        { id: 'a', preferred: { x: 0, y: 0 } },
        { id: 'b', preferred: null },
      ],
      grid,
    );
    expect(placements[0].col).toBe(0);
    expect(placements[0].row).toBe(0);
    const secondKey = `${placements[1].col},${placements[1].row}`;
    const firstKey = `${placements[0].col},${placements[0].row}`;
    expect(secondKey).not.toBe(firstKey);
  });
});

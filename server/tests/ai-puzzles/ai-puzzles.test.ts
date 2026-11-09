/**
 * AI puzzle suite runner (P0-5).
 *
 * Prints a pass table and asserts every non-knownFailing puzzle passes.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { initDb } from '../../src/db/index.js';
import { attackPuzzles } from './attack.puzzles.js';
import { blockPuzzles } from './block.puzzles.js';
import { lethalPuzzles } from './lethal.puzzles.js';
import { mulliganPuzzles } from './mulligan.puzzles.js';
import { priorityPuzzles } from './priority.puzzles.js';
import {
  assertPuzzleOutcome,
  evaluatePuzzle,
  formatPassTable,
  type Puzzle,
  type PuzzleOutcome,
} from './puzzleHarness.js';

const ALL_PUZZLES: Puzzle[] = [
  ...lethalPuzzles,
  ...attackPuzzles,
  ...blockPuzzles,
  ...mulliganPuzzles,
  ...priorityPuzzles,
];

describe('AI puzzle suite (P0-5)', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('has 12 puzzles covering the Phase 0 categories', () => {
    expect(ALL_PUZZLES).toHaveLength(12);
    const categories = new Set(ALL_PUZZLES.map((p) => p.category));
    for (const needed of ['lethal', 'attack', 'block', 'mulligan', 'sequencing', 'response', 'sweeper', 'removal']) {
      expect(categories.has(needed), `missing category ${needed}`).toBe(true);
    }
  });

  it('runs all puzzles and reports the v0 pass table', async () => {
    const outcomes: PuzzleOutcome[] = [];
    for (const puzzle of ALL_PUZZLES) {
      const result = await puzzle.run();
      const outcome = evaluatePuzzle(puzzle, result);
      outcomes.push(outcome);
      assertPuzzleOutcome(outcome, puzzle);
    }

    const table = formatPassTable(outcomes);
    // eslint-disable-next-line no-console
    console.log('\n' + table + '\n');

    const hardFails = outcomes.filter((o) => !o.passed && !o.knownFailing);
    expect(hardFails, hardFails.map((o) => `${o.id}:${o.observed}`).join(', ')).toEqual([]);

    const v0Pass = outcomes.filter((o) => o.passed).length;
    expect(v0Pass).toBeGreaterThanOrEqual(0);
  }, 60_000);
});

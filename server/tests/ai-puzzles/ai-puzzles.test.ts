/**
 * AI puzzle suite runner (P0-5 + P2-4).
 *
 * Prints a pass table and asserts every non-knownFailing, non-heldOut puzzle passes.
 * Held-out puzzles run only when AI_PUZZLE_INCLUDE_HELD_OUT=1 (Phase 2 gate).
 */

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import './puzzleGameActionMocks.js';
import { initDb } from '../../src/db/index.js';
import { attackPuzzles } from './attack.puzzles.js';
import { blockPuzzles } from './block.puzzles.js';
import { lethalPuzzles } from './lethal.puzzles.js';
import { mulliganPuzzles } from './mulligan.puzzles.js';
import { priorityPuzzles } from './priority.puzzles.js';
import { phase2LethalPuzzles } from './phase2Lethal.puzzles.js';
import { phase2CrackbackPuzzles } from './phase2Crackback.puzzles.js';
import { phase2TargetPuzzles } from './phase2Target.puzzles.js';
import { phase2MultiPuzzles } from './phase2Multi.puzzles.js';
import { phase2BlockPuzzles } from './phase2Blocks.puzzles.js';
import { phase2SequencingPuzzles } from './phase2Sequencing.puzzles.js';
import {
  assertPuzzleOutcome,
  evaluatePuzzle,
  formatPassTable,
  type Puzzle,
  type PuzzleOutcome,
} from './puzzleHarness.js';

export const ALL_PUZZLES: Puzzle[] = [
  ...lethalPuzzles,
  ...attackPuzzles,
  ...blockPuzzles,
  ...mulliganPuzzles,
  ...priorityPuzzles,
  ...phase2LethalPuzzles,
  ...phase2CrackbackPuzzles,
  ...phase2TargetPuzzles,
  ...phase2MultiPuzzles,
  ...phase2BlockPuzzles,
  ...phase2SequencingPuzzles,
];

const INCLUDE_HELD_OUT = String(process.env.AI_PUZZLE_INCLUDE_HELD_OUT || '') === '1';

const HELD_OUT_IDS = new Set(['L3', 'C2', 'C4', 'T1', 'M1', 'M4', 'B2', 'S3']);

describe('AI puzzle suite (P0-5 + P2-4)', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('has 36 puzzles with 8 held out (plan suggested set)', () => {
    expect(ALL_PUZZLES).toHaveLength(36);
    const held = ALL_PUZZLES.filter((p) => p.heldOut);
    expect(held).toHaveLength(8);
    expect(held.map((p) => p.id).sort()).toEqual([...HELD_OUT_IDS].sort());
    const categories = new Set(ALL_PUZZLES.map((p) => p.category));
    for (const needed of [
      'lethal',
      'attack',
      'block',
      'mulligan',
      'sequencing',
      'response',
      'sweeper',
      'removal',
    ]) {
      expect(categories.has(needed), `missing category ${needed}`).toBe(true);
    }
  });

  it('runs puzzles and reports the pass table', async () => {
    const runnable = ALL_PUZZLES.filter((p) => INCLUDE_HELD_OUT || !p.heldOut);
    const outcomes: PuzzleOutcome[] = [];
    for (const puzzle of runnable) {
      const result = await puzzle.run();
      const outcome = evaluatePuzzle(puzzle, result);
      outcomes.push(outcome);
      assertPuzzleOutcome(outcome, puzzle);
    }

    const table = formatPassTable(outcomes);
    // eslint-disable-next-line no-console
    console.log('\n' + table + '\n');
    // eslint-disable-next-line no-console
    console.log(
      `heldOut skipped: ${ALL_PUZZLES.length - runnable.length} (set AI_PUZZLE_INCLUDE_HELD_OUT=1 to include)`,
    );

    const hardFails = outcomes.filter((o) => !o.passed && !o.knownFailing);
    expect(hardFails, hardFails.map((o) => `${o.id}:${o.observed}`).join(', ')).toEqual([]);

    const passed = outcomes.filter((o) => o.passed).length;
    const brain = process.env.AI_BRAIN || 'v0';

    const outRel = process.env.AI_PUZZLE_OUT?.trim();
    if (outRel) {
      const outPath = path.isAbsolute(outRel)
        ? outRel
        : path.resolve(process.cwd(), outRel);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(
        outPath,
        JSON.stringify(
          {
            brain,
            total: outcomes.length,
            catalogue: ALL_PUZZLES.length,
            heldOutSkipped: ALL_PUZZLES.length - runnable.length,
            passed,
            results: outcomes.map((o) => ({
              id: o.id,
              status: o.passed ? 'PASS' : o.knownFailing ? 'FAIL(v0)' : 'FAIL',
              observed: o.observed,
            })),
          },
          null,
          2,
        ),
      );
    }
  }, 120_000);
});

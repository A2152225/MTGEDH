/**
 * P0-5 mulligan puzzles.
 */

import type { Puzzle } from './puzzleHarness.js';
import { decideMulligan } from './puzzleHarness.js';

function land(name: string) {
  return { name, types: ['Land'], type_line: `Basic Land — ${name}` };
}

function spell(name: string) {
  return { name, types: ['Creature'], type_line: 'Creature' };
}

export const mulliganPuzzles: Puzzle[] = [
  {
    id: 'M-keep-two-land',
    category: 'mulligan',
    kind: 'mulligan',
    description: 'Seven-card hand with exactly two lands: keep.',
    acceptable: ['mulligan:keep'],
    forbidden: ['mulligan:mulligan'],
    run: async () =>
      decideMulligan({
        hand: [land('Forest'), land('Island'), spell('Bear'), spell('Elf'), spell('Bird'), spell('Dog'), spell('Cat')],
      }),
  },
  {
    id: 'M-mulligan-zero-land',
    category: 'mulligan',
    kind: 'mulligan',
    description: 'Seven-card hand with zero lands: mulligan.',
    acceptable: ['mulligan:mulligan'],
    forbidden: ['mulligan:keep'],
    run: async () =>
      decideMulligan({
        hand: [spell('Bear'), spell('Elf'), spell('Bird'), spell('Dog'), spell('Cat'), spell('Ox'), spell('Ape')],
      }),
  },
];

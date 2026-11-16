/**
 * P2-4 choose-among-three-opponents drafts (T1–T4). Suggested held-out: T1.
 */

import type { Puzzle } from './puzzleHarness.js';
import { creature, decideAttackers } from './puzzleHarness.js';

export const phase2TargetPuzzles: Puzzle[] = [
  {
    id: 'T1',
    category: 'attack',
    kind: 'attack',
    heldOut: true,
    knownFailing: true,
    description: '5/5; A has 1/1 deathtouch, B 1/1, C open. Attack C or B, not A.',
    acceptable: ['attack:beater->C', 'attack:beater->B'],
    forbidden: ['attack:beater->A'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 40, B: 40, C: 40 },
        battlefield: [
          creature('beater', 'ai-player', { power: '5', toughness: '5' }),
          creature('dt', 'A', {
            power: '1',
            toughness: '1',
            oracle_text: 'Deathtouch',
          }),
          creature('chump', 'B', { power: '1', toughness: '1' }),
        ],
      }),
  },
  {
    id: 'T2',
    category: 'attack',
    kind: 'attack',
    knownFailing: true,
    description:
      'Three 4/4s; A at 12 with three 2/2s, B at 12 open. All attack B for exact lethal.',
    acceptable: ['attack:a->B,b->B,c->B'],
    forbidden: ['attack:none'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 12, B: 12, C: 40 },
        battlefield: [
          creature('a', 'ai-player', { power: '4', toughness: '4' }),
          creature('b', 'ai-player', { power: '4', toughness: '4' }),
          creature('c', 'ai-player', { power: '4', toughness: '4' }),
          creature('x1', 'A', { power: '2', toughness: '2' }),
          creature('x2', 'A', { power: '2', toughness: '2' }),
          creature('x3', 'A', { power: '2', toughness: '2' }),
        ],
      }),
  },
  {
    id: 'T3',
    category: 'attack',
    kind: 'attack',
    description:
      '7/7 and 1/1; A and B each have 2/2; C open. 7/7 to C/A/B; 1/1 to C or home — not into A/B.',
    acceptable: [
      'attack:big->C',
      'attack:big->A',
      'attack:big->B',
      'attack:big->C,small->C',
      'attack:big->A,small->C',
      'attack:big->B,small->C',
    ],
    forbidden: [
      'attack:small->A',
      'attack:small->B',
      'attack:big->A,small->A',
      'attack:big->A,small->B',
      'attack:big->B,small->A',
      'attack:big->B,small->B',
      'attack:big->C,small->A',
      'attack:big->C,small->B',
    ],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 40, B: 40, C: 40 },
        battlefield: [
          creature('big', 'ai-player', { power: '7', toughness: '7' }),
          creature('small', 'ai-player', { power: '1', toughness: '1' }),
          creature('a2', 'A', { power: '2', toughness: '2' }),
          creature('b2', 'B', { power: '2', toughness: '2' }),
        ],
      }),
  },
  {
    id: 'T4',
    category: 'attack',
    kind: 'attack',
    description: '4/4 and 3/3; B at 9, others 40, no blockers. Both attack B.',
    acceptable: ['attack:big->B,mid->B'],
    forbidden: ['attack:none'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 40, B: 9, C: 40 },
        battlefield: [
          creature('big', 'ai-player', { power: '4', toughness: '4' }),
          creature('mid', 'ai-player', { power: '3', toughness: '3' }),
        ],
      }),
  },
];

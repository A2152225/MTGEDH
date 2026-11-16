/**
 * P2-4 crack-back drafts (C1–C4). Suggested held-out: C2, C4.
 */

import type { Puzzle } from './puzzleHarness.js';
import { creature, decideAttackers } from './puzzleHarness.js';

export const phase2CrackbackPuzzles: Puzzle[] = [
  {
    id: 'C1',
    category: 'attack',
    kind: 'attack',
    knownFailing: true,
    description:
      'At 6 with 4/4 and 2/2; A has 5/5 and 3/3. No attackers — stay home to block.',
    acceptable: ['attack:none'],
    forbidden: [
      'attack:big->A',
      'attack:small->A',
      'attack:big->A,small->A',
      'attack:big->B',
      'attack:big->C',
      'attack:small->B',
      'attack:small->C',
    ],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 6, A: 40, B: 40, C: 40 },
        battlefield: [
          creature('big', 'ai-player', { power: '4', toughness: '4' }),
          creature('small', 'ai-player', { power: '2', toughness: '2' }),
          creature('a5', 'A', { power: '5', toughness: '5' }),
          creature('a3', 'A', { power: '3', toughness: '3' }),
        ],
      }),
  },
  {
    id: 'C2',
    category: 'attack',
    kind: 'attack',
    heldOut: true,
    knownFailing: true,
    description:
      'At 4 with 4/4 vigilance and 3/3; A has 4/4. Vigilance (and optionally 3/3) attack B or C.',
    acceptable: [
      'attack:vig->B',
      'attack:vig->C',
      'attack:mid->B,vig->B',
      'attack:mid->B,vig->C',
      'attack:mid->C,vig->B',
      'attack:mid->C,vig->C',
    ],
    forbidden: ['attack:none', 'attack:mid->A', 'attack:vig->A', 'attack:mid->A,vig->A'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 4, A: 40, B: 40, C: 40 },
        battlefield: [
          creature('vig', 'ai-player', {
            power: '4',
            toughness: '4',
            oracle_text: 'Vigilance',
          }),
          creature('mid', 'ai-player', { power: '3', toughness: '3' }),
          creature('a4', 'A', { power: '4', toughness: '4' }),
        ],
      }),
  },
  {
    id: 'C3',
    category: 'attack',
    kind: 'attack',
    description:
      'At 20 with three 3/3s; B at 12 open. Attack B with two or three — small crack-back is fine.',
    acceptable: [
      'attack:c1->B,c2->B',
      'attack:c1->B,c3->B',
      'attack:c2->B,c3->B',
      'attack:c1->B,c2->B,c3->B',
    ],
    forbidden: ['attack:none'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 20, A: 40, B: 12, C: 40 },
        battlefield: [
          creature('c1', 'ai-player', { power: '3', toughness: '3' }),
          creature('c2', 'ai-player', { power: '3', toughness: '3' }),
          creature('c3', 'ai-player', { power: '3', toughness: '3' }),
          creature('a3', 'A', { power: '3', toughness: '3' }),
          creature('a2', 'A', { power: '2', toughness: '2' }),
        ],
      }),
  },
  {
    id: 'C4',
    category: 'attack',
    kind: 'attack',
    heldOut: true,
    knownFailing: true,
    description:
      'At 40 with one 3/3; A commander 6/6 has dealt 15 to you. Hold the 3/3 to chump.',
    acceptable: ['attack:none'],
    forbidden: ['attack:chump->A', 'attack:chump->B', 'attack:chump->C'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 40, B: 40, C: 40 },
        battlefield: [
          creature('chump', 'ai-player', { power: '3', toughness: '3' }),
          creature('cmd', 'A', {
            power: '6',
            toughness: '6',
            isCommander: true,
          }),
        ],
        commanderDamage: { 'ai-player': { cmd: 15 } },
      }),
  },
];

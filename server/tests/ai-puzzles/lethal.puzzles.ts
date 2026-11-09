/**
 * P0-5 lethal attack puzzles.
 */

import type { Puzzle } from './puzzleHarness.js';
import { creature, decideAttackers } from './puzzleHarness.js';

export const lethalPuzzles: Puzzle[] = [
  {
    id: 'L-life-exact',
    category: 'lethal',
    kind: 'attack',
    description: 'You have a 5/5; A is at 5 with no blockers. Attack A for exact lethal.',
    acceptable: ['attack:beater->A'],
    forbidden: ['attack:none', 'attack:beater->B', 'attack:beater->C'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 5, B: 40, C: 40 },
        battlefield: [creature('beater', 'ai-player', { power: '5', toughness: '5' })],
      }),
  },
  {
    id: 'L-commander-21',
    category: 'lethal',
    kind: 'attack',
    description:
      'Your commander is a 5/5 and has dealt 16 damage to B. B has no blockers. Attack B for commander lethal (not A at 5 life).',
    // v0 picks lowest life, so it sends the commander at A instead of B.
    knownFailing: true,
    acceptable: ['attack:cmd->B'],
    forbidden: ['attack:none', 'attack:cmd->A', 'attack:cmd->C'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 5, B: 40, C: 40 },
        battlefield: [
          creature('cmd', 'ai-player', {
            power: '5',
            toughness: '5',
            isCommander: true,
          }),
        ],
        commanderDamage: {
          B: { cmd: 16 },
        },
      }),
  },
];

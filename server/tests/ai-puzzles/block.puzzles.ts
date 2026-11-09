/**
 * P0-5 block puzzles.
 */

import type { Puzzle } from './puzzleHarness.js';
import { creature, decideBlockers } from './puzzleHarness.js';

export const blockPuzzles: Puzzle[] = [
  {
    id: 'B-chump-lethal',
    category: 'block',
    kind: 'block',
    description: 'You are at 6; A attacks with an 8/8. Chump with your 1/1.',
    acceptable: ['block:chump->big-attacker'],
    forbidden: ['block:none'],
    run: async () =>
      decideBlockers({
        life: 6,
        attackers: [
          creature('big-attacker', 'attacker', {
            power: '8',
            toughness: '8',
            attacking: 'ai-player',
          }),
        ],
        blockers: [creature('chump', 'ai-player', { power: '1', toughness: '1' })],
      }),
  },
  {
    id: 'B-chump-commander-21',
    category: 'block',
    kind: 'block',
    description:
      'You are at 40 with a 2/2. A\'s 5/5 commander attacks; it has already dealt 17 commander damage. Chump block.',
    acceptable: ['block:token->cmd'],
    forbidden: ['block:none'],
    run: async () =>
      decideBlockers({
        life: 40,
        attackers: [
          creature('cmd', 'attacker', {
            power: '5',
            toughness: '5',
            attacking: 'ai-player',
            isCommander: true,
          }),
        ],
        blockers: [creature('token', 'ai-player', { power: '2', toughness: '2' })],
        commanderDamage: {
          'ai-player': { cmd: 17 },
        },
      }),
  },
];

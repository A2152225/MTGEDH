/**
 * P0-5 attack prudence puzzles (do not throw into lethal blocks / crack-back).
 */

import type { Puzzle } from './puzzleHarness.js';
import { creature, decideAttackers } from './puzzleHarness.js';

export const attackPuzzles: Puzzle[] = [
  {
    id: 'A-avoid-deathtouch-block',
    category: 'attack',
    kind: 'attack',
    description:
      'You have a 5/5. A has an untapped 1/1 deathtouch; C has no creatures. Attack C (or B), not A.',
    acceptable: ['attack:beater->C', 'attack:beater->B'],
    forbidden: ['attack:beater->A'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 30, B: 40, C: 40 },
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
    id: 'A-hold-vs-lethal-crackback',
    category: 'attack',
    kind: 'attack',
    description:
      'You are at 6 with an untapped 4/4. A has a 5/5 and a 3/3. Do not attack; stay back to block.',
    knownFailing: true,
    acceptable: ['attack:none'],
    forbidden: ['attack:wall->A', 'attack:wall->B', 'attack:wall->C'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 6, A: 40, B: 40, C: 40 },
        battlefield: [
          creature('wall', 'ai-player', { power: '4', toughness: '4' }),
          creature('big', 'A', { power: '5', toughness: '5' }),
          creature('mid', 'A', { power: '3', toughness: '3' }),
        ],
      }),
  },
];

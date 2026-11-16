/**
 * P2-4 lethal drafts (L1–L4). Suggested held-out: L3.
 */

import type { Puzzle } from './puzzleHarness.js';
import { creature, decideAttackers } from './puzzleHarness.js';

export const phase2LethalPuzzles: Puzzle[] = [
  {
    id: 'L1',
    category: 'lethal',
    kind: 'attack',
    knownFailing: true,
    description:
      '6/6 trample + 4/4 + 2/2; A at 8 with one 2/2. All three attack A (8 through after best block).',
    acceptable: ['attack:mid->A,small->A,trampler->A'],
    forbidden: ['attack:none'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 8, B: 40, C: 40 },
        battlefield: [
          creature('trampler', 'ai-player', {
            power: '6',
            toughness: '6',
            oracle_text: 'Trample',
          }),
          creature('mid', 'ai-player', { power: '4', toughness: '4' }),
          creature('small', 'ai-player', { power: '2', toughness: '2' }),
          creature('blocker', 'A', { power: '2', toughness: '2' }),
        ],
      }),
  },
  {
    id: 'L2',
    category: 'lethal',
    kind: 'attack',
    knownFailing: true,
    description:
      'Commander 5/5 has dealt 16 to B; B open. A at 8 open; C has 5/5. Commander attacks B.',
    acceptable: ['attack:cmd->B'],
    forbidden: ['attack:none', 'attack:cmd->A', 'attack:cmd->C'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 8, B: 40, C: 40 },
        battlefield: [
          creature('cmd', 'ai-player', {
            power: '5',
            toughness: '5',
            isCommander: true,
          }),
          creature('c_wall', 'C', { power: '5', toughness: '5' }),
        ],
        commanderDamage: { B: { cmd: 16 } },
      }),
  },
  {
    id: 'L3',
    category: 'lethal',
    kind: 'attack',
    heldOut: true,
    knownFailing: true,
    description:
      'Two 3/3 menace + one 3/3; A at 6 with two 1/1s. All three attack A.',
    acceptable: ['attack:menace1->A,menace2->A,plain->A'],
    forbidden: ['attack:none'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 6, B: 40, C: 40 },
        battlefield: [
          creature('menace1', 'ai-player', {
            power: '3',
            toughness: '3',
            oracle_text: 'Menace',
          }),
          creature('menace2', 'ai-player', {
            power: '3',
            toughness: '3',
            oracle_text: 'Menace',
          }),
          creature('plain', 'ai-player', { power: '3', toughness: '3' }),
          creature('chump1', 'A', { power: '1', toughness: '1' }),
          creature('chump2', 'A', { power: '1', toughness: '1' }),
        ],
      }),
  },
  {
    id: 'L4',
    category: 'lethal',
    kind: 'attack',
    description:
      '5/5 vs A at 5 with open mana and cards. Attack A (unless_trick lethal).',
    acceptable: ['attack:beater->A'],
    forbidden: ['attack:none', 'attack:beater->B', 'attack:beater->C'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 5, B: 40, C: 40 },
        battlefield: [
          creature('beater', 'ai-player', { power: '5', toughness: '5' }),
        ],
      }),
  },
];

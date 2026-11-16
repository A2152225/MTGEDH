/**
 * P2-4 multi-creature combat drafts (M1–M4). Suggested held-out: M1, M4.
 */

import type { Puzzle } from './puzzleHarness.js';
import { creature, decideAttackers, decideBlockers } from './puzzleHarness.js';

export const phase2MultiPuzzles: Puzzle[] = [
  {
    id: 'M1',
    category: 'block',
    kind: 'block',
    heldOut: true,
    knownFailing: true,
    description:
      'A attacks with 4/4 and 3/3; you have 4/4 first strike and 2/2. FS blocks the 4/4; 2/2 stays home.',
    acceptable: ['block:fs->atk4'],
    forbidden: ['block:chump->atk4', 'block:chump->atk3', 'block:fs->atk3', 'block:chump->atk3,fs->atk4'],
    run: async () =>
      decideBlockers({
        life: 40,
        attackers: [
          creature('atk4', 'attacker', {
            power: '4',
            toughness: '4',
            attacking: 'ai-player',
          }),
          creature('atk3', 'attacker', {
            power: '3',
            toughness: '3',
            attacking: 'ai-player',
          }),
        ],
        blockers: [
          creature('fs', 'ai-player', {
            power: '4',
            toughness: '4',
            oracle_text: 'First strike',
          }),
          creature('chump', 'ai-player', { power: '2', toughness: '2' }),
        ],
      }),
  },
  {
    id: 'M2',
    category: 'block',
    kind: 'block',
    description:
      'A attacks with 1/1 deathtouch and 5/5; you have 6/6 commander and 2/2. Commander blocks 5/5.',
    acceptable: [
      'block:cmd->big',
      'block:cmd->big,token->dt',
    ],
    forbidden: ['block:cmd->dt', 'block:cmd->dt,token->big'],
    run: async () =>
      decideBlockers({
        life: 40,
        attackers: [
          creature('dt', 'attacker', {
            power: '1',
            toughness: '1',
            attacking: 'ai-player',
            oracle_text: 'Deathtouch',
          }),
          creature('big', 'attacker', {
            power: '5',
            toughness: '5',
            attacking: 'ai-player',
          }),
        ],
        blockers: [
          creature('cmd', 'ai-player', {
            power: '6',
            toughness: '6',
            isCommander: true,
          }),
          creature('token', 'ai-player', { power: '2', toughness: '2' }),
        ],
      }),
  },
  {
    id: 'M3',
    category: 'attack',
    kind: 'attack',
    knownFailing: true,
    description:
      'Your 5/5; A has two 3/3s. Attack B or C, or stay home — do not attack into the double block.',
    acceptable: ['attack:beater->B', 'attack:beater->C', 'attack:none'],
    forbidden: ['attack:beater->A'],
    run: async () =>
      decideAttackers({
        life: { 'ai-player': 40, A: 40, B: 40, C: 40 },
        battlefield: [
          creature('beater', 'ai-player', { power: '5', toughness: '5' }),
          creature('x1', 'A', { power: '3', toughness: '3' }),
          creature('x2', 'A', { power: '3', toughness: '3' }),
        ],
      }),
  },
  {
    id: 'M4',
    category: 'block',
    kind: 'block',
    heldOut: true,
    knownFailing: true,
    description:
      'A attacks with 5/5 trample; you have two 3/3s. Double-block or no block — not a lone chump.',
    acceptable: ['block:b1->tramp,b2->tramp', 'block:none'],
    forbidden: ['block:b1->tramp', 'block:b2->tramp'],
    run: async () =>
      decideBlockers({
        life: 40,
        attackers: [
          creature('tramp', 'attacker', {
            power: '5',
            toughness: '5',
            attacking: 'ai-player',
            oracle_text: 'Trample',
          }),
        ],
        blockers: [
          creature('b1', 'ai-player', { power: '3', toughness: '3' }),
          creature('b2', 'ai-player', { power: '3', toughness: '3' }),
        ],
      }),
  },
];

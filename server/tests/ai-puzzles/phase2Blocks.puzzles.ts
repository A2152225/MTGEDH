/**
 * P2-4 ahead/behind block drafts (B1–B3). Suggested held-out: B2.
 */

import type { Puzzle } from './puzzleHarness.js';
import { creature, decideBlockers } from './puzzleHarness.js';

export const phase2BlockPuzzles: Puzzle[] = [
  {
    id: 'B1',
    category: 'block',
    kind: 'block',
    description: 'At 40 with 2/2 and 1/1; A attacks with 6/6. No chump.',
    acceptable: ['block:none'],
    forbidden: ['block:token->big', 'block:tiny->big', 'block:tiny->big,token->big'],
    run: async () =>
      decideBlockers({
        life: 40,
        attackers: [
          creature('big', 'attacker', {
            power: '6',
            toughness: '6',
            attacking: 'ai-player',
          }),
        ],
        blockers: [
          creature('token', 'ai-player', { power: '2', toughness: '2' }),
          creature('tiny', 'ai-player', { power: '1', toughness: '1' }),
        ],
      }),
  },
  {
    id: 'B2',
    category: 'block',
    kind: 'block',
    heldOut: true,
    knownFailing: true,
    description:
      'At 40 with 2/2; A commander 5/5 has dealt 17. Chump the commander.',
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
        commanderDamage: { 'ai-player': { cmd: 17 } },
      }),
  },
  {
    id: 'B3',
    category: 'block',
    kind: 'block',
    description:
      'At 30 with 3/3; A (leader) and B each attack with a 3/3. Block A\'s to trade with the leader.',
    acceptable: ['block:mine->a_atk'],
    forbidden: ['block:mine->b_atk', 'block:none'],
    run: async () =>
      decideBlockers({
        life: 30,
        attackers: [
          creature('a_atk', 'attacker', {
            power: '3',
            toughness: '3',
            attacking: 'ai-player',
          }),
          creature('b_atk', 'bystander', {
            power: '3',
            toughness: '3',
            attacking: 'ai-player',
          }),
        ],
        blockers: [creature('mine', 'ai-player', { power: '3', toughness: '3' })],
        otherPermanents: [
          // Pad A's board so "leader" has more creatures (for human judgement;
          // v0 may ignore this and knownFailing covers it).
          creature('a2', 'attacker', { power: '2', toughness: '2' }),
          creature('a3', 'attacker', { power: '2', toughness: '2' }),
          creature('a4', 'attacker', { power: '2', toughness: '2' }),
          creature('a5', 'attacker', { power: '2', toughness: '2' }),
          creature('a6', 'attacker', { power: '2', toughness: '2' }),
          creature('b_only', 'bystander', { power: '2', toughness: '2' }),
        ],
      }),
  },
];

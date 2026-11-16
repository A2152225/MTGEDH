/**
 * P2-4 sequencing-under-mana drafts (S1–S5). Suggested held-out: S3.
 * Land drop already used in every position.
 */

import type { PlayerID } from '../../../shared/src/types.js';
import { createGameIfNotExists, deleteGame } from '../../src/db/index.js';
import { cleanupGameAI, handleAIPriority, registerAIPlayer } from '../../src/socket/ai.js';
import { ResolutionQueueManager } from '../../src/state/resolution/index.js';
import { games } from '../../src/socket/socket.js';
import { ensureGame } from '../../src/socket/util.js';
import type { Puzzle, PuzzleResult } from './puzzleHarness.js';
import { handlePlayLandRequest, requestCastSpellForSocket } from './puzzleGameActionMocks.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
  } as any;
}

function emptyMana() {
  return { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
}

function landPermanent(id: string, playerId: string, name = 'Forest') {
  return {
    id,
    controller: playerId,
    owner: playerId,
    tapped: false,
    summoningSickness: false,
    counters: {},
    card: {
      id: `c_${id}`,
      name,
      type_line: `Basic Land — ${name}`,
      oracle_text: '{T}: Add {G}.',
    },
  };
}

async function withTempGame(
  gameId: string,
  playerId: string,
  state: any,
  fn: (game: any) => Promise<PuzzleResult>,
) {
  cleanupGameAI(gameId);
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame failed');
  Object.assign(game.state as any, state);
  registerAIPlayer(gameId, playerId as PlayerID);
  try {
    return await fn(game);
  } finally {
    cleanupGameAI(gameId);
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }
}

function resolveCastCardName(gameId: string, playerId: string, payload: any): string {
  const explicit = payload?.cardName || payload?.card?.name;
  if (explicit) return String(explicit);
  const cardId = String(payload?.cardId || '');
  const live = ensureGame(gameId);
  const zones = (live?.state as any)?.zones?.[playerId] || {};
  for (const zoneName of ['hand', 'graveyard', 'exile', 'library'] as const) {
    const zone = zones[zoneName];
    if (!Array.isArray(zone)) continue;
    const hit = zone.find((c: any) => String(c?.id || '') === cardId);
    if (hit?.name) return String(hit.name);
  }
  const bf = (live?.state as any)?.battlefield || [];
  const fromBf = bf.find((p: any) => String(p?.id || '') === cardId || String(p?.card?.id || '') === cardId);
  if (fromBf?.card?.name) return String(fromBf.card.name);
  return cardId || 'spell';
}

async function observeFirstCast(gameId: string, playerId: string): Promise<PuzzleResult> {
  requestCastSpellForSocket.mockReset();
  handlePlayLandRequest.mockReset();
  requestCastSpellForSocket.mockResolvedValue(true);
  await handleAIPriority(createNoopIo(), gameId, playerId as PlayerID);
  if (requestCastSpellForSocket.mock.calls.length > 0) {
    // One priority window → first attempted cast is the plan's chosen play.
    // Mocked casts do not mutate hand, so the AI may retry later candidates;
    // sequencing puzzles judge the first choice only.
    const first = resolveCastCardName(gameId, playerId, requestCastSpellForSocket.mock.calls[0]?.[2]);
    return {
      observed: `priority:cast:${first}`,
      detail: requestCastSpellForSocket.mock.calls,
    };
  }
  if (handlePlayLandRequest.mock.calls.length > 0) {
    return { observed: 'priority:play_land', detail: handlePlayLandRequest.mock.calls };
  }
  return { observed: 'priority:pass', detail: {} };
}

export const phase2SequencingPuzzles: Puzzle[] = [
  {
    id: 'S1',
    category: 'sequencing',
    kind: 'priority',
    description:
      'Four lands; hand Sol Ring, 3-mana 3/3, 5-mana 5/5. Cast Sol Ring first (then 5/5).',
    acceptable: ['priority:cast:Sol Ring'],
    forbidden: ['priority:cast:Bear 3', 'priority:cast:Beast 5', 'priority:pass'],
    run: async () => {
      const gameId = 'puzzle_s1_ramp';
      const playerId = 'ai-player';
      return withTempGame(
        gameId,
        playerId,
        {
          players: [
            { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
            { id: 'opp1', name: 'Opp', spectator: false, life: 40 },
          ],
          turnPlayer: playerId,
          activePlayer: playerId,
          priority: playerId,
          phase: 'precombatMain',
          step: 'MAIN1',
          turnNumber: 4,
          stack: [],
          landsPlayedThisTurn: { [playerId]: 1 },
          // Pre-filled pool so the puzzle is cast order, not land tapping.
          manaPool: { [playerId]: { ...emptyMana(), green: 4 }, opp1: emptyMana() },
          battlefield: [1, 2, 3, 4].map((n) => landPermanent(`f${n}`, playerId)),
          zones: {
            [playerId]: {
              hand: [
                {
                  id: 'sol',
                  name: 'Sol Ring',
                  type_line: 'Artifact',
                  oracle_text: '{T}: Add {C}{C}.',
                  mana_cost: '{1}',
                  cmc: 1,
                },
                {
                  id: 'bear',
                  name: 'Bear 3',
                  type_line: 'Creature — Bear',
                  power: '3',
                  toughness: '3',
                  mana_cost: '{2}{G}',
                  cmc: 3,
                },
                {
                  id: 'beast',
                  name: 'Beast 5',
                  type_line: 'Creature — Beast',
                  power: '5',
                  toughness: '5',
                  mana_cost: '{3}{G}{G}',
                  cmc: 5,
                },
              ],
              library: [],
              graveyard: [],
              exile: [],
            },
            opp1: { hand: [], library: [], graveyard: [], exile: [] },
          },
        },
        async () => observeFirstCast(gameId, playerId),
      );
    },
  },
  {
    id: 'S2',
    category: 'sequencing',
    kind: 'priority',
    description:
      'Five lands; hand 6/6, 3/3, 2/2. Cast affordable creatures — do not attempt the 6-drop.',
    acceptable: ['priority:cast:Bear 3', 'priority:cast:Dog 2', 'priority:cast:Bear 3+Dog 2', 'priority:cast:Dog 2+Bear 3'],
    forbidden: ['priority:cast:Wurm 6'],
    run: async () => {
      const gameId = 'puzzle_s2_afford';
      const playerId = 'ai-player';
      return withTempGame(
        gameId,
        playerId,
        {
          players: [
            { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
            { id: 'opp1', name: 'Opp', spectator: false, life: 40 },
          ],
          turnPlayer: playerId,
          activePlayer: playerId,
          priority: playerId,
          phase: 'precombatMain',
          step: 'MAIN1',
          turnNumber: 5,
          stack: [],
          landsPlayedThisTurn: { [playerId]: 1 },
          manaPool: { [playerId]: { ...emptyMana(), green: 5 }, opp1: emptyMana() },
          battlefield: [1, 2, 3, 4, 5].map((n) => landPermanent(`f${n}`, playerId)),
          zones: {
            [playerId]: {
              hand: [
                {
                  id: 'wurm',
                  name: 'Wurm 6',
                  type_line: 'Creature — Wurm',
                  power: '6',
                  toughness: '6',
                  mana_cost: '{4}{G}{G}',
                  cmc: 6,
                },
                {
                  id: 'bear',
                  name: 'Bear 3',
                  type_line: 'Creature — Bear',
                  power: '3',
                  toughness: '3',
                  mana_cost: '{2}{G}',
                  cmc: 3,
                },
                {
                  id: 'dog',
                  name: 'Dog 2',
                  type_line: 'Creature — Dog',
                  power: '2',
                  toughness: '2',
                  mana_cost: '{1}{G}',
                  cmc: 2,
                },
              ],
              library: [],
              graveyard: [],
              exile: [],
            },
            opp1: { hand: [], library: [], graveyard: [], exile: [] },
          },
        },
        async () => observeFirstCast(gameId, playerId),
      );
    },
  },
  {
    id: 'S3',
    category: 'sequencing',
    kind: 'priority',
    heldOut: true,
    knownFailing: true,
    description:
      'Four lands; hand Llanowar Elves, 3/3, 5/5. Cast Elves + 3/3 — elves are sick and cannot pay for the 5.',
    acceptable: [
      'priority:cast:Llanowar Elves',
      'priority:cast:Bear 3',
      'priority:cast:Llanowar Elves+Bear 3',
      'priority:cast:Bear 3+Llanowar Elves',
    ],
    forbidden: ['priority:cast:Beast 5'],
    run: async () => {
      const gameId = 'puzzle_s3_sick';
      const playerId = 'ai-player';
      return withTempGame(
        gameId,
        playerId,
        {
          players: [
            { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
            { id: 'opp1', name: 'Opp', spectator: false, life: 40 },
          ],
          turnPlayer: playerId,
          activePlayer: playerId,
          priority: playerId,
          phase: 'precombatMain',
          step: 'MAIN1',
          turnNumber: 4,
          stack: [],
          landsPlayedThisTurn: { [playerId]: 1 },
          manaPool: { [playerId]: { ...emptyMana(), green: 4 }, opp1: emptyMana() },
          battlefield: [1, 2, 3, 4].map((n) => landPermanent(`f${n}`, playerId)),
          zones: {
            [playerId]: {
              hand: [
                {
                  id: 'elf',
                  name: 'Llanowar Elves',
                  type_line: 'Creature — Elf Druid',
                  power: '1',
                  toughness: '1',
                  oracle_text: '{T}: Add {G}.',
                  mana_cost: '{G}',
                  cmc: 1,
                },
                {
                  id: 'bear',
                  name: 'Bear 3',
                  type_line: 'Creature — Bear',
                  power: '3',
                  toughness: '3',
                  mana_cost: '{2}{G}',
                  cmc: 3,
                },
                {
                  id: 'beast',
                  name: 'Beast 5',
                  type_line: 'Creature — Beast',
                  power: '5',
                  toughness: '5',
                  mana_cost: '{3}{G}{G}',
                  cmc: 5,
                },
              ],
              library: [],
              graveyard: [],
              exile: [],
            },
            opp1: { hand: [], library: [], graveyard: [], exile: [] },
          },
        },
        async () => observeFirstCast(gameId, playerId),
      );
    },
  },
  {
    id: 'S4',
    category: 'sequencing',
    kind: 'priority',
    description:
      'Two lands + untapped Sol Ring; hand 4-drop and 2-drop. Cast the 4/4 using the rock.',
    acceptable: ['priority:cast:Golem 4'],
    forbidden: ['priority:pass', 'priority:cast:Dog 2'],
    run: async () => {
      const gameId = 'puzzle_s4_rock';
      const playerId = 'ai-player';
      return withTempGame(
        gameId,
        playerId,
        {
          players: [
            { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
            { id: 'opp1', name: 'Opp', spectator: false, life: 40 },
          ],
          turnPlayer: playerId,
          activePlayer: playerId,
          priority: playerId,
          phase: 'precombatMain',
          step: 'MAIN1',
          turnNumber: 3,
          stack: [],
          landsPlayedThisTurn: { [playerId]: 1 },
          // 2 lands + Sol Ring = 4 mana available (pre-filled).
          manaPool: { [playerId]: { ...emptyMana(), colorless: 4 }, opp1: emptyMana() },
          battlefield: [
            landPermanent('f1', playerId),
            landPermanent('f2', playerId),
            {
              id: 'sol',
              controller: playerId,
              owner: playerId,
              tapped: false,
              summoningSickness: false,
              counters: {},
              card: {
                id: 'c_sol',
                name: 'Sol Ring',
                type_line: 'Artifact',
                oracle_text: '{T}: Add {C}{C}.',
                mana_cost: '{1}',
                cmc: 1,
              },
            },
          ],
          zones: {
            [playerId]: {
              hand: [
                {
                  id: 'golem',
                  name: 'Golem 4',
                  type_line: 'Artifact Creature — Golem',
                  power: '4',
                  toughness: '4',
                  mana_cost: '{4}',
                  cmc: 4,
                },
                {
                  id: 'dog',
                  name: 'Dog 2',
                  type_line: 'Creature — Dog',
                  power: '2',
                  toughness: '2',
                  mana_cost: '{1}{G}',
                  cmc: 2,
                },
              ],
              library: [],
              graveyard: [],
              exile: [],
            },
            opp1: { hand: [], library: [], graveyard: [], exile: [] },
          },
        },
        async () => observeFirstCast(gameId, playerId),
      );
    },
  },
  {
    id: 'S5',
    category: 'sequencing',
    kind: 'priority',
    description:
      'Five lands, nine cards (max hand 7). Cast 3/3 + one 2/2 to avoid discarding.',
    acceptable: [
      'priority:cast:Bear 3',
      'priority:cast:Dog A',
      'priority:cast:Dog B',
      'priority:cast:Bear 3+Dog A',
      'priority:cast:Bear 3+Dog B',
      'priority:cast:Dog A+Bear 3',
      'priority:cast:Dog B+Bear 3',
    ],
    forbidden: ['priority:pass'],
    run: async () => {
      const gameId = 'puzzle_s5_discard';
      const playerId = 'ai-player';
      const spareLands = [1, 2, 3, 4, 5, 6].map((n) => ({
        id: `spare${n}`,
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.',
        types: ['Land'],
      }));
      return withTempGame(
        gameId,
        playerId,
        {
          players: [
            { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
            { id: 'opp1', name: 'Opp', spectator: false, life: 40 },
          ],
          turnPlayer: playerId,
          activePlayer: playerId,
          priority: playerId,
          phase: 'precombatMain',
          step: 'MAIN1',
          turnNumber: 6,
          stack: [],
          landsPlayedThisTurn: { [playerId]: 1 },
          manaPool: { [playerId]: { ...emptyMana(), green: 5 }, opp1: emptyMana() },
          battlefield: [1, 2, 3, 4, 5].map((n) => landPermanent(`f${n}`, playerId)),
          zones: {
            [playerId]: {
              hand: [
                {
                  id: 'bear',
                  name: 'Bear 3',
                  type_line: 'Creature — Bear',
                  power: '3',
                  toughness: '3',
                  mana_cost: '{2}{G}',
                  cmc: 3,
                },
                {
                  id: 'dogA',
                  name: 'Dog A',
                  type_line: 'Creature — Dog',
                  power: '2',
                  toughness: '2',
                  mana_cost: '{1}{G}',
                  cmc: 2,
                },
                {
                  id: 'dogB',
                  name: 'Dog B',
                  type_line: 'Creature — Dog',
                  power: '2',
                  toughness: '2',
                  mana_cost: '{1}{G}',
                  cmc: 2,
                },
                ...spareLands,
              ],
              library: [],
              graveyard: [],
              exile: [],
            },
            opp1: { hand: [], library: [], graveyard: [], exile: [] },
          },
        },
        async () => observeFirstCast(gameId, playerId),
      );
    },
  },
];

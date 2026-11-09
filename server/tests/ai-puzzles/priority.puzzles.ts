/**
 * P0-5 main-phase / response / targeting puzzles that exercise server AI helpers.
 */

import { vi } from 'vitest';
import type { PlayerID, TargetRef } from '../../../shared/src/types.js';
import type { SpellSpec } from '../../src/rules-engine/targeting.js';
import { createGameIfNotExists, deleteGame } from '../../src/db/index.js';
import { cleanupGameAI, handleAIPriority, registerAIPlayer } from '../../src/socket/ai.js';
import { enumerateAIActionCandidates } from '../../src/socket/ai-handlers/aiActionCandidateHandlers.js';
import { chooseAITargetsForSpell } from '../../src/socket/ai-handlers/aiTargetChoiceHandlers.js';
import { ResolutionQueueManager } from '../../src/state/resolution/index.js';
import { games } from '../../src/socket/socket.js';
import { ensureGame } from '../../src/socket/util.js';
import type { Puzzle } from './puzzleHarness.js';

const { requestCastSpellForSocket, handlePlayLandRequest } = vi.hoisted(() => ({
  requestCastSpellForSocket: vi.fn(),
  handlePlayLandRequest: vi.fn(),
}));

vi.mock('../../src/socket/game-actions.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/socket/game-actions.js')>(
    '../../src/socket/game-actions.js',
  );
  return {
    ...actual,
    requestCastSpellForSocket,
    handlePlayLandRequest,
  };
});

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
  } as any;
}

async function withTempGame(gameId: string, playerId: string, state: any, fn: (game: any) => Promise<PuzzleResult>) {
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

function emptyMana() {
  return { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
}

export const priorityPuzzles: Puzzle[] = [
  {
    id: 'P-land-before-spell',
    category: 'sequencing',
    kind: 'priority',
    description: 'Main phase with a land and a castable spell: play the land first.',
    acceptable: ['priority:play_land:Forest'],
    forbidden: ['priority:cast_spell:Cultivate', 'priority:pass'],
    run: async () => {
      const gameId = 'puzzle_land_before_spell';
      const playerId = 'ai-player';
      requestCastSpellForSocket.mockReset();
      handlePlayLandRequest.mockReset();
      handlePlayLandRequest.mockImplementation((_io: any, _socket: any, payload: any) => {
        const live = ensureGame(String(payload?.gameId || gameId));
        if (!live) return;
        const zones = (live.state as any).zones?.[playerId];
        const hand = Array.isArray(zones?.hand) ? zones.hand : [];
        const idx = hand.findIndex((c: any) => String(c?.id || '') === String(payload?.cardId || ''));
        if (idx >= 0) {
          const [card] = hand.splice(idx, 1);
          (live.state as any).battlefield = [
            ...((live.state as any).battlefield || []),
            {
              id: `bf_${card.id}`,
              controller: playerId,
              owner: playerId,
              tapped: false,
              summoningSickness: false,
              counters: {},
              card,
            },
          ];
          (live.state as any).landsPlayedThisTurn = {
            ...((live.state as any).landsPlayedThisTurn || {}),
            [playerId]: Number((live.state as any).landsPlayedThisTurn?.[playerId] || 0) + 1,
          };
        }
      });
      requestCastSpellForSocket.mockResolvedValue(true);

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
          phase: 'main',
          step: 'precombat_main',
          turnNumber: 3,
          stack: [],
          landsPlayedThisTurn: { [playerId]: 0 },
          manaPool: { [playerId]: { ...emptyMana(), green: 3 }, opp1: emptyMana() },
          battlefield: [
            {
              id: 'f1',
              controller: playerId,
              owner: playerId,
              tapped: false,
              summoningSickness: false,
              counters: {},
              card: { id: 'c_f1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
            },
            {
              id: 'f2',
              controller: playerId,
              owner: playerId,
              tapped: false,
              summoningSickness: false,
              counters: {},
              card: { id: 'c_f2', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
            },
            {
              id: 'f3',
              controller: playerId,
              owner: playerId,
              tapped: false,
              summoningSickness: false,
              counters: {},
              card: { id: 'c_f3', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
            },
          ],
          zones: {
            [playerId]: {
              hand: [
                {
                  id: 'land1',
                  name: 'Forest',
                  type_line: 'Basic Land — Forest',
                  oracle_text: '{T}: Add {G}.',
                  types: ['Land'],
                },
                {
                  id: 'spell1',
                  name: 'Cultivate',
                  type_line: 'Sorcery',
                  oracle_text:
                    'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
                  mana_cost: '{2}{G}',
                  cmc: 3,
                },
              ],
              library: [],
              graveyard: [],
              exile: [],
            },
            opp1: { hand: [], library: [], graveyard: [], exile: [] },
          },
        },
        async (game) => {
          await handleAIPriority(createNoopIo(), gameId, playerId as PlayerID);
          if (handlePlayLandRequest.mock.calls.length > 0) {
            return { observed: 'priority:play_land:Forest', detail: handlePlayLandRequest.mock.calls[0] };
          }
          if (requestCastSpellForSocket.mock.calls.length > 0) {
            const payload = requestCastSpellForSocket.mock.calls[0]?.[2];
            const name = String(payload?.cardName || payload?.card?.name || 'spell');
            return { observed: `priority:cast_spell:${name}`, detail: requestCastSpellForSocket.mock.calls[0] };
          }
          return { observed: 'priority:pass', detail: { stack: game.state.stack } };
        },
      );
    },
  },
  {
    id: 'P-hold-counter-for-winner',
    category: 'response',
    kind: 'response',
    description:
      'Stack has a game-winning Expropriate under a Shock. Hold Counterspell for Expropriate (do not spend it on Shock).',
    knownFailing: true,
    acceptable: ['response:pass', 'response:cast:Counterspell:Expropriate'],
    forbidden: ['response:cast:Counterspell:Shock'],
    run: async () => {
      const gameId = 'puzzle_hold_counter';
      const playerId = 'ai-player';
      return withTempGame(
        gameId,
        playerId,
        {
          players: [
            { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
            { id: 'opp1', name: 'Opp', spectator: false, life: 40 },
          ],
          turnPlayer: 'opp1',
          activePlayer: 'opp1',
          priority: playerId,
          phase: 'main',
          step: 'precombat_main',
          turnNumber: 8,
          stack: [
            {
              id: 'stack_expro',
              type: 'spell',
              controller: 'opp1',
              card: {
                id: 'expro',
                name: 'Expropriate',
                type_line: 'Sorcery',
                oracle_text: 'Council\'s dilemma — Each player votes...',
                mana_cost: '{5}{U}{U}',
                cmc: 7,
              },
            },
            {
              id: 'stack_shock',
              type: 'spell',
              controller: 'opp1',
              card: {
                id: 'shock',
                name: 'Shock',
                type_line: 'Instant',
                oracle_text: 'Shock deals 2 damage to any target.',
                mana_cost: '{R}',
                cmc: 1,
              },
            },
          ],
          manaPool: {
            [playerId]: { ...emptyMana(), blue: 2 },
            opp1: emptyMana(),
          },
          battlefield: [],
          zones: {
            [playerId]: {
              hand: [
                {
                  id: 'cs',
                  name: 'Counterspell',
                  type_line: 'Instant',
                  oracle_text: 'Counter target spell.',
                  mana_cost: '{U}{U}',
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
        async (game) => {
          const candidates = await enumerateAIActionCandidates(game, playerId as PlayerID, {
            mode: 'response',
            kinds: ['cast_spell'],
          });
          if (candidates.length === 0) {
            return { observed: 'response:pass', detail: candidates };
          }
          const top = candidates[0];
          const name =
            top.kind === 'cast_spell'
              ? String(top.spell?.castCard?.name || top.spell?.card?.name || 'spell')
              : top.kind;
          // Without a planner, v0 casts Counterspell at whatever is legal; treat first candidate as intent.
          const stackTop = (game.state.stack || [])[(game.state.stack || []).length - 1];
          const targetName = String(stackTop?.card?.name || 'unknown');
          return {
            observed: `response:cast:${name}:${targetName}`,
            detail: { candidates, stackTop },
          };
        },
      );
    },
  },
  {
    id: 'P-no-self-wipe',
    category: 'sweeper',
    kind: 'priority',
    description: 'You have five creatures; opponent has one. Do not cast Wrath of God.',
    knownFailing: true,
    acceptable: ['priority:pass', 'priority:cast_spell:other'],
    forbidden: ['priority:cast_spell:Wrath of God'],
    run: async () => {
      const gameId = 'puzzle_no_self_wipe';
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
          phase: 'main',
          step: 'precombat_main',
          turnNumber: 10,
          stack: [],
          landsPlayedThisTurn: { [playerId]: 1 },
          manaPool: { [playerId]: { ...emptyMana(), white: 4 }, opp1: emptyMana() },
          battlefield: [
            ...[1, 2, 3, 4, 5].map((n) => ({
              id: `own${n}`,
              controller: playerId,
              owner: playerId,
              tapped: false,
              summoningSickness: false,
              counters: {},
              card: {
                id: `c_own${n}`,
                name: `Bear ${n}`,
                type_line: 'Creature — Bear',
                power: '2',
                toughness: '2',
              },
            })),
            {
              id: 'opp_beast',
              controller: 'opp1',
              owner: 'opp1',
              tapped: false,
              summoningSickness: false,
              counters: {},
              card: {
                id: 'c_opp',
                name: 'Craw Wurm',
                type_line: 'Creature — Wurm',
                power: '6',
                toughness: '4',
              },
            },
            ...[1, 2, 3, 4].map((n) => ({
              id: `plains${n}`,
              controller: playerId,
              owner: playerId,
              tapped: false,
              summoningSickness: false,
              counters: {},
              card: {
                id: `c_p${n}`,
                name: 'Plains',
                type_line: 'Basic Land — Plains',
                oracle_text: '{T}: Add {W}.',
              },
            })),
          ],
          zones: {
            [playerId]: {
              hand: [
                {
                  id: 'wrath',
                  name: 'Wrath of God',
                  type_line: 'Sorcery',
                  oracle_text: 'Destroy all creatures. They can\'t be regenerated.',
                  mana_cost: '{2}{W}{W}',
                  cmc: 4,
                },
              ],
              library: [],
              graveyard: [],
              exile: [],
            },
            opp1: { hand: [], library: [], graveyard: [], exile: [] },
          },
        },
        async (game) => {
          const candidates = await enumerateAIActionCandidates(game, playerId as PlayerID, {
            mode: 'main',
            kinds: ['cast_spell'],
          });
          if (candidates.length === 0) return { observed: 'priority:pass', detail: candidates };
          const top = candidates[0];
          const name =
            top.kind === 'cast_spell'
              ? String(top.spell?.castCard?.name || top.spell?.card?.name || 'other')
              : 'other';
          if (name === 'Wrath of God') {
            return { observed: 'priority:cast_spell:Wrath of God', detail: candidates };
          }
          return { observed: 'priority:cast_spell:other', detail: candidates };
        },
      );
    },
  },
  {
    id: 'P-remove-biggest-threat',
    category: 'removal',
    kind: 'target',
    description: 'Doom Blade in hand; opponent has a 2/2 and an 8/8. Target the 8/8.',
    acceptable: ['target:opp_large'],
    forbidden: ['target:opp_small'],
    run: async () => {
      const gameId = 'puzzle_remove_biggest';
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
          phase: 'main',
          step: 'precombat_main',
          turnNumber: 5,
          stack: [],
          manaPool: { [playerId]: { ...emptyMana(), black: 2 }, opp1: emptyMana() },
          battlefield: [
            {
              id: 'opp_small',
              controller: 'opp1',
              owner: 'opp1',
              tapped: false,
              summoningSickness: false,
              counters: {},
              effectivePower: 2,
              effectiveToughness: 2,
              card: {
                id: 'c_small',
                name: 'Grizzly Bears',
                type_line: 'Creature — Bear',
                power: '2',
                toughness: '2',
              },
            },
            {
              id: 'opp_large',
              controller: 'opp1',
              owner: 'opp1',
              tapped: false,
              summoningSickness: false,
              counters: {},
              effectivePower: 8,
              effectiveToughness: 8,
              card: {
                id: 'c_large',
                name: 'Colossus',
                type_line: 'Creature — Golem',
                power: '8',
                toughness: '8',
              },
            },
          ],
          zones: {
            [playerId]: { hand: [], library: [], graveyard: [], exile: [] },
            opp1: { hand: [], library: [], graveyard: [], exile: [] },
          },
        },
        async (game) => {
          const card = {
            id: 'doom',
            name: 'Doom Blade',
            type_line: 'Instant',
            oracle_text: 'Destroy target nonblack creature.',
            mana_cost: '{1}{B}',
            cmc: 2,
          };
          const spellSpec = {
            op: 'DESTROY_TARGET',
            filter: 'CREATURE',
            minTargets: 1,
            maxTargets: 1,
          } as SpellSpec;
          const validTargets: TargetRef[] = [
            { kind: 'permanent', id: 'opp_small' },
            { kind: 'permanent', id: 'opp_large' },
          ];
          const targets = chooseAITargetsForSpell(
            game,
            playerId as PlayerID,
            card,
            spellSpec,
            validTargets,
          );
          const chosen = targets[0]?.id || 'none';
          return { observed: `target:${chosen}`, detail: targets };
        },
      );
    },
  },
];


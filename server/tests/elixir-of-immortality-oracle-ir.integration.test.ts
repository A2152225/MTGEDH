import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { isActivatedAbilityEffectFullyWired } from '../src/state/modules/oracleIrStepWiring.js';
import { collectActivatedAbilitySteps } from '../src/state/modules/oracleIrAbilityExecution.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const ELIXIR_ORACLE =
  "{2}, {T}: You gain 5 life. Shuffle Elixir of Immortality and your graveyard into their owner's library.";

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedElixirGame(gameId: string, playerId: PlayerID) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      graveyard: [
        { id: 'gy_1', name: 'Grave Card 1', type_line: 'Sorcery', zone: 'graveyard' },
        { id: 'gy_2', name: 'Grave Card 2', type_line: 'Instant', zone: 'graveyard' },
      ],
      graveyardCount: 2,
      libraryCount: 1,
    },
  };
  (game.state as any).battlefield = [{
    id: 'elixir_perm_1',
    controller: playerId,
    owner: playerId,
    card: {
      id: 'elixir_card_1',
      name: 'Elixir of Immortality',
      type_line: 'Artifact',
      oracle_text: ELIXIR_ORACLE,
    },
  }];
  game.libraries.set(playerId, [
    { id: 'lib_1', name: 'Library Card', type_line: 'Creature', zone: 'library' },
  ] as any);

  return game;
}

describe('Elixir of Immortality Oracle IR activated ability', () => {
  const gameId = 'test_elixir_oracle_ir';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('parses the activated effect into fully wired gain_life + move_zone steps', () => {
    const steps = collectActivatedAbilitySteps(ELIXIR_ORACLE, 'Elixir of Immortality');
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
    expect(steps.map((step) => step.kind)).toEqual(['gain_life', 'move_zone']);
  });

  it('applies life gain and shuffles the artifact plus graveyard into library via IR', () => {
    const playerId = 'p1' as PlayerID;
    const game = seedElixirGame(gameId, playerId);

    const result = tryApplyOracleIRToActivatedAbility(game as any, {
      controller: playerId,
      sourceName: 'Elixir of Immortality',
      oracleText: ELIXIR_ORACLE,
      sourcePermanentId: 'elixir_perm_1',
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBe(2);
    expect((game.state as any).life[playerId]).toBe(45);
    expect((game.state as any).zones[playerId].graveyard).toHaveLength(0);
    expect((game.state as any).battlefield).toHaveLength(0);

    const libraryIds = new Set((game.libraries.get(playerId) || []).map((card: any) => card.id));
    expect(libraryIds).toEqual(new Set(['lib_1', 'elixir_card_1', 'gy_1', 'gy_2']));
  });

  it('resolves the ability from the stack without legacy Elixir handler', () => {
    const playerId = 'p1' as PlayerID;
    const game = seedElixirGame(gameId, playerId);

    (game.state as any).stack = [{
      id: 'elixir_ability_1',
      type: 'ability',
      controller: playerId,
      source: 'elixir_perm_1',
      sourceName: 'Elixir of Immortality',
      description: "You gain 5 life. Shuffle Elixir of Immortality and your graveyard into their owner's library.",
      activatedAbilityText: ELIXIR_ORACLE,
    }];

    resolveTopOfStack(game as any);

    expect((game.state as any).stack).toHaveLength(0);
    expect((game.state as any).life[playerId]).toBe(45);
    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).zones[playerId].graveyard).toHaveLength(0);
    expect((game.libraries.get(playerId) || []).length).toBe(4);
  });
});

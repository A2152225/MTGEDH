import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import {
  persistTargetedTriggeredStackItems,
  triggerPermanentTargetedTriggersFromAbility,
  triggerPermanentTargetedTriggersFromSpell,
} from '../src/state/modules/triggers/targeted.js';
import { processTargetedTriggersForSpellTargets } from '../src/socket/game-actions.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('Oracle IR Cowardice observer targeted trigger', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  const cowardiceOracleText =
    'Whenever a creature becomes the target of a spell or ability, return that creature to its owner\'s hand. (It won\'t be affected by the spell or ability.)';

  function seedCowardiceBoard(game: any, playerId: PlayerID) {
    (game.state as any).battlefield = [
      {
        id: 'cowardice_1',
        controller: playerId,
        card: {
          name: 'Cowardice',
          type_line: 'Enchantment',
          oracle_text: cowardiceOracleText,
        },
      },
      {
        id: 'bear_1',
        controller: playerId,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ];
  }

  it('queues Cowardice when a spell targets a creature via processTargetedTriggersForSpellTargets', () => {
    const gameId = 'test_oracle_ir_cowardice_spell_targeted';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const spellStackId = 'stack_giant_growth_cowardice_1';
    seedCowardiceBoard(game, p1);
    (game.state as any).stack = [
      {
        id: spellStackId,
        type: 'spell',
        controller: p1,
        sourceName: 'Giant Growth',
        targets: ['bear_1'],
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };

    processTargetedTriggersForSpellTargets(game, p1, ['bear_1'], gameId, spellStackId);

    const cowardiceTrigger = getStackItems((game.state as any).stack)
      .find((item: any) => item?.sourceName === 'Cowardice');
    expect(cowardiceTrigger).toBeDefined();
    expect(cowardiceTrigger?.triggerType).toBe('targeted');
    expect(String(cowardiceTrigger?.description || '')).toMatch(/return that creature/i);
    expect(cowardiceTrigger?.source).toBe('cowardice_1');
    expect(cowardiceTrigger?.effectData?.targetedPermanentId).toBe('bear_1');
    expect(cowardiceTrigger?.triggeringStackItemId).toBe(spellStackId);
  });

  it('persists pushTriggeredAbility and replays Cowardice onto the stack', async () => {
    const gameId = 'test_oracle_ir_cowardice_targeted_replay';
    const replayGameId = `${gameId}_replay`;
    const p1 = 'p1' as PlayerID;

    ResolutionQueueManager.removeQueue(gameId);
    GameManager.deleteGame(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
    await deleteGame(replayGameId);

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const spellStackId = 'stack_giant_growth_cowardice_replay_1';
    seedCowardiceBoard(game, p1);
    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    const eventStart = getEvents(gameId).length;

    const targetedTriggers = triggerPermanentTargetedTriggersFromSpell(game as any, {
      castBy: p1,
      stackItemId: spellStackId,
      targetIds: ['bear_1'],
    });
    persistTargetedTriggeredStackItems(gameId, game, targetedTriggers);

    const replayEvents = getEvents(gameId)
      .slice(eventStart)
      .map((event: any) =>
        event?.payload && typeof event.payload === 'object'
          ? { type: event.type, ...(event.payload as Record<string, unknown>) }
          : { type: event.type },
      );
    expect(replayEvents.filter((event: any) => event.type === 'pushTriggeredAbility')).toHaveLength(1);

    const replayGame = createInitialGameState(replayGameId);
    seedCowardiceBoard(replayGame, p1);
    replayGame.replay(replayEvents as any);

    const replayTrigger = getStackItems((replayGame.state as any).stack)
      .find((item: any) => item?.sourceName === 'Cowardice');
    expect(replayTrigger?.effectData?.targetedPermanentId).toBe('bear_1');

    await deleteGame(gameId);
    await deleteGame(replayGameId);
  });

  it('queues Cowardice when a single-target ability targets a creature', () => {
    const gameId = 'test_oracle_ir_cowardice_ability_targeted';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const abilityStackId = 'stack_shock_trooper_cowardice_1';
    seedCowardiceBoard(game, p1);
    (game.state as any).battlefield.push({
      id: 'shock_trooper_1',
      controller: p1,
      card: { name: 'Shock Trooper', type_line: 'Creature — Human Soldier' },
    });
    (game.state as any).stack = [
      {
        id: abilityStackId,
        type: 'ability',
        controller: p1,
        source: 'shock_trooper_1',
        sourceName: 'Shock Trooper',
        abilityText: '{R}: Target creature gets +1/+0 until end of turn.',
        targets: ['bear_1'],
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };

    const targetedTriggers = triggerPermanentTargetedTriggersFromAbility(game as any, {
      activatedBy: p1,
      sourcePermanentId: 'shock_trooper_1',
      stackItemId: abilityStackId,
      targetIds: ['bear_1'],
    });

    expect(targetedTriggers).toHaveLength(1);
    expect(targetedTriggers[0]?.sourceName).toBe('Cowardice');
    expect(targetedTriggers[0]?.effectData?.targetedPermanentId).toBe('bear_1');
  });

  it('does not queue spell-only observer triggers when a creature is targeted by an ability', () => {
    const gameId = 'test_oracle_ir_spell_only_observer_ability_skip';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const spellOnlyOracleText =
      'Whenever a creature becomes the target of a spell, return that creature to its owner\'s hand.';

    (game.state as any).battlefield = [
      {
        id: 'spell_only_observer_1',
        controller: p1,
        card: {
          name: 'Spell Only Observer',
          type_line: 'Enchantment',
          oracle_text: spellOnlyOracleText,
        },
      },
      {
        id: 'bear_1',
        controller: p1,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'shock_trooper_1',
        controller: p1,
        card: { name: 'Shock Trooper', type_line: 'Creature — Human Soldier' },
      },
    ];

    const targetedTriggers = triggerPermanentTargetedTriggersFromAbility(game as any, {
      activatedBy: p1,
      sourcePermanentId: 'shock_trooper_1',
      stackItemId: 'stack_shock_trooper_spell_only_1',
      targetIds: ['bear_1'],
    });

    expect(targetedTriggers).toHaveLength(0);
  });

  it('queues spell-only observer triggers when a creature is targeted by a spell', () => {
    const gameId = 'test_oracle_ir_spell_only_observer_spell';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const spellOnlyOracleText =
      'Whenever a creature becomes the target of a spell, return that creature to its owner\'s hand.';

    (game.state as any).battlefield = [
      {
        id: 'spell_only_observer_1',
        controller: p1,
        card: {
          name: 'Spell Only Observer',
          type_line: 'Enchantment',
          oracle_text: spellOnlyOracleText,
        },
      },
      {
        id: 'bear_1',
        controller: p1,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ];

    const targetedTriggers = triggerPermanentTargetedTriggersFromSpell(game as any, {
      castBy: p1,
      stackItemId: 'stack_giant_growth_spell_only_1',
      targetIds: ['bear_1'],
    });

    expect(targetedTriggers).toHaveLength(1);
    expect(targetedTriggers[0]?.sourceName).toBe('Spell Only Observer');
    expect(targetedTriggers[0]?.effectData?.targetedPermanentId).toBe('bear_1');
  });

  it('does not queue Cowardice when a noncreature permanent is targeted', () => {
    const gameId = 'test_oracle_ir_cowardice_noncreature_skip';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    seedCowardiceBoard(game, p1);
    (game.state as any).battlefield.push({
      id: 'sol_ring_1',
      controller: p1,
      card: { name: 'Sol Ring', type_line: 'Artifact' },
    });

    const targetedTriggers = triggerPermanentTargetedTriggersFromSpell(game as any, {
      castBy: p1,
      stackItemId: 'stack_destroy_artifact_1',
      targetIds: ['sol_ring_1'],
    });

    expect(targetedTriggers).toHaveLength(0);
  });
});

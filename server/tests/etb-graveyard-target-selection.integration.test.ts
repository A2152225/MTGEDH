import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { executeTriggerEffect, queueSelfETBTriggersForPermanent } from '../src/state/modules/stack.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: () => {} }),
    emit: () => {},
  } as any;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedGame(gameId: string, playerId: string, opponentId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
    { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
  (game as any).libraries = new Map<PlayerID, any[]>([[playerId, []], [opponentId, []]]);
  return game;
}

describe('ETB triggered ability: graveyard target selection wiring (later11)', () => {
  const gameId = 'etb_grave_target_select_int';
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('queues GRAVEYARD_SELECTION when an ETB trigger needs a graveyard target, then resolves with the chosen card', () => {
    const game = seedGame(gameId, playerId, opponentId);

    // Coalstoke Gearhulk-style: ETB returns a creature card from your graveyard
    // to the battlefield. We craft an explicit oracle text so the
    // inferTriggeredAbilityTargetMetadata helper sees a graveyard target.
    const sourceCard = {
      id: 'gearhulk_card',
      name: 'Test Gearhulk',
      type_line: 'Artifact Creature \u2014 Construct',
      oracle_text: 'When Test Gearhulk enters, return target creature card from your graveyard to the battlefield.',
      power: '4', toughness: '4',
    };
    const sourcePermanent = {
      id: 'gearhulk_perm',
      controller: playerId,
      owner: playerId,
      counters: {},
      tapped: false,
      summoningSickness: true,
      card: sourceCard,
    };
    (game.state as any).battlefield.push(sourcePermanent);

    // Eligible target: a creature card already in the player's graveyard.
    const targetCard = {
      id: 'grizzly_bears_card',
      name: 'Grizzly Bears',
      type_line: 'Creature \u2014 Bear',
      oracle_text: '',
      power: '2', toughness: '2',
      mana_cost: '{1}{G}',
    };
    (game.state as any).zones[playerId].graveyard.push(targetCard);
    (game.state as any).zones[playerId].graveyardCount = 1;

    // Also seed a non-creature card to confirm filtering rejects it.
    const nonCreatureCard = {
      id: 'lightning_bolt_card',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: '',
      mana_cost: '{R}',
    };
    (game.state as any).zones[playerId].graveyard.push(nonCreatureCard);
    (game.state as any).zones[playerId].graveyardCount = 2;

    queueSelfETBTriggersForPermanent(game as any, sourcePermanent, playerId as any);

    // The trigger should be on the stack...
    const stack: any[] = (game.state as any).stack;
    expect(stack.length).toBeGreaterThanOrEqual(1);
    const triggerItem = stack[stack.length - 1];
    expect(triggerItem?.type).toBe('triggered_ability');

    // ...and a GRAVEYARD_SELECTION step should be queued for the controller.
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any);
    const grSteps = steps.filter((s: any) => s?.type === ResolutionStepType.GRAVEYARD_SELECTION && s?.triggeredAbilityGraveyardChoice === true);
    expect(grSteps.length).toBe(1);
    const step = grSteps[0] as any;
    expect(step.triggerStackItemId).toBe(triggerItem.id);
    expect(Array.isArray(step.validTargets)).toBe(true);
    const targetIds = step.validTargets.map((t: any) => t.id);
    expect(targetIds).toContain('grizzly_bears_card');
    expect(targetIds).not.toContain('lightning_bolt_card');

    // Simulate the player's selection by stamping targets onto the stack item
    // (this mirrors what handleGraveyardSelectionResponse does in the
    // triggeredAbilityGraveyardChoice branch).
    triggerItem.targets = ['grizzly_bears_card'];

    // Resolve the trigger -> should return the creature card to the battlefield.
    executeTriggerEffect(
      game as any,
      playerId,
      'Test Gearhulk',
      'Return target creature card from your graveyard to the battlefield.',
      {
        source: 'gearhulk_perm',
        permanentId: 'gearhulk_perm',
        triggerType: 'etb',
        card: sourceCard,
        targets: ['grizzly_bears_card'],
      } as any
    );

    const battlefield: any[] = (game.state as any).battlefield;
    const reanimated = battlefield.find((p) => p?.card?.id === 'grizzly_bears_card');
    expect(reanimated).toBeDefined();
    expect((game.state as any).zones[playerId].graveyard.find((c: any) => c?.id === 'grizzly_bears_card')).toBeUndefined();
  });

  it('filters graveyard targets by mana value when the trigger text constrains it (Coalstoke Gearhulk-style)', () => {
    const game = seedGame(gameId, playerId, opponentId);

    const sourceCard = {
      id: 'mv_gearhulk_card',
      name: 'Test MV Gearhulk',
      type_line: 'Artifact Creature \u2014 Construct',
      oracle_text: 'When Test MV Gearhulk enters, return target creature card with mana value 3 or less from your graveyard to the battlefield.',
      power: '4', toughness: '4',
    };
    const sourcePermanent = {
      id: 'mv_gearhulk_perm',
      controller: playerId,
      owner: playerId,
      counters: {},
      tapped: false,
      summoningSickness: true,
      card: sourceCard,
    };
    (game.state as any).battlefield.push(sourcePermanent);

    const cheapCreature = {
      id: 'cheap_card',
      name: 'Cheap Creature',
      type_line: 'Creature \u2014 Bear',
      oracle_text: '',
      mana_cost: '{1}{G}',
      power: '2', toughness: '2',
    };
    const expensiveCreature = {
      id: 'expensive_card',
      name: 'Expensive Creature',
      type_line: 'Creature \u2014 Beast',
      oracle_text: '',
      mana_cost: '{4}{G}{G}',
      power: '6', toughness: '6',
    };
    (game.state as any).zones[playerId].graveyard.push(cheapCreature, expensiveCreature);
    (game.state as any).zones[playerId].graveyardCount = 2;

    queueSelfETBTriggersForPermanent(game as any, sourcePermanent, playerId as any);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any);
    const grSteps = steps.filter((s: any) => s?.type === ResolutionStepType.GRAVEYARD_SELECTION && s?.triggeredAbilityGraveyardChoice === true);
    expect(grSteps.length).toBe(1);
    const step = grSteps[0] as any;
    const targetIds = step.validTargets.map((t: any) => t.id);
    expect(targetIds).toContain('cheap_card');
    expect(targetIds).not.toContain('expensive_card');
  });

  it('queues Necromancy-style ETB graveyard selection and attaches the source enchantment to the reanimated creature', () => {
    const game = seedGame(gameId, playerId, opponentId);

    const sourceCard = {
      id: 'necromancy_card',
      name: 'Necromancy',
      type_line: 'Enchantment',
      oracle_text: 'When Necromancy enters, if it\'s on the battlefield, it becomes an Aura with enchant creature put onto the battlefield with Necromancy. Put target creature card from a graveyard onto the battlefield under your control and attach Necromancy to it.',
    };
    const sourcePermanent = {
      id: 'necromancy_perm',
      controller: playerId,
      owner: playerId,
      counters: {},
      tapped: false,
      summoningSickness: false,
      card: sourceCard,
    };
    (game.state as any).battlefield.push(sourcePermanent);

    const targetCard = {
      id: 'gy_creature_necro',
      name: 'Sengir Vampire',
      type_line: 'Creature \u2014 Vampire',
      oracle_text: 'Flying',
      power: '4',
      toughness: '4',
      mana_cost: '{3}{B}{B}',
    };
    (game.state as any).zones[playerId].graveyard.push(targetCard);
    (game.state as any).zones[playerId].graveyardCount = 1;

    queueSelfETBTriggersForPermanent(game as any, sourcePermanent, playerId as any);

    const stack: any[] = (game.state as any).stack;
    expect(stack.length).toBeGreaterThanOrEqual(1);
    const triggerItem = stack[stack.length - 1];
    expect(triggerItem?.type).toBe('triggered_ability');

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any);
    const grSteps = steps.filter((s: any) => s?.type === ResolutionStepType.GRAVEYARD_SELECTION && s?.triggeredAbilityGraveyardChoice === true);
    expect(grSteps.length).toBe(1);
    const step = grSteps[0] as any;
    expect(step.validTargets.map((t: any) => String(t.id))).toEqual(['gy_creature_necro']);

    executeTriggerEffect(
      game as any,
      playerId,
      'Necromancy',
      'Put target creature card from a graveyard onto the battlefield under your control and attach Necromancy to it.',
      {
        source: 'necromancy_perm',
        permanentId: 'necromancy_perm',
        triggerType: 'etb',
        card: sourceCard,
        targets: ['gy_creature_necro'],
      } as any
    );

    const battlefield: any[] = (game.state as any).battlefield;
    const necromancy = battlefield.find((p) => p?.id === 'necromancy_perm');
    const reanimated = battlefield.find((p) => p?.card?.id === 'gy_creature_necro');
    expect(necromancy).toBeDefined();
    expect(reanimated).toBeDefined();
    expect(String(necromancy.attachedTo || '')).toBe(String(reanimated.id || ''));
    expect(String(necromancy.card?.type_line || '').toLowerCase()).toContain('aura');
    expect(Array.isArray((reanimated as any).attachments)).toBe(true);
    expect((reanimated as any).attachments).toContain('necromancy_perm');
  });
});

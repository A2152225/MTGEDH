import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { applyEvent } from '../src/state/modules/applyEvent';

const liveReplayGameId = 'test_graveyard_provenance_etb_replay_live';
const replayReplayGameId = 'test_graveyard_provenance_etb_replay_replay';

async function resetGame(gameId: string) {
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function permanentHasFlying(permanent: any): boolean {
  const card = permanent?.card || {};
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  if (keywords.some((entry: string) => String(entry).toLowerCase() === 'flying')) {
    return true;
  }
  const abilities = Array.isArray(card.abilities) ? card.abilities : [];
  if (abilities.some((entry: string) => String(entry).toLowerCase() === 'flying')) {
    return true;
  }
  return String(card.oracle_text || '').toLowerCase().includes('flying');
}

function createContext(stateOverrides: Record<string, any> = {}) {
  const state: any = {
    players: [
      { id: 'p1', name: 'P1', life: 40 },
      { id: 'p2', name: 'P2', life: 40 },
    ],
    battlefield: [],
    stack: [],
    zones: {
      p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    },
    ...stateOverrides,
  };

  return {
    state,
    gameId: 'unknown',
    libraries: new Map<string, any[]>(),
    commandZone: {},
    bumpSeq: () => {},
  } as any;
}

const archfiendCard = {
  id: 'archfiend_card',
  name: "Archfiend's Vessel",
  mana_cost: '{B}',
  type_line: 'Creature — Human Cleric',
  oracle_text: "Lifelink\nWhen this creature enters, if it entered from your graveyard or you cast it from your graveyard, exile it. If you do, create a 5/5 black Demon creature token with flying.",
  power: '1',
  toughness: '1',
};

const prizedAmalgamCard = {
  id: 'prized_card',
  name: 'Prized Amalgam',
  mana_cost: '{1}{U}{B}',
  type_line: 'Creature — Zombie',
  oracle_text: 'Whenever a creature you control enters, if it entered from your graveyard or you cast it from your graveyard, return this card from your graveyard to the battlefield tapped at the beginning of the next end step.',
  power: '3',
  toughness: '3',
};

const rocketCard = {
  id: 'rocket_card',
  name: 'Rocket-Powered Goblin Glider',
  mana_cost: '{R}',
  type_line: 'Artifact — Equipment',
  oracle_text: 'When this Equipment enters, if it was cast from your graveyard, attach it to target creature you control. Equipped creature gets +2/+0 and has flying and haste. Equip {2}. Mayhem {2}.',
};

describe('graveyard provenance ETB integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    await resetGame(liveReplayGameId);
    await resetGame(replayReplayGameId);
  });

  it('marks replayed graveyard-to-battlefield moves with enteredFromZone metadata', () => {
    const ctx = createContext({
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          graveyard: [{ ...archfiendCard }],
          graveyardCount: 1,
          exile: [],
          exileCount: 0,
          libraryCount: 0,
        },
      },
    });

    applyEvent(ctx, {
      type: 'confirmGraveyardTargets',
      playerId: 'p1',
      selectedCardIds: ['archfiend_card'],
      createdPermanentIds: ['arch_perm'],
      destination: 'battlefield',
      targetPlayerId: 'p1',
    } as any);

    const permanent = ctx.state.battlefield.find((entry: any) => entry.id === 'arch_perm');
    expect(permanent).toBeTruthy();
    expect(permanent.enteredFromZone).toBe('graveyard');
    expect(permanent.enteredFromGraveyard).toBe(true);
    expect(permanent.card.enteredFromZone).toBe('graveyard');
  });

  it("exiles Archfiend's Vessel and creates the Demon token when it entered from graveyard", () => {
    const archfiendPermanent = {
      id: 'arch_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      basePower: 1,
      baseToughness: 1,
      enteredFromZone: 'graveyard',
      enteredFromGraveyard: true,
      card: { ...archfiendCard, zone: 'battlefield', enteredFromZone: 'graveyard', enteredFromGraveyard: true },
    };
    const ctx = createContext({
      battlefield: [archfiendPermanent],
    });

    triggerETBEffectsForPermanent(ctx, archfiendPermanent, 'p1');

    const trigger = ctx.state.stack.find((entry: any) => entry.sourceName === "Archfiend's Vessel");
    expect(trigger).toBeTruthy();
    expect(trigger.description).toContain('If you do, create a 5/5 black Demon creature token with flying');

    executeTriggerEffect(ctx, 'p1', "Archfiend's Vessel", trigger.description, trigger);

    expect(ctx.state.battlefield.some((entry: any) => entry.id === 'arch_perm')).toBe(false);
    expect(ctx.state.zones.p1.exile.some((entry: any) => entry.name === "Archfiend's Vessel")).toBe(true);

    const demon = ctx.state.battlefield.find((entry: any) => entry.card?.name === 'Demon');
    expect(demon).toBeTruthy();
    expect(demon.basePower).toBe(5);
    expect(demon.baseToughness).toBe(5);
    expect(demon.card.colors).toEqual(['B']);
    expect(permanentHasFlying(demon)).toBe(true);
  });

  it("persists and replays Archfiend's Vessel self-exile token creation", () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    createGameIfNotExists(liveReplayGameId, 'commander', 40, undefined, 'p1');
    const game = ensureGame(liveReplayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const archfiendPermanent = {
      id: 'arch_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      basePower: 1,
      baseToughness: 1,
      enteredFromZone: 'graveyard',
      enteredFromGraveyard: true,
      card: { ...archfiendCard, zone: 'battlefield', enteredFromZone: 'graveyard', enteredFromGraveyard: true },
    };
    (game.state as any).players = [{ id: 'p1', name: 'P1', life: 40 }];
    (game.state as any).zones = {
      p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [archfiendPermanent];
    (game.state as any).stack = [];

    triggerETBEffectsForPermanent(game as any, archfiendPermanent, 'p1' as any);
    const trigger = (game.state as any).stack.find((entry: any) => entry.sourceName === "Archfiend's Vessel");
    expect(trigger).toBeTruthy();

    executeTriggerEffect(game as any, 'p1' as any, "Archfiend's Vessel", trigger.description, trigger);

    expect(((game.state as any).battlefield || []).some((entry: any) => entry.id === 'arch_perm')).toBe(false);
    const liveDemon = ((game.state as any).battlefield || []).find((entry: any) => entry.card?.name === 'Demon');
    expect(liveDemon).toBeTruthy();
    expect(((game.state as any).zones.p1.exile || []).map((card: any) => card.id)).toEqual(['archfiend_card']);

    const events = getEvents(liveReplayGameId);
    const exileEvent = events.find((event: any) =>
      event.type === 'exilePermanent' &&
      event.payload?.oracleIrReplayMutation === true &&
      event.payload?.permanentId === 'arch_perm',
    ) as any;
    expect(exileEvent?.payload).toMatchObject({
      permanentId: 'arch_perm',
      sourcePermanentId: 'arch_perm',
      oracleIrSourceId: 'arch_perm',
    });

    const tokenEvent = events.find((event: any) =>
      event.type === 'executeEffect' &&
      event.payload?.effectType === 'createToken' &&
      event.payload?.oracleIrReplayMutation === true &&
      String(event.payload?.tokenData?.name || '').toLowerCase() === 'demon'
    ) as any;
    expect(tokenEvent?.payload?.oracleIrSourceId).toBe('arch_perm');
    expect(tokenEvent?.payload?.tokenData).toMatchObject({
      name: 'Demon',
      power: 5,
      toughness: 5,
      colors: ['B'],
    });
    expect(permanentHasFlying(liveDemon)).toBe(true);

    createGameIfNotExists(replayReplayGameId, 'commander', 40, undefined, 'p1');
    const replayGame = ensureGame(replayReplayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');
    (replayGame.state as any).players = [{ id: 'p1', name: 'P1', life: 40 }];
    (replayGame.state as any).zones = {
      p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (replayGame.state as any).battlefield = [archfiendPermanent];

    replayGame.applyEvent({ type: 'exilePermanent', ...(exileEvent.payload || {}) } as any);
    replayGame.applyEvent({ type: 'executeEffect', ...(tokenEvent.payload || {}) } as any);

    expect(((replayGame.state as any).battlefield || []).some((entry: any) => entry.id === 'arch_perm')).toBe(false);
    expect(((replayGame.state as any).zones.p1.exile || []).map((card: any) => card.id)).toEqual(['archfiend_card']);
    const replayDemon = ((replayGame.state as any).battlefield || []).find(
      (entry: any) => entry.id === tokenEvent.payload.tokenData.id,
    );
    expect(replayDemon).toMatchObject({
      id: tokenEvent.payload.tokenData.id,
      controller: 'p1',
      owner: 'p1',
      basePower: 5,
      baseToughness: 5,
      isToken: true,
      card: expect.objectContaining({
        name: 'Demon',
        colors: ['B'],
      }),
    });
  });

  it('queues a delayed tapped return for Prized Amalgam from the graveyard', () => {
    const returningCreature = {
      id: 'creature_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      basePower: 3,
      baseToughness: 1,
      enteredFromZone: 'graveyard',
      enteredFromGraveyard: true,
      card: {
        id: 'skaab_card',
        name: 'Stitchwing Skaab',
        type_line: 'Creature — Zombie Horror',
        power: '3',
        toughness: '1',
        zone: 'battlefield',
        enteredFromZone: 'graveyard',
        enteredFromGraveyard: true,
      },
    };
    const ctx = createContext({
      battlefield: [returningCreature],
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          graveyard: [{ ...prizedAmalgamCard }],
          graveyardCount: 1,
          exile: [],
          exileCount: 0,
          libraryCount: 0,
        },
      },
      turnNumber: 3,
    });

    triggerETBEffectsForPermanent(ctx, returningCreature, 'p1');

    const trigger = ctx.state.stack.find((entry: any) => entry.sourceName === 'Prized Amalgam');
    expect(trigger).toBeTruthy();
    expect(trigger.boundGraveyardCardId).toBe('prized_card');
    expect(trigger.delayedReturnAt).toBe('next_end_step');

    executeTriggerEffect(ctx, 'p1', 'Prized Amalgam', trigger.description, trigger);

    expect(ctx.state.zones.p1.graveyard.some((entry: any) => entry.id === 'prized_card')).toBe(true);
    expect(ctx.state.pendingDelayedGraveyardReturns).toHaveLength(1);
    expect(ctx.state.pendingDelayedGraveyardReturns[0]).toEqual(
      expect.objectContaining({
        cardId: 'prized_card',
        zoneOwnerId: 'p1',
        destination: 'battlefield',
        fireAtStep: 'end_step',
        battlefieldTapped: true,
      }),
    );
  });

  it('detects Rocket-Powered Goblin Glider as a self ETB and attaches it after graveyard cast', () => {
    const targetCreature = {
      id: 'target_creature',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      basePower: 2,
      baseToughness: 2,
      card: { id: 'bear_card', name: 'Runeclaw Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const rocketPermanent = {
      id: 'rocket_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      castSourceZone: 'graveyard',
      enteredFromCast: true,
      card: { ...rocketCard, zone: 'battlefield', castSourceZone: 'graveyard', enteredFromCast: true },
    };
    const ctx = createContext({
      battlefield: [targetCreature, rocketPermanent],
    });

    triggerETBEffectsForPermanent(ctx, rocketPermanent, 'p1');

    const trigger = ctx.state.stack.find((entry: any) => entry.sourceName === 'Rocket-Powered Goblin Glider');
    expect(trigger).toBeTruthy();
    expect(trigger.requiresTarget).toBe(true);
    expect(trigger.targetType).toBe('creature');
    expect(trigger.targetConstraint).toBe('you');

    executeTriggerEffect(
      ctx,
      'p1',
      'Rocket-Powered Goblin Glider',
      trigger.description,
      { ...trigger, targets: ['target_creature'] },
    );

    const rocketAfter = ctx.state.battlefield.find((entry: any) => entry.id === 'rocket_perm');
    const targetAfter = ctx.state.battlefield.find((entry: any) => entry.id === 'target_creature');
    expect(rocketAfter?.attachedTo).toBe('target_creature');
    expect(targetAfter?.attachedEquipment).toContain('rocket_perm');
    expect(targetAfter?.isEquipped).toBe(true);
  });

  it('does not trigger Rocket-Powered Goblin Glider when it was cast from hand', () => {
    const rocketPermanent = {
      id: 'rocket_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      castSourceZone: 'hand',
      enteredFromCast: true,
      card: { ...rocketCard, zone: 'battlefield', castSourceZone: 'hand', enteredFromCast: true },
    };
    const ctx = createContext({ battlefield: [rocketPermanent] });

    triggerETBEffectsForPermanent(ctx, rocketPermanent, 'p1');

    expect(ctx.state.stack.some((entry: any) => entry.sourceName === 'Rocket-Powered Goblin Glider')).toBe(false);
  });

  it('grants haste via IR when Chainer-style ETB trigger fires for a non-hand cast', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const chainerPermanent = {
      id: 'chainer_1',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'chainer_card',
        name: 'Chainer, Nightmare Adept',
        type_line: 'Legendary Creature — Human Minion',
        oracle_text: 'Discard a card: You may cast a creature spell from your graveyard this turn. Activate only once each turn.\nWhenever a nontoken creature enters the battlefield under your control, if you didn\'t cast it from your hand, it gains haste.',
      },
    };
    const enteringCreature = {
      id: 'zombie_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      castSourceZone: 'graveyard',
      summoningSickness: true,
      card: { id: 'zombie_card', name: 'Graveyard Zombie', type_line: 'Creature — Zombie', power: '2', toughness: '2' },
    };
    const ctx = createContext({ battlefield: [chainerPermanent, enteringCreature] });

    triggerETBEffectsForPermanent(ctx, enteringCreature, 'p1');

    const trigger = ctx.state.stack.find((entry: any) => entry.sourceName === 'Chainer, Nightmare Adept');
    expect(trigger).toBeTruthy();
    expect(trigger.interveningIfSubjectPermanentId).toBe('zombie_perm');

    executeTriggerEffect(ctx, 'p1', 'Chainer, Nightmare Adept', trigger.description, trigger);

    const creatureAfter = ctx.state.battlefield.find((entry: any) => entry.id === 'zombie_perm');
    expect(creatureAfter?.grantedAbilities).toContain('haste');
    expect(creatureAfter?.summoningSickness).toBe(false);
  });
});

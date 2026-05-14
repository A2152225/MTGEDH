import { describe, expect, it } from 'vitest';

import { executeTriggerEffect, triggerETBEffectsForPermanent } from '../src/state/modules/stack';
import { applyEvent } from '../src/state/modules/applyEvent';

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
    expect(demon.card.keywords).toContain('Flying');
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

    expect(rocketPermanent.attachedTo).toBe('target_creature');
    expect(targetCreature.attachedEquipment).toContain('rocket_perm');
    expect(targetCreature.isEquipped).toBe(true);
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
});

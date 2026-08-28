import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectEndStepTriggers } from '../src/state/modules/triggers/turn-phases-handlers/turnPhaseEndStepTriggers.js';
import { getEndStepTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';

const EARTHSHAKER_ORACLE =
  'Trample\nWhen this creature enters, draw a card for each other Dinosaur you control.';
const REGISAUR_ORACLE =
  'Other Dinosaurs you control have haste.\nWhen this creature enters, create a 3/3 green Dinosaur creature token with trample.';
const PTERANODON_ORACLE =
  'Flying, haste\nWhenever this creature or another Dinosaur you control with flying enters, gain control of target creature an opponent controls until end of turn. Untap that creature. It gains flying and haste until end of turn. At the beginning of the next end step, target land deals 3 damage to that creature.';

function dinosaur(id: string, controller: string, extras?: { flying?: boolean; name?: string; oracle?: string }) {
  const flying = extras?.flying === true;
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: extras?.name || (flying ? 'Swooping Pteranodon' : 'Earthshaker Dreadmaw'),
      type_line: 'Creature — Dinosaur',
      oracle_text: extras?.oracle || (flying ? PTERANODON_ORACLE : EARTHSHAKER_ORACLE),
      power: '4',
      toughness: '4',
      keywords: flying ? ['Flying', 'Haste'] : ['Trample'],
    },
  };
}

describe('tribal other-subtype ETB draw, haste lord, and flying-typed watcher', () => {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;

  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
  });

  it('detects Earthshaker self-ETB and draws one card per other dinosaur', () => {
    const triggers = detectETBTriggers({
      name: 'Earthshaker Dreadmaw',
      type_line: 'Creature — Dinosaur',
      oracle_text: EARTHSHAKER_ORACLE,
    }, { id: 'dreadmaw_1' });
    const selfEtb = triggers.find((trigger) => trigger.triggerType === 'etb');
    expect(selfEtb).toBeTruthy();
    expect(String(selfEtb?.effect || '')).toMatch(/draw a card for each other dinosaur you control/i);

    const ir = parseOracleTextToIR(EARTHSHAKER_ORACLE, 'Earthshaker Dreadmaw');
    const draw = ir.abilities.flatMap((ability) => ability.steps || []).find((step) => step.kind === 'draw');
    expect((draw as any)?.amount).toEqual({
      kind: 'reference_amount',
      raw: 'a card for each other dinosaur you control',
    });

    const game = createInitialGameState('t_earthshaker_draw');
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    const library = Array.from({ length: 8 }, (_, index) => ({
      id: `lib_${index}`,
      name: `Card ${index}`,
      type_line: 'Instant',
    }));
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, library, libraryCount: library.length, graveyard: [] },
    };
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [];
    player.library = library.map((card: any) => ({ ...card }));
    (game.state as any).battlefield = [
      dinosaur('dreadmaw_1', p1),
      dinosaur('alpha_1', p1, { name: 'Regisaur Alpha', oracle: REGISAUR_ORACLE }),
      dinosaur('ghalta_1', p1, { name: 'Ghalta, Stampede Tyrant', oracle: 'Trample' }),
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
      },
    ];

    const result = applyOracleIRStepsOnServer(
      game as any,
      game.state as any,
      [draw!],
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'dreadmaw_1',
        sourceName: 'Earthshaker Dreadmaw',
      }),
      { allowOptional: false },
      { controller: p1 },
    );
    expect(result.appliedSteps.some((step) => step.kind === 'draw')).toBe(true);
    expect(((game.state as any).players[0].hand || []).length).toBe(2);
  });

  it('grants haste to other dinosaurs from Other [type]s you control have haste', () => {
    const state = {
      battlefield: [
        dinosaur('regisaur_1', p1, { name: 'Regisaur Alpha', oracle: REGISAUR_ORACLE }),
        dinosaur('other_dino', p1),
        {
          id: 'bear_1',
          controller: p1,
          owner: p1,
          card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state)).toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[0] as any, state)).not.toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[2] as any, state)).not.toContain('haste');
  });

  it('grants haste to other goblins from the same Other [type]s you control have haste template', () => {
    const state = {
      battlefield: [
        {
          id: 'warchief_1',
          controller: p1,
          owner: p1,
          card: {
            id: 'warchief_card',
            name: 'Goblin Warchief Stand-in',
            type_line: 'Creature — Goblin Warrior',
            oracle_text: 'Other Goblins you control have haste.',
          },
        },
        {
          id: 'lackey_1',
          controller: p1,
          owner: p1,
          card: { id: 'lackey_card', name: 'Goblin Lackey', type_line: 'Creature — Goblin', oracle_text: '' },
        },
        {
          id: 'bear_1',
          controller: p1,
          owner: p1,
          card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state)).toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[0] as any, state)).not.toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[2] as any, state)).not.toContain('haste');
  });

  it('detects this-or-another typed ETB for Goblin the same way as Dinosaur', () => {
    const triggers = detectETBTriggers({
      name: 'Goblin Recruiter Stand-in',
      type_line: 'Creature — Goblin',
      oracle_text: 'Whenever this creature or another Goblin you control enters, draw a card.',
    }, { id: 'recruiter_1' });
    const watcher = triggers.find((trigger) => trigger.triggerType === 'this_or_another_typed_etb') as any;
    expect(watcher).toBeTruthy();
    expect(String(watcher?.requiredTypePhrase || '')).toMatch(/goblin/i);
  });

  it('queues Swooping Pteranodon for itself and other flying dinosaurs, not grounded dinosaurs', () => {
    const triggers = detectETBTriggers({
      name: 'Swooping Pteranodon',
      type_line: 'Creature — Dinosaur',
      oracle_text: PTERANODON_ORACLE,
    }, { id: 'ptera_1' });
    const watcher = triggers.find((trigger) => trigger.triggerType === 'this_or_another_typed_etb') as any;
    expect(watcher).toBeTruthy();
    expect(String(watcher?.requiredTypePhrase || '')).toMatch(/dinosaur/i);
    expect(String(watcher?.requiredKeyword || '')).toBe('flying');

    const game = createInitialGameState('t_pteranodon_watcher');
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    const pteranodon = dinosaur('ptera_1', p1, { flying: true, name: 'Swooping Pteranodon', oracle: PTERANODON_ORACLE });
    const flyer = dinosaur('flyer_1', p1, {
      flying: true,
      name: 'Winged Dinosaur',
      oracle: 'Flying',
    });
    const grounded = dinosaur('ground_1', p1, { name: 'Earthshaker Dreadmaw', oracle: EARTHSHAKER_ORACLE });
    (game.state as any).battlefield.push(pteranodon, flyer, grounded);

    queueSelfETBTriggersForPermanent(game as any, pteranodon, p1);
    expect(((game.state as any).stack || []).filter((item: any) => (
      item?.sourceName === 'Swooping Pteranodon' && item?.triggerType === 'this_or_another_typed_etb'
    ))).toHaveLength(1);

    (game.state as any).stack = [];
    triggerETBEffectsForPermanent(game as any, flyer, p1);
    expect(((game.state as any).stack || []).filter((item: any) => (
      item?.sourceName === 'Swooping Pteranodon' && item?.triggerType === 'this_or_another_typed_etb'
    ))).toHaveLength(1);

    (game.state as any).stack = [];
    triggerETBEffectsForPermanent(game as any, grounded, p1);
    expect(((game.state as any).stack || []).some((item: any) => (
      item?.sourceName === 'Swooping Pteranodon' && item?.triggerType === 'this_or_another_typed_etb'
    ))).toBe(false);
  });

  it('steals the targeted opponent creature, untaps it, and grants flying and haste until end of turn', () => {
    const stealEffect =
      'gain control of target creature an opponent controls until end of turn. Untap that creature. It gains flying and haste until end of turn.';
    const steps = collectOracleEffectSteps(stealEffect, 'Swooping Pteranodon');
    expect(steps.map((step) => step.kind)).toEqual([
      'gain_control',
      'tap_or_untap',
      'grant_temporary_ability',
    ]);

    const game = createInitialGameState('t_pteranodon_steal');
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    const pteranodon = dinosaur('ptera_1', p1, { flying: true, name: 'Swooping Pteranodon', oracle: PTERANODON_ORACLE });
    const stolen = {
      id: 'opp_bear',
      controller: p2,
      owner: p2,
      tapped: true,
      summoningSickness: false,
      counters: {},
      card: {
        id: 'opp_bear_card',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
      },
    };
    (game.state as any).battlefield.push(pteranodon, stolen);

    executeTriggerEffect(
      game as any,
      p1,
      'Swooping Pteranodon',
      stealEffect,
      {
        id: 'ptera_steal',
        type: 'triggered_ability',
        controller: p1,
        source: 'ptera_1',
        sourceId: 'ptera_1',
        permanentId: 'ptera_1',
        triggerType: 'this_or_another_typed_etb',
        interveningIfSubjectPermanentId: 'ptera_1',
        targets: ['opp_bear'],
        card: pteranodon.card,
      },
    );

    const after = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'opp_bear');
    expect(after?.controller).toBe(p1);
    expect(after?.tapped).toBe(false);
    const granted = [
      ...((after as any)?.grantedAbilities || []),
      ...(((after as any)?.untilEndOfTurn?.grantedAbilitiesToRemove) || []),
      ...(((after as any)?.tempAbilities) || []),
    ].map((entry: unknown) => String(entry || '').toLowerCase());
    expect(granted.some((ability: string) => ability.includes('flying'))).toBe(true);
    expect(granted.some((ability: string) => ability.includes('haste'))).toBe(true);
    expect((game.state as any).controlChangeEffects).toEqual([
      expect.objectContaining({
        permanentId: 'opp_bear',
        originalController: p2,
        newController: p1,
        duration: 'until_end_of_turn',
      }),
    ]);
    const pteranodonAfter = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'ptera_1');
    expect(pteranodonAfter?.controller).toBe(p1);
  });

  it('keeps the delayed next-end-step land damage as part of the flying dinosaur ETB', () => {
    const triggers = detectETBTriggers({
      name: 'Swooping Pteranodon',
      type_line: 'Creature — Dinosaur',
      oracle_text: PTERANODON_ORACLE,
    }, { id: 'ptera_1' });
    const watcher = triggers.find((trigger) => trigger.triggerType === 'this_or_another_typed_etb');
    expect(String(watcher?.effect || '').toLowerCase()).toContain('gain control of target creature');
    expect(String(watcher?.effect || '').toLowerCase()).toContain('at the beginning of the next end step');
    expect(String(watcher?.effect || '').toLowerCase()).toContain('target land deals 3 damage to that creature');

    expect(detectEndStepTriggers(
      { name: 'Swooping Pteranodon', oracle_text: PTERANODON_ORACLE },
      { id: 'ptera_1', controller: p1 },
    )).toEqual([]);

    const stealEffect = String(watcher?.effect || '');
    const steps = collectOracleEffectSteps(stealEffect, 'Swooping Pteranodon');
    expect(steps.map((step) => step.kind)).toEqual([
      'gain_control',
      'tap_or_untap',
      'grant_temporary_ability',
      'schedule_delayed_trigger',
    ]);
    const delayed = steps.find((step) => step.kind === 'schedule_delayed_trigger') as any;
    expect(delayed?.timing).toBe('next_end_step');
    expect(String(delayed?.effect || '').toLowerCase()).toContain('target land deals 3 damage to that creature');
  });

  it('schedules the delayed land-damage trigger against the stolen creature and deals 3 at end step', () => {
    const stealEffect =
      'gain control of target creature an opponent controls until end of turn. Untap that creature. It gains flying and haste until end of turn. At the beginning of the next end step, target land deals 3 damage to that creature.';

    const game = createInitialGameState('t_pteranodon_land_damage');
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    const pteranodon = dinosaur('ptera_1', p1, { flying: true, name: 'Swooping Pteranodon', oracle: PTERANODON_ORACLE });
    const stolen = {
      id: 'opp_bear',
      controller: p2,
      owner: p2,
      tapped: true,
      summoningSickness: false,
      counters: {},
      markedDamage: 0,
      card: {
        id: 'opp_bear_card',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
      },
    };
    const mountain = {
      id: 'p1_mountain',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: {
        id: 'p1_mountain_card',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '{T}: Add {R}.',
      },
    };
    (game.state as any).battlefield.push(pteranodon, stolen, mountain);

    executeTriggerEffect(
      game as any,
      p1,
      'Swooping Pteranodon',
      stealEffect,
      {
        id: 'ptera_steal',
        type: 'triggered_ability',
        controller: p1,
        source: 'ptera_1',
        sourceId: 'ptera_1',
        permanentId: 'ptera_1',
        triggerType: 'this_or_another_typed_etb',
        interveningIfSubjectPermanentId: 'ptera_1',
        targets: ['opp_bear'],
        card: pteranodon.card,
      },
    );

    const delayed = (((game.state as any).delayedTriggerRegistry?.triggers) || []).find((trigger: any) =>
      String(trigger?.effect || '').toLowerCase().includes('target land deals 3 damage'),
    );
    expect(delayed).toBeTruthy();
    expect(delayed.timing).toBe('next_end_step');
    expect(delayed.effectData?.lastAntecedentBattlefieldPermanentIds).toEqual(
      expect.arrayContaining(['opp_bear']),
    );

    const queued = getEndStepTriggers(game as any, p1);
    const landDamage = queued.find((trigger) =>
      String(trigger.effect || '').toLowerCase().includes('target land deals 3 damage'),
    );
    expect(landDamage).toBeTruthy();
    expect((landDamage as any).stackItem?.targetType).toBe('land');
    expect((landDamage as any).stackItem?.requiresTarget).toBe(true);
    expect((landDamage as any).stackItem?.lastAntecedentBattlefieldPermanentIds).toEqual(
      expect.arrayContaining(['opp_bear']),
    );

    executeTriggerEffect(
      game as any,
      p1,
      'Swooping Pteranodon',
      String(landDamage?.effect || ''),
      {
        id: 'ptera_land_damage',
        type: 'triggered_ability',
        controller: p1,
        source: 'ptera_1',
        sourceId: 'ptera_1',
        permanentId: 'ptera_1',
        triggerType: 'end_step',
        targets: ['p1_mountain'],
        lastAntecedentBattlefieldPermanentIds: ['opp_bear'],
        effectData: { lastAntecedentBattlefieldPermanentIds: ['opp_bear'] },
        card: pteranodon.card,
      },
    );

    const after = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'opp_bear');
    expect(Number(after?.markedDamage ?? after?.damageMarked ?? after?.counters?.damage ?? 0)).toBe(3);
    const pteranodonAfter = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'ptera_1');
    expect(Number(pteranodonAfter?.markedDamage ?? pteranodonAfter?.damageMarked ?? 0)).toBe(0);
  });
});

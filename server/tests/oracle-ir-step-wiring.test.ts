import { describe, expect, it } from 'vitest';

import type { OracleEffectStep } from '../../rules-engine/src/oracleIR.js';
import {
  isTriggerEffectOwnedByOracleIrPrimary,
} from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { ORACLE_IR_FALLBACK_STEP_KINDS } from '../src/state/modules/trigger-runtime-wiring.js';
import {
  ORACLE_IR_ACTIVATED_STEP_KINDS,
  areAllOracleEffectStepsRuntimeWired,
  collectActivatedAbilitySteps,
  isActivatedAbilityEffectFullyWired,
  isOracleIrActivatedAbilityHandled,
  isOracleIrMandatoryExecutionComplete,
  tryApplyOracleIRToActivatedAbility,
} from '../src/state/modules/oracleIrAbilityExecution.js';
import { isOracleIrExecutionHandled } from '../src/state/modules/oracleIrSpellExecution.js';
import {
  describeOracleIrExecutionHandledIncomplete,
  describeMissingMandatoryOracleIrSteps,
  describeOracleIrMandatoryExecutionIncomplete,
  formatOracleIrAllOrNothingFailure,
} from '../src/state/modules/oracleIrStepWiring.js';

const WHIP_EFFECT =
  'Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.';

function seedWhipState() {
  return {
    players: [{ id: 'p1', name: 'P1' }],
    life: { p1: 40 },
    turnNumber: 5,
    battlefield: [{
      id: 'whip_1',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'whip_card_1', name: 'Whip of Erebos', oracle_text: '' },
    }],
    pendingExileAtNextEndStep: [],
    zones: {
      p1: {
        graveyard: [{
          id: 'whip_target_1',
          name: 'Grizzly Bears',
          type_line: 'Creature - Bear',
          power: '2',
          toughness: '2',
        }],
        graveyardCount: 1,
      },
    },
  };
}

describe('oracle IR step wiring guardrails', () => {
  it('includes reanimation rider kinds in fallback and activated allowlists', () => {
    for (const kind of [
      'grant_temporary_ability',
      'grant_static_ability',
      'grant_leave_battlefield_replacement',
      'schedule_delayed_battlefield_action',
    ]) {
      expect(ORACLE_IR_FALLBACK_STEP_KINDS.has(kind)).toBe(true);
      expect(ORACLE_IR_ACTIVATED_STEP_KINDS.has(kind)).toBe(true);
    }
  });

  it('wires create_emblem for activated loyalty and trigger/spell fallback', () => {
    expect(ORACLE_IR_FALLBACK_STEP_KINDS.has('create_emblem')).toBe(true);
    expect(ORACLE_IR_ACTIVATED_STEP_KINDS.has('create_emblem')).toBe(true);
    const steps = collectActivatedAbilitySteps(
      'You get an emblem with "Creatures you control get +1/+1."',
      'Generic Planeswalker',
    );
    expect(steps.some((step) => step.kind === 'create_emblem')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });

  it('wires gain_control, grant_exile_permission, and skip_next_untap for loyalty/fallback', () => {
    for (const kind of ['gain_control', 'grant_exile_permission', 'skip_next_untap'] as const) {
      expect(ORACLE_IR_FALLBACK_STEP_KINDS.has(kind)).toBe(true);
      expect(ORACLE_IR_ACTIVATED_STEP_KINDS.has(kind)).toBe(true);
    }

    const gainControl = collectActivatedAbilitySteps(
      'Gain control of target creature until end of turn.',
      'Generic Planeswalker',
    );
    expect(gainControl.some((step) => step.kind === 'gain_control')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(gainControl)).toBe(true);

    const skipUntap = collectActivatedAbilitySteps(
      'Target player skips their next untap step.',
      'Generic Planeswalker',
    );
    expect(skipUntap.some((step) => step.kind === 'skip_next_untap')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(skipUntap)).toBe(true);

    const impulse = collectActivatedAbilitySteps(
      'Exile the top card of your library. You may play it this turn.',
      'Generic Planeswalker',
    );
    expect(impulse.some((step) => step.kind === 'impulse_exile_top' || step.kind === 'exile_top')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(impulse)).toBe(true);

    const exilePermission = collectActivatedAbilitySteps(
      'You may play it this turn.',
      'Generic Planeswalker',
    );
    expect(exilePermission.some((step) => step.kind === 'grant_exile_permission')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(exilePermission)).toBe(true);
  });

  it('wires remaining loyalty executor kinds (flip_coin, phase_out, venture, exchange_control)', () => {
    for (const kind of [
      'flip_coin',
      'phase_out',
      'venture_into_dungeon',
      'exchange_control',
      'add_types',
      'cant_activate_abilities',
      'modify_exile_permissions',
      'choose_card_name',
    ] as const) {
      expect(ORACLE_IR_FALLBACK_STEP_KINDS.has(kind)).toBe(true);
      expect(ORACLE_IR_ACTIVATED_STEP_KINDS.has(kind)).toBe(true);
    }

    const flip = collectActivatedAbilitySteps('Flip a coin.', 'Generic Planeswalker');
    expect(flip.some((step) => step.kind === 'flip_coin')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(flip)).toBe(true);

    const phaseOut = collectActivatedAbilitySteps(
      'Target creature you don\'t control phases out.',
      'Generic Planeswalker',
    );
    expect(phaseOut.some((step) => step.kind === 'phase_out')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(phaseOut)).toBe(true);

    const untilNextTurnPt = collectActivatedAbilitySteps(
      'Until your next turn, up to one target creature gets -3/-0.',
      'Generic Planeswalker',
    );
    expect(untilNextTurnPt).toEqual([
      expect.objectContaining({
        kind: 'modify_pt',
        power: -3,
        toughness: 0,
        duration: 'until_next_turn',
      }),
    ]);
    expect(isActivatedAbilityEffectFullyWired(untilNextTurnPt)).toBe(true);

    const suffixUntilNextTurnPt = collectActivatedAbilitySteps(
      'Up to one target creature gets -2/-1 until your next turn.',
      'Generic Planeswalker',
    );
    expect(suffixUntilNextTurnPt).toEqual([
      expect.objectContaining({
        kind: 'modify_pt',
        power: -2,
        toughness: -1,
        duration: 'until_next_turn',
      }),
    ]);
    expect(isActivatedAbilityEffectFullyWired(suffixUntilNextTurnPt)).toBe(true);

    const compoundUntilNextTurnPt = collectActivatedAbilitySteps(
      'Until your next turn, up to one target creature gets -2/-0 and loses flying.',
      'Generic Planeswalker',
    );
    expect(compoundUntilNextTurnPt.map((step) => step.kind)).toEqual(['modify_pt', 'grant_temporary_ability']);
    expect(compoundUntilNextTurnPt[0]).toEqual(expect.objectContaining({
      kind: 'modify_pt',
      power: -2,
      toughness: 0,
      duration: 'until_next_turn',
    }));
    expect(isActivatedAbilityEffectFullyWired(compoundUntilNextTurnPt)).toBe(true);

    const cantAttackOrBlockUntilNextTurn = collectActivatedAbilitySteps(
      "Target creature without first strike, double strike, or vigilance can't attack or block until your next turn.",
      'Generic Planeswalker',
    );
    expect(cantAttackOrBlockUntilNextTurn).toEqual([
      expect.objectContaining({
        kind: 'grant_temporary_ability',
        duration: 'until_next_turn',
      }),
    ]);
    expect(isActivatedAbilityEffectFullyWired(cantAttackOrBlockUntilNextTurn)).toBe(true);

    const untilNextTurnCostReduction = collectActivatedAbilitySteps(
      'Target player draws two cards. Until your next turn, instant, sorcery, and planeswalker spells that player casts cost {2} less to cast.',
      'Generic Planeswalker',
    );
    expect(untilNextTurnCostReduction.map((step) => step.kind)).toEqual(['draw', 'grant_temporary_ability']);
    expect(isActivatedAbilityEffectFullyWired(untilNextTurnCostReduction)).toBe(true);

    const untilNextTurnWhenever = collectActivatedAbilitySteps(
      'Until your next turn, whenever a creature an opponent controls attacks, it gets -1/-0 until end of turn.',
      'Generic Planeswalker',
    );
    expect(untilNextTurnWhenever).toEqual([
      expect.objectContaining({
        kind: 'grant_temporary_ability',
        duration: 'until_next_turn',
      }),
    ]);
    expect(isActivatedAbilityEffectFullyWired(untilNextTurnWhenever)).toBe(true);

    const perpetualPt = collectActivatedAbilitySteps(
      'Target creature an opponent controls perpetually gets -3/-3.',
      'Generic Planeswalker',
    );
    expect(perpetualPt).toEqual([
      expect.objectContaining({
        kind: 'grant_static_ability',
        power: -3,
        toughness: -3,
        duration: 'static',
      }),
    ]);
    expect(isActivatedAbilityEffectFullyWired(perpetualPt)).toBe(true);

    const modalScaledPt = collectActivatedAbilitySteps(
      'Target creature gets +X/+X or -X/-X until end of turn, where X is the number of Swamps you control.',
      'Generic Planeswalker',
    );
    expect(modalScaledPt).toEqual([
      expect.objectContaining({
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 1,
      }),
    ]);
    expect(isActivatedAbilityEffectFullyWired(modalScaledPt)).toBe(true);

    const untilNextTurnAnimate = collectActivatedAbilitySteps(
      'Until your next turn, target artifact you control becomes a 5/5 creature in addition to its other types.',
      'Generic Planeswalker',
    );
    expect(untilNextTurnAnimate).toEqual([
      expect.objectContaining({
        kind: 'animate_permanent',
        power: 5,
        toughness: 5,
        duration: 'until_next_turn',
      }),
    ]);
    expect(isActivatedAbilityEffectFullyWired(untilNextTurnAnimate)).toBe(true);

    const gyReanimateWard = collectActivatedAbilitySteps(
      'Target opponent puts a creature card of their choice from their graveyard onto the battlefield under your control. That creature gains ward {2}.',
      'Generic Planeswalker',
    );
    expect(gyReanimateWard.map((step) => step.kind)).toEqual(['move_zone', 'grant_static_ability']);
    expect(isActivatedAbilityEffectFullyWired(gyReanimateWard)).toBe(true);
  });

  it('wires Class gain_class_level for activated abilities', () => {
    expect(ORACLE_IR_ACTIVATED_STEP_KINDS.has('gain_class_level')).toBe(true);
    const steps = collectActivatedAbilitySteps('{W}: Level 2', "Caretaker's Talent");
    expect(steps.map((step) => step.kind)).toEqual(['gain_class_level']);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });

  it('parses Whip activated effect into fully wired steps', () => {
    const steps = collectActivatedAbilitySteps(WHIP_EFFECT, 'Whip of Erebos');
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
    expect(areAllOracleEffectStepsRuntimeWired(steps)).toBe(true);
  });

  it('parses Kethis exile-cost grant from full activated ability text', () => {
    const oracleText =
      'Exile two legendary cards from your graveyard: Until end of turn, each legendary card in your graveyard gains "You may play this card from your graveyard."';
    const steps = collectActivatedAbilitySteps(oracleText, 'Kethis, the Hidden Hand');
    expect(steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        permission: 'play',
        what: { kind: 'raw', text: 'legendary card' },
        duration: 'this_turn',
      },
    ]);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });

  it('parses Magus exile-self grant and replacement rider from full activated text', () => {
    const oracleText =
      '{2}{B}, {T}, Exile this creature: Until end of turn, you may play lands and cast spells from your graveyard. If a card would be put into your graveyard from anywhere this turn, exile that card instead.';
    const steps = collectActivatedAbilitySteps(oracleText, 'Magus of the Will');
    expect(steps.some((step) => step.kind === 'grant_graveyard_permission' && (step as any).permission === 'play')).toBe(true);
    expect(steps.some((step) => step.kind === 'grant_graveyard_permission' && (step as any).permission === 'cast')).toBe(true);
    expect(steps.some((step) => step.kind === 'modify_graveyard_permissions')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });

  it('treats Kheru-style reanimation triggers as primary-owned when env is on', () => {
    const previous = process.env.ORACLE_IR_TRIGGER_PRIMARY;
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    try {
      const effect =
        'Return a creature card at random from your graveyard to the battlefield. It gains flying, trample, and haste. Exile that card at the beginning of your next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.';
      expect(isTriggerEffectOwnedByOracleIrPrimary(effect, 'Kheru Lich Lord')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
      else process.env.ORACLE_IR_TRIGGER_PRIMARY = previous;
    }
  });

  it('rejects partial mandatory execution when only the first step applied', () => {
    const parsedSteps: OracleEffectStep[] = [
      { kind: 'move_zone', what: { kind: 'raw', text: 'target creature card' }, to: 'battlefield', raw: 'Return target creature card from your graveyard to the battlefield' },
      { kind: 'grant_temporary_ability', target: { kind: 'raw', text: 'it' }, abilities: ['haste'], duration: 'end_of_turn', raw: 'It gains haste' },
    ];

    const partialResult = {
      state: {},
      log: [],
      appliedSteps: [parsedSteps[0]],
      skippedSteps: [],
      automationGaps: [],
      pendingOptionalSteps: [],
    } as any;

    expect(isOracleIrMandatoryExecutionComplete(parsedSteps, partialResult)).toBe(false);
    expect(isOracleIrActivatedAbilityHandled(parsedSteps, partialResult)).toBe(false);
    expect(isOracleIrExecutionHandled(partialResult, 0, 0, parsedSteps)).toBe(false);

    const reasons = describeOracleIrMandatoryExecutionIncomplete(parsedSteps, partialResult);
    expect(reasons.some((reason) => reason.startsWith('unapplied_mandatory_step:'))).toBe(true);
    expect(reasons.some((reason) => reason.includes('grant_temporary_ability'))).toBe(true);

    const executionReasons = describeOracleIrExecutionHandledIncomplete(partialResult, 0, 0, parsedSteps);
    expect(executionReasons.some((reason) => reason.includes('grant_temporary_ability'))).toBe(true);

    const formatted = formatOracleIrAllOrNothingFailure('spell', 'Test Spell', executionReasons, {
      applied: 1,
      parsed: 2,
    });
    expect(formatted).toContain('All-or-nothing spell failed for Test Spell');
    expect(formatted).toContain('reason:');
    expect(formatted).toContain('grant_temporary_ability');
  });

  it('describes missing mandatory steps for partial fallback wiring', () => {
    const allSteps: OracleEffectStep[] = [
      { kind: 'draw', amount: 1, raw: 'Draw a card.' },
      { kind: 'player_choice', raw: 'Each player may put a land card from their hand onto the battlefield.' } as OracleEffectStep,
    ];
    const fallbackSteps: OracleEffectStep[] = [allSteps[0]];

    const reasons = describeMissingMandatoryOracleIrSteps(allSteps, fallbackSteps);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('player_choice');
  });

  it('reports skipped mandatory steps and unqueued player choice gaps', () => {
    const parsedSteps: OracleEffectStep[] = [
      { kind: 'draw', amount: 1, raw: 'Draw a card.' },
      { kind: 'mill', amount: 3, raw: 'Mill three cards.' },
    ];
    const result = {
      state: {},
      log: [],
      appliedSteps: [parsedSteps[0]],
      skippedSteps: [parsedSteps[1]],
      automationGaps: [{
        reasonCode: 'player_choice_required',
        message: 'Needs land selection',
        stepKind: 'player_choice',
        raw: 'Each player may put a land...',
      }],
      pendingOptionalSteps: [],
      pendingContinuationSteps: [{ kind: 'mill', amount: 3, raw: 'Mill three cards.' }],
    } as any;

    const reasons = describeOracleIrExecutionHandledIncomplete(result, 0, 0, parsedSteps);
    expect(reasons.some((reason) => reason.startsWith('skipped_mandatory_step:'))).toBe(true);
    expect(reasons.some((reason) => reason.startsWith('unqueued_player_choice:'))).toBe(true);
    expect(reasons.some((reason) => reason.startsWith('pending_continuation_without_queue_bridge:'))).toBe(true);
  });

  it('accepts complete mandatory execution when all parsed steps applied', () => {
    const parsedSteps: OracleEffectStep[] = [
      { kind: 'move_zone', what: { kind: 'raw', text: 'target creature card' }, to: 'battlefield', raw: 'Return target creature card from your graveyard to the battlefield' },
      { kind: 'grant_temporary_ability', target: { kind: 'raw', text: 'it' }, abilities: ['haste'], duration: 'end_of_turn', raw: 'It gains haste' },
    ];

    const completeResult = {
      state: {},
      log: [],
      appliedSteps: parsedSteps,
      skippedSteps: [],
      automationGaps: [],
      pendingOptionalSteps: [],
    } as any;

    expect(isOracleIrMandatoryExecutionComplete(parsedSteps, completeResult)).toBe(true);
    expect(isOracleIrActivatedAbilityHandled(parsedSteps, completeResult)).toBe(true);
  });

  it('refuses activated IR when an unwired step kind is present', () => {
    const ctx = {
      state: seedWhipState(),
      gameId: 'test_partial_activated',
      bumpSeq: () => {},
      libraries: new Map(),
    };

    const oracleText =
      'Return target creature card from your graveyard to the battlefield. Target creature can\'t attack this turn.';

    const steps = collectActivatedAbilitySteps(oracleText, 'Test Source');
    expect(steps.some((step) => step.kind === 'cant_attack')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(false);

    const result = tryApplyOracleIRToActivatedAbility(ctx as any, {
      controller: 'p1' as any,
      sourceName: 'Test Source',
      oracleText,
      sourcePermanentId: 'whip_1',
      targets: ['whip_target_1'],
    });

    expect(result.handled).toBe(false);
    expect(result.applied).toBe(0);
    expect((ctx.state as any).battlefield.some((perm: any) => perm?.card?.id === 'whip_target_1')).toBe(false);
  });

  it('treats reanimate plus take_extra_turn as fully wired activated steps', () => {
    const oracleText =
      'Return target creature card from your graveyard to the battlefield. Take an extra turn after this one.';
    const steps = collectActivatedAbilitySteps(oracleText, 'Test Source');
    expect(steps.some((step) => step.kind === 'take_extra_turn')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });

  it('applies fully wired Whip activated effect without partial drop', () => {
    const ctx = {
      state: seedWhipState(),
      gameId: 'test_full_activated',
      bumpSeq: () => {},
      libraries: new Map(),
    };

    const result = tryApplyOracleIRToActivatedAbility(ctx as any, {
      controller: 'p1' as any,
      sourceName: 'Whip of Erebos',
      oracleText: WHIP_EFFECT,
      sourcePermanentId: 'whip_1',
      targets: ['whip_target_1'],
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThanOrEqual(4);

    const perm = (ctx.state as any).battlefield.find((entry: any) => entry?.card?.id === 'whip_target_1');
    expect(perm?.summoningSickness).toBe(false);
    expect((perm?.grantedAbilities || []).map((entry: any) => String(entry).toLowerCase())).toContain('haste');
    expect((ctx.state as any).pendingExileAtNextEndStep?.length).toBeGreaterThan(0);
  });
});

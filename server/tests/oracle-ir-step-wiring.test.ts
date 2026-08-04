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
      'Return target creature card from your graveyard to the battlefield. Venture into the dungeon.';

    const steps = collectActivatedAbilitySteps(oracleText, 'Test Source');
    expect(steps.some((step) => step.kind === 'venture_into_dungeon')).toBe(true);
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

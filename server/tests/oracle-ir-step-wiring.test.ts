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

  it('parses Whip activated effect into fully wired steps', () => {
    const steps = collectActivatedAbilitySteps(WHIP_EFFECT, 'Whip of Erebos');
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
    expect(areAllOracleEffectStepsRuntimeWired(steps)).toBe(true);
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
      'Return target creature card from your graveyard to the battlefield. Take an extra turn after this one.';

    const steps = collectActivatedAbilitySteps(oracleText, 'Test Source');
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

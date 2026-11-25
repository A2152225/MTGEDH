/**
 * Hygiene for oracleIR-telemetry AON lines seen on gate-p2-regate-s33.
 * Generic wiring/parse fixes — no card-name routing.
 */
import { describe, expect, it } from 'vitest';
import { collectActivatedAbilitySteps } from '../src/state/modules/oracleIrAbilityExecution.js';
import {
  ORACLE_IR_FALLBACK_STEP_KINDS,
  normalizeTriggerEffectForIrAudit,
  collectSpellResolutionEffectSteps,
} from '../src/state/modules/trigger-runtime-wiring.js';
import { isActivatedAbilityEffectFullyWired } from '../src/state/modules/oracleIrStepWiring.js';
import { parseTargetRequirements } from '../src/rules-engine/targeting.js';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { isRecognizedActivatedAbilityCostText } from '../../rules-engine/src/stationPermanentUtils.js';

const AETHERGEODE_FULL =
  "Whenever this creature attacks, you get {E}{E} (two energy counters).\n"
  + "Pay {E}{E}: Exile this creature, then return it to the battlefield under its owner's control.";

const THEATER_ABILITY =
  '{3}{R}: This enchantment deals 1 damage to target opponent or planeswalker.';

const TROSTANI_ABILITY =
  "{1}{G}{W}, {T}: Populate. (Create a token that's a copy of a creature token you control.)";

const JOURNEY_EFFECT =
  'exile the top four cards of your library, then roll a d20.\n'
  + '1—9 | You may put a land card from among those cards onto the battlefield.\n'
  + '10—19 | Create a 2/2 green Wolf creature token, then put a +1/+1 counter on it for each creature card among those cards.\n'
  + '20 | Put all permanent cards exiled with this enchantment onto the battlefield, then sacrifice it.';

const VAULT_112_III =
  'Pay any amount of {E}. If you paid one or more {E} this way, shuffle your library, then exile that many cards from the top. You may play one of those cards without paying its mana cost.';

describe('s33 AON hygiene', () => {
  it('wires roll_die, die_roll_results, and pay_energy for fallback', () => {
    expect(ORACLE_IR_FALLBACK_STEP_KINDS.has('roll_die')).toBe(true);
    expect(ORACLE_IR_FALLBACK_STEP_KINDS.has('die_roll_results')).toBe(true);
    expect(ORACLE_IR_FALLBACK_STEP_KINDS.has('pay_energy')).toBe(true);
  });

  it('rejects trigger-prefixed costs and scopes Aethergeode full oracle to Pay {E}{E}', () => {
    expect(isRecognizedActivatedAbilityCostText(
      'Whenever this creature attacks, you get {E}{E} (two energy counters).\nPay {E}{E}',
    )).toBe(false);
    expect(isRecognizedActivatedAbilityCostText('Pay {E}{E}')).toBe(true);

    const steps = collectActivatedAbilitySteps(AETHERGEODE_FULL, 'Aethergeode Miner');
    expect(steps.map((s) => s.kind)).toEqual(['exile', 'move_zone']);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });

  it('applies Aethergeode flicker from full-card oracle text with source binding', () => {
    const state: any = {
      players: [
        { id: 'p1', name: 'P1', life: 40, counters: { energy: 2 } },
        { id: 'p2', name: 'P2', life: 40 },
      ],
      life: { p1: 40, p2: 40 },
      energy: { p1: 2, p2: 0 },
      turnNumber: 5,
      turnPlayer: 'p1',
      priority: 'p1',
      phase: 'precombatMain',
      step: 'MAIN1',
      stack: [],
      battlefield: [{
        id: 'miner',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'miner_c',
          name: 'Aethergeode Miner',
          type_line: 'Creature — Dwarf Scout',
          oracle_text: AETHERGEODE_FULL,
        },
      }],
      zones: {
        p1: { hand: [], library: [], graveyard: [], exile: [], handCount: 0, libraryCount: 0 },
        p2: { hand: [], library: [], graveyard: [], exile: [] },
      },
    };
    const ctx = {
      state,
      gameId: `aethergeode_full_${Date.now()}`,
      bumpSeq: () => {},
      libraries: new Map([['p1', []], ['p2', []]]),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Aethergeode Miner',
      oracleText: AETHERGEODE_FULL,
      sourcePermanentId: 'miner',
      sourceItem: { id: 'stk_energy', source: 'miner' },
      allowOptional: true,
    });
    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
    expect((ctx.state.battlefield || []).some((p: any) => p?.card?.name === 'Aethergeode Miner')).toBe(true);
    expect((ctx.state.battlefield || []).some((p: any) => p?.id === 'miner')).toBe(false);
  });

  it('parses Theater opponent-or-planeswalker as both target types', () => {
    const req = parseTargetRequirements(THEATER_ABILITY);
    expect(req.needsTargets).toBe(true);
    expect(req.targetTypes).toEqual(expect.arrayContaining(['opponent', 'planeswalker']));
    const steps = collectActivatedAbilitySteps(THEATER_ABILITY, 'Theater of Horrors');
    expect(steps.some((s) => s.kind === 'deal_damage')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });

  it('strips Populate reminder so only populate remains (no fake create_token)', () => {
    const steps = collectActivatedAbilitySteps(TROSTANI_ABILITY, "Trostani, Selesnya's Voice");
    expect(steps.some((s) => s.kind === 'populate')).toBe(true);
    expect(steps.some((s) => s.kind === 'create_token')).toBe(false);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });

  it('preserves Journey die-band newlines and wires roll_die + die_roll_results', () => {
    const normalized = normalizeTriggerEffectForIrAudit(JOURNEY_EFFECT);
    expect(normalized).toMatch(/\n/);
    expect(normalized).toMatch(/1\s*[-\u2013\u2014]\s*9\s*\|/);
    const steps = collectSpellResolutionEffectSteps(normalized, 'Journey to the Lost City');
    expect(steps.some((s) => s.kind === 'roll_die')).toBe(true);
    expect(steps.some((s) => s.kind === 'die_roll_results')).toBe(true);
    expect(ORACLE_IR_FALLBACK_STEP_KINDS.has('roll_die')).toBe(true);
  });

  it('wires Vault 112 pay_energy for saga chapter text', () => {
    const steps = collectSpellResolutionEffectSteps(VAULT_112_III, 'Vault 112: Sadistic Simulation');
    expect(steps.some((s) => s.kind === 'pay_energy')).toBe(true);
    expect(ORACLE_IR_FALLBACK_STEP_KINDS.has('pay_energy')).toBe(true);
  });

  it('wires Domineering Will force_block (smoke AON: They block this turn if able)', () => {
    const text =
      'Target player gains control of up to three target nonattacking creatures until end of turn. Untap those creatures. They block this turn if able.';
    const steps = collectSpellResolutionEffectSteps(text, 'Domineering Will');
    expect(steps.map((s) => s.kind)).toEqual(
      expect.arrayContaining(['gain_control', 'tap_or_untap', 'force_block']),
    );
    expect(ORACLE_IR_FALLBACK_STEP_KINDS.has('force_block')).toBe(true);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';

const controllerId = 'p1' as PlayerID;

const baseParams = {
  raw: '',
  controllerId,
  ctx: { controllerId, sourceId: 'bf-source' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 343 — top condition clusters', () => {
  it('evaluates creature-cast-this-way, untapped source, hand lead, and counter riders', () => {
    const state = {
      players: [
        { id: controllerId, hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }] },
        { id: 'p2', hand: [{ id: 'p2-h1' }] },
        { id: 'p3', hand: [{ id: 'p3-h1' }, { id: 'p3-h2' }] },
      ],
      battlefield: [
        { id: 'bf-source', controller: controllerId, type_line: 'Creature — Human', tapped: false },
        {
          id: 'bf-creature-with-counters',
          controller: controllerId,
          type_line: 'Creature — Elf',
          counters: { '+1/+1': 1 },
        },
      ],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you cast a creature spell this way',
        ctx: { ...baseParams.ctx, creatureSpellCastThisWay: true, spellCastThisWay: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'this creature is untapped',
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'you have more cards in hand than each opponent' },
        nextState: state,
        controllerId,
        ctx: baseParams.ctx,
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'it had one or more counters on it' },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, targetPermanentId: 'bf-creature-with-counters' },
        lastActionOutcome: null,
      })
    ).toBe(true);
  });

  it('executes Alaundo creature-cast-this-way rider without condition gap', () => {
    const ir = parseOracleTextToIR(
      '{T}: Draw a card, then exile a card from your hand and put a number of time counters on it equal to its mana value. It gains "When the last time counter is removed from this card, if it\'s exiled, you may cast it without paying its mana cost. If you cast a creature spell this way, it gains haste until end of turn." Then remove a time counter from each other card you own in exile.',
      'Alaundo the Seer'
    );
    const step = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find((entry) => entry.kind === 'conditional' && /creature spell this way/i.test(entry.raw || ''));
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId, hand: [{ id: 'hand-1' }] }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-alaundo', creatureSpellCastThisWay: true, spellCastThisWay: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Reveille Squad untapped branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      '{T}: If this creature is untapped, you may untap all creatures you control.',
      'Reveille Squad'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature', tapped: false }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Death of a Thousand Stings hand-lead branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever you draw a card, if you have more cards in hand than each opponent, you may return this card from your graveyard to your hand.',
      'Death of a Thousand Stings'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [
          { id: controllerId, hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }] },
          { id: 'p2', hand: [{ id: 'p2-h1' }] },
        ],
        battlefield: [],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'gy-death-of-a-thousand-stings' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Nikara counter-dies branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever another creature dies, if it had one or more counters on it, you draw a card and you lose 1 life.',
      'Nikara, Lair Scavenger'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          {
            id: 'bf-creature-with-counters',
            controller: controllerId,
            type_line: 'Creature — Human',
            counters: { '+1/+1': 1 },
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-nikara', targetPermanentId: 'bf-creature-with-counters' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});

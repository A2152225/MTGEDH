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

describe('Oracle IR gap batch 365 — top condition clusters', () => {
  it('evaluates life-paid activate, named workers, and graveyard entry', () => {
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'life was paid to activate it' },
        nextState: {
          players: [{ id: controllerId }],
          stack: [{ id: 'stack-ability-1', description: 'Pay 2 life: Draw a card.' }],
        } as GameState,
        controllerId,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          lifeWasPaidToActivateIt: true,
          targetSpellId: 'stack-ability-1',
          stackItem: { description: 'Pay 2 life: Draw a card.' },
        },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          players: [{ id: controllerId }],
          battlefield: [
            { id: 'bf-mine-worker', controller: controllerId, name: 'Mine Worker', type_line: 'Artifact Creature — Construct' },
            { id: 'bf-tower-worker', controller: controllerId, name: 'Tower Worker', type_line: 'Artifact Creature — Construct' },
          ],
        } as GameState,
        normalizedRaw: 'you control creatures named mine worker and tower worker',
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'they entered or were cast from a graveyard' },
        nextState: {
          players: [{ id: controllerId }],
          battlefield: [
            { id: 'bf-gy-creature-1', controller: controllerId, type_line: 'Creature — Zombie', enteredFromZone: 'graveyard' },
          ],
        } as GameState,
        controllerId,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          thoseCreatureIds: ['bf-gy-creature-1'],
        },
        lastActionOutcome: null,
      })
    ).toBe(true);
  });

  it('executes Verrak life-paid-activate branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever you activate an ability, if life was paid to activate it, you may pay that much life again. If you do, copy that ability. You may choose new targets for the copy.',
      'Verrak, Warped Sengir'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        stack: [{ id: 'stack-ability-1', description: 'Pay 2 life: Draw a card.' }],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        lifeWasPaidToActivateIt: true,
        targetSpellId: 'stack-ability-1',
        stackItem: { description: 'Pay 2 life: Draw a card.' },
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Power Plant Worker named-workers branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      '{T}: This creature gets +2/+2 until end of turn. If you control creatures named Mine Worker and Tower Worker, put two +1/+1 counters on this creature instead.',
      'Power Plant Worker'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, name: 'Power Plant Worker', type_line: 'Artifact Creature — Construct' },
          { id: 'bf-mine-worker', controller: controllerId, name: 'Mine Worker', type_line: 'Artifact Creature — Construct' },
          { id: 'bf-tower-worker', controller: controllerId, name: 'Tower Worker', type_line: 'Artifact Creature — Construct' },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Twilight Diviner graveyard-entry branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Whenever one or more creatures enter the battlefield under your control, if they entered or were cast from a graveyard, create a token that's a copy of one of them. This ability triggers only once each turn.",
      'Twilight Diviner'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-gy-creature-1', controller: controllerId, type_line: 'Creature — Zombie', enteredFromZone: 'graveyard' },
        ],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        thoseCreatureIds: ['bf-gy-creature-1'],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('returns null for ambiguous life-or-mana activate costs', () => {
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'life was paid to activate it' },
        nextState: {
          players: [{ id: controllerId }],
          stack: [{ id: 'stack-ability-1', description: 'Pay 2 life or {B}: Draw a card.' }],
        } as GameState,
        controllerId,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          targetSpellId: 'stack-ability-1',
          stackItem: { description: 'Pay 2 life or {B}: Draw a card.' },
        },
        lastActionOutcome: null,
      })
    ).toBe(null);
  });
});

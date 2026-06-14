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
  ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 360 — top condition clusters', () => {
  it('evaluates exiled-with, single target, sacrificed Human, and nonbasic land', () => {
    const state = {
      players: [
        {
          id: controllerId,
          exile: [
            {
              id: 'ex-exiled-with-source',
              name: 'Counterspell',
              type_line: 'Instant',
              exiledWithSourceId: 'bf-source',
            },
          ],
        },
      ],
      stack: [{ id: 'stack-spell-1', controller: controllerId, type_line: 'Instant', targets: ['bf-target-1'] }],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'a card is exiled with it',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'it has a single target',
        ctx: { ...baseParams.ctx, stackItem: { targets: ['bf-target-1'] } },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'the sacrificed creature was a Human' },
        nextState: state,
        controllerId,
        ctx: {
          ...baseParams.ctx,
          lastSacrificedPermanents: [{ id: 'bf-human', type_line: 'Creature — Human' }],
        },
        lastActionOutcome: { kind: 'applied', stepKind: 'sacrifice' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'that land was nonbasic',
        lastMovedCards: [{ id: 'bf-nonbasic-land', type_line: 'Land', name: "Rogue's Passage" }],
        ctx: {
          ...baseParams.ctx,
          targetPermanentId: 'bf-nonbasic-land',
          lastMovedCards: [{ id: 'bf-nonbasic-land', type_line: 'Land', name: "Rogue's Passage" }],
        },
      })
    ).toBe(true);
  });

  it('executes Smirking Spelljacker exiled-with branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature attacks, if a card is exiled with it, you may cast the exiled card without paying its mana cost.',
      'Smirking Spelljacker'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [
          {
            id: controllerId,
            exile: [
              {
                id: 'ex-exiled-with-source',
                name: 'Counterspell',
                type_line: 'Instant',
                exiledWithSourceId: 'bf-source',
              },
            ],
          },
        ],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Rogue' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Grip of Chaos single-target branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever a spell or ability is put onto the stack, if it has a single target, reselect its target at random.',
      'Grip of Chaos'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        stack: [{ id: 'stack-spell-1', controller: controllerId, type_line: 'Instant', targets: ['bf-target-1'] }],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-chaos',
        targetSpellId: 'stack-spell-1',
        stackItem: { targets: ['bf-target-1'] },
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Falkenrath Aristocrat Human-sacrifice branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Sacrifice a creature: This creature gains indestructible until end of turn. If the sacrificed creature was a Human, put a +1/+1 counter on this creature.',
      'Falkenrath Aristocrat'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Vampire' }],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        lastSacrificedPermanents: [{ id: 'bf-human', type_line: 'Creature — Human' }],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Helldozer nonbasic-land branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      '{B}{B}{B}, {T}: Destroy target land. If that land was nonbasic, untap this creature.',
      'Helldozer'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Zombie Giant', tapped: true }],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        targetPermanentId: 'bf-nonbasic-land',
        lastMovedCards: [{ id: 'bf-nonbasic-land', type_line: 'Land', name: "Rogue's Passage" }],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});

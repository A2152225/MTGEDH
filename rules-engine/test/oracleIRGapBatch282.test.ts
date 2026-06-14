import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';

const controllerId = 'p1' as PlayerID;

function auditState(): GameState {
  return {
    players: [
      { id: 'p1', life: 40 },
      { id: 'p2', life: 40 },
    ],
    battlefield: [
      {
        id: 'bf-source',
        controller: 'p1',
        type_line: 'Creature — Human',
        counters: { ki: 2, depletion: 0 },
      },
      {
        id: 'bf-legendary-creature',
        controller: 'p1',
        type_line: 'Legendary Creature — Human Knight',
        power: 3,
        toughness: 3,
      },
      {
        id: 'bf-legendary-creature-2',
        controller: 'p1',
        type_line: 'Legendary Creature — Human Cleric',
        power: 2,
        toughness: 2,
      },
    ],
    lastVoteResults: { planeswalk: 3, chaos: 1 },
    lifePaidThisWay: { p1: true },
  } as GameState;
}

const baseParams = {
  raw: '',
  controllerId,
  ctx: {
    controllerId,
    sourceId: 'bf-source',
    lifePaidThisWay: true,
    lastVoteResults: { planeswalk: 3, chaos: 1 },
  } as any,
  lastActionOutcome: null,
};

describe('Oracle IR gap batch 282 — full-card conditional riders', () => {
  it('evaluates depletion, ki, legendary, and vote riders', () => {
    const state = auditState();
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'there are no depletion counters on this land',
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'there are two or more ki counters on this creature',
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'at least two legendary creatures you control',
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'planeswalk gets more votes',
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you paid life this way',
      })
    ).toBe(true);
  });

  it('evaluates isolated it-was-a-creature without antecedent', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: auditState(),
        normalizedRaw: 'it was a creature',
      })
    ).toBe(true);
  });
});

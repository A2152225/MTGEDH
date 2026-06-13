import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { snapshotCardsFromZone } from '../src/oracleIRSnapshotFactory';
import {
  flushStepLedgerFromAppliedResult,
  omitBridgedStepCarryOver,
  sanitizeBridgedStepCarryOver,
} from '../src/oracleIRStepLedgerRuntime';
import { evaluateModifyPtWhereX } from '../src/oracleIRExecutorModifyPtWhereEvaluator';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
import { buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { resolveNonlandLedgerCountAtAntecedent } from '../src/oracleIRLedgerCardAccess';

describe('oracleIR ledger shim retirement', () => {
  it('skips flush when pre-commit bridge already recorded step ledger snapshots', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [{ id: 'c1', name: 'Bolt', type_line: 'Instant' }],
      zone: 'exile',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-bridge-0',
      transitionKind: 'zone-change',
    }));

    const appliedStepKinds = new Map<number, string>();
    flushStepLedgerFromAppliedResult({
      ledger,
      appliedStepKinds,
      stepIndex: 0,
      step: { kind: 'exile', raw: 'exile target creature', target: { kind: 'raw', text: 'target creature' } },
      controllerId: 'p1',
      appliedResult: {
        lastExiledCards: [{ id: 'c1', name: 'Bolt', type_line: 'Instant' }],
      },
    });

    expect(ledger.get(0)).toHaveLength(1);
    expect(appliedStepKinds.get(0)).toBe('exile');
  });

  it('evaluateModifyPtWhereX reads total power exiled from ledger without lastExiledCards runtime', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [
        { id: 'c1', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
        { id: 'c2', name: 'Giant', type_line: 'Creature — Giant', power: 5, toughness: 5 },
      ],
      zone: 'exile',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-exile-0',
      transitionKind: 'zone-change',
    }));

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      stepLedger: ledger,
      appliedStepKinds: new Map([[0, 'exile']]),
      currentStepIndex: 1,
    });

    const step: OracleEffectStep = {
      kind: 'modify_pt',
      raw: 'creatures get +X/+X, where X is the total power of cards exiled this way',
      target: { kind: 'raw', text: 'each creature' },
      power: 1,
      toughness: 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: 'X is the total power of cards exiled this way' },
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'exile',
    } as OracleEffectStep;

    const value = evaluateModifyPtWhereX(
      { players: [], battlefield: [] } as any,
      'p1' as PlayerID,
      'X is the total power of cards exiled this way',
      undefined,
      ctx,
      {},
      0,
      step,
    );

    expect(value).toBe(7);
  });

  it('omitBridgedStepCarryOver strips runtime zone arrays when skipLedgerFlush is set', () => {
    const sanitized = omitBridgedStepCarryOver({
      applied: true,
      skipLedgerFlush: true,
      lastMovedCards: [{ id: 'stale' }],
      lastExiledCards: [{ id: 'stale-exile' }],
      lastDiscardedCards: [{ id: 'stale-discard' }],
      lastMilledCards: [{ id: 'stale-mill' }],
      lastExiledCardCount: 1,
      state: {},
      log: [],
    });

    expect(sanitized.skipLedgerFlush).toBe(true);
    expect(sanitized.lastMovedCards).toBeUndefined();
    expect(sanitized.lastExiledCards).toBeUndefined();
    expect(sanitized.lastDiscardedCards).toBeUndefined();
    expect(sanitized.lastMilledCards).toBeUndefined();
    expect((sanitized as any).lastSacrificedPermanents).toBeUndefined();
    expect((sanitized as any).lastExiledCardCount).toBeUndefined();
  });

  it('sanitizeBridgedStepCarryOver is a no-op without skipLedgerFlush', () => {
    const raw = {
      applied: true,
      lastMovedCards: [{ id: 'keep' }],
      state: {},
      log: [],
    };
    expect(sanitizeBridgedStepCarryOver(raw).lastMovedCards).toHaveLength(1);
  });

  it('resolveNonlandLedgerCountAtAntecedent ignores stale lastMovedCards runtime', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [
        { id: 'c1', name: 'Island', type_line: 'Land' },
        { id: 'c2', name: 'Bolt', type_line: 'Instant' },
        { id: 'c3', name: 'Bear', type_line: 'Creature — Bear' },
      ],
      zone: 'library',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-look-0',
      transitionKind: 'zone-change',
    }));

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      stepLedger: ledger,
    });

    expect(resolveNonlandLedgerCountAtAntecedent(ctx, 0)).toBe(2);
  });

  it('evaluateConditionalWrapperCondition reads card type from ledger not stale runtime', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [{ id: 'c1', name: 'Shock', type_line: 'Instant' }],
      zone: 'hand',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-discard-0',
      transitionKind: 'zone-change',
    }));

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      stepLedger: ledger,
      appliedStepKinds: new Map([[0, 'discard']]),
      currentStepIndex: 1,
    });

    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'it was an instant card' },
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as PlayerID,
      ctx,
      lastActionOutcome: { kind: 'applied', stepKind: 'discard' },
      lastMovedCards: [{ id: 'stale', type_line: 'Creature — Bear' }],
    });

    expect(result).toBe(true);
  });

  it('evaluateExtendedConditionalClause reads this-way exile from ledger', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [{ id: 'c1', name: 'Bolt', type_line: 'Instant' }],
      zone: 'exile',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-exile-top-0',
      transitionKind: 'zone-change',
    }));

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      stepLedger: ledger,
      appliedStepKinds: new Map([[0, 'exile_top']]),
      currentStepIndex: 1,
    });

    const result = evaluateExtendedConditionalClause({
      normalizedRaw: 'you exiled an instant card this way',
      raw: 'If you exiled an instant card this way',
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as PlayerID,
      ctx,
      lastActionOutcome: { kind: 'applied', stepKind: 'exile_top' },
      lastMovedCards: [{ id: 'stale', type_line: 'Creature — Bear' }],
    });

    expect(result).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import {
  deserializeAppliedStepKindsFromEvent,
  deserializeStepLedgerFromEvent,
  serializeAppliedStepKindsForEvent,
  serializeStepLedgerForEvent,
} from '../src/oracleIRStepLedgerRuntime';
import {
  resolveGreatestPowerExiledThisWay,
  resolveThisWayTrait,
} from '../src/oracleIRThisWayResolver';
import { snapshotCardsFromZone } from '../src/oracleIRSnapshotFactory';

describe('oracleIRStepLedger', () => {
  it('resolveGreatestPowerExiledThisWay reads creature power from step ledger', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [{
        name: 'Exiled Beast',
        type_line: 'Creature — Beast',
        power: 7,
        toughness: 5,
        colors: ['G'],
      }],
      zone: 'exile',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-test-0',
      transitionKind: 'zone-change',
    }));

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'exile']]),
    });

    expect(resolveGreatestPowerExiledThisWay(ctx, 0)).toBe(7);
  });

  it('resolveThisWayTrait aggregates total power for creatures exiled this way', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [
        { name: 'A', type_line: 'Creature — Elf', power: 2, toughness: 2 },
        { name: 'B', type_line: 'Creature — Elf', power: 3, toughness: 3 },
        { name: 'C', type_line: 'Instant', power: undefined, toughness: undefined },
      ],
      zone: 'exile',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-test-1',
      transitionKind: 'zone-change',
    }));

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      stepLedger: ledger,
    });

    expect(resolveThisWayTrait({
      binding: 'this_way',
      antecedentStepIndex: 0,
      trait: 'power',
      aggregation: 'total',
      subjectFilter: { typeLineMatch: { includes: ['creature'] } },
    }, ctx)).toBe(5);
  });

  it('applyOracleIRStepsToGameState persists step ledger on state after exile step', () => {
    const state: any = {
      players: [{ id: 'p1', hand: [], graveyard: [], exile: [], library: [] }],
      battlefield: [{
        id: 'perm-1',
        controller: 'p1',
        owner: 'p1',
        card: {
          name: 'Test Creature',
          type_line: 'Creature — Human',
          power: 4,
          toughness: 4,
        },
        power: 4,
        toughness: 4,
      }],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'exile',
      raw: 'exile target creature',
      target: { kind: 'target_creature', text: 'target creature' },
    }];

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      targetPermanentId: 'perm-1',
      selectorContext: { targetPermanentId: 'perm-1' },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const ledger = (result.state as any).oracleIrStepLedger;
    expect(ledger).toBeInstanceOf(Map);
    expect(ledger?.get(0)?.length).toBeGreaterThan(0);
    expect(ledger?.get(0)?.[0]?.power).toBe(4);
  });

  it('serializes and deserializes step ledger and applied step kinds for event replay', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [{ name: 'Forest', type_line: 'Basic Land — Forest' }],
      zone: 'library',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-serialize-0',
      transitionKind: 'zone-change',
    }));
    const applied = new Map([[0, 'search_library']]);

    const serializedLedger = serializeStepLedgerForEvent(ledger);
    const serializedApplied = serializeAppliedStepKindsForEvent(applied);
    expect(serializedLedger).toHaveLength(1);
    expect(serializedApplied).toEqual([[0, 'search_library']]);

    const restoredLedger = deserializeStepLedgerFromEvent(serializedLedger);
    const restoredApplied = deserializeAppliedStepKindsFromEvent(serializedApplied);
    expect(restoredLedger.get(0)?.[0]?.name).toBe('Forest');
    expect(restoredApplied.get(0)).toBe('search_library');
  });
});

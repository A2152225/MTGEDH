import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { resolveAntecedentMovedCards } from '../src/oracleIRLedgerCardAccess';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { resolveSnapshotCountAtAntecedent } from '../src/oracleIRThisWayResolver';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR search library transition bridge', () => {
  it('puts searched card into hand via pre-commit bridge and records step ledger', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bolt', type_line: 'Instant' },
          { id: 'lib-2', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'search_library',
      raw: 'search your library for an instant card, put it into your hand',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: 'instant' },
      destination: 'hand',
      shuffle: false,
    }];

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: true,
      haltState,
    });

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      serverBridge,
      transitionHaltState: haltState,
      stepLedger: ledger,
      appliedStepKinds: new Map(),
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].hand).toHaveLength(1);
    expect((result.state as any).players[0].hand[0].id).toBe('lib-1');
    expect((result.state as any).players[0].library).toHaveLength(1);
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'search_library']]) },
      0,
    )).toBe(1);
    expect(resolveAntecedentMovedCards(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'search_library']]) },
    )).toHaveLength(1);
  });

  it('puts searched card onto library top via pre-commit bridge', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bolt', type_line: 'Instant' },
          { id: 'lib-2', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'search_library',
      raw: 'search your library for an instant card, put it on top of your library',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: 'instant' },
      destination: 'top',
      shuffle: false,
    }];

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: false,
      haltState,
    });

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      serverBridge,
      transitionHaltState: haltState,
      stepLedger: ledger,
      appliedStepKinds: new Map(),
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].library.map((card: any) => card.id)).toEqual(['lib-1', 'lib-2']);
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'search_library']]) },
      0,
    )).toBe(1);
  });

  it('keeps the selected card on top after shuffling the library remainder', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bear', type_line: 'Creature — Bear' },
          { id: 'lib-2', name: 'Sol Ring', type_line: 'Artifact' },
          { id: 'lib-3', name: 'Forest', type_line: 'Basic Land — Forest' },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'search_library',
      raw: 'search your library for an artifact card, reveal it, then shuffle and put that card on top',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: 'artifact' },
      destination: 'top',
      shuffle: true,
      revealFound: true,
      maxResults: 1,
    }];

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: true,
      haltState,
    });
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'enlightened-tutor',
      serverBridge,
      transitionHaltState: haltState,
      stepLedger: ledger,
      appliedStepKinds: new Map(),
      selectorContext: { chosenObjectIds: ['lib-2'] },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });

    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].library).toHaveLength(3);
    expect((result.state as any).players[0].library[0].id).toBe('lib-2');
  });

  it('puts player-selected search match into hand via pre-commit bridge', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
          { id: 'lib-2', name: 'Giant', type_line: 'Creature — Giant', power: 5, toughness: 5 },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'search_library',
      raw: 'search your library for a creature card, put it into your hand',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: 'creature' },
      destination: 'hand',
      shuffle: false,
      maxResults: 1,
    }];

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: true,
      haltState,
    });

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      serverBridge,
      transitionHaltState: haltState,
      stepLedger: ledger,
      appliedStepKinds: new Map(),
      selectorContext: { chosenObjectIds: ['lib-2'] },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].hand).toHaveLength(1);
    expect((result.state as any).players[0].hand[0].id).toBe('lib-2');
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'search_library']]) },
      0,
    )).toBe(1);
  });

  it('puts searched creature onto battlefield via ETB pre-commit bridge', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
          { id: 'lib-2', name: 'Bolt', type_line: 'Instant' },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'search_library',
      raw: 'search your library for a creature card, put it onto the battlefield',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: 'creature' },
      destination: 'battlefield',
      shuffle: false,
    }];

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: false,
      haltState,
    });

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      serverBridge,
      transitionHaltState: haltState,
      stepLedger: ledger,
      appliedStepKinds: new Map(),
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].library).toHaveLength(1);
    expect((result.state as any).battlefield).toHaveLength(1);
    expect((result.state as any).battlefield[0].card.name).toBe('Bear');
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'search_library']]) },
      0,
    )).toBe(1);
  });
});

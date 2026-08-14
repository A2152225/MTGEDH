import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  bindThisWayAntecedentOnSteps,
  findAntecedentStepIndexInProgram,
} from '../src/oracleIRThisWayBinding';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { snapshotCardsFromZone } from '../src/oracleIRSnapshotFactory';
import { evaluateModifyPtWhereX } from '../src/oracleIRExecutorModifyPtWhereEvaluator';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
import { isRevealedThisWayLedgerFirst, isSearchedLibraryThisWayLedgerFirst } from '../src/oracleIRLedgerCardAccess';
import { resolveOracleQuantity } from '../src/oracleIRExecutorResolveQuantity';
import { resolveGreatestPerPlayerDiscardCountThisWay } from '../src/oracleIRThisWayResolver';

describe('oracleIRThisWayBinding', () => {
  it('binds modify_pt where-clause to prior exile step', () => {
    const steps: OracleEffectStep[] = [
      { kind: 'exile', raw: 'exile all creatures', target: { kind: 'raw', text: 'all creatures' } },
      {
        kind: 'modify_pt',
        raw: 'each creature gets +X/+X until end of turn, where X is the greatest power among creature cards exiled this way',
        target: { kind: 'raw', text: 'each creature' },
        power: 1,
        toughness: 1,
        powerUsesX: true,
        toughnessUsesX: true,
        duration: 'end_of_turn',
        condition: { kind: 'where', raw: 'X is the greatest power among creature cards exiled this way' },
      },
    ];

    const bound = bindThisWayAntecedentOnSteps(steps);
    expect((bound[1] as any).thisWayAntecedentStepIndex).toBe(0);
    expect((bound[1] as any).thisWayAntecedentStepKind).toBe('exile');
  });

  it('parseOracleTextToIR binds this-way antecedent on multi-clause abilities', () => {
    const text =
      'Exile all creatures. Each creature gets +X/+X until end of turn, where X is the greatest power among creature cards exiled this way.';
    const ir = parseOracleTextToIR(text, 'Test Spell');
    const steps = ir.abilities.flatMap((ability) => ability.steps);
    const modifyStep = steps.find((step) => step.kind === 'modify_pt');
    expect(modifyStep).toBeTruthy();
    expect((modifyStep as any).thisWayAntecedentStepIndex).toBeGreaterThanOrEqual(0);
    expect(steps[(modifyStep as any).thisWayAntecedentStepIndex]?.kind).toBe('exile');
  });

  it('findAntecedentStepIndexInProgram scans backward for exile variants', () => {
    const steps: OracleEffectStep[] = [
      { kind: 'draw', raw: 'draw a card', amount: { kind: 'number', value: 1 }, who: { kind: 'you' } },
      { kind: 'exile_top', raw: 'exile the top card of your library', amount: { kind: 'number', value: 1 }, who: { kind: 'you' } },
      {
        kind: 'modify_pt',
        raw: 'it gets +X/+X until end of turn, where X is the greatest mana value among cards exiled this way',
        target: { kind: 'raw', text: 'it' },
        power: 1,
        toughness: 1,
        powerUsesX: true,
        toughnessUsesX: true,
        duration: 'end_of_turn',
        condition: { kind: 'where', raw: 'X is the greatest mana value among cards exiled this way' },
      },
    ];

    expect(findAntecedentStepIndexInProgram(steps, ['exile', 'exile_top'], 2)).toBe(1);
  });

  it('binds revealed-this-way antecedent to look_choose_from_top via look alias', () => {
    const steps: OracleEffectStep[] = [
      {
        kind: 'look_choose_from_top',
        raw: 'look at the top three cards of your library, put a creature card from among them into your hand',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 3 },
        selectorText: 'creature',
        destination: 'hand',
        restOrder: 'any',
      },
      {
        kind: 'modify_pt',
        raw: 'each creature gets +X/+X until end of turn, where X is the number of cards revealed this way',
        target: { kind: 'raw', text: 'each creature' },
        power: 1,
        toughness: 1,
        powerUsesX: true,
        toughnessUsesX: true,
        duration: 'end_of_turn',
        condition: { kind: 'where', raw: 'X is the number of cards revealed this way' },
      },
    ];

    const bound = bindThisWayAntecedentOnSteps(steps);
    expect((bound[1] as any).thisWayAntecedentStepIndex).toBe(0);
    expect((bound[1] as any).thisWayAntecedentStepKind).toBe('look_choose_from_top');
    expect(findAntecedentStepIndexInProgram(steps, ['look', 'scry', 'surveil', 'search_library'], 2)).toBe(0);
  });

  it('binds revealed-this-way antecedent to search_library with revealFound', () => {
    const steps: OracleEffectStep[] = [
      {
        kind: 'search_library',
        raw: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: 'basic land' },
        destination: 'battlefield',
        revealFound: true,
        entersTapped: true,
        shuffle: true,
        maxResults: 2,
      },
      {
        kind: 'modify_pt',
        raw: 'each creature gets +X/+X until end of turn, where X is the number of cards revealed this way',
        target: { kind: 'raw', text: 'each creature' },
        power: 1,
        toughness: 1,
        powerUsesX: true,
        toughnessUsesX: true,
        duration: 'end_of_turn',
        condition: { kind: 'where', raw: 'X is the number of cards revealed this way' },
      },
    ];

    const bound = bindThisWayAntecedentOnSteps(steps);
    expect((bound[1] as any).thisWayAntecedentStepIndex).toBe(0);
    expect((bound[1] as any).thisWayAntecedentStepKind).toBe('search_library');
    expect(findAntecedentStepIndexInProgram(steps, ['search_library'], 2)).toBe(0);
  });

  it('binds searched-library-this-way antecedent to search_library', () => {
    const steps: OracleEffectStep[] = [
      {
        kind: 'search_library',
        raw: 'Search your library for a creature card, reveal it, put it into your hand, then shuffle.',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: 'creature' },
        destination: 'hand',
        revealFound: true,
        shuffle: true,
        maxResults: 1,
      },
      {
        kind: 'conditional',
        raw: 'If you searched your library this way, draw a card.',
        condition: { kind: 'raw', raw: 'you searched your library this way' },
        thenSteps: [{ kind: 'draw', raw: 'draw a card', amount: { kind: 'number', value: 1 }, who: { kind: 'you' } }],
      },
    ];

    const bound = bindThisWayAntecedentOnSteps(steps);
    expect((bound[1] as any).thisWayAntecedentStepIndex).toBe(0);
    expect((bound[1] as any).thisWayAntecedentStepKind).toBe('search_library');
    expect(findAntecedentStepIndexInProgram(steps, ['search_library'], 2)).toBe(0);
  });

  it('evaluateModifyPtWhereX resolves revealed-this-way count from look_choose ledger via look alias', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [
        { name: 'Bolt', type_line: 'Instant' },
        { name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
        { name: 'Island', type_line: 'Land' },
      ],
      zone: 'library',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-look-0',
      transitionKind: 'zone-change',
    }));

    const state: any = {
      players: [{ id: 'p1', hand: [], graveyard: [], exile: [], library: [] }],
      battlefield: [],
    };

    const step = {
      kind: 'modify_pt',
      raw: 'where X is the number of cards revealed this way',
      target: { kind: 'raw', text: 'each creature' },
      power: 1,
      toughness: 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'look',
    } as OracleEffectStep;

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'look_choose_from_top']]),
    });

    const value = evaluateModifyPtWhereX(
      state,
      'p1',
      'X is the number of cards revealed this way',
      undefined,
      ctx,
      undefined,
      0,
      step,
    );

    expect(value).toBe(3);
  });

  it('evaluateModifyPtWhereX resolves revealed-this-way count from search_library ledger', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [
        { name: 'Forest', type_line: 'Basic Land — Forest' },
        { name: 'Plains', type_line: 'Basic Land — Plains' },
      ],
      zone: 'library',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-search-0',
      transitionKind: 'zone-change',
    }));

    const state: any = {
      players: [{ id: 'p1', hand: [], graveyard: [], exile: [], library: [] }],
      battlefield: [],
    };

    const step = {
      kind: 'modify_pt',
      raw: 'where X is the number of cards revealed this way',
      target: { kind: 'raw', text: 'each creature' },
      power: 1,
      toughness: 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'search_library',
    } as OracleEffectStep;

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'search_library']]),
    });

    const value = evaluateModifyPtWhereX(
      state,
      'p1',
      'X is the number of cards revealed this way',
      undefined,
      ctx,
      undefined,
      0,
      step,
    );

    expect(value).toBe(2);
  });

  it('evaluateConditionalWrapperCondition resolves searched-library-this-way from ledger', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [{ name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 }],
      zone: 'library',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-search-cond-0',
      transitionKind: 'zone-change',
    }));

    const conditionalStep = {
      kind: 'conditional',
      raw: 'If you searched your library this way, draw a card.',
      condition: { kind: 'if', raw: 'you searched your library this way' },
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'search_library',
    } as OracleEffectStep;

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'search_library']]),
    });

    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'you searched your library this way' },
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as PlayerID,
      ctx,
      lastActionOutcome: null,
      step: conditionalStep,
    });

    expect(result).toBe(true);
  });

  it('isSearchedLibraryThisWayLedgerFirst accepts ledger snapshots when shuffle overwrote appliedStepKinds', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [
        { name: 'Forest', type_line: 'Basic Land — Forest' },
        { name: 'Plains', type_line: 'Basic Land — Plains' },
      ],
      zone: 'library',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-search-shuffle-0',
      transitionKind: 'zone-change',
    }));

    const conditionalStep = {
      kind: 'conditional',
      raw: 'If you searched your library this way, draw a card.',
      condition: { kind: 'if', raw: 'you searched your library this way' },
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'search_library',
    } as OracleEffectStep;

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'shuffle_library']]),
    });

    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'you searched your library this way' },
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as PlayerID,
      ctx,
      lastActionOutcome: { kind: 'applied', stepKind: 'shuffle_library' },
      step: conditionalStep,
    });

    expect(result).toBe(true);
  });

  it('isRevealedThisWayLedgerFirst accepts ledger snapshots when shuffle overwrote appliedStepKinds', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [
        { name: 'Forest', type_line: 'Basic Land — Forest' },
        { name: 'Plains', type_line: 'Basic Land — Plains' },
      ],
      zone: 'library',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-reveal-shuffle-0',
      transitionKind: 'zone-change',
    }));

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'shuffle_library']]),
    });

    const modifyStep = {
      kind: 'modify_pt',
      raw: 'where X is the number of cards revealed this way',
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'search_library',
    } as OracleEffectStep;

    expect(isRevealedThisWayLedgerFirst(ctx, modifyStep)).toBe(true);
    expect(evaluateModifyPtWhereX(
      { players: [], battlefield: [] } as any,
      'p1',
      'X is the number of cards revealed this way',
      undefined,
      ctx,
      undefined,
      0,
      modifyStep,
    )).toBe(2);
  });

  it('evaluateModifyPtWhereX uses parser-bound antecedent via step ledger', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [
        { name: 'Big Beast', type_line: 'Creature — Beast', power: 9, toughness: 9 },
        { name: 'Bolt', type_line: 'Instant' },
      ],
      zone: 'exile',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-bind-0',
      transitionKind: 'zone-change',
    }));

    const state: any = {
      players: [{ id: 'p1', hand: [], graveyard: [], exile: [], library: [] }],
      battlefield: [],
    };

    const step = {
      kind: 'modify_pt',
      raw: 'where X is the greatest power among creature cards exiled this way',
      target: { kind: 'raw', text: 'target creature' },
      power: 1,
      toughness: 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'exile',
    } as OracleEffectStep;

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'exile']]),
    });

    const value = evaluateModifyPtWhereX(
      state,
      'p1',
      'X is the greatest power among creature cards exiled this way',
      undefined,
      ctx,
      undefined,
      0,
      step,
    );

    expect(value).toBe(9);
  });

  it('resolveOracleQuantity uses ledger for greatest_number_discarded_this_way (Windfall)', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [
        { name: 'Island', type_line: 'Land', ownerId: 'p1' },
        { name: 'Bolt', type_line: 'Instant', ownerId: 'p1' },
        { name: 'Bear', type_line: 'Creature — Bear', ownerId: 'p2' },
        { name: 'Elf', type_line: 'Creature — Elf', ownerId: 'p2' },
        { name: 'Elf2', type_line: 'Creature — Elf', ownerId: 'p2' },
      ],
      zone: 'graveyard',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-windfall-0',
      transitionKind: 'zone-change',
    }));

    const state: any = {
      players: [
        { id: 'p1', hand: [], graveyard: [], exile: [], library: [] },
        { id: 'p2', hand: [], graveyard: [], exile: [], library: [] },
      ],
      battlefield: [],
    };

    const drawStep = {
      kind: 'draw',
      raw: 'each player draws cards equal to the greatest number of cards a player discarded this way',
      who: { kind: 'each_player' },
      amount: { kind: 'reference_amount', raw: 'greatest_number_discarded_this_way' },
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'discard',
    } as OracleEffectStep;

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'discard']]),
    });

    expect(resolveGreatestPerPlayerDiscardCountThisWay(ctx, 0)).toBe(3);
    expect(resolveOracleQuantity(state, 'p1', drawStep.amount as any, ctx, { step: drawStep })).toBe(3);
  });

  it('evaluateModifyPtWhereX resolves nonland discarded this way from ledger', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, snapshotCardsFromZone({
      cards: [
        { name: 'Island', type_line: 'Land', ownerId: 'p1' },
        { name: 'Bolt', type_line: 'Instant', ownerId: 'p1' },
        { name: 'Shock', type_line: 'Instant', ownerId: 'p1' },
      ],
      zone: 'graveyard',
      ownerId: 'p1',
      affectedByStepIndex: 0,
      transitionId: 'ir-discard-0',
      transitionKind: 'zone-change',
    }));

    const state: any = {
      players: [{ id: 'p1', hand: [], graveyard: [], exile: [], library: [] }],
      battlefield: [],
    };

    const step = {
      kind: 'add_counter',
      raw: 'where X is the number of nonland cards discarded this way',
      target: { kind: 'raw', text: 'target creature' },
      counterType: '+1/+1',
      amount: { kind: 'x' },
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'discard',
    } as OracleEffectStep;

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'discard']]),
    });

    const value = evaluateModifyPtWhereX(
      state,
      'p1',
      'X is the number of nonland cards discarded this way',
      undefined,
      ctx,
      undefined,
      0,
      step,
    );

    expect(value).toBe(2);
  });

  it('binds put-into-a-graveyard-this-way token rider to prior mill', () => {
    const steps: OracleEffectStep[] = [
      { kind: 'mill', raw: 'Each player mills X cards', who: { kind: 'each_player' }, amount: { kind: 'x' } },
      {
        kind: 'create_token',
        raw: 'For each creature card put into a graveyard this way, you create a tapped 2/2 black Zombie creature token.',
        who: { kind: 'you' },
        amount: { kind: 'x' },
        token: '2/2 black Zombie',
        entersTapped: true,
      },
    ];

    const bound = bindThisWayAntecedentOnSteps(steps);
    expect((bound[1] as any).thisWayAntecedentStepIndex).toBe(0);
    expect((bound[1] as any).thisWayAntecedentStepKind).toBe('mill');
  });
});

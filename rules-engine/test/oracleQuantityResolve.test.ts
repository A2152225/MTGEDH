import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { resolveOracleQuantity, resolveOracleQuantityForPlayer } from '../src/oracleIRExecutorResolveQuantity';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseQuantityWithOptionalWhereX,
  splitQuantityTailAndWhereX,
  tryParseExileTopClause,
} from '../src/oracleIRParserQuantityHelpers';
import { applyLoseLifeStep, applyMillStep } from '../src/oracleIRExecutorPlayerStepHandlers';
import { tryParseLifeAndCombatClause } from '../src/oracleIRParserLifeAndCombatClauses';
import { parseQuantity } from '../src/oracleIRParserUtils';

function makeState(overrides?: Partial<Record<string, unknown>>): GameState {
  return {
    players: [
      { id: 'p1' as PlayerID, name: 'P1', library: ['a', 'b', 'c', 'd'], graveyard: [], life: 40 },
      { id: 'p2' as PlayerID, name: 'P2', library: ['e', 'f', 'g', 'h', 'i'], graveyard: [], life: 40 },
      { id: 'p3' as PlayerID, name: 'P3', library: ['g', 'h'], graveyard: [], life: 40 },
    ],
    battlefield: [],
    stack: [],
    ...overrides,
  } as GameState;
}

describe('oracle quantity helpers', () => {
  it('parses "a card" draw quantity', () => {
    expect(parseQuantity('a card')).toEqual({ kind: 'number', value: 1 });
    const ir = parseOracleTextToIR('draw a card.', 'Kindred Discovery');
    const draw = ir.abilities.flatMap(a => a.steps).find(s => s.kind === 'draw');
    expect((draw as any)?.amount).toEqual({ kind: 'number', value: 1 });
    const unknowns = ir.abilities.flatMap(a => a.steps).filter(s => s.kind === 'unknown');
    expect(unknowns).toHaveLength(0);
  });

  it('parses draw a card for each other subtype you control as reference_amount', () => {
    expect(parseQuantity('a card for each other Dinosaur you control')).toEqual({
      kind: 'reference_amount',
      raw: 'a card for each other dinosaur you control',
    });
    const ir = parseOracleTextToIR(
      'When this creature enters, draw a card for each other Dinosaur you control.',
      'Earthshaker Dreadmaw',
    );
    const draw = ir.abilities.flatMap(a => a.steps).find(s => s.kind === 'draw');
    expect((draw as any)?.amount).toEqual({
      kind: 'reference_amount',
      raw: 'a card for each other dinosaur you control',
    });
  });

  it('parses impulse exile until instant or sorcery quantity', () => {
    expect(parseQuantity('until they exile an instant or sorcery card')).toEqual({
      kind: 'reference_amount',
      raw: 'until they exile an instant or sorcery card',
    });
    const ir = parseOracleTextToIR(
      'that player exiles cards from the top of their library until they exile an instant or sorcery card. you may cast that card without paying its mana cost.',
      'Dazzling Sphinx'
    );
    const step = ir.abilities.flatMap(a => a.steps).find(s => s.kind === 'impulse_exile_top');
    expect((step as any)?.amount?.kind).toBe('reference_amount');
  });

  it('parses gain life equal to its mana value', () => {
    const parsed = tryParseLifeAndCombatClause({
      clause: 'you gain life equal to its mana value',
      rawClause: 'you gain life equal to its mana value',
      withMeta: value => value,
    });
    expect(parsed?.kind).toBe('gain_life');
    expect((parsed as any)?.amount).toEqual({ kind: 'object_stat', subject: 'it', stat: 'mana_value' });
  });

  it('parses look choose from top with put that card into hand', () => {
    const ir = parseOracleTextToIR(
      'Whenever you attack, look at the top four cards of your library. You may reveal a Hero card from among them and put that card into your hand. Put the rest on the bottom of your library in a random order.',
      'Director Nick Fury'
    );
    const step = ir.abilities.flatMap(a => a.steps).find(s => s.kind === 'look_choose_from_top');
    expect(step).toBeTruthy();
    expect((step as any)?.selectorText).toMatch(/hero/i);
    const unknowns = ir.abilities.flatMap(a => a.steps).filter(s => s.kind === 'unknown');
    expect(unknowns).toHaveLength(0);
  });

  it('parses "a card at random" draw quantity', () => {
    expect(parseQuantity('a card at random')).toEqual({ kind: 'number', value: 1 });
    expect(parseQuantity('card')).toEqual({ kind: 'number', value: 1 });
  });

  it('parses exile top clause with whereX directly', () => {
    const step = tryParseExileTopClause({
      clause: 'Exile the top X cards of your library, where X is the number of lands you control.',
      rawClause: 'Exile the top X cards of your library, where X is the number of lands you control.',
      withMeta: value => value,
    });
    expect(step?.kind).toBe('exile_top');
    expect((step as any)?.whereX?.raw).toMatch(/lands you control/i);
  });
  it('splits mill quantity and where X clause', () => {
    const split = splitQuantityTailAndWhereX(
      'x cards, where x is the amount of life you gained this turn'
    );
    expect(split.quantityPart).toBe('x cards');
    expect(split.whereX?.raw).toBe('the amount of life you gained this turn');
  });

  it('parses Hope Estheim trigger clause to mill IR with whereX', () => {
    const ir = parseOracleTextToIR(
      'Each opponent mills X cards, where X is the amount of life you gained this turn.',
      'Hope Estheim'
    );
    const steps = ir.abilities.flatMap(a => a.steps);
    const mill = steps.find(s => s.kind === 'mill');
    expect(mill).toBeTruthy();
    expect((mill as any).who).toEqual({ kind: 'each_opponent' });
    expect((mill as any).whereX?.raw).toBe('the amount of life you gained this turn');
  });
});

describe('resolveOracleQuantity', () => {
  it('resolves cast-time X from context', () => {
    const state = makeState();
    const count = resolveOracleQuantity(
      state,
      'p1' as PlayerID,
      { kind: 'x' },
      { controllerId: 'p1' as PlayerID, xValue: 4 }
    );
    expect(count).toBe(4);
  });

  it('resolves that many cards from referenceAmount context', () => {
    const state = makeState();
    const count = resolveOracleQuantity(
      state,
      'p1' as PlayerID,
      { kind: 'reference_amount', raw: 'that many' },
      { controllerId: 'p1' as PlayerID, referenceAmount: 5 }
    );
    expect(count).toBe(5);
  });

  it('resolves where X is life gained this turn', () => {
    const state = makeState({
      lifeGainedThisTurn: { p1: 3 },
    } as any);
    const { amount, whereX } = parseQuantityWithOptionalWhereX(
      'x cards, where x is the amount of life you gained this turn'
    );
    const count = resolveOracleQuantity(state, 'p1' as PlayerID, amount, { controllerId: 'p1' as PlayerID }, { whereX });
    expect(count).toBe(3);
  });

  it('resolves life gained this turn as 0 when the tracker has no controller key', () => {
    const state = makeState({
      lifeGainedThisTurn: {},
    } as any);
    const { amount, whereX } = parseQuantityWithOptionalWhereX(
      'x cards, where x is the amount of life you gained this turn'
    );
    const count = resolveOracleQuantity(state, 'p1' as PlayerID, amount, { controllerId: 'p1' as PlayerID }, { whereX });
    expect(count).toBe(0);
  });

  it('resolves Ivory Tower hand-size-above reference gain_life amount', () => {
    const state = makeState({
      zones: {
        p1: { handCount: 6 },
      },
    } as any);
    const amount = {
      kind: 'reference_amount',
      raw: '1 life for each card in your hand above 4',
    } as const;
    const count = resolveOracleQuantity(state, 'p1' as PlayerID, amount, { controllerId: 'p1' as PlayerID });
    expect(count).toBe(2);
  });

  it("resolves Venser's Journal per-card hand-size gain_life amount", () => {
    const state = makeState({
      zones: {
        p1: { handCount: 3 },
      },
    } as any);
    const amount = {
      kind: 'reference_amount',
      raw: '1 for each card in your hand',
    } as const;
    const count = resolveOracleQuantity(state, 'p1' as PlayerID, amount, { controllerId: 'p1' as PlayerID });
    expect(count).toBe(3);
  });
});

describe('quantity step parsing', () => {
  it('parses Fraying Sanity enchanted player mill with graveyard count whereX', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of each end step, enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.',
      'Fraying Sanity'
    );
    const steps = ir.abilities.flatMap(a => a.steps);
    const mill = steps.find(s => s.kind === 'mill');
    expect(mill).toBeTruthy();
    expect((mill as any).who).toEqual({ kind: 'enchanted_player' });
    expect((mill as any).whereX?.raw).toBe(
      'the number of cards put into their graveyard from anywhere this turn'
    );
  });

  it('parses draw X with whereX', () => {
    const ir = parseOracleTextToIR(
      'Draw X cards, where X is the number of cards in your hand.',
      'Test Draw'
    );
    expect(ir.abilities.length).toBeGreaterThan(0);
    const draw = ir.abilities.flatMap(a => a.steps).find(s => s.kind === 'draw');
    expect(draw).toBeTruthy();
    expect((draw as any).amount).toEqual({ kind: 'x' });
    expect((draw as any).whereX?.raw).toBe('the number of cards in your hand');
  });

  it('parses target player draw X with whereX', () => {
    const ir = parseOracleTextToIR(
      'Target player draws X cards, where X is the number of cards in your hand.',
      'Test Target Draw'
    );
    expect(ir.abilities.length).toBeGreaterThan(0);
    const draw = ir.abilities.flatMap(a => a.steps).find(s => s.kind === 'draw');
    expect(draw).toBeTruthy();
    expect((draw as any).who).toEqual({ kind: 'target_player' });
    expect((draw as any).amount).toEqual({ kind: 'x' });
    expect((draw as any).whereX?.raw).toBe('the number of cards in your hand');
  });

  it('parses gain X life with whereX', () => {
    const gain = tryParseLifeAndCombatClause({
      clause: 'you gain X life, where X is the amount of life you gained this turn.',
      rawClause: 'you gain X life, where X is the amount of life you gained this turn.',
      withMeta: step => step,
    });
    expect(gain?.kind).toBe('gain_life');
    expect((gain as any)?.whereX?.raw).toBe('the amount of life you gained this turn');
  });

  it('parses ETB gain X life on full oracle via parseOracleTextToIR', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, you gain X life, where X is the amount of life you gained this turn.',
      'Test Creature'
    );
    const gain = ir.abilities.flatMap(a => a.steps).find(s => s.kind === 'gain_life');
    expect(gain).toBeTruthy();
    expect((gain as any)?.whereX?.raw).toBe('the amount of life you gained this turn');
  });
});

describe('applyMillStep', () => {
  it('mills enchanted player using graveyard count whereX', () => {
    const state = makeState({
      cardsPutIntoYourGraveyardThisTurn: { p2: 4 },
    } as any);
    const result = applyMillStep(
      state,
      {
        kind: 'mill',
        who: { kind: 'enchanted_player' },
        amount: { kind: 'x' },
        whereX: {
          kind: 'where',
          raw: 'the number of cards put into their graveyard from anywhere this turn',
        },
        raw: 'enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.',
      },
      {
        controllerId: 'p1' as PlayerID,
        sourceId: 'aura-1',
        selectorContext: { targetPlayerId: 'p2' as PlayerID },
      }
    );
    expect(result.applied).toBe(true);
    const p2 = result.state.players.find(p => p.id === 'p2');
    expect(p2?.graveyard?.length).toBe(4);
  });

  it('mills each opponent using dynamic where X', () => {
    const state = makeState({ lifeGainedThisTurn: { p1: 2 } } as any);
    const result = applyMillStep(
      state,
      {
        kind: 'mill',
        who: { kind: 'each_opponent' },
        amount: { kind: 'x' },
        whereX: { kind: 'where', raw: 'the amount of life you gained this turn' },
        raw: 'Each opponent mills X cards, where X is the amount of life you gained this turn.',
      },
      { controllerId: 'p1' as PlayerID }
    );
    expect(result.applied).toBe(true);
    const p2 = result.state.players.find(p => p.id === 'p2');
    const p3 = result.state.players.find(p => p.id === 'p3');
    expect(p2?.graveyard?.length).toBe(2);
    expect(p3?.graveyard?.length).toBe(2);
  });

  it('applies mill 0 when life-gained tracker is empty', () => {
    const state = makeState({ lifeGainedThisTurn: {} } as any);
    const result = applyMillStep(
      state,
      {
        kind: 'mill',
        who: { kind: 'each_opponent' },
        amount: { kind: 'x' },
        whereX: { kind: 'where', raw: 'the amount of life you gained this turn' },
        raw: 'Each opponent mills X cards, where X is the amount of life you gained this turn.',
      },
      { controllerId: 'p1' as PlayerID }
    );
    expect(result.applied).toBe(true);
    const p2 = result.state.players.find(p => p.id === 'p2');
    expect(p2?.graveyard?.length ?? 0).toBe(0);
    expect(p2?.library?.length).toBeGreaterThan(0);
  });

  it('loses life per opponent equal to the life they lost this turn', () => {
    const state = makeState({
      lifeLostThisTurn: { p1: 1, p2: 5, p3: 3 },
      life: { p1: 40, p2: 40, p3: 40 },
    } as any);
    const ir = parseOracleTextToIR(
      'Each opponent loses life equal to the life they lost this turn.',
      'Wound Reflection'
    );
    const lose = ir.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'lose_life');
    expect(lose).toBeTruthy();
    const p2Amount = resolveOracleQuantityForPlayer(
      state,
      'p1' as PlayerID,
      (lose as any).amount,
      { controllerId: 'p1' as PlayerID },
      'p2' as PlayerID,
    );
    const p3Amount = resolveOracleQuantityForPlayer(
      state,
      'p1' as PlayerID,
      (lose as any).amount,
      { controllerId: 'p1' as PlayerID },
      'p3' as PlayerID,
    );
    expect(p2Amount).toBe(5);
    expect(p3Amount).toBe(3);

    const result = applyLoseLifeStep(state, lose as any, { controllerId: 'p1' as PlayerID }, 'p1' as PlayerID);
    expect(result.applied).toBe(true);
    expect(result.state.players.find((player) => player.id === 'p2')?.life).toBe(35);
    expect(result.state.players.find((player) => player.id === 'p3')?.life).toBe(37);
    expect(result.state.players.find((player) => player.id === 'p1')?.life).toBe(40);
  });
});

describe('oracle effect IR gap closures', () => {
  it('parses draw unless that player pays mana', () => {
    const ir = parseOracleTextToIR('you may draw a card unless that player pays {4}.', 'Mystic Remora');
    const step = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'unless_pays_mana');
    expect(step).toBeDefined();
    expect((step as any)?.mana).toBe('{4}');
    expect(ir.abilities.flatMap((a) => a.steps).filter((s) => s.kind === 'unknown')).toHaveLength(0);
  });

  it('parses you get seven {TK}', () => {
    const ir = parseOracleTextToIR('you get seven {TK}.', 'Prize Booth');
    const step = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'add_player_counter');
    expect((step as any)?.counter).toBe('ticket');
    expect((step as any)?.amount).toEqual({ kind: 'number', value: 7 });
    expect(ir.abilities.flatMap((a) => a.steps).filter((s) => s.kind === 'unknown')).toHaveLength(0);
  });

  it('recovers truncated draw-a-card unless pays clause', () => {
    const ir = parseOracleTextToIR('a card unless that player pays {1}.', 'Rhystic Study Fragment');
    expect(ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'unless_pays_mana')).toBeDefined();
    expect(ir.abilities.flatMap((a) => a.steps).filter((s) => s.kind === 'unknown')).toHaveLength(0);
  });

  it('prunes goad reminder parenthetical as non-executable text', () => {
    const ir = parseOracleTextToIR(
      '(until your next turn, they attack each combat if able and attack a player other than you if able.)',
      'Legion Loyalist',
    );
    expect(ir.abilities.flatMap((a) => a.steps).filter((s) => s.kind === 'unknown')).toHaveLength(0);
  });
});

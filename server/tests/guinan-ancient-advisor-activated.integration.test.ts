import { describe, expect, it } from 'vitest';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';

/**
 * Guinan, Ancient Advisor, oracle text from oracle-cards.jsonl:
 *   {1}, {T}: Put a +1/+1 counter on each creature you control that entered this turn. If you put
 *   two or more +1/+1 counters on creatures this way, draw a card.
 *
 * Self-play game 94 reported the ability as an all-or-nothing failure. When fewer than two counters
 * were put, the "If you put two or more ..." clause is checked and correctly does nothing, but it
 * was then counted as a mandatory step that had not been carried out.
 */
const GUINAN_ORACLE =
  '{1}, {T}: Put a +1/+1 counter on each creature you control that entered this turn. If you put two or more +1/+1 counters on creatures this way, draw a card.';

function bear(id: string, enteredThisTurn: boolean) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    enteredThisTurn,
    summoningSickness: enteredThisTurn,
    counters: {},
    card: { id: `${id}_card`, name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
  };
}

function makeCtx(gameId: string, creatures: any[]) {
  const library = [
    { id: 'lib_1', name: 'Swamp', type_line: 'Basic Land — Swamp' },
    { id: 'lib_2', name: 'Forest', type_line: 'Basic Land — Forest' },
  ];
  const state: any = {
    players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
    life: { p1: 40, p2: 40 },
    turnNumber: 5,
    turnPlayer: 'p1',
    priority: 'p1',
    phase: 'precombatMain',
    step: 'MAIN1',
    stack: [],
    battlefield: [
      {
        id: 'guinan',
        controller: 'p1',
        owner: 'p1',
        tapped: true,
        enteredThisTurn: false,
        counters: {},
        card: { id: 'guinan_card', name: 'Guinan, Ancient Advisor', type_line: 'Legendary Creature — El-Aurian Advisor', power: '2', toughness: '2', oracle_text: GUINAN_ORACLE },
      },
      ...creatures,
    ],
    zones: {
      p1: { hand: [], library, graveyard: [], exile: [], handCount: 0, libraryCount: library.length },
      p2: { hand: [], library: [], graveyard: [], exile: [] },
    },
  };
  return { state, gameId, bumpSeq: () => {}, libraries: new Map([['p1', library], ['p2', []]]) } as any;
}

function activate(ctx: any) {
  return tryApplyOracleIRToActivatedAbility(ctx, {
    controller: 'p1',
    sourceName: 'Guinan, Ancient Advisor',
    oracleText: GUINAN_ORACLE,
    sourcePermanentId: 'guinan',
    allowOptional: true,
  });
}

function plusCounters(ctx: any): Record<string, number> {
  return Object.fromEntries(ctx.state.battlefield.map((perm: any) => [perm.id, Number(perm.counters?.['+1/+1'] || 0)]));
}

function handIds(ctx: any): string[] {
  return (ctx.state.zones.p1.hand || []).map((card: any) => String(card.id));
}

describe('Guinan, Ancient Advisor activated ability', () => {
  it('puts a counter on each creature that entered this turn and draws when two or more were put', () => {
    const ctx = makeCtx('guinan_two_entered', [bear('bear_1', true), bear('bear_2', true), bear('old_bear', false)]);
    const result = activate(ctx);

    expect(result.handled).toBe(true);
    expect(plusCounters(ctx)).toEqual({ guinan: 0, bear_1: 1, bear_2: 1, old_bear: 0 });
    expect(handIds(ctx)).toHaveLength(1);
  });

  it('is complete, without a draw, when only one creature entered this turn', () => {
    const ctx = makeCtx('guinan_one_entered', [bear('bear_1', true), bear('old_bear', false)]);
    const result = activate(ctx);

    expect(result.handled).toBe(true);
    expect(plusCounters(ctx)).toEqual({ guinan: 0, bear_1: 1, old_bear: 0 });
    expect(handIds(ctx)).toEqual([]);
  });

  it('is complete, with nothing changed, when no creature entered this turn', () => {
    const ctx = makeCtx('guinan_none_entered', [bear('old_bear', false)]);
    const result = activate(ctx);

    expect(result.handled).toBe(true);
    expect(plusCounters(ctx)).toEqual({ guinan: 0, old_bear: 0 });
    expect(handIds(ctx)).toEqual([]);
  });
});

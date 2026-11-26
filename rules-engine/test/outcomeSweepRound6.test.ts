import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { snapshotToCardLike } from '../src/oracleIRLedgerCardAccess';
import { tryApplyCompoundOrDividedDamage } from '../src/oracleIRExecutorDamageBoundTargetFallback';
import { normalizeOracleTextSelfReferences } from '../src/oracleTextParserPreprocess';

function player(id: string, library: any[] = []): any {
  return { id, name: id, seat: 0, life: 40, hand: [], library, graveyard: [], exile: [], commandZone: [], counters: {}, hasLost: false,
    manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
}

function makeState(battlefield: any[]): GameState {
  return {
    id: 'round6', format: 'commander', life: { p1: 40, p2: 40 }, turnPlayer: 'p1', priority: 'p1', active: true,
    players: [player('p1', [{ id: 'lib1', name: 'Card A' }, { id: 'lib2', name: 'Card B' }]), player('p2')],
    battlefield, stack: [], zones: {}, startingLife: 40, commandZone: {}, phase: 'main1', step: 'main',
  } as any;
}

describe('outcome sweep round 6 (IR)', () => {
  it('keeps the one-word card name as the imperative verb (Exile)', () => {
    const text = 'Exile target nonwhite attacking creature. You gain life equal to its toughness.';
    expect(normalizeOracleTextSelfReferences(text, 'Exile')).toBe(text);
    expect(normalizeOracleTextSelfReferences('Fireball deals X damage to any target.', 'Fireball')).toMatch(/^this permanent deals/);
    const steps = parseOracleTextToIR(text, 'Exile').abilities[0].steps as any[];
    expect(steps[0].kind).toBe('exile');
  });

  it('ledger snapshots keep last-known mana value', () => {
    const card = snapshotToCardLike({ objectId: 'a', zone: 'battlefield', ownerId: 'p2', name: 'Trinket', typeLine: 'Artifact',
      supertypes: [], types: ['Artifact'], subtypes: [], power: null, toughness: null, manaValue: 1, colors: [], isToken: false,
      isCommander: false, counters: {}, affectedByStepIndex: 0, transitionId: 't', transitionKind: 'sacrifice' } as any);
    expect((card as any).manaValue).toBe(1);
  });

  it('compound damage binds where-X only to the X part (Judgment Bolt)', () => {
    const seen: any[] = [];
    const apply = (state: any, step: any) => { seen.push(step); return { applied: true, state, log: [] } as any; };
    const step: any = { kind: 'deal_damage', amount: { kind: 'number', value: 5 }, source: { kind: 'raw', text: 'this permanent' },
      target: { kind: 'raw', text: "target creature and X damage to that creature's controller" },
      whereX: { kind: 'where', raw: 'the number of Equipment you control' } };
    tryApplyCompoundOrDividedDamage(makeState([]), step, { controllerId: 'p1' } as any, apply);
    expect(seen).toHaveLength(2);
    expect(seen[0].whereX).toBeUndefined();
    expect(seen[0].amount).toEqual({ kind: 'number', value: 5 });
    expect(seen[1].amount).toEqual({ kind: 'x' });
    expect(seen[1].whereX?.raw).toBe('the number of Equipment you control');
  });

  it("false 'If that permanent is a Chandra planeswalker' makes 'If you do' false (no draw)", () => {
    const giant = { id: 'g1', controller: 'p2', owner: 'p2', tapped: false, counters: {}, damage: 0,
      card: { id: 'g1c', name: 'Hill Giant', type_line: 'Creature — Giant', colors: ['R'], power: '3', toughness: '3' } };
    const text = "Chandra's Defeat deals 5 damage to target red creature or red planeswalker. If that permanent is a Chandra planeswalker, you may discard a card. If you do, draw a card.";
    const steps = parseOracleTextToIR(text, "Chandra's Defeat").abilities[0].steps;
    const result = applyOracleIRStepsToGameState(makeState([giant]), steps, {
      controllerId: 'p1', sourceName: "Chandra's Defeat", targetPermanentId: 'g1', selectorContext: { targetPermanentId: 'g1' },
    } as any);
    const p1 = (result.state.players as any[]).find((entry) => entry.id === 'p1');
    expect(p1.hand).toHaveLength(0);
    expect(p1.library).toHaveLength(2);
  });
});

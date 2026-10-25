import { describe, it, expect } from 'vitest';
import type { GameContext } from '../src/state/context.js';
import { collectOraclePatternDamageReplacementSpecsFromState, overlaySpecsMatchDamage } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamageOracleTemplates.js';
import { parseBatch19PreventAllSentence } from '../src/state/modules/replacementBatch19PreventAll.js';
import { applyBatch19DrawInstead } from '../src/state/modules/replacementBatch19DrawInstead.js';
import { recordDamageReplacementMessages } from '../src/state/modules/replacementDamageLog.js';

type Perm = { id: string; controller: string; owner: string; card: { name: string; type_line: string; oracle_text: string; colors?: string[] }; [k: string]: unknown };
const perm = (id: string, name: string, oracle: string, extra: Partial<Perm> = {}, controller = 'p1', type_line = 'Creature'): Perm =>
  ({ id, controller, owner: controller, card: { name, type_line, oracle_text: oracle }, ...extra });
// Single fixture adapter: tests build plain state objects, the API takes a GameContext.
const ctxOf = (state: object, libraries = new Map<string, unknown[]>()): GameContext => ({ state, libraries }) as unknown as GameContext;
function prevented(state: object, input: { damageDealer: string; damageReceiver: string; damageSourcePermanentId?: string; targetPermanentId?: string; isCombatDamage?: boolean }): boolean {
  return collectOraclePatternDamageReplacementSpecsFromState(state)
    .some((spec) => spec.instead?.modify === 'cap' && spec.instead?.value === 0 && overlaySpecsMatchDamage(spec, input, state));
}

describe('batch19 prevent-all', () => {
  it('parses Energy Storm and conditional lines', () => {
    expect(parseBatch19PreventAllSentence('prevent all damage that would be dealt by instant and sorcery spells').length).toBeGreaterThan(0);
    expect(parseBatch19PreventAllSentence('as long as ~ has a divinity counter on it, prevent all damage that would be dealt to ~').length).toBeGreaterThan(0);
  });
  it('chosen-name filter only prevents damage from the named source', () => {
    const w = perm('w', 'Ward of Names', 'Prevent all damage that would be dealt to you by sources with the chosen name.', { chosenCardName: 'Bear' });
    const bear = perm('b', 'Bear', '', {}, 'p2');
    const orc = perm('o', 'Orc', '', {}, 'p2');
    const state = { battlefield: [w, bear, orc] };
    const specs = collectOraclePatternDamageReplacementSpecsFromState(state);
    expect(specs.length).toBeGreaterThan(0);
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'b' })).toBe(true);
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'o' })).toBe(false);
  });
});

describe('batch19 draw replacements', () => {
  const zones = () => ({ p1: { hand: [], handCount: 0, libraryCount: 2, graveyard: [] as unknown[], graveyardCount: 0, exile: [], exileCount: 0 }, p2: { hand: [], handCount: 0, libraryCount: 2, graveyard: [], graveyardCount: 0 } });
  const libs = () => new Map<string, unknown[]>([['p1', [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }]], ['p2', [{ id: 'd1', name: 'C' }]]]);
  it('Possessed Portal skips the draw', () => {
    const state = { battlefield: [perm('pp', 'Possessed Portal', 'If a player would draw a card, that player skips that draw instead.', {}, 'p1', 'Artifact')], zones: zones(), players: [{ id: 'p1' }, { id: 'p2' }] };
    expect(applyBatch19DrawInstead(ctxOf(state), 'p2', { drawNumber: 1, isDrawStep: true }, () => true)).toBe(true);
    expect(state).toHaveProperty('batch18DrawReplacements.0.sourceName', 'Possessed Portal');
  });
  it('Uba Mask exiles the top card face up', () => {
    const state = { battlefield: [perm('um', 'Uba Mask', 'If a player would draw a card, that player exiles that card face up instead.', {}, 'p1', 'Artifact')], zones: zones(), players: [] };
    const l = libs();
    expect(applyBatch19DrawInstead(ctxOf(state, l), 'p1', { drawNumber: 1, isDrawStep: true }, () => true)).toBe(true);
    expect(state.zones.p1.exile).toHaveLength(1);
    expect(l.get('p1')).toHaveLength(1);
  });
  it('Forbidden Crypt returns from graveyard or loses', () => {
    const z = zones(); z.p1.graveyard.push({ id: 'g1', name: 'G' });
    const players = [{ id: 'p1', hasLost: false }];
    const state = { battlefield: [perm('fc', 'Forbidden Crypt', 'If you would draw a card, return a card from your graveyard to your hand instead. If you can\'t, you lose the game.', {}, 'p1', 'Enchantment')], zones: z, players };
    expect(applyBatch19DrawInstead(ctxOf(state), 'p1', { drawNumber: 1, isDrawStep: true }, () => true)).toBe(true);
    expect(z.p1.hand).toHaveLength(1);
    expect(applyBatch19DrawInstead(ctxOf(state), 'p1', { drawNumber: 2, isDrawStep: false }, () => true)).toBe(true);
    expect(players[0].hasLost).toBe(true);
    expect(applyBatch19DrawInstead(ctxOf(state), 'p2', { drawNumber: 1, isDrawStep: false }, () => true)).toBe(false);
  });
  it('Notion Thief redirects opponent extra draws', () => {
    const state = { battlefield: [perm('nt', 'Notion Thief', 'Flash\nIf an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.')], zones: zones(), players: [], turnPlayer: 'p2' };
    const drew: string[] = [];
    const d = (pid: string) => { drew.push(pid); return true; };
    expect(applyBatch19DrawInstead(ctxOf(state), 'p2', { drawNumber: 1, isDrawStep: true }, d)).toBe(false);
    expect(applyBatch19DrawInstead(ctxOf(state), 'p2', { drawNumber: 2, isDrawStep: false }, d)).toBe(true);
    expect(applyBatch19DrawInstead(ctxOf(state), 'p1', { drawNumber: 2, isDrawStep: false }, d)).toBe(false);
    expect(drew).toEqual(['p1']);
  });
});

describe('batch19 damage log', () => {
  it('records and caps', () => {
    const state: { damageReplacementLog?: unknown[] } = {};
    recordDamageReplacementMessages(state, ['X: prevented 2'], 2, 0);
    recordDamageReplacementMessages(state, [], 2, 2);
    expect(state.damageReplacementLog).toHaveLength(1);
  });
});
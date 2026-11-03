import { describe, expect, it } from 'vitest';
import { spellHasGrantedRebound } from '../src/state/modules/spellReboundGrant.js';
import { readGlobalColorSetting } from '../src/state/modules/globalColorSetting.js';
import { getEffectiveColors } from '../src/state/modules/effectiveColors.js';
import { moveResolvedInstantOrSorceryAfterResolution } from '../src/state/modules/stackResolveSpellZoneUtils.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

const sys = (line: string, name = 'Test Card') => String(classifyStaticCensusLine(line, name)?.system ?? '');
const ctt = { id: 'ctt', controller: 'p1', card: { name: 'Cast Through Time', type_line: 'Enchantment', oracle_text: 'Instant and sorcery spells you control have rebound.' } };
const lens = { id: 'lens', controller: 'p2', card: { name: 'Thran Lens', type_line: 'Artifact', oracle_text: 'All permanents are colorless.' } };
const bear = { id: 'bear', controller: 'p1', card: { name: 'Bear', type_line: 'Creature - Bear', colors: ['G'], oracle_text: '' }, colors: ['G'] };

describe('B46: granted rebound', () => {
  it('grants to the controller only, for instants and sorceries', () => {
    const state = { battlefield: [ctt] };
    expect(spellHasGrantedRebound(state, 'p1', { type_line: 'Instant' })).toBe(true);
    expect(spellHasGrantedRebound(state, 'p1', { type_line: 'Sorcery' })).toBe(true);
    expect(spellHasGrantedRebound(state, 'p2', { type_line: 'Instant' })).toBe(false);
    expect(spellHasGrantedRebound(state, 'p1', { type_line: 'Creature' })).toBe(false);
    expect(spellHasGrantedRebound({ battlefield: [] }, 'p1', { type_line: 'Instant' })).toBe(false);
  });
  it('exiles a hand-cast instant with reboundPending on resolution', () => {
    const card = { id: 'shock', name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.' };
    const state: any = { battlefield: [ctt], turnNumber: 3, zones: { p1: { hand: [], graveyard: [], exile: [], graveyardCount: 0, exileCount: 0 } } };
    moveResolvedInstantOrSorceryAfterResolution({ state, gameId: 'b46_rebound' } as any, { controller: 'p1' as any, card, effectiveCard: card, item: { id: 's1', card, castFromHand: true, controller: 'p1' }, oracleText: card.oracle_text });
    const exiled = state.zones.p1.exile.find((c: any) => c.id === 'shock');
    expect(exiled).toBeTruthy();
    expect(exiled.reboundPending).toBe(true);
    expect(state.zones.p1.graveyard.some((c: any) => c.id === 'shock')).toBe(false);
  });
});

describe('B46: global colour setting', () => {
  it('Thran Lens makes battlefield permanents colorless but not off-battlefield cards', () => {
    const state = { battlefield: [lens, bear] };
    expect(readGlobalColorSetting(state, bear).colorless).toBe(true);
    expect(getEffectiveColors(bear as any, state)).toEqual([]);
    expect(getEffectiveColors({ id: 'inhand', colors: ['R'] } as any, state)).toEqual(['R']);
    expect(getEffectiveColors(bear as any, { battlefield: [bear] })).toEqual(['G']);
  });
  it('"All creatures are black" sets creature colour only', () => {
    const black = { id: 'dh', controller: 'p1', card: { name: 'X', type_line: 'Enchantment', oracle_text: 'All creatures are black.' } };
    const state = { battlefield: [black, bear] };
    expect(getEffectiveColors(bear as any, state)).toEqual(['B']);
    expect(readGlobalColorSetting(state, black).set).toEqual([]);
  });
  it('ignores "in addition to their other colors"', () => {
    const add = { id: 'a', controller: 'p1', card: { name: 'Y', type_line: 'Enchantment', oracle_text: 'All creatures are black in addition to their other colors.' } };
    expect(readGlobalColorSetting({ battlefield: [add, bear] }, bear).set).toEqual([]);
  });
});

describe('B46: census classification', () => {
  it('classifies the long-tail families', () => {
    expect(sys('Instant and sorcery spells you control have rebound.', 'Cast Through Time')).toContain('spellReboundGrant');
    expect(sys('Enchanted permanent is an enchantment and loses all other card types.', 'One with the Stars')).toContain('attachedTypeSettingStamp');
    expect(sys('All permanents are colorless.', 'Thran Lens')).toContain('globalColorSetting');
  });
});

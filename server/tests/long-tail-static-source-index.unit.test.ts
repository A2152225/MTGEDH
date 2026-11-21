import { describe, expect, it, vi } from 'vitest';

const parserCalls = vi.hoisted(() => ({ jetmirBands: 0 }));

vi.mock('../src/state/modules/batch110Parsers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/state/modules/batch110Parsers.js')>();
  return {
    ...actual,
    parseAlsoPTAndKeywordAtCreatureCount: (oracle: string) => {
      parserCalls.jetmirBands += 1;
      return actual.parseAlsoPTAndKeywordAtCreatureCount(oracle);
    },
  };
});

import { layer4AddedTypesFor, stampLayer4TypeSetting } from '../src/state/modules/layer4TypeSetting.js';
import { batch107PermanentHasKeyword } from '../src/state/modules/batch107Apply.js';
import { batch108PermanentHasKeyword } from '../src/state/modules/batch108Apply.js';
import { batch109PermanentHasKeyword } from '../src/state/modules/batch109Apply.js';
import { batch110PermanentHasKeyword } from '../src/state/modules/batch110Apply.js';
import { batch111PermanentHasKeyword } from '../src/state/modules/batch111Apply.js';
import { batch112PermanentHasKeyword } from '../src/state/modules/batch112Apply.js';
import {
  createLongTailStaticSourceFilter,
  longTailStaticSources,
  withLongTailStaticSourceIndex,
} from '../src/state/modules/longTailStaticSourceIndex.js';

/**
 * Self-play game 144 stalled with 200 Borg tokens on the battlefield: one continuous-effects
 * recompute took about 20 seconds, because the layer 4 stamp asked every battlefield source about
 * every permanent 74 times although no source had any of the texts being looked for.
 *
 * Oracle text (oracle-cards.jsonl):
 *   Jetmir, Nexus of Revels — "Creatures you control get +1/+0 and have vigilance as long as you
 *     control three or more creatures.\nCreatures you control also get +1/+0 and have trample as
 *     long as you control six or more creatures.\nCreatures you control also get +1/+0 and have
 *     double strike as long as you control nine or more creatures."
 *   Life and Limb — "All Forests and all Saprolings are 1/1 green Saproling creatures and Forest
 *     lands in addition to their other types. (They're affected by summoning sickness.)"
 *   Kormus Bell — "All Swamps are 1/1 black creatures that are still lands."
 *   Borg token — Token Artifact Creature — Borg, no rules text.
 */
const JETMIR =
  'Creatures you control get +1/+0 and have vigilance as long as you control three or more creatures.\n'
  + 'Creatures you control also get +1/+0 and have trample as long as you control six or more creatures.\n'
  + 'Creatures you control also get +1/+0 and have double strike as long as you control nine or more creatures.';
const LIFE_AND_LIMB =
  "All Forests and all Saprolings are 1/1 green Saproling creatures and Forest lands in addition to their other types. (They're affected by summoning sickness.)";
const KORMUS_BELL = 'All Swamps are 1/1 black creatures that are still lands.';

const KEYWORDS = ['hexproof', 'menace', 'first strike', 'lifelink', 'double strike', 'prowess', 'trample', 'flying', 'haste', 'indestructible', 'shroud'];

function permanent(id: string, controller: string, name: string, typeLine: string, oracleText = '', extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: { id: `${id}_card`, name, type_line: typeLine, oracle_text: oracleText, ...extra },
  };
}

function borgTokens(count: number, controller: string, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({
    ...permanent(`${prefix}_${index}`, controller, 'Borg', 'Token Artifact Creature — Borg', '', { power: '1', toughness: '1' }),
    isToken: true,
  }));
}

function makeState(battlefield: any[]) {
  return {
    players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
    turnPlayer: 'p1',
    activePlayer: 'p1',
    battlefield,
    zones: { p1: { hand: [], graveyard: [], exile: [] }, p2: { hand: [], graveyard: [], exile: [] } },
  } as any;
}

function expectedKeywords(perm: any, state: any): string[] {
  return KEYWORDS.filter((kw) => (
    batch107PermanentHasKeyword(perm, state, kw) || batch108PermanentHasKeyword(perm, state, kw)
    || batch109PermanentHasKeyword(perm, state, kw) || batch110PermanentHasKeyword(perm, state, kw)
    || batch111PermanentHasKeyword(perm, state, kw) || batch112PermanentHasKeyword(perm, state, kw)
  ));
}

describe('long-tail static source index', () => {
  it('stamps the same types and keywords as asking every source about every permanent', () => {
    const state = makeState([
      permanent('jetmir', 'p1', 'Jetmir, Nexus of Revels', 'Legendary Creature — Cat Demon', JETMIR, { power: '5', toughness: '4' }),
      permanent('limb', 'p2', 'Life and Limb', 'Enchantment', LIFE_AND_LIMB),
      permanent('bell', 'p2', 'Kormus Bell', 'Artifact', KORMUS_BELL),
      permanent('forest', 'p1', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
      permanent('swamp', 'p2', 'Swamp', 'Basic Land — Swamp', '({T}: Add {B}.)'),
      permanent('island', 'p2', 'Island', 'Basic Land — Island', '({T}: Add {U}.)'),
      ...borgTokens(9, 'p1', 'borg_p1'),
      ...borgTokens(2, 'p2', 'borg_p2'),
    ]);

    stampLayer4TypeSetting(state);

    // Reference answers come from the same functions outside the stamp, where every source is asked.
    for (const perm of state.battlefield) {
      expect([...(perm.layer4AddedTypes || [])].sort(), `types of ${perm.id}`).toEqual([...layer4AddedTypesFor(perm, state)].sort());
      expect(perm.batch107GrantedKeywords, `keywords of ${perm.id}`).toEqual(expectedKeywords(perm, state));
    }

    // And the answers are real ones, not all-empty on both sides.
    const byId = (id: string) => state.battlefield.find((perm: any) => perm.id === id);
    expect(byId('borg_p1_0').batch107GrantedKeywords).toEqual(['double strike', 'trample']);
    expect(byId('borg_p2_0').batch107GrantedKeywords).toEqual([]);
    expect(byId('forest').layer4AddedTypes).toEqual(expect.arrayContaining(['Creature', 'Saproling']));
    expect(byId('swamp').layer4AddedTypes).toEqual(expect.arrayContaining(['Creature']));
    expect(byId('island').layer4AddedTypes).toBeUndefined();
  });

  it('does not ask each of 200 text-less tokens about each permanent', () => {
    const state = makeState([
      permanent('jetmir', 'p1', 'Jetmir, Nexus of Revels', 'Legendary Creature — Cat Demon', JETMIR, { power: '5', toughness: '4' }),
      permanent('island', 'p1', 'Island', 'Basic Land — Island', '({T}: Add {U}.)'),
      ...borgTokens(200, 'p1', 'borg'),
    ]);

    parserCalls.jetmirBands = 0;
    stampLayer4TypeSetting(state);

    // Before: 202 permanents x 11 keywords x 202 sources = 448,844 calls of this one parser.
    // Now: one relevance check per distinct text, then one call per (permanent, keyword) for Jetmir.
    expect(parserCalls.jetmirBands).toBeLessThan(202 * 11 * 2);
    expect(state.battlefield.find((perm: any) => perm.id === 'borg_199').batch107GrantedKeywords).toEqual(['double strike', 'trample']);
  });

  it('only shortens the source list inside the scope, and only for the scoped battlefield', () => {
    const filter = createLongTailStaticSourceFilter('test-jetmir', () => [
      (line: string) => (/also get/i.test(line) ? [{ min: 6 }] : []),
    ]);
    const lineOf = (perm: any) => String(perm?.card?.oracle_text || '');
    const jetmir = permanent('jetmir', 'p1', 'Jetmir, Nexus of Revels', 'Legendary Creature — Cat Demon', JETMIR);
    const state = makeState([jetmir, ...borgTokens(5, 'p1', 'borg')]);
    const otherState = makeState([...borgTokens(3, 'p1', 'other')]);

    expect(filter.isInertLine('')).toBe(true);
    expect(filter.isInertLine(JETMIR)).toBe(false);
    expect(longTailStaticSources(state, filter, lineOf)).toBe(state.battlefield);

    withLongTailStaticSourceIndex(state, () => {
      expect(longTailStaticSources(state, filter, lineOf)).toEqual([jetmir]);
      expect(longTailStaticSources(otherState, filter, lineOf)).toBe(otherState.battlefield);
    });

    expect(longTailStaticSources(state, filter, lineOf)).toBe(state.battlefield);
  });

  it('keeps a source whose parser throws or returns a non-empty value', () => {
    const throwing = createLongTailStaticSourceFilter('test-throwing', () => [() => { throw new Error('boom'); }]);
    const truthy = createLongTailStaticSourceFilter('test-truthy', () => [() => null, () => ({ power: 1 })]);
    const none = createLongTailStaticSourceFilter('test-no-parsers', () => []);
    expect(throwing.isInertLine('anything')).toBe(false);
    expect(truthy.isInertLine('anything')).toBe(false);
    expect(none.isInertLine('anything')).toBe(false);
  });
});

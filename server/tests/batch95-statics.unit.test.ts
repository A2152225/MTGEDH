import { describe, expect, it } from 'vitest';
import { parseTypedLandWouldEnterSacrifice, landMatchesTypedWouldEnterSacrifice, collectBatch95LandWouldEnterReplacementSpecs } from '../src/state/modules/batch95LandWouldEnter.js';
import { parseSpellOrHandKeywordGrants, cardMatchesKeywordGrantFilter, getGrantedSpellOrHandKeyword } from '../src/state/modules/batch95SpellAndHandKeywordGrants.js';
import { parseBatch95CounterSentence, collectBatch95CounterReplacementSpecs, applyMeliraPoisonReplacement } from '../src/state/modules/replacementBatch95CounterReplacements.js';
import { parseBatch95DamageSentence, collectBatch95DamageReplacementSpecs, applyBatch95DamageSideEffects } from '../src/state/modules/replacementBatch95DamageReplacements.js';
import { parseBatch95LongTailStaticKind, playerHasOpponentCantForceDiscardOrSacrifice, commanderHasNoMaximumDeckSize } from '../src/state/modules/staticEffectSpec-handlers/batch95LongTailStatics.js';
import { parseLibraryOfLengDiscardReplacement, applyLibraryOfLengDiscardDestination, noteManaValueAsExiledForBorca, getGreatestNotedManaValueThisTurn } from '../src/state/modules/batch95DiscardAndNotes.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

const SOLDEVI = 'If this land would enter, sacrifice an untapped Island instead. If you do, put this land onto the battlefield. If you don\'t, put it into its owner\'s graveyard.';
const HEART = 'If this land would enter, sacrifice a Forest instead. If you do, put this land onto the battlefield. If you don\'t, put it into its owner\'s graveyard.';
const BALDUVIAN = 'If this land would enter, sacrifice an untapped Mountain instead.';
const LOREHOLD = 'Each instant and sorcery card in your hand has miracle {2}.';
const HATCHERY = 'Each Sliver spell you cast has replicate. The replicate cost is equal to its mana cost.';
const JO = 'Each historic card in your hand has cycling {2}{W}.';
const SILVERQUILL = 'Each instant and sorcery spell you cast has casualty 1.';
const HERIGAST = 'Each creature spell you cast has emerge. The emerge cost is equal to its mana cost.';
const STATUARY = 'Nonartifact spells you cast have improvise.';
const ASHLING = 'Elemental permanent spells you cast from your hand gain evoke {4} as you cast them.';
const ELDA = 'The first nonlegendary creature spell you cast each turn has demonstrate.';
const RAIDING = 'Each noncreature spell you cast has conspire.';
const DOC = 'If you would put one or more counters on a permanent you control, put that many plus one of each of those kinds of counters on that permanent instead.';
const PIR = 'If one or more counters would be put on a permanent your team controls, that many plus one of each of those kinds of counters are put on that permanent instead.';
const VIZIER = 'If one or more -1/-1 counters would be put on a creature you control, that many -1/-1 counters minus one are put on it instead.';
const MELIRA = 'If you would get one or more poison counters, instead you get one poison counter and you can\'t get additional poison counters this turn.';
const VIGOR = 'If damage would be dealt to another creature you control, prevent that damage. Put a +1/+1 counter on that creature for each 1 damage prevented this way.';
const GRATUITOUS = 'If a creature you control would deal damage to a permanent or player, it deals double that damage instead.';
const LASHKNIFE = 'If a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead.';
const SPHERE = 'If an artifact would deal damage to you, prevent 1 of that damage.';
const CALLOUS = 'If a source would deal 3 or less damage to this creature, prevent that damage.';
const PANTHER = 'If equipped creature would be dealt damage, prevent that damage and put that many +1/+1 counters on it.';
const WEATHERED = 'As long as this creature is untapped, all combat damage that would be dealt to you by unblocked creatures is dealt to this creature instead.';
const TAMIYO = 'Spells and abilities your opponents control can\'t cause you to discard cards or sacrifice permanents.';
const LENG = 'If an effect causes you to discard a card, discard it, but you may put it on top of your library instead of into your graveyard.';
const UBA = 'Each player may play lands and cast spells from among cards they exiled with this artifact this turn.';
const FBLTHP_PLOT = 'The top card of your library has plot. The plot cost is equal to its mana cost.';
const FBLTHP_MAY = 'You may plot nonland cards from the top of your library.';
const CELEBRANT = 'If this creature hasn\'t been exerted this turn, you may exert it as it attacks.';
const BORCA_NOTE = 'Note the mana value of each card as it\'s put into exile.';
const BORCA_POWER = 'Bell Borca\'s power is equal to the greatest number noted for it this turn.';
const WHTZ = 'A deck with this commander has no maximum deck size.';

function perm(init: any) {
  return { tapped: false, phasedOut: false, ...init };
}
function stateWith(battlefield: any[], extra: any = {}) {
  return { battlefield, life: { p1: 40, p2: 40 }, zones: { p1: { library: [], graveyard: [], hand: [] }, p2: { library: [], graveyard: [], hand: [] } }, ...extra };
}

describe('batch95 statics', () => {
  it('parses typed land-would-enter sacrifice for Island, Forest, and Mountain', () => {
    expect(parseTypedLandWouldEnterSacrifice(SOLDEVI)).toEqual({ sacrificeCount: 1, requireUntapped: true, requireType: 'island' });
    expect(parseTypedLandWouldEnterSacrifice(HEART)).toEqual({ sacrificeCount: 1, requireUntapped: false, requireType: 'forest' });
    expect(parseTypedLandWouldEnterSacrifice(BALDUVIAN)).toEqual({ sacrificeCount: 1, requireUntapped: true, requireType: 'mountain' });
    const island = perm({ id: 'i', controller: 'p1', card: { type_line: 'Land — Island' }, tapped: false });
    const forest = perm({ id: 'f', controller: 'p1', card: { type_line: 'Land — Forest' }, tapped: false });
    const tappedIsland = perm({ id: 'ti', controller: 'p1', card: { type_line: 'Land — Island' }, tapped: true });
    const parsed = parseTypedLandWouldEnterSacrifice(SOLDEVI)!;
    expect(landMatchesTypedWouldEnterSacrifice(island, parsed)).toBe(true);
    expect(landMatchesTypedWouldEnterSacrifice(forest, parsed)).toBe(false);
    expect(landMatchesTypedWouldEnterSacrifice(tappedIsland, parsed)).toBe(false);
    expect(collectBatch95LandWouldEnterReplacementSpecs(SOLDEVI, { sourcePermanentId: 's', sourceController: 'p1', sourceName: 'Soldevi Excavations' }).some((s) => s.effectId === 'land-would-enter-sacrifice')).toBe(true);
  });

  it('grants miracle, cycling, replicate, casualty, emerge, improvise, evoke, demonstrate, and conspire from one mechanism', () => {
    const bolt = { name: 'Lightning Bolt', type_line: 'Instant', colors: ['R'], mana_cost: '{R}', oracle_text: 'Lightning Bolt deals 3 damage to any target.' };
    const sliver = { name: 'Sidewinder Sliver', type_line: 'Creature — Sliver', mana_cost: '{W}' };
    const historic = { name: 'Sol Ring', type_line: 'Artifact', mana_cost: '{1}' };
    const elemental = { name: 'Lightning Elemental', type_line: 'Creature — Elemental', mana_cost: '{3}{R}' };
    const nonleg = { name: 'Grizzly Bears', type_line: 'Creature — Bear', mana_cost: '{1}{G}' };
    const lorehold = perm({ id: 'lh', controller: 'p1', card: { name: 'Lorehold, the Historian', oracle_text: LOREHOLD } });
    const st = stateWith([lorehold]);
    expect(getGrantedSpellOrHandKeyword(st, 'p1', bolt, 'miracle', { zone: 'hand' })?.cost).toBe('{2}');
    expect(getGrantedSpellOrHandKeyword(st, 'p1', historic, 'miracle', { zone: 'hand' })).toBeNull();

    const jo = stateWith([perm({ id: 'jg', controller: 'p1', card: { name: 'Jo Grant', oracle_text: JO } })]);
    expect(getGrantedSpellOrHandKeyword(jo, 'p1', historic, 'cycling', { zone: 'hand' })?.cost).toBe('{2}{W}');
    expect(getGrantedSpellOrHandKeyword(jo, 'p1', bolt, 'cycling', { zone: 'hand' })).toBeNull();

    const hatch = stateWith([perm({ id: 'hs', controller: 'p1', card: { name: 'Hatchery Sliver', oracle_text: HATCHERY } })]);
    expect(getGrantedSpellOrHandKeyword(hatch, 'p1', sliver, 'replicate', { zone: 'cast' })?.cost).toBe('{W}');
    expect(getGrantedSpellOrHandKeyword(hatch, 'p1', bolt, 'replicate', { zone: 'cast' })).toBeNull();

    expect(parseSpellOrHandKeywordGrants(SILVERQUILL)[0]).toMatchObject({ keyword: 'casualty', numericValue: 1 });
    expect(cardMatchesKeywordGrantFilter(bolt, parseSpellOrHandKeywordGrants(SILVERQUILL)[0].filter)).toBe(true);
    expect(parseSpellOrHandKeywordGrants(HERIGAST)[0].keyword).toBe('emerge');
    expect(getGrantedSpellOrHandKeyword(stateWith([perm({ id: 'is', controller: 'p1', card: { oracle_text: STATUARY } })]), 'p1', bolt, 'improvise', { zone: 'cast' })).toBeTruthy();
    expect(getGrantedSpellOrHandKeyword(stateWith([perm({ id: 'is', controller: 'p1', card: { oracle_text: STATUARY } })]), 'p1', historic, 'improvise', { zone: 'cast' })).toBeNull();
    expect(getGrantedSpellOrHandKeyword(stateWith([perm({ id: 'as', controller: 'p1', card: { oracle_text: ASHLING } })]), 'p1', elemental, 'evoke', { zone: 'cast', fromZone: 'hand' })?.cost).toBe('{4}');
    expect(parseSpellOrHandKeywordGrants(ELDA)[0]).toMatchObject({ keyword: 'demonstrate', filter: { firstThisTurn: true } });
    expect(parseSpellOrHandKeywordGrants(RAIDING)[0].keyword).toBe('conspire');
    expect(parseSpellOrHandKeywordGrants(FBLTHP_PLOT).some((g) => g.keyword === 'plot')).toBe(true);
    expect(parseSpellOrHandKeywordGrants(FBLTHP_MAY).some((g) => g.keyword === 'plot')).toBe(true);
  });

  it('collects Doc Samson, Pir, Vizier, and Melira counter replacements, and caps Melira poison', () => {
    const src = { sourcePermanentId: 'x', sourceController: 'p1', sourceName: 'X' };
    expect(collectBatch95CounterReplacementSpecs(DOC, src).some((s) => s.effectId === 'you-put-counters-plus-n' && s.instead.value === 1)).toBe(true);
    expect(collectBatch95CounterReplacementSpecs(PIR, src).some((s) => s.effectId === 'team-counters-plus-n' && s.instead.value === 1)).toBe(true);
    expect(collectBatch95CounterReplacementSpecs(VIZIER, src).some((s) => s.effectId === 'm1m1-counters-minus-n' && s.instead.value === -1)).toBe(true);
    expect(parseBatch95CounterSentence(MELIRA).some((e) => e.kind === 'poison-first-then-cap')).toBe(true);
    const melira = perm({ id: 'm', controller: 'p1', card: { name: 'Melira, the Living Cure', oracle_text: MELIRA } });
    const st = stateWith([melira]);
    expect(applyMeliraPoisonReplacement(st, 'p1', 3)).toBe(1);
    expect(applyMeliraPoisonReplacement(st, 'p1', 2)).toBe(0);
    expect(applyMeliraPoisonReplacement(st, 'p2', 2)).toBe(2);
  });

  it('applies Vigor, Gratuitous Violence, Lashknife, Sphere of Purity, Callous Giant, and Panther Habit', () => {
    const vigor = perm({ id: 'v', controller: 'p1', card: { name: 'Vigor', type_line: 'Creature — Elemental Incarnation', oracle_text: VIGOR } });
    const bear = perm({ id: 'b', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear' }, counters: {} });
    const gv = perm({ id: 'g', controller: 'p1', card: { name: 'Gratuitous Violence', type_line: 'Enchantment', oracle_text: GRATUITOUS } });
    const lash = perm({ id: 'l', controller: 'p1', card: { name: 'Lashknife Barrier', type_line: 'Enchantment', oracle_text: LASHKNIFE } });
    const sphere = perm({ id: 's', controller: 'p1', card: { name: 'Sphere of Purity', type_line: 'Enchantment', oracle_text: SPHERE } });
    const giant = perm({ id: 'cg', controller: 'p1', card: { name: 'Callous Giant', type_line: 'Creature — Giant', oracle_text: CALLOUS } });
    const habit = perm({ id: 'ph', controller: 'p1', attachedTo: 'b', card: { name: 'Panther Habit', type_line: 'Artifact — Equipment', oracle_text: PANTHER } });
    expect(parseBatch95DamageSentence(WEATHERED).some((e) => e.kind === 'redirect-unblocked-combat-to-self-while-untapped')).toBe(true);
    expect(collectBatch95DamageReplacementSpecs(GRATUITOUS, { sourcePermanentId: 'g', sourceController: 'p1', sourceName: 'GV' }).some((s) => s.effectId === 'controlled-creatures-double-damage')).toBe(true);

    const vHit = applyBatch95DamageSideEffects({ state: stateWith([vigor, bear]) } as any, 3, 'p2', 'p1', 'opp', 'b');
    expect(vHit?.amount).toBe(0);
    expect(bear.counters['+1/+1']).toBe(3);

    const dmg = applyBatch95DamageSideEffects({ state: stateWith([gv, bear]) } as any, 3, 'p1', 'p2', 'b');
    expect(dmg?.amount).toBe(6);

    const minus = applyBatch95DamageSideEffects({ state: stateWith([lash, bear]) } as any, 3, 'p2', 'p1', 'opp', 'b');
    expect(minus?.amount).toBe(2);

    const artifact = perm({ id: 'a', controller: 'p2', card: { name: 'Juggernaut', type_line: 'Artifact Creature — Juggernaut' } });
    const prev = applyBatch95DamageSideEffects({ state: stateWith([sphere, artifact]) } as any, 3, 'p2', 'p1', 'a');
    expect(prev?.amount).toBe(2);

    const cap = applyBatch95DamageSideEffects({ state: stateWith([giant]) } as any, 3, 'p2', 'p1', 'opp', 'cg');
    expect(cap?.amount).toBe(0);
    const capMiss = applyBatch95DamageSideEffects({ state: stateWith([giant]) } as any, 4, 'p2', 'p1', 'opp', 'cg');
    expect(capMiss).toBeNull();

    const pHit = applyBatch95DamageSideEffects({ state: stateWith([habit, bear]) } as any, 2, 'p2', 'p1', 'opp', 'b');
    expect(pHit?.amount).toBe(0);
    expect(bear.counters['+1/+1']).toBe(5);
  });

  it('covers Tamiyo, Library of Leng, Uba Mask, Fblthp, Combat Celebrant, Bell Borca, and Whtz', () => {
    expect(parseBatch95LongTailStaticKind(TAMIYO)).toContain('opponent-cant-force-discard-or-sacrifice');
    const tamiyo = perm({ id: 't', controller: 'p1', card: { name: 'Tamiyo, Collector of Tales', oracle_text: TAMIYO } });
    expect(playerHasOpponentCantForceDiscardOrSacrifice(stateWith([tamiyo]), 'p1')).toBe(true);
    expect(playerHasOpponentCantForceDiscardOrSacrifice(stateWith([tamiyo]), 'p2')).toBe(false);

    expect(parseLibraryOfLengDiscardReplacement(LENG)).toBe(true);
    const leng = perm({ id: 'll', controller: 'p1', card: { name: 'Library of Leng', oracle_text: LENG } });
    const shock = { id: 'shock', name: 'Shock', mana_cost: '{R}' };
    const st = stateWith([leng], { zones: { p1: { library: [{ id: 'x' }], graveyard: [shock], hand: [] } } });
    expect(applyLibraryOfLengDiscardDestination(st, 'p1', shock, true)).toBe(true);
    expect(st.zones.p1.library[0].id).toBe('shock');

    expect(parseBatch95LongTailStaticKind(UBA)).toContain('may-play-cards-exiled-with-this-this-turn');
    expect(parseBatch95LongTailStaticKind(CELEBRANT)).toContain('may-exert-as-it-attacks-if-not-exerted-this-turn');
    expect(parseBatch95LongTailStaticKind(FBLTHP_PLOT).some((k) => k.startsWith('grant-plot'))).toBe(true);

    const borca = perm({ id: 'bb', controller: 'p1', card: { name: 'Bell Borca, Spectral Sergeant', oracle_text: `${BORCA_NOTE}\n${BORCA_POWER}` }, notedManaValuesThisTurn: [] });
    const bst = stateWith([borca], { turnNumber: 4 });
    noteManaValueAsExiledForBorca(bst, { name: 'Counterspell', mana_cost: '{U}{U}', mana_value: 2 });
    noteManaValueAsExiledForBorca(bst, { name: 'Wrath of God', mana_cost: '{2}{W}{W}', mana_value: 4 });
    expect(getGreatestNotedManaValueThisTurn(borca, bst)).toBe(4);
    expect(parseBatch95LongTailStaticKind(BORCA_NOTE)).toContain('note-mana-value-as-exiled');
    expect(parseBatch95LongTailStaticKind(BORCA_POWER)).toContain('power-equals-greatest-noted-this-turn');

    expect(commanderHasNoMaximumDeckSize({ oracle_text: WHTZ })).toBe(true);
    expect(parseBatch95LongTailStaticKind(WHTZ)).toContain('commander-no-maximum-deck-size');
  });

  it('census lines for this batch are not owned_but_unhandled', () => {
    const lines: Array<[string, string]> = [
      [SOLDEVI, 'Soldevi Excavations'],
      [HEART, 'Heart of Yavimaya'],
      [BALDUVIAN, 'Balduvian Trading Post'],
      [LOREHOLD, 'Lorehold, the Historian'],
      [HATCHERY, 'Hatchery Sliver'],
      [JO, 'Jo Grant'],
      [SILVERQUILL, 'Silverquill, the Disputant'],
      [HERIGAST, 'Herigast, Erupting Nullkite'],
      [STATUARY, 'Inspiring Statuary'],
      [ASHLING, 'Ashling, the Limitless'],
      [ELDA, 'Elda, Conjurer of Spectacle'],
      [RAIDING, 'Raiding Schemes'],
      [DOC, 'Doc Samson, Super Psychiatrist'],
      [PIR, 'Pir, Imaginative Rascal'],
      [VIZIER, 'Vizier of Remedies'],
      [MELIRA, 'Melira, the Living Cure'],
      [VIGOR, 'Vigor'],
      [GRATUITOUS, 'Gratuitous Violence'],
      [LASHKNIFE, 'Lashknife Barrier'],
      [SPHERE, 'Sphere of Purity'],
      [CALLOUS, 'Callous Giant'],
      [PANTHER, 'Panther Habit'],
      [WEATHERED, 'Weathered Bodyguards'],
      [TAMIYO, 'Tamiyo, Collector of Tales'],
      [LENG, 'Library of Leng'],
      [UBA, 'Uba Mask'],
      [FBLTHP_PLOT, 'Fblthp, Lost on the Range'],
      [FBLTHP_MAY, 'Fblthp, Lost on the Range'],
      [CELEBRANT, 'Combat Celebrant'],
      [BORCA_NOTE, 'Bell Borca, Spectral Sergeant'],
      [BORCA_POWER, 'Bell Borca, Spectral Sergeant'],
      [WHTZ, 'Whtz, the Bibliophile'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});

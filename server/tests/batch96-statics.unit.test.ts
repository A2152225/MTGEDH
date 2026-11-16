import { describe, it, expect } from 'vitest';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.ts';
import { getGrantedSpellOrHandKeyword } from '../src/state/modules/batch95SpellAndHandKeywordGrants.js';
import {
  mayPlayCardsExiledWithSourceThisTurn,
  playerHasOpponentCantForceDiscardOrSacrifice,
} from '../src/state/modules/staticEffectSpec-handlers/batch95LongTailStatics.js';
import { noteManaValueAsExiledForBorca, getGreatestNotedManaValueThisTurn } from '../src/state/modules/batch95DiscardAndNotes.js';
import { resolveGrantedKeywordAlternateCost, stampGrantedCastKeywords, readStampedGrantedKeyword } from '../src/state/modules/batch96GrantedKeywordHooks.js';
import { getLibraryTopPlotAction, applyPlotLibraryTopCard } from '../src/state/modules/batch96PlotAction.js';
import { shouldBlockOpponentForcedDiscardOrSacrifice } from '../src/state/modules/batch96CauseGuard.js';
import { parseAshiokLifePayExile, applyAshiokLifePayExile, collectBatch96LifePayExileSpecs } from '../src/state/modules/batch96LifePayExile.js';
import { parseBatch96GraveyardExileSentence, collectBatch96ZoneReplacementSpecs } from '../src/state/modules/replacementBatch96ZoneReplacements.js';
import { parseBatch96DamageReplacementKind, applyWolverineMarkedDamageHeal, collectBatch96DamageReplacementSpecs } from '../src/state/modules/replacementBatch96DamageReplacements.js';
import {
  parseTwistsAndTurnsExploreReplacement,
  parseYurlokUnspentManaLifeLoss,
  applyYurlokUnspentManaLifeLossAmount,
  collectBatch96ExploreReplacementSpecs,
} from '../src/state/modules/replacementBatch96ExploreAndMana.js';
import {
  parseBatch96LongTailStaticKind,
  diligentZookeeperPump,
  meatsqueakSquirrelPump,
  muckslingerOffBattlefieldPump,
  ashesAddedCreatureTypeForGraveyardCard,
  sparkRupturePlaneswalkerCreaturePT,
} from '../src/state/modules/staticEffectSpec-handlers/batch96LongTailStatics.js';
import { calculatePowerOnlyCDA } from '../src/state/utils-handlers/variablePowerOnlyCalculator.js';

const SRC = { sourcePermanentId: 'src-1', sourceController: 'p1', sourceName: 'Test' };

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return { id, controller, card: { name, oracle_text: oracle, ...extra }, ...extra };
}

describe('batch96 statics', () => {
  it('hooks emerge, evoke, casualty, demonstrate, and conspire grants', () => {
    const herigast = perm('h1', 'p1', 'Herigast, Erupting Nullkite', 'Each creature spell you cast has emerge. The emerge cost is equal to its mana cost.');
    const ashling = perm('a1', 'p1', 'Ashling, the Limitless', 'Elemental permanent spells you cast from your hand gain evoke {4} as you cast them.');
    const silverquill = perm('s1', 'p1', 'Silverquill Lecturer', 'Each instant and sorcery spell you cast has casualty 1.');
    const elda = perm('e1', 'p1', 'Elda, Giant Hunter', 'The first nonlegendary creature spell you cast each turn has demonstrate.');
    const raiding = perm('r1', 'p1', 'Raiding Schemes', 'Each noncreature spell you cast has conspire.');
    const state = { battlefield: [herigast, ashling, silverquill, elda, raiding], spellsCastThisTurn: { p1: 0 } };
    const creature = { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', mana_value: 2 };
    const elemental = { name: 'Fire Elemental', type_line: 'Creature — Elemental', oracle_text: '', mana_cost: '{3}{R}', mana_value: 4 };
    const instant = { name: 'Shock', type_line: 'Instant', oracle_text: '', mana_cost: '{R}' };
    const nonleg = { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}' };
    const artifact = { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '', mana_cost: '{1}' };

    expect(resolveGrantedKeywordAlternateCost(state, 'p1', creature, 'emerge')).toBe('{1}{G}');
    expect(getGrantedSpellOrHandKeyword(state, 'p1', elemental, 'evoke', { zone: 'cast', fromZone: 'hand' })?.cost).toBe('{4}');
    expect(resolveGrantedKeywordAlternateCost(state, 'p1', elemental, 'evoke', { fromZone: 'hand' })).toBe('{4}');

    stampGrantedCastKeywords(state, 'p1', [instant, nonleg, artifact, creature]);
    expect(readStampedGrantedKeyword(instant, 'casualty')).toBe(1);
    expect(readStampedGrantedKeyword(nonleg, 'demonstrate')).toBe(true);
    expect(readStampedGrantedKeyword(artifact, 'conspire')).toBe(true);
    expect(readStampedGrantedKeyword(creature, 'emerge')).toBe('{1}{G}');
  });

  it('blocks only opponent-caused discard or sacrifice for Tamiyo', () => {
    const tamiyo = perm('t1', 'p1', 'Tamiyo, Compleated Sage', "Spells and abilities your opponents control can't cause you to discard cards or sacrifice permanents.");
    const state = { battlefield: [tamiyo] };
    expect(playerHasOpponentCantForceDiscardOrSacrifice(state, 'p1')).toBe(true);
    expect(shouldBlockOpponentForcedDiscardOrSacrifice(state, 'p1', 'p2')).toBe(true);
    expect(shouldBlockOpponentForcedDiscardOrSacrifice(state, 'p1', 'p1')).toBe(false);
    expect(shouldBlockOpponentForcedDiscardOrSacrifice(state, 'p1', undefined)).toBe(false);
    expect(shouldBlockOpponentForcedDiscardOrSacrifice(state, 'p2', 'p1')).toBe(false);
  });

  it('Uba Mask play-from-exile helper recognizes cards exiled with the source this turn', () => {
    const uba = perm('u1', 'p1', 'Uba Mask', 'Each player may play lands and cast spells from among cards they exiled with this artifact this turn.');
    const state = { turnNumber: 4, battlefield: [uba] };
    const card = { id: 'c1', name: 'Island', type_line: 'Land — Island', exiledByPermanentId: 'u1', exiledThisTurnNumber: 4 };
    expect(mayPlayCardsExiledWithSourceThisTurn(state, 'p1', card)).toBe(true);
    expect(mayPlayCardsExiledWithSourceThisTurn({ ...state, turnNumber: 5 }, 'p1', card)).toBe(false);
  });

  it("plots Fblthp's library-top nonland at mana cost", () => {
    const fblthp = perm('f1', 'p1', 'Fblthp, Lost on the Range', 'The top card of your library has plot. The plot cost is equal to its mana cost.\nYou may plot nonland cards from the top of your library.');
    const spell = { id: 'c2', name: 'Shock', type_line: 'Instant', mana_cost: '{R}', oracle_text: '' };
    const state: any = { battlefield: [fblthp], zones: { p1: { library: [spell], exile: [] } } };
    const action = getLibraryTopPlotAction(state, 'p1');
    expect(action?.cost).toBe('{R}');
    const plotted = applyPlotLibraryTopCard(state, 'p1');
    expect(plotted?.isPlotted).toBe(true);
    expect(plotted?.plotCost).toBe('{R}');
    expect(state.zones.p1.library).toHaveLength(0);
    expect(state.zones.p1.exile[0].isPlotted).toBe(true);
  });

  it("notes Bell Borca exile mana values and feeds the power CDA", () => {
    const borca = perm('b1', 'p1', 'Bell Borca, Spectral Sergeant', "Note the mana value of each card as it's put into exile.\nBell Borca's power is equal to the greatest number noted for it this turn.", { power: '*', toughness: '4' });
    const state: any = { turnNumber: 3, battlefield: [borca] };
    noteManaValueAsExiledForBorca(state, { mana_value: 2 });
    noteManaValueAsExiledForBorca(state, { mana_cost: '{3}{U}' });
    expect(getGreatestNotedManaValueThisTurn(borca, state)).toBe(4);
    const cda = calculatePowerOnlyCDA(borca.card, String(borca.card.oracle_text).toLowerCase(), [borca], {}, 'p1');
    expect(cda?.power).toBe(4);
    expect(cda?.toughness).toBe(4);
  });

  it('exiles library top instead of paying life for Ashiok', () => {
    const oracle = 'If you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library instead.';
    expect(parseAshiokLifePayExile(oracle)).toBe(true);
    expect(collectBatch96LifePayExileSpecs(oracle, SRC)[0].effectId).toBe('pay-life-exile-library-top');
    const lib = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const state: any = { battlefield: [perm('ash', 'p1', 'Ashiok, Wicked Manipulator', oracle)], zones: { p1: { library: lib, exile: [] } } };
    expect(applyAshiokLifePayExile(state, 'p1', 2)).toEqual({ replaced: true, exiled: 2 });
    expect(state.zones.p1.library.map((c: any) => c.id)).toEqual(['c']);
    expect(state.zones.p1.exile).toHaveLength(2);
    expect(applyAshiokLifePayExile(state, 'p1', 5).replaced).toBe(false);
  });

  it('collects Lorcan, Samurai of the Pale Curtain, and Sanctifier en-Vec zone replacements', () => {
    const lorcan = parseBatch96GraveyardExileSentence('If a Warlock you control would die, exile it instead.');
    expect(lorcan).toEqual([{ kind: 'type_you_control_dies', type: 'warlock' }]);
    const samurai = collectBatch96ZoneReplacementSpecs('If a permanent would be put into a graveyard, exile it instead.', SRC);
    expect(samurai[0].instead).toMatchObject({ redirectZone: 'exile' });
    const sanct = collectBatch96ZoneReplacementSpecs(
      'If a black or red permanent, spell, or card not on the battlefield would be put into a graveyard, exile it instead.',
      SRC,
    );
    expect((sanct[0].match as any).objectColorsIncludeAny).toEqual(['B', 'R']);
  });

  it('parses Gemcutter, Ashes, counted pumps, Yurlok, and Spark Rupture', () => {
    expect(parseBatch96LongTailStaticKind('Treasures you control are Equipment in addition to their other types and have "Equipped creature gets +2/+0," equip Pirate {1}, and equip {3}.')).toContain('treasures-are-equipment-with-equip');
    expect(parseBatch96LongTailStaticKind('Each creature card in your graveyard has the chosen creature type in addition to its other types.')).toContain('graveyard-creatures-have-chosen-type');
    expect(parseBatch96LongTailStaticKind('Each non-Human creature you control gets +1/+1 for each of its creature types, to a maximum of 10.')).toContain('nonhuman-plus-per-creature-type-capped');
    expect(parseBatch96LongTailStaticKind('Creature spells you control and creature cards you own in any zone other than the battlefield or the stack get +3/+3.')).toEqual(['off-battlefield-creature-cards-pt']);
    expect(parseBatch96LongTailStaticKind('For every seven Foods you control, Squirrels you control get +3/+3.')).toContain('for-every-n-foods-type-gets-pt');
    expect(parseBatch96LongTailStaticKind('A player losing unspent mana causes that player to lose that much life.')).toContain('losing-unspent-mana-loses-that-much-life');
    expect(parseBatch96LongTailStaticKind('Each planeswalker with one or more loyalty counters on it loses all abilities and is a creature with power and toughness each equal to the number of loyalty counters on it.')).toContain('planeswalkers-with-loyalty-are-creatures');

    const hydra = { card: { type_line: 'Creature — Hydra Drake Beast' } };
    expect(diligentZookeeperPump(hydra, 'Each non-Human creature you control gets +1/+1 for each of its creature types, to a maximum of 10.')).toEqual({ power: 3, toughness: 3 });
    const human = { card: { type_line: 'Creature — Human Citizen' } };
    expect(diligentZookeeperPump(human, 'Each non-Human creature you control gets +1/+1 for each of its creature types, to a maximum of 10.')).toBeNull();

    const squirrel = { card: { type_line: 'Creature — Squirrel' }, controller: 'p1' };
    const foods = Array.from({ length: 15 }, (_, i) => ({ id: `f${i}`, controller: 'p1', card: { type_line: 'Artifact — Food' } }));
    expect(meatsqueakSquirrelPump(squirrel, foods, 'p1', 'For every seven Foods you control, Squirrels you control get +3/+3.')).toEqual({ power: 6, toughness: 6 });
    expect(muckslingerOffBattlefieldPump('Creature spells you control and creature cards you own in any zone other than the battlefield or the stack get +3/+3.')).toEqual({ power: 3, toughness: 3 });

    const ashes = perm('as1', 'p1', 'Ashes of the Fallen', 'Each creature card in your graveyard has the chosen creature type in addition to its other types.', { chosenCreatureType: 'Zombie' });
    expect(ashesAddedCreatureTypeForGraveyardCard({ battlefield: [ashes] }, 'p1', { type_line: 'Creature — Human' })).toBe('Zombie');

    const spark = perm('sp1', 'p1', 'Spark Rupture', 'Each planeswalker with one or more loyalty counters on it loses all abilities and is a creature with power and toughness each equal to the number of loyalty counters on it.');
    const walker = { id: 'w1', card: { type_line: 'Legendary Planeswalker — Jace' }, loyalty: 5, counters: { loyalty: 5 } };
    expect(sparkRupturePlaneswalkerCreaturePT(walker, { battlefield: [spark, walker] })).toEqual({ power: 5, toughness: 5 });
  });

  it('collects Mjölnir, Wolverine, Twists and Turns, and Yurlok helpers', () => {
    expect(parseBatch96DamageReplacementKind('Double all damage equipped creature would deal.')).toContain('equipped-creature-double-damage');
    expect(collectBatch96DamageReplacementSpecs('Double all damage equipped creature would deal.', SRC)[0].instead).toMatchObject({ modify: 'double' });
    const wolf = parseBatch96DamageReplacementKind('If damage would be dealt to Wolverine, instead that damage is dealt, but all other damage already dealt to him is healed.');
    expect(wolf).toContain('damage-dealt-heal-other-marked');
    const body: any = { damage: 3, markedDamage: 3 };
    applyWolverineMarkedDamageHeal(body);
    expect(body.damage).toBe(0);

    expect(parseTwistsAndTurnsExploreReplacement('If a creature you control would explore, instead you scry 1, then that creature explores.')).toBe(1);
    expect(collectBatch96ExploreReplacementSpecs('If a creature you control would explore, instead you scry 1, then that creature explores.', SRC)[0].metadata).toMatchObject({ scryCount: 1 });
    expect(parseYurlokUnspentManaLifeLoss('A player losing unspent mana causes that player to lose that much life.')).toBe(true);
    const yurlok = perm('y1', 'p1', 'Yurlok of Scorch Thrash', 'A player losing unspent mana causes that player to lose that much life.');
    expect(applyYurlokUnspentManaLifeLossAmount({ battlefield: [yurlok] }, 4)).toBe(4);
    expect(applyYurlokUnspentManaLifeLossAmount({ battlefield: [] }, 4)).toBe(0);
  });

  it('does not classify parsed B96 lines as owned_but_unhandled', () => {
    const lines: Array<[string, string]> = [
      ['If you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library instead.', 'Ashiok, Wicked Manipulator'],
      ['If a Warlock you control would die, exile it instead.', 'Lorcan, Warlock Collector'],
      ['If a permanent would be put into a graveyard, exile it instead.', 'Samurai of the Pale Curtain'],
      ['If a black or red permanent, spell, or card not on the battlefield would be put into a graveyard, exile it instead.', 'Sanctifier en-Vec'],
      ['Treasures you control are Equipment in addition to their other types and have "Equipped creature gets +2/+0," equip Pirate {1}, and equip {3}.', 'Gemcutter Buccaneer'],
      ['Each creature card in your graveyard has the chosen creature type in addition to its other types.', 'Ashes of the Fallen'],
      ['Each non-Human creature you control gets +1/+1 for each of its creature types, to a maximum of 10.', 'Diligent Zookeeper'],
      ['Creature spells you control and creature cards you own in any zone other than the battlefield or the stack get +3/+3.', 'The Muckslinger Gang'],
      ['For every seven Foods you control, Squirrels you control get +3/+3.', 'Meatsqueak, Hoard Lord'],
      ['A player losing unspent mana causes that player to lose that much life.', 'Yurlok of Scorch Thrash'],
      ['Double all damage equipped creature would deal.', 'Mjölnir, Hammer of Thor'],
      ['If a creature you control would explore, instead you scry 1, then that creature explores.', 'Twists and Turns'],
      ['Each planeswalker with one or more loyalty counters on it loses all abilities and is a creature with power and toughness each equal to the number of loyalty counters on it.', 'Spark Rupture'],
      ['If damage would be dealt to Wolverine, instead that damage is dealt, but all other damage already dealt to him is healed.', 'Wolverine, Fierce Fighter'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${JSON.stringify(result)}`).not.toBe('owned_but_unhandled');
    }
  });
});

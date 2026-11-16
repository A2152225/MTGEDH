import { describe, it, expect } from 'vitest';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.ts';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { playerProtectedFromOpponentSacrifice, playerProtectedFromOpponentDiscard } from '../../rules-engine/src/sacrificeCauseProtection.js';
import { shouldBlockOpponentForcedDiscardOrSacrifice } from '../src/state/modules/batch96CauseGuard.js';
import { applyAshiokLifePayExile } from '../src/state/modules/batch96LifePayExile.js';
import { payLifeAmount, canPayLifeAmount } from '../src/state/modules/batch97PayLife.js';
import { noteManaValueAsExiledForBorca, getGreatestNotedManaValueThisTurn } from '../src/state/modules/batch95DiscardAndNotes.js';
import { noteManaValueAsExiled } from '../../rules-engine/src/batch97ExileManaValueNote.js';
import { sparkRuptureAbilityLossTimestamp } from '../../rules-engine/src/batch97SparkAbilityLoss.js';
import { permanentLosesAllAbilities } from '../../rules-engine/src/permanentKeywordAbilities.js';
import {
  parseGrantedTreasureEquipmentOracle,
  grantedEquipmentOracleText,
  permanentIsEquipmentNow,
  playerMayActivateEquipAtInstantSpeed,
  attachedLetsAttackAsThoughHaste,
  equipmentOracleTextWithGrants,
} from '../src/state/modules/batch97GrantedEquipmentAbilities.js';
import { parseWorthyDefinition, permanentMatchesWorthyDefinition } from '../src/state/modules/batch97EquipWorthy.js';
import { parseEquipAbilitiesFromOracle, permanentMatchesEquipQualifier } from '../../shared/src/equipAbilities.js';
import { attachWorthyDefinitionToQualifiers } from '../src/state/modules/batch97EquipWorthy.js';
import {
  parseBatch97LongTailStaticKind,
  ghostlyFlameDamageSourceIsColorless,
  graveyardCardCountsAsName,
  countCardsNamedInGraveyards,
} from '../src/state/modules/staticEffectSpec-handlers/batch97LongTailStatics.js';
import { parseEdgarFirstFlipReplacement, collectBatch97ReplacementSpecs } from '../src/state/modules/replacementBatch97Collect.js';
import { collectBatch93DrawReplacementSpecsFromState } from '../src/state/modules/replacementBatch93DrawReplacements.js';
import { shouldForceFirstFlipHeadsAndWin, markCoinFlipEventThisTurn } from '../../rules-engine/src/batch97CoinFlipForce.js';
import { payEquipLifeCost, equipLifeCostError } from '../src/state/modules/equipNonManaCosts.js';
import { calculateEquipmentBonus } from '../src/state/utils-handlers/ptEquipmentBonusCalculator.js';

const SRC = { sourcePermanentId: 'src-1', sourceController: 'p1', sourceName: 'Test' };

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return { id, controller, card: { name, oracle_text: oracle, ...extra }, ...extra };
}

describe('batch97 statics', () => {
  it('extends opponent-cause sacrifice protection to Tamiyo and covers discard', () => {
    const tamiyo = perm('t1', 'p1', 'Tamiyo, Collector of Tales', "Spells and abilities your opponents control can't cause you to discard cards or sacrifice permanents.");
    const sigarda = perm('s1', 'p1', 'Sigarda, Host of Herons', "Spells and abilities your opponents control can't cause you to sacrifice permanents.");
    const bf = [tamiyo];
    expect(playerProtectedFromOpponentSacrifice(bf, 'p1', 'p2')).toBe(true);
    expect(playerProtectedFromOpponentDiscard(bf, 'p1', 'p2')).toBe(true);
    expect(playerProtectedFromOpponentSacrifice(bf, 'p1', 'p1')).toBe(false);
    expect(playerProtectedFromOpponentDiscard(bf, 'p1', 'p1')).toBe(false);
    expect(playerProtectedFromOpponentSacrifice(bf, 'p1', undefined)).toBe(false);
    expect(playerProtectedFromOpponentSacrifice([sigarda], 'p1', 'p2')).toBe(true);
    expect(playerProtectedFromOpponentDiscard([sigarda], 'p1', 'p2')).toBe(false);
    expect(shouldBlockOpponentForcedDiscardOrSacrifice({ battlefield: bf }, 'p1', 'p2')).toBe(true);
  });

  it('pays life through a shared chokepoint that applies Ashiok and notes Borca', () => {
    const oracle = 'If you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library instead.';
    const ashiok = perm('ash', 'p1', 'Ashiok, Wicked Manipulator', oracle);
    const borca = perm('b1', 'p1', 'Bell Borca, Spectral Sergeant', "Note the mana value of each card as it's put into exile.\nBell Borca's power is equal to the greatest number noted for it this turn.", { power: '*', toughness: '4' });
    const lib = [{ id: 'a', mana_value: 2 }, { id: 'b', mana_value: 5 }, { id: 'c', mana_value: 1 }];
    const state: any = {
      turnNumber: 4,
      battlefield: [ashiok, borca],
      life: { p1: 5 },
      players: [{ id: 'p1', life: 5 }],
      zones: { p1: { library: lib, exile: [] } },
    };
    expect(canPayLifeAmount(state, 'p1', 2)).toBe(true);
    const paid = payLifeAmount(state, 'p1', 2);
    expect(paid).toMatchObject({ paid: true, replaced: true, exiled: 2, newLife: 5 });
    expect(state.life.p1).toBe(5);
    expect(state.zones.p1.library.map((c: any) => c.id)).toEqual(['c']);
    expect(getGreatestNotedManaValueThisTurn(borca, state)).toBe(5);

    const small: any = {
      battlefield: [ashiok],
      life: { p1: 8 },
      players: [{ id: 'p1', life: 8 }],
      zones: { p1: { library: [{ id: 'x' }], exile: [] } },
    };
    const direct = payLifeAmount(small, 'p1', 3);
    expect(direct).toMatchObject({ paid: true, replaced: false, newLife: 5, exiled: 0 });
    expect(small.players[0].life).toBe(5);
    expect(applyAshiokLifePayExile(small, 'p1', 3).replaced).toBe(false);
  });

  it('routes equip life costs through the shared pay-life chokepoint', () => {
    const oracle = 'If you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library instead.';
    const state: any = {
      battlefield: [perm('ash', 'p1', 'Ashiok, Wicked Manipulator', oracle)],
      life: { p1: 2 },
      players: [{ id: 'p1', life: 2 }],
      zones: { p1: { library: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], exile: [] } },
    };
    expect(equipLifeCostError(state, 'p1', 'Pay 3 life')).toBeNull();
    expect(payEquipLifeCost(state, 'p1', 'Pay 3 life')).toBe(true);
    expect(state.life.p1).toBe(2);
    expect(state.zones.p1.exile).toHaveLength(3);
  });

  it('notes mana values on the shared exile helper used by every zone-change path', () => {
    const borca = perm('b1', 'p1', 'Bell Borca, Spectral Sergeant', "Note the mana value of each card as it's put into exile.\nBell Borca's power is equal to the greatest number noted for it this turn.");
    const state: any = { turnNumber: 7, battlefield: [borca] };
    noteManaValueAsExiled(state, { mana_value: 6 });
    noteManaValueAsExiledForBorca(state, { mana_cost: '{2}{R}' });
    expect(getGreatestNotedManaValueThisTurn(borca, state)).toBe(6);
  });

  it('makes Spark Rupture planeswalkers lose all abilities', () => {
    const spark = perm('sp1', 'p1', 'Spark Rupture', 'Each planeswalker with one or more loyalty counters on it loses all abilities and is a creature with power and toughness each equal to the number of loyalty counters on it.');
    const walker = { id: 'w1', controller: 'p1', card: { type_line: 'Legendary Planeswalker — Jace', oracle_text: '+1: Draw a card.' }, loyalty: 4, counters: { loyalty: 4 } };
    const bf = [spark, walker];
    expect(sparkRuptureAbilityLossTimestamp(walker, bf)).toBeDefined();
    expect(permanentLosesAllAbilities(walker, bf)).toBe(true);
    const empty = { ...walker, loyalty: 0, counters: { loyalty: 0 } };
    expect(permanentLosesAllAbilities(empty, [spark, empty])).toBe(false);
  });

  it('grants treasure equipment abilities and P/T from Gemcutter', () => {
    const oracle = 'Treasures you control are Equipment in addition to their other types and have "Equipped creature gets +2/+0," equip Pirate {1}, and equip {3}.';
    expect(parseGrantedTreasureEquipmentOracle(oracle)?.type).toBe('treasure');
    expect(parseGrantedTreasureEquipmentOracle(oracle)?.fragment).toMatch(/equipped creature gets \+2\/\+0/i);
    expect(parseGrantedTreasureEquipmentOracle(oracle)?.fragment).toMatch(/equip pirate \{1\}/i);
    const gem = perm('g1', 'p1', 'Gemcutter Buccaneer', oracle);
    const treasure = {
      id: 'tr1',
      controller: 'p1',
      card: { name: 'Treasure', type_line: 'Artifact Token — Treasure', oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.' },
      layer4AddedTypes: ['Equipment'],
      attachedTo: 'c1',
    };
    const pirate = { id: 'c1', controller: 'p1', card: { name: 'Pirate', type_line: 'Creature — Orc Pirate', power: '2', toughness: '2' } };
    const state = { battlefield: [gem, treasure, pirate] };
    expect(permanentIsEquipmentNow(treasure, state)).toBe(true);
    expect(grantedEquipmentOracleText(treasure, state)).toMatch(/equip \{3\}/i);
    const bonus = calculateEquipmentBonus(pirate, state.battlefield, state);
    expect(bonus.power).toBe(2);
    expect(bonus.toughness).toBe(0);
    const text = equipmentOracleTextWithGrants(treasure, state);
    const equips = parseEquipAbilitiesFromOracle(text);
    expect(equips.some((e) => e.qualifier.kind === 'creature_types' && e.cost.replace(/\s/g, '') === '{1}')).toBe(true);
    expect(equips.some((e) => e.qualifier.kind === 'any' && e.cost.replace(/\s/g, '') === '{3}')).toBe(true);
  });

  it("matches Mjölnir's worthy definition and instant-speed / as-though-haste helpers", () => {
    const mjolnirOracle = "Double all damage equipped creature would deal.\nEquip worthy {1} (A creature is worthy if it's a legendary non-Villain that's red and/or white.)";
    const def = parseWorthyDefinition(mjolnirOracle);
    expect(def).toMatchObject({ legendary: true, nonTypes: ['villain'], colors: ['R', 'W'], colorMode: 'any' });
    const thor = { card: { type_line: 'Legendary Creature — Human Warrior', colors: ['R', 'W'] } };
    const villain = { card: { type_line: 'Legendary Creature — Human Villain', colors: ['R'] } };
    const common = { card: { type_line: 'Creature — Human Warrior', colors: ['R'] } };
    const blueLeg = { card: { type_line: 'Legendary Creature — Merfolk', colors: ['U'] } };
    expect(permanentMatchesWorthyDefinition(thor, def)).toBe(true);
    expect(permanentMatchesWorthyDefinition(villain, def)).toBe(false);
    expect(permanentMatchesWorthyDefinition(common, def)).toBe(false);
    expect(permanentMatchesWorthyDefinition(blueLeg, def)).toBe(false);
    const parsed = attachWorthyDefinitionToQualifiers(parseEquipAbilitiesFromOracle(mjolnirOracle), mjolnirOracle);
    const worthy = parsed.find((a) => a.qualifier.kind === 'worthy');
    expect(worthy?.cost).toBe('{1}');
    expect(permanentMatchesEquipQualifier(thor, worthy!.qualifier)).toBe(true);
    expect(permanentMatchesEquipQualifier(villain, worthy!.qualifier)).toBe(false);

    const shikari = perm('sh1', 'p1', 'Leonin Shikari', 'You may activate equip abilities any time you could cast an instant.');
    expect(playerMayActivateEquipAtInstantSpeed({ battlefield: [shikari] }, 'p1')).toBe(true);
    expect(playerMayActivateEquipAtInstantSpeed({ battlefield: [shikari] }, 'p2')).toBe(false);

    const instill = perm('i1', 'p1', 'Instill Energy', 'Enchanted creature can attack as though it had haste.');
    instill.attachedTo = 'c1';
    const host = { id: 'c1', card: { type_line: 'Creature — Bear' } };
    expect(attachedLetsAttackAsThoughHaste(host, [instill, host])).toBe(true);
  });

  it('parses leftover statics and applies Farmhand / Ghostly Flame / Edgar helpers', () => {
    expect(parseBatch97LongTailStaticKind('Black and/or red permanents and spells are colorless sources of damage.')).toContain('color-permanents-are-color-damage-sources');
    expect(parseBatch97LongTailStaticKind('If this card is in a graveyard, effects from spells named Muscle Burst count it as a card named Muscle Burst.')).toContain('graveyard-counts-as-named-card');
    expect(parseEdgarFirstFlipReplacement('The first time you flip one or more coins each turn, those coins come up heads and you win those flips.')).toBe(true);
    expect(collectBatch97ReplacementSpecs('The first time you flip one or more coins each turn, those coins come up heads and you win those flips.', SRC)[0].effectId).toBe('first-coin-flips-heads-and-win');

    const farmhand = { name: 'Diligent Farmhand', oracle_text: 'If this card is in a graveyard, effects from spells named Muscle Burst count it as a card named Muscle Burst.' };
    expect(graveyardCardCountsAsName(farmhand, 'Muscle Burst')).toBe(true);
    expect(graveyardCardCountsAsName({ name: 'Shock' }, 'Muscle Burst')).toBe(false);
    const gyState = { zones: { p1: { graveyard: [farmhand, { name: 'Muscle Burst' }] }, p2: { graveyard: [{ name: 'Muscle Burst' }] } } };
    expect(countCardsNamedInGraveyards(gyState, 'Muscle Burst')).toBe(3);

    const flame = perm('f1', 'p1', 'Ghostly Flame', 'Black and/or red permanents and spells are colorless sources of damage.');
    const swamp = { card: { name: 'Drain Life', colors: ['B'] } };
    const island = { card: { name: 'Cancel', colors: ['U'] } };
    expect(ghostlyFlameDamageSourceIsColorless(swamp, { battlefield: [flame] })).toBe(true);
    expect(ghostlyFlameDamageSourceIsColorless(island, { battlefield: [flame] })).toBe(false);

    const edgar = perm('e1', 'p1', 'Edgar, King of Figaro', 'The first time you flip one or more coins each turn, those coins come up heads and you win those flips.');
    const flipState: any = { battlefield: [edgar], coinFlipsThisTurn: {} };
    expect(shouldForceFirstFlipHeadsAndWin(flipState, 'p1')).toBe(true);
    markCoinFlipEventThisTurn(flipState, 'p1');
    expect(shouldForceFirstFlipHeadsAndWin(flipState, 'p1')).toBe(false);
  });

  it('collects Archmage Ascension even when quest counters are below the threshold', () => {
    const arch = perm('a1', 'p1', 'Archmage Ascension', 'As long as this enchantment has six or more quest counters on it, if you would draw a card, you may instead search your library for a card, put that card into your hand, then shuffle.');
    const specs = collectBatch93DrawReplacementSpecsFromState({ battlefield: [arch] });
    expect(specs.some((s) => s.effectId === 'optional-search-instead-of-draw')).toBe(true);
  });

  it('does not classify implemented B97 lines as owned_but_unhandled', () => {
    const lines: Array<[string, string]> = [
      ["Spells and abilities your opponents control can't cause you to discard cards or sacrifice permanents.", 'Tamiyo, Collector of Tales'],
      ['If you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library instead.', 'Ashiok, Wicked Manipulator'],
      ["Note the mana value of each card as it's put into exile.", 'Bell Borca, Spectral Sergeant'],
      ['Each planeswalker with one or more loyalty counters on it loses all abilities and is a creature with power and toughness each equal to the number of loyalty counters on it.', 'Spark Rupture'],
      ['Treasures you control are Equipment in addition to their other types and have "Equipped creature gets +2/+0," equip Pirate {1}, and equip {3}.', 'Gemcutter Buccaneer'],
      ["Equip worthy {1}", 'Mjölnir, Hammer of Thor'],
      ['The first time you flip one or more coins each turn, those coins come up heads and you win those flips.', 'Edgar, King of Figaro'],
      ['Black and/or red permanents and spells are colorless sources of damage.', 'Ghostly Flame'],
      ['If this card is in a graveyard, effects from spells named Muscle Burst count it as a card named Muscle Burst.', 'Diligent Farmhand'],
      ['You may activate equip abilities any time you could cast an instant.', 'Leonin Shikari'],
      ['Enchanted creature can attack as though it had haste.', 'Instill Energy'],
      ['You may have this artifact enter as a copy of any artifact on the battlefield.', 'Sculpting Steel'],
      ['You may have this creature enter as a copy of a creature you control.', 'Mirror Image'],
      ["Morph—Return a Bird you control to its owner's hand.", 'Raven Guild Initiate'],
      ["Morph—Return a Bird you control to its owner’s hand.", 'Raven Guild Initiate'],
      ['If you would draw a card, return a card from your graveyard to your hand instead. If you can’t, you lose the game.', 'Forbidden Crypt'],
      ['While voting, you get an additional vote.', "Brago's Representative"],
      ['Equip {0}. Activate only once each turn.', 'Leather Armor'],
      ['Do You Like Squirrels? — Whenever The Unbeatable Squirrel Girl enters or attacks, create a 1/1 green Squirrel creature token.', 'The Unbeatable Squirrel Girl'],
      ['As long as this enchantment has six or more quest counters on it, if you would draw a card, you may instead search your library for a card, put that card into your hand, then shuffle.', 'Archmage Ascension'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      if (result == null || result.system) continue;
      const perm: any = {
        id: 'census-perm', controller: 'p1', owner: 'p1',
        card: { name, type_line: 'Creature', oracle_text: line },
      };
      let st = false;
      let rp = false;
      try { st = parseStaticEffectSpecsFromOraclePermanent(perm).length > 0; } catch { st = false; }
      try { rp = collectReplacementEffectSpecsFromState({ battlefield: [perm], players: [{ id: 'p1', life: 40 }] }).length > 0; } catch { rp = false; }
      expect(st || rp, `${name}: classify=${JSON.stringify(result)} parse=${st} collect=${rp}`).toBe(true);
    }
  });
});

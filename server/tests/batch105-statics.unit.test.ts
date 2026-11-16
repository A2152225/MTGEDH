// server/tests/batch105-statics.unit.test.ts
// Live-path B105 tests: call hooked functions, not only helpers.
import { describe, expect, it } from 'vitest';
import {
  parseAreEquipmentInAdditionAndHaveQuoted,
  parseOpponentCreaturesAllAttackIfAble,
  parseCreaturesYouControlWithKeywordHaveQuotedActivated,
  parseAsHistoricPermanentYouControlEntersBecomes,
  parseGraveyardCardsHaveFlashbackEqualToManaCost,
  parseWouldConniveInsteadYouDrawThenConnives,
  parseDuringCombatCantCastInstantsOrActivateNonMana,
  parseGetsPTAndKeywordWhenLifeGreaterThanStarting,
  parseAdditionalPTWhenLifeAtLeastNGreaterThanStarting,
  parseHasHasteAndWardAsLongAsCast,
  parseTheMonarchControlsEnchanted,
  parseEnchantedAttacksEachCombatIfAbleAndCantAttackYou,
  parsePowerEqualToGreatestMvAmongNoncreaturePermanentsAndGy,
  parseCantBeBlockedIfTypeEnteredThisTurn,
  parsePowerEqualToPermanentCardsInGyToughnessPlusOne,
  parseAurasAttachedToPermanentsYouControlHaveUmbraArmor,
  parseSubtypeYouControlGetPTForEachOtherAndCantBeBlockedByMono,
  parseCreaturesAttackingYourOpponentsHaveDoubleStrike,
  parseCreaturesLoseAllAbilities,
  parseOpponentsCantCastSpellsWithChosenName,
  parseCantAttackOrBlockUnlessCreatureDiedUnderYourControl,
  parseCreaturesCantBlock,
  parseGyCreatureCardsOfTypesHaveUnearth,
  parseOpponentWhoControlsMoreTypeCantCastOrPlay,
  parseGetsPTForEachColorPermanentOpponentsControlWithThreshold,
} from '../src/state/modules/batch105Parsers.js';
import { parseBatch105LongTailStaticKind } from '../src/state/modules/staticEffectSpec-handlers/batch105LongTailStatics.js';
import { collectBatch105ReplacementSpecsFromState } from '../src/state/modules/replacementBatch105Collect.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec.js';
import { listGrantedActivatedAbilityLines } from '../../shared/src/grantedActivatedAbilityList.js';
import {
  grantedEquipmentOracleText,
  parseGrantedTreasureEquipmentOracle,
  permanentIsEquipmentNow,
  parseEquipAbilitiesForPermanent,
} from '../src/state/modules/batch97GrantedEquipmentAbilities.js';
import { stampLayer4TypeSetting, layer4AddedTypesFor } from '../src/state/modules/layer4TypeSetting.js';
import {
  applyBatch105PowerToughnessAdjustment,
  applyBatch105HistoricPermanentEntersBecomesToCard,
  batch105OpponentSourceForcesAllToAttack,
  batch105CreatureHasHasteFromWasCast,
  batch105GrantedWardCost,
  batch105PermanentHasMenace,
  batch105HasDoubleStrike,
  batch105BlockRestrictionReason,
  batch105CannotCastInstantDuringCombat,
  batch105CannotActivateNonManaDuringCombat,
  batch105MonarchControllerForEnchanted,
  batch105IllegalDefendingPlayerReason,
  batch105AttackRestrictionReason,
  tryBatch105UmbraArmorDestroyReplacement,
  findBatch105UmbraArmorAura,
  batch105CannotCastOrPlayForWardOfBones,
} from '../src/state/modules/batch105Apply.js';
import { permanentMustAttackIfAnotherYouControlAttacks } from '../src/state/modules/batch98CombatAndKeywords.js';
import { creatureHasHaste } from '../src/socket/game-actions-handlers/gameActionsPermanentKeywordGrants.js';
import { getGrantedWardCost } from '../src/state/modules/faceDownWardKeyword.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates.js';
import { getMinimumBlockers } from '../src/socket/combat-handlers/combatMinimumBlockers.js';
import { findOracleCastingLimitViolation } from '../src/state/modules/staticCastingRestrictionsOracleExtras.js';
import { opponentActivationProhibitionReason } from '../src/state/modules/opponentActivationLocks.js';
import { isSpellCastingProhibitedByChosenName } from '../src/state/modules/chosen-name-restrictions.js';
import { getGrantedFlashbackInfo, getGrantedUnearthInfo } from '../src/state/modules/graveyard-permissions.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { syncControlFromRegistry } from '../../rules-engine/src/controlEffectRegistry.js';
import { applyConniveStep } from '../../rules-engine/src/oracleIRExecutorPlayerExploreLifeDrawSteps.js';
import { permanentLosesAllAbilities } from '../../rules-engine/src/permanentKeywordAbilities.js';
import { collectBatch95CounterReplacementSpecsFromState } from '../src/state/modules/replacementBatch95CounterReplacements.js';

const DAN_LEWIS = 'Noncreature, non-Equipment artifacts you control are Equipment in addition to their other types and have "Equipped creature gets +1/+0" and equip {1}.';
const WARS_TOLL = 'If a creature an opponent controls attacks, all creatures that opponent controls attack if able.';
const FRONDLAND = 'Creatures you control with vigilance have "{1}, {T}: Tap target creature."';
const DISPLACED = 'As a historic permanent you control enters, it becomes a 7/7 Dinosaur creature in addition to its other types.';
const RETURN_PAST = 'During your turn, each instant and sorcery card in your graveyard has flashback. Its flashback cost is equal to its mana cost.';
const LEADER = 'If a creature you control would connive, instead you draw a card, then that creature connives.';
const HAND_TO_HAND = "During combat, players can't cast instant spells or activate abilities that aren't mana abilities.";
const ELENDA = 'As long as your life total is greater than your starting life total, Elenda gets +1/+1 and has menace. Elenda gets an additional +5/+5 as long as your life total is at least 10 greater than your starting life total.';
const TARRASQUE = 'The Tarrasque has haste and ward {10} as long as it was cast.';
const FEALTY_MONARCH = 'The monarch controls enchanted creature.';
const FEALTY_ATTACK = "Enchanted creature attacks each combat if able and can't attack you.";
const DRAGON_MAN = "Dragon Man's power is equal to the greatest mana value among noncreature permanents you control and noncreature cards in your graveyard.";
const FUGITIVE = "Fugitive Droid can't be blocked if an artifact entered the battlefield under your control this turn.";
const SOULS = "Souls of the Lost's power is equal to the number of permanent cards in your graveyard and its toughness is equal to that number plus 1.";
const UMBRA = 'Auras attached to permanents you control have umbra armor.';
const NEPHILIM = "Nephilim you control get +1/+1 for each other Nephilim you control and can't be blocked by monocolored creatures.";
const HELLKITE = 'Creatures attacking your opponents have double strike.';
const DRESS_DOWN = 'Creatures lose all abilities.';
const ALHAMMARRET = "Your opponents can't cast spells with the chosen name.";
const BONTU = "Bontu can't attack or block unless a creature died under your control this turn.";
const BEDLAM = "Creatures can't block.";
const SOLEMN = "Each creature card in your graveyard that's a Cleric, Rogue, Warrior, and/or Wizard has unearth {1}{B}.";
const WARD_CREATURE = "Each opponent who controls more creatures than you can't cast creature spells.";
const WARD_LAND = "Each opponent who controls more lands than you can't play lands.";
const NANTUKO = 'Threshold — Nantuko Blightcutter gets +1/+1 for each black permanent your opponents control as long as seven or more cards in your graveyard.';
const LAEZEL = 'If you would put one or more counters on a creature or planeswalker you control or on yourself, put that many plus one of each of those kinds of counters on that permanent or player instead.';

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  const { card, owner, type_line, ...rest } = extra as Record<string, any>;
  return {
    id,
    controller,
    owner: owner || controller,
    card: { id: `${id}-card`, name, oracle_text: oracle, type_line: (type_line as string) || 'Creature', ...(card as object || {}) },
    ...(type_line ? { type_line } : {}),
    ...rest,
  };
}

describe('B105 parsers', () => {
  it('parses the named head and onward oracles', () => {
    expect(parseAreEquipmentInAdditionAndHaveQuoted(DAN_LEWIS)?.type).toBe('artifact');
    expect(parseAreEquipmentInAdditionAndHaveQuoted(DAN_LEWIS)?.excludedTypeWords).toEqual(expect.arrayContaining(['creature', 'equipment']));
    expect(parseAreEquipmentInAdditionAndHaveQuoted(DAN_LEWIS)?.fragment).toMatch(/equip \{1\}/i);
    expect(parseOpponentCreaturesAllAttackIfAble(WARS_TOLL)).toBe(true);
    expect(parseCreaturesYouControlWithKeywordHaveQuotedActivated(FRONDLAND)).toEqual({
      keyword: 'vigilance',
      ability: '{1}, {T}: Tap target creature.',
    });
    expect(parseAsHistoricPermanentYouControlEntersBecomes(DISPLACED)).toEqual({
      power: 7, toughness: 7, types: ['Creature', 'Dinosaur'],
    });
    expect(parseGraveyardCardsHaveFlashbackEqualToManaCost(RETURN_PAST)?.duringYourTurn).toBe(true);
    expect(parseWouldConniveInsteadYouDrawThenConnives(LEADER)).toBe(true);
    expect(parseDuringCombatCantCastInstantsOrActivateNonMana(HAND_TO_HAND)).toBe(true);
    expect(parseGetsPTAndKeywordWhenLifeGreaterThanStarting(ELENDA)?.keyword).toBe('menace');
    expect(parseAdditionalPTWhenLifeAtLeastNGreaterThanStarting(ELENDA)?.atLeast).toBe(10);
    expect(parseHasHasteAndWardAsLongAsCast(TARRASQUE)?.wardCost).toBe('{10}');
    expect(parseTheMonarchControlsEnchanted(FEALTY_MONARCH)).toBe(true);
    expect(parseEnchantedAttacksEachCombatIfAbleAndCantAttackYou(FEALTY_ATTACK)).toBe(true);
    expect(parsePowerEqualToGreatestMvAmongNoncreaturePermanentsAndGy(DRAGON_MAN)).toBe(true);
    expect(parseCantBeBlockedIfTypeEnteredThisTurn(FUGITIVE)?.type).toBe('artifact');
    expect(parsePowerEqualToPermanentCardsInGyToughnessPlusOne(SOULS)).toBe(true);
    expect(parseAurasAttachedToPermanentsYouControlHaveUmbraArmor(UMBRA)).toBe(true);
    expect(parseSubtypeYouControlGetPTForEachOtherAndCantBeBlockedByMono(NEPHILIM)?.subtype).toBe('nephilim');
    expect(parseCreaturesAttackingYourOpponentsHaveDoubleStrike(HELLKITE)).toBe(true);
    expect(parseCreaturesLoseAllAbilities(DRESS_DOWN)).toBe(true);
    expect(parseOpponentsCantCastSpellsWithChosenName(ALHAMMARRET)).toBe(true);
    expect(parseCantAttackOrBlockUnlessCreatureDiedUnderYourControl(BONTU)).toBe(true);
    expect(parseCreaturesCantBlock(BEDLAM)).toBe(true);
    expect(parseGyCreatureCardsOfTypesHaveUnearth(SOLEMN)?.cost).toMatch(/\{1\}\{B\}/);
    expect(parseOpponentWhoControlsMoreTypeCantCastOrPlay(`${WARD_CREATURE} ${WARD_LAND}`).map((r) => r.type)).toEqual(expect.arrayContaining(['creature', 'land']));
    expect(parseGetsPTForEachColorPermanentOpponentsControlWithThreshold(NANTUKO)?.color).toBe('black');
    expect(parseBatch105LongTailStaticKind(DAN_LEWIS).length).toBeGreaterThan(0);
  });
});

describe('B105 live parse and collect hooks', () => {
  it('emits static specs for the named head and collects Leader', () => {
    const dan = perm('dan', 'p1', 'Dan Lewis', DAN_LEWIS, { type_line: 'Legendary Artifact Creature — Human' });
    const specs = parseStaticEffectSpecsFromOraclePermanent(dan, { battlefield: [dan] } as any);
    expect(specs.some((s: any) => String(s?.id || s?.effectId || s?.kind || '').includes('equipment') || String(s?.grant?.typeAdditions || '').toLowerCase().includes('equipment') || JSON.stringify(s).toLowerCase().includes('equipment'))).toBe(true);

    const leader = perm('lead', 'p1', 'Leader, Super-Genius', LEADER);
    const collected = collectBatch105ReplacementSpecsFromState({ battlefield: [leader] });
    expect(collected.some((s) => s.effectId === 'would-connive-instead-you-draw-then-connives')).toBe(true);
    const live = collectReplacementEffectSpecsFromState({ battlefield: [leader] });
    expect(live.some((s) => s.effectId === 'would-connive-instead-you-draw-then-connives')).toBe(true);
  });
});

describe('B105 Dan Lewis, Frondland, War\'s Toll, and Displaced Dinosaurs', () => {
  it('stamps Equipment, grants equip text, and parses the granted equip ability', () => {
    const dan = perm('dan', 'p1', 'Dan Lewis', DAN_LEWIS, { type_line: 'Legendary Artifact Creature — Human' });
    const rock = perm('rock', 'p1', 'Sol Ring', '', { type_line: 'Artifact' });
    const sword = perm('sword', 'p1', 'Sword', '', { type_line: 'Artifact — Equipment' });
    const creatureArt = perm('goof', 'p1', 'Creature Artifact', '', { type_line: 'Artifact Creature — Golem' });
    const state: any = { battlefield: [dan, rock, sword, creatureArt] };
    expect(grantedEquipmentOracleText(rock, state)).toMatch(/Equipped creature gets \+1\/\+0/i);
    expect(grantedEquipmentOracleText(rock, state)).toMatch(/equip \{1\}/i);
    expect(grantedEquipmentOracleText(sword, state)).toBe('');
    expect(grantedEquipmentOracleText(creatureArt, state)).toBe('');
    stampLayer4TypeSetting(state);
    expect(layer4AddedTypesFor(rock, state).map((t) => t.toLowerCase())).toContain('equipment');
    expect(permanentIsEquipmentNow(rock, state)).toBe(true);
    expect(permanentIsEquipmentNow(creatureArt, state)).toBe(false);
    const equips = parseEquipAbilitiesForPermanent(rock, state);
    expect(JSON.stringify(equips)).toMatch(/1/);
  });

  it('grants the vigilance-qualified activated ability through the existing path', () => {
    const cat = perm('cat', 'p1', 'Frondland Felidar', `Vigilance\n${FRONDLAND}`, { type_line: 'Creature — Cat Beast', card: { keywords: ['Vigilance'], oracle_text: `Vigilance\n${FRONDLAND}`, type_line: 'Creature — Cat Beast' } });
    const vigil = perm('v', 'p1', 'Vigilant Bear', 'Vigilance', { type_line: 'Creature — Bear', card: { keywords: ['Vigilance'], oracle_text: 'Vigilance', type_line: 'Creature — Bear' } });
    const sleepy = perm('s', 'p1', 'Grizzly Bears', '', { type_line: 'Creature — Bear' });
    const state: any = { battlefield: [cat, vigil, sleepy] };
    const grants = getContinuousGrantedAbilitiesForPermanent(vigil, state);
    const lines = listGrantedActivatedAbilityLines(grants);
    expect(lines.some((l) => /tap target creature/i.test(l) && /\{1\}/.test(l) && /\{T\}/.test(l))).toBe(true);
    const sleepyLines = listGrantedActivatedAbilityLines(getContinuousGrantedAbilitiesForPermanent(sleepy, state));
    expect(sleepyLines.some((l) => /tap target creature/i.test(l))).toBe(false);
  });

  it('forces the rest of that opponent\'s creatures to attack', () => {
    const toll = perm('toll', 'p1', "War's Toll", WARS_TOLL, { type_line: 'Enchantment' });
    const a = perm('a', 'p2', 'Bear A', '', { type_line: 'Creature — Bear', attacking: true });
    const b = perm('b', 'p2', 'Bear B', '', { type_line: 'Creature — Bear' });
    const battlefield = [toll, a, b];
    expect(batch105OpponentSourceForcesAllToAttack(b, battlefield)).toBe(true);
    expect(permanentMustAttackIfAnotherYouControlAttacks(b, battlefield)).toBe(true);
    expect(permanentMustAttackIfAnotherYouControlAttacks(b)).toBe(false);
  });

  it('turns a historic permanent you control into a 7/7 Dinosaur creature as it enters', () => {
    const dino = perm('dd', 'p1', 'Displaced Dinosaurs', DISPLACED, { type_line: 'Creature — Dinosaur' });
    const state: any = { battlefield: [dino] };
    const ring = { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' };
    const entered = applyBatch105HistoricPermanentEntersBecomesToCard(ring, 'p1', state);
    expect(String(entered.type_line)).toMatch(/creature/i);
    expect(String(entered.type_line)).toMatch(/dinosaur/i);
    expect(String(entered.power)).toBe('7');
    expect(String(entered.toughness)).toBe('7');
  });
});

describe('B105 Return the Past, Leader, Hand to Hand, Elenda, Tarrasque, Fealty', () => {
  it('grants flashback equal to mana cost during your turn', () => {
    const enchant = perm('rtp', 'p1', 'Return the Past', RETURN_PAST, { type_line: 'Enchantment' });
    const state: any = {
      battlefield: [enchant],
      activePlayer: 'p1',
      turnPlayer: 'p1',
      currentPlayer: 'p1',
      players: [{ id: 'p1' }, { id: 'p2' }],
    };
    const card = { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', mana_cost: '{R}', oracle_text: '', zone: 'graveyard', owner: 'p1' };
    const info = getGrantedFlashbackInfo({ state } as any, 'p1' as any, card);
    expect(info.hasIt).toBe(true);
    expect(String((info as any).cost || '')).toMatch(/\{R\}/);
  });

  it('draws an extra card before the creature connives', () => {
    const leader = perm('lead', 'p1', 'Leader, Super-Genius', LEADER, { type_line: 'Creature — Goblin' });
    const guy = perm('guy', 'p1', 'Conniver', '', { type_line: 'Creature — Human' });
    const cards = [
      { id: 'c1', name: 'A', type_line: 'Instant' },
      { id: 'c2', name: 'B', type_line: 'Instant' },
      { id: 'c3', name: 'C', type_line: 'Instant' },
    ];
    const state: any = {
      battlefield: [leader, guy],
      players: [{ id: 'p1', hand: [], library: cards, graveyard: [] }, { id: 'p2', hand: [], library: [], graveyard: [] }],
    };
    const result = applyConniveStep(
      state,
      { kind: 'connive', target: { kind: 'raw', text: 'this creature' }, amount: { kind: 'number', value: 1 }, raw: 'connive' } as any,
      { controllerId: 'p1', targetPermanentId: 'guy', sourcePermanentId: 'guy' } as any,
    );
    const hand = (result.state as any)?.players?.find((p: any) => p.id === 'p1')?.hand || [];
    expect(hand.length).toBe(2);
    expect(result.reason === 'player_choice_required' || result.applied === true).toBe(true);
  });

  it('locks instant casts and non-mana activations during combat', () => {
    const lock = perm('hth', 'p1', 'Hand to Hand', HAND_TO_HAND, { type_line: 'Enchantment' });
    const state: any = { battlefield: [lock], phase: 'combat', step: 'declare_attackers' };
    const instant = { name: 'Lightning Bolt', type_line: 'Instant' };
    expect(batch105CannotCastInstantDuringCombat(state, instant)).toBeTruthy();
    expect(findOracleCastingLimitViolation(state, 'p2', instant).prohibited).toBe(true);
    expect(batch105CannotActivateNonManaDuringCombat(state, false)).toBeTruthy();
    expect(batch105CannotActivateNonManaDuringCombat(state, true)).toBeNull();
    const reason = opponentActivationProhibitionReason(state, 'p2', perm('bear', 'p2', 'Bear', '', { type_line: 'Creature — Bear' }), false);
    expect(reason).toBeTruthy();
  });

  it('pumps Elenda and grants menace when life is above starting', () => {
    const elenda = perm('el', 'p1', 'Elenda, Saint of Dusk', ELENDA, {
      type_line: 'Legendary Creature — Vampire Knight',
      card: { power: '4', toughness: '4', oracle_text: ELENDA, type_line: 'Legendary Creature — Vampire Knight' },
    });
    const low: any = { battlefield: [elenda], life: { p1: 40 }, startingLife: 40 };
    expect(applyBatch105PowerToughnessAdjustment(elenda, low, 4, 4)).toEqual({ power: 4, toughness: 4 });
    const mid: any = { battlefield: [elenda], life: { p1: 41 }, startingLife: 40 };
    expect(applyBatch105PowerToughnessAdjustment(elenda, mid, 4, 4)).toEqual({ power: 5, toughness: 5 });
    expect(batch105PermanentHasMenace(elenda, mid)).toBe(true);
    expect(getMinimumBlockers(elenda, mid.battlefield, mid)).toBeGreaterThanOrEqual(2);
    const high: any = { battlefield: [elenda], life: { p1: 50 }, startingLife: 40 };
    const live = getCurrentPowerToughness(elenda, high);
    expect(live?.power).toBe(10);
    expect(live?.toughness).toBe(10);
  });

  it('grants haste and ward {10} when The Tarrasque was cast', () => {
    const tarr = perm('tar', 'p1', 'The Tarrasque', TARRASQUE, {
      type_line: 'Legendary Creature — Dinosaur',
      wasCast: true,
      enteredFromCast: true,
    });
    const battlefield = [tarr];
    expect(batch105CreatureHasHasteFromWasCast(tarr)).toBe(true);
    expect(creatureHasHaste(tarr, battlefield, 'p1')).toBe(true);
    expect(batch105GrantedWardCost(tarr)).toBe('{10}');
    expect(getGrantedWardCost(tarr)).toBe('{10}');
    const cheat = perm('tar2', 'p1', 'The Tarrasque', TARRASQUE, { type_line: 'Legendary Creature — Dinosaur' });
    expect(creatureHasHaste(cheat, [cheat], 'p1')).toBe(false);
    expect(getGrantedWardCost(cheat)).toBeNull();
  });

  it('gives the monarch control and blocks attacking the Aura\'s controller', () => {
    const host = perm('host', 'p2', 'Bear', '', { type_line: 'Creature — Bear', controlBase: 'p2' });
    const aura = perm('fealty', 'p1', 'Fealty to the Realm', `${FEALTY_MONARCH}\n${FEALTY_ATTACK}`, {
      type_line: 'Enchantment — Aura',
      attachedTo: 'host',
    });
    const state: any = { battlefield: [host, aura], monarch: 'p3', players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] };
    expect(batch105MonarchControllerForEnchanted(aura, state)).toBe('p3');
    syncControlFromRegistry(state);
    const after = state.battlefield.find((p: any) => p.id === 'host');
    expect(String(after.controller)).toBe('p3');
    const grants = getContinuousGrantedAbilitiesForPermanent(host, state);
    expect(grants.some((a: string) => /attacks each combat if able/i.test(a))).toBe(true);
    expect(batch105IllegalDefendingPlayerReason(host, 'p1', state.battlefield)).toBeTruthy();
    expect(batch105IllegalDefendingPlayerReason(host, 'p2', state.battlefield)).toBeNull();
  });
});

describe('B105 onward live hooks', () => {
  it('computes Dragon Man and Souls of the Lost CDAs', () => {
    const man = perm('dm', 'p1', 'Dragon Man, Reformed Robot', DRAGON_MAN, {
      type_line: 'Legendary Artifact Creature — Robot',
      card: { power: '*', toughness: '4', oracle_text: DRAGON_MAN, type_line: 'Legendary Artifact Creature — Robot' },
    });
    const rock = perm('sr', 'p1', 'Sol Ring', '', { type_line: 'Artifact', card: { type_line: 'Artifact', cmc: 1, mana_value: 1 } });
    const state: any = {
      battlefield: [man, rock],
      zones: { p1: { graveyard: [{ name: 'Wrath of God', type_line: 'Sorcery', cmc: 4, mana_value: 4 }] } },
    };
    const manCard = { ...man.card, controller: 'p1', name: 'Dragon Man, Reformed Robot' };
    const pt = calculateVariablePT(manCard, state);
    expect(pt?.power).toBe(4);

    const souls = perm('sol', 'p1', 'Souls of the Lost', SOULS, {
      type_line: 'Creature — Spirit',
      card: { power: '*', toughness: '*', oracle_text: SOULS, type_line: 'Creature — Spirit', controller: 'p1', name: 'Souls of the Lost' },
    });
    const soulsState: any = {
      battlefield: [souls],
      zones: { p1: { graveyard: [
        { type_line: 'Creature — Elf' },
        { type_line: 'Land' },
        { type_line: 'Instant' },
      ] } },
    };
    const spt = calculateVariablePT(souls.card, soulsState);
    expect(spt).toEqual({ power: 2, toughness: 3 });
  });

  it('applies Fugitive, Nephilim, Bedlam, Bontu, and Dress Down combat hooks', () => {
    const droid = perm('fd', 'p1', 'Fugitive Droid', FUGITIVE, { type_line: 'Artifact Creature — Droid' });
    const art = perm('art', 'p1', 'Sol Ring', '', { type_line: 'Artifact', enteredThisTurn: true });
    const blocker = perm('blk', 'p2', 'Bear', '', { type_line: 'Creature — Bear', card: { colors: ['g'], type_line: 'Creature — Bear' } });
    const droidState: any = { battlefield: [droid, art] };
    expect(batch105BlockRestrictionReason(blocker, droid, droidState.battlefield, 'p2', droidState)).toBeTruthy();
    expect(canBlockAttacker(blocker, droid, droidState.battlefield, 'p2', droidState).canBlock).toBe(false);

    const n1 = perm('n1', 'p1', 'Nephilim A', NEPHILIM, { type_line: 'Creature — Nephilim' });
    const n2 = perm('n2', 'p1', 'Nephilim B', '', { type_line: 'Creature — Nephilim' });
    const neoState: any = { battlefield: [n1, n2] };
    expect(applyBatch105PowerToughnessAdjustment(n1, neoState, 3, 3)).toEqual({ power: 4, toughness: 4 });
    expect(canBlockAttacker(blocker, n1, neoState.battlefield, 'p2', neoState).canBlock).toBe(false);

    const bedlam = perm('bed', 'p1', 'Bedlam', BEDLAM, { type_line: 'Enchantment' });
    const bedState: any = { battlefield: [bedlam, blocker, n1] };
    expect(canBlockAttacker(blocker, n1, bedState.battlefield, 'p2', bedState).canBlock).toBe(false);

    const bontu = perm('bon', 'p1', 'Bontu the Glorified', BONTU, { type_line: 'Legendary Creature — God' });
    const bonState: any = { battlefield: [bontu], creaturesDiedThisTurnByController: {} };
    expect(batch105AttackRestrictionReason(bontu, 'p2', bonState)).toBeTruthy();
    bonState.creaturesDiedThisTurnByController = { p1: 1 };
    expect(batch105AttackRestrictionReason(bontu, 'p2', bonState)).toBeNull();

    const dress = perm('dd', 'p1', 'Dress Down', DRESS_DOWN, { type_line: 'Enchantment' });
    const bear = perm('bear', 'p1', 'Serra Angel', 'Flying, vigilance', { type_line: 'Creature — Angel' });
    expect(permanentLosesAllAbilities(bear, [dress, bear])).toBe(true);
  });

  it('grants umbra armor, Hellkite double strike, chosen-name lock, unearth, Ward of Bones, and Lae\'zel', () => {
    const mystic = perm('um', 'p1', 'Umbra Mystic', UMBRA, { type_line: 'Creature — Human Wizard' });
    const host = perm('host', 'p1', 'Bear', '', { type_line: 'Creature — Bear' });
    const aura = perm('aura', 'p1', 'Pacifism', 'Enchant creature', { type_line: 'Enchantment — Aura', attachedTo: 'host' });
    const umbraState: any = { battlefield: [mystic, host, aura] };
    expect(findBatch105UmbraArmorAura(umbraState.battlefield, host)?.id).toBe('aura');
    let sacrificed = '';
    expect(tryBatch105UmbraArmorDestroyReplacement(umbraState, 'host', (id) => { sacrificed = id; })).toBe(true);
    expect(sacrificed).toBe('aura');
    expect(host.damage).toBe(0);

    const hell = perm('bh', 'p1', 'Blast-Furnace Hellkite', HELLKITE, { type_line: 'Creature — Dragon' });
    const attacker = perm('atk', 'p1', 'Bear', '', { type_line: 'Creature — Bear', attacking: true, attackingPlayerId: 'p2' });
    expect(batch105HasDoubleStrike(attacker, [hell, attacker])).toBe(true);

    const arbiter = perm('al', 'p1', 'Alhammarret, High Arbiter', ALHAMMARRET, { type_line: 'Legendary Creature — Sphinx', chosenCardName: 'Lightning Bolt' });
    const nameState: any = { battlefield: [arbiter] };
    expect(isSpellCastingProhibitedByChosenName(nameState, 'p2' as any, 'Lightning Bolt').prohibited).toBe(true);
    expect(isSpellCastingProhibitedByChosenName(nameState, 'p1' as any, 'Lightning Bolt').prohibited).toBe(false);

    const guide = perm('sd', 'p1', 'Solemn Doomguide', SOLEMN, { type_line: 'Creature — Spirit' });
    const unearthState: any = { battlefield: [guide], activePlayer: 'p1', turnPlayer: 'p1' };
    const cleric = { id: 'cl', name: 'Priest', type_line: 'Creature — Cleric', oracle_text: '', zone: 'graveyard', owner: 'p1' };
    const info = getGrantedUnearthInfo({ state: unearthState } as any, 'p1' as any, cleric);
    expect(info.hasIt).toBe(true);
    expect(String((info as any).cost || '')).toMatch(/\{1\}\{B\}/);

    const ward = perm('wob', 'p1', 'Ward of Bones', `${WARD_CREATURE}\n${WARD_LAND}`, { type_line: 'Artifact' });
    const oppC1 = perm('c1', 'p2', 'Bear', '', { type_line: 'Creature — Bear' });
    const oppC2 = perm('c2', 'p2', 'Bear 2', '', { type_line: 'Creature — Bear' });
    const youC = perm('yc', 'p1', 'Bear 3', '', { type_line: 'Creature — Bear' });
    const wardState: any = { battlefield: [ward, oppC1, oppC2, youC] };
    expect(batch105CannotCastOrPlayForWardOfBones(wardState, 'p2', { type_line: 'Creature — Elf' }, 'cast')).toBeTruthy();
    expect(findOracleCastingLimitViolation(wardState, 'p2', { name: 'Grizzly Bears', type_line: 'Creature — Bear' }).prohibited).toBe(true);

    const lae = perm('lz', 'p1', "Lae'zel, Vlaakith's Champion", LAEZEL, { type_line: 'Legendary Creature — Gith Warrior' });
    const laeSpecs = collectBatch95CounterReplacementSpecsFromState({ battlefield: [lae] });
    expect(laeSpecs.some((s: any) => String(s.effectId || '').includes('counters-plus') || String(s.reason || '').includes('plus'))).toBe(true);
  });
});

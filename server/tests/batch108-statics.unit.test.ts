import { describe, expect, it } from 'vitest';
import {
  parseActivatedAbilitiesOfTheChosenPermanentCantBeActivated,
  parseAllBasicLandTypeAreNNColorCreaturesStillLands,
  parseAllCreaturesWithFlyingAbleToBlockThisDoSo,
  parseAsLongAsThisIsACreatureItHasProwess,
  parseCanOnlyAttackAlone,
  parseCantAttackOrBlockUnlessNPlusCounters,
  parseCantBeBlockedExceptByLegendaryCreatures,
  parseCreatureCombatDamageToThisPreventAndPlusCounter,
  parseCreaturesYouControlWithPowerOrToughnessNOrLessCantBeBlocked,
  parseDuringYourTurnCreaturesAndPlaneswalkersYouControlHaveLifelink,
  parseEachTypalCreatureCardInYourGraveyardHasUnearth,
  parseEnchantedCantBeBlockedAsLongAsAttackingAlone,
  parseForestsAndSaprolingsAreNNColorSaprolingCreaturesAndForestLands,
  parseGetsPTAsLongAsNCreaturesAreBlockingIt,
  parseGetsPTAsLongAsTopLibraryCardIsCreature,
  parseHasDoubleStrikeAsLongAsNEquipmentAttached,
  parseIfThisWouldDiePutOnLibrary,
  parseTypalCreaturesAttackEachCombatIfAble,
} from '../src/state/modules/batch108Parsers.js';
import { parseBatch108LongTailStaticKind } from '../src/state/modules/staticEffectSpec-handlers/batch108LongTailStatics.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import {
  collectBatch108DamagePreventionSpecsFromState,
  collectBatch108ReplacementSpecs,
  collectBatch108ZoneChangeReplacementSpecsFromState,
} from '../src/state/modules/replacementBatch108Collect.js';
import {
  addExperienceCounters,
  applyBatch108DamagePrevention,
  applyBatch108PowerToughnessAdjustment,
  applyCardToLibraryTop,
  attackerMustBeBlockedByFlyingIfAble,
  batch108AdditionalTypes,
  batch108AttackRestrictionReason,
  batch108CanOnlyAttackAloneReason,
  batch108CannotBlockReason,
  batch108CreatureMustAttackIfAble,
  batch108PermanentHasKeyword,
  getBatch108BlockRestrictionReason,
  isAbilityActivationProhibitedByBatch108ChosenPermanent,
  readBatch108ColorSetting,
} from '../src/state/modules/batch108Apply.js';
import { applyBatch107PlayerCounterPlusOne, getBatch107BushidoValue } from '../src/state/modules/batch107Apply.js';
import { detectKeywords } from '../src/state/modules/keyword-detection.js';
import { handleBushido } from '../src/state/modules/keyword-trigger-handlers/keywordTriggerAttackHandlers.js';
import { getGrantedUnearthInfo } from '../src/state/modules/graveyard-permissions.js';
import { resolvePlayerCounterGainFromHook } from '../../rules-engine/src/playerCounterGainHook.js';
import { layer4AddedTypesFor, layer4BasePowerToughnessFor } from '../src/state/modules/layer4TypeSetting.js';

const FUMIKO = 'Bushido X, where X is the number of attacking creatures.';
const WINDING = "If one or more counters would be put on an artifact or creature you control, that many plus one of each of those kinds of counters are put on that permanent instead.\nIf you would get one or more counters, you get that many plus one of each of those kinds of counters instead.";
const CYCLOPS = 'This creature gets -2/-0 as long as two or more creatures are blocking it.';
const TETSUKO = 'Creatures you control with power or toughness 1 or less can\'t be blocked.';
const IRONSCALE = 'If a creature would deal combat damage to this creature, prevent that damage and put a +1/+1 counter on this creature.';
const FENCE = 'Activated abilities of the chosen permanent can\'t be activated.';
const SPACE = 'Space sculptor (Whenever a creature you control enters or a creature you own returns to the battlefield, you may put a sector counter on it. At the beginning of your end step, remove all sector counters from permanents you control.)';
const SORIN = 'During your turn, creatures and planeswalkers you control have lifelink.';
const GRAVEBANE = 'If this creature would die, put it on top of its owner\'s library instead.';
const NISSA = 'If this creature would die, put it on the bottom of its owner\'s library instead.';
const LIMB = 'All Forests and all Saprolings are 1/1 green Saproling creatures and Forest lands in addition to their other types.';
const BALROG = 'The Balrog can\'t be blocked except by legendary creatures.';
const ASSAULT = 'Goblin creatures attack each combat if able.';
const BALAN = 'Balan has double strike as long as two or more Equipment are attached to it.';
const MASTER = 'This creature can only attack alone.';
const DREGSCAPE = 'Each Sliver creature card in your graveyard has unearth {2}.';
const KORMUS = 'All Swamps are 1/1 black creatures that are still lands.';
const GUTTER = 'Enchanted creature can\'t be blocked as long as it\'s attacking alone.';
const TALRUUM = 'All creatures with flying able to block this creature do so.';
const MULDAYA = 'This creature gets +3/+3 as long as the top card of your library is a creature card.';
const SLUMBER = 'This creature can\'t attack or block unless it has five or more +1/+1 counters on it.';
const TRITON = 'As long as this Vehicle is a creature, it has prowess.';

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    card: {
      id: `${id}-card`,
      name,
      oracle_text: oracle,
      type_line: String(extra.type_line || 'Creature'),
      power: extra.power ?? 2,
      toughness: extra.toughness ?? 2,
      colors: extra.colors,
    },
    power: extra.power ?? 2,
    toughness: extra.toughness ?? 2,
    ...extra,
  };
}

function stateWith(battlefield: any[], extra: Record<string, unknown> = {}) {
  return {
    battlefield,
    zones: extra.zones || {},
    activePlayer: extra.activePlayer || 'p1',
    turnPlayer: extra.turnPlayer || extra.activePlayer || 'p1',
    players: extra.players || [{ id: 'p1' }, { id: 'p2' }],
    ...extra,
  };
}

function censusPerm(name: string, line: string, typeLine = 'Creature') {
  return {
    id: 'census-perm',
    controller: 'p1',
    owner: 'p1',
    card: { id: 'census-card', name, type_line: typeLine, oracle_text: line, power: '2', toughness: '2' },
  };
}

describe('B108 parsers and long-tail specs', () => {
  it('parses the named engine-tail wordings and rejects Space Beleren', () => {
    expect(parseGetsPTAsLongAsNCreaturesAreBlockingIt(CYCLOPS)).toEqual({ min: 2, power: -2, toughness: -0 });
    expect(parseCreaturesYouControlWithPowerOrToughnessNOrLessCantBeBlocked(TETSUKO)).toBe(1);
    expect(parseCreatureCombatDamageToThisPreventAndPlusCounter(IRONSCALE)?.counter).toBe('+1/+1');
    expect(parseActivatedAbilitiesOfTheChosenPermanentCantBeActivated(FENCE)).toBe(true);
    expect(parseDuringYourTurnCreaturesAndPlaneswalkersYouControlHaveLifelink(SORIN)).toBe(true);
    expect(parseIfThisWouldDiePutOnLibrary(GRAVEBANE)).toBe('top');
    expect(parseIfThisWouldDiePutOnLibrary(NISSA)).toBe('bottom');
    expect(parseForestsAndSaprolingsAreNNColorSaprolingCreaturesAndForestLands(LIMB)?.color).toBe('green');
    expect(parseCantBeBlockedExceptByLegendaryCreatures(BALROG)).toBe(true);
    expect(parseTypalCreaturesAttackEachCombatIfAble(ASSAULT)).toBe('Goblin');
    expect(parseHasDoubleStrikeAsLongAsNEquipmentAttached(BALAN)).toBe(2);
    expect(parseCanOnlyAttackAlone(MASTER)).toBe(true);
    expect(parseEachTypalCreatureCardInYourGraveyardHasUnearth(DREGSCAPE)).toEqual({ typal: 'Sliver', cost: '{2}' });
    expect(parseAllBasicLandTypeAreNNColorCreaturesStillLands(KORMUS)?.color).toBe('black');
    expect(parseEnchantedCantBeBlockedAsLongAsAttackingAlone(GUTTER)).toBe(true);
    expect(parseAllCreaturesWithFlyingAbleToBlockThisDoSo(TALRUUM)).toBe(true);
    expect(parseGetsPTAsLongAsTopLibraryCardIsCreature(MULDAYA)).toEqual({ power: 3, toughness: 3 });
    expect(parseCantAttackOrBlockUnlessNPlusCounters(SLUMBER)?.min).toBe(5);
    expect(parseAsLongAsThisIsACreatureItHasProwess(TRITON)).toBe(true);
    expect(parseBatch108LongTailStaticKind(SPACE)).toBeNull();
    expect(parseBatch108LongTailStaticKind(TETSUKO)).toBe('pt_cap_cant_be_blocked');
  });

  it('emits static or replacement specs for census lines and not for Space Beleren', () => {
    expect(parseStaticEffectSpecsFromOraclePermanent(censusPerm('Tetsuko Umezawa, Fugitive', TETSUKO) as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(censusPerm('Sorin, Vengeful Bloodlord', SORIN, 'Legendary Planeswalker — Sorin') as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(censusPerm('Life and Limb', LIMB, 'Enchantment') as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(censusPerm('The Balrog, Durin\'s Bane', BALROG) as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(censusPerm('Goblin Assault', ASSAULT, 'Enchantment') as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(censusPerm('Balan, Wandering Knight', BALAN) as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(censusPerm('Master of Cruelties', MASTER) as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(censusPerm('Dregscape Sliver', DREGSCAPE) as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(censusPerm('Scheming Fence', FENCE) as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(censusPerm('Space Beleren', SPACE, 'Legendary Planeswalker — Jace') as any).length).toBe(0);
    const grave = collectBatch108ReplacementSpecs(GRAVEBANE, { sourcePermanentId: 'g', sourceController: 'p1', sourceName: 'Gravebane Zombie' });
    expect(grave.some((s) => s.effectId === 'die-to-library-top')).toBe(true);
    const nissa = collectBatch108ReplacementSpecs(NISSA, { sourcePermanentId: 'n', sourceController: 'p1', sourceName: "Nissa's Chosen" });
    expect(nissa.some((s) => s.effectId === 'die-to-library-bottom')).toBe(true);
    const iron = collectBatch108ReplacementSpecs(IRONSCALE, { sourcePermanentId: 'i', sourceController: 'p1', sourceName: 'Ironscale Hydra' });
    expect(iron.some((s) => s.effectId === 'creature-combat-damage-prevent-plus-counter')).toBe(true);
  });
});

describe('B108 residuals and live hooks', () => {
  it('splices bushido X so Fumiko equals the attacking-creature count', () => {
    const detected = detectKeywords(FUMIKO, 'Fumiko the Bloodsword');
    const bushido = detected.keywords.find((k) => k.keyword === 'bushido');
    expect(bushido).toBeTruthy();
    const a1 = perm('a1', 'p1', 'Bear', '', { type_line: 'Creature — Bear', attacking: true });
    const a2 = perm('a2', 'p1', 'Wolf', '', { type_line: 'Creature — Wolf', attacking: true });
    const fumiko = perm('fu', 'p1', 'Fumiko the Bloodsword', FUMIKO, { type_line: 'Legendary Creature — Human Samurai' });
    const state = stateWith([fumiko, a1, a2], { attackingCreatures: [a1, a2] });
    expect(getBatch107BushidoValue(fumiko, state)).toBe(2);
    const result = handleBushido({
      permanent: fumiko,
      state,
      battlefield: state.battlefield,
      attackingCreatures: [a1, a2],
      controller: 'p1',
    } as any, bushido as any);
    expect(result.ptModification).toEqual({ power: 2, toughness: 2, duration: 'end_of_turn' });
    expect(String(result.chatMessage || '')).toMatch(/Bushido 2/);
  });

  it('writes experience through the plus-one hook when Winding is out', () => {
    const winding = perm('w', 'p1', 'Winding Constrictor', WINDING, { type_line: 'Creature — Snake' });
    const state = stateWith([winding], { experience: {} });
    expect(applyBatch107PlayerCounterPlusOne(state, 'p1', 1)).toBe(2);
    expect(addExperienceCounters(state, 'p1', 1)).toBe(2);
    expect(state.experience.p1).toBe(2);
    expect(resolvePlayerCounterGainFromHook(state, 'p1', 'experience', 1)).toBe(2);
    expect(resolvePlayerCounterGainFromHook(state, 'p2', 'experience', 1)).toBe(1);
  });

  it('applies Rampaging Cyclops, Mul Daya, Tetsuko, Balrog, and Gutter block/PT hooks', () => {
    const cyclops = perm('cy', 'p1', 'Rampaging Cyclops', CYCLOPS, { power: 4, toughness: 4, blockedBy: ['b1', 'b2'] });
    const b1 = perm('b1', 'p2', 'Bear', '', { blocking: ['cy'] });
    const b2 = perm('b2', 'p2', 'Wolf', '', { blocking: ['cy'] });
    const cState = stateWith([cyclops, b1, b2]);
    expect(applyBatch108PowerToughnessAdjustment(cyclops, cState, 4, 4)).toEqual({ power: 2, toughness: 4 });

    const mul = perm('md', 'p1', 'Mul Daya Channelers', MULDAYA, { power: 2, toughness: 2 });
    const land = { id: 'top-land', type_line: 'Land — Forest' };
    const creature = { id: 'top-cr', type_line: 'Creature — Elf' };
    expect(applyBatch108PowerToughnessAdjustment(mul, stateWith([mul], { zones: { p1: { library: [land] } } }), 2, 2)).toEqual({ power: 2, toughness: 2 });
    expect(applyBatch108PowerToughnessAdjustment(mul, stateWith([mul], { zones: { p1: { library: [creature] } } }), 2, 2)).toEqual({ power: 5, toughness: 5 });

    const tetsuko = perm('te', 'p1', 'Tetsuko Umezawa, Fugitive', TETSUKO, { type_line: 'Legendary Creature — Human Rogue' });
    const weak = perm('wk', 'p1', '1/1', '', { type_line: 'Creature — Human', power: 1, toughness: 1 });
    const fat = perm('ft', 'p1', '3/3', '', { type_line: 'Creature — Beast', power: 3, toughness: 3 });
    const blocker = perm('bl', 'p2', 'Wall', '', { type_line: 'Creature — Wall' });
    const tState = stateWith([tetsuko, weak, fat, blocker]);
    expect(getBatch108BlockRestrictionReason(weak, blocker, tState.battlefield, 'p2', tState)).toBeTruthy();
    expect(getBatch108BlockRestrictionReason(fat, blocker, tState.battlefield, 'p2', tState)).toBeNull();

    const balrog = perm('ba', 'p1', "The Balrog, Durin's Bane", BALROG, { type_line: 'Legendary Creature — Balrog' });
    const grunt = perm('gr', 'p2', 'Bear', '', { type_line: 'Creature — Bear' });
    const legend = perm('lg', 'p2', 'King', '', { type_line: 'Legendary Creature — Human' });
    expect(getBatch108BlockRestrictionReason(balrog, grunt, [balrog, grunt])).toBeTruthy();
    expect(getBatch108BlockRestrictionReason(balrog, legend, [balrog, legend])).toBeNull();

    const aura = perm('au', 'p1', 'Gutter Shortcut', GUTTER, { type_line: 'Enchantment — Aura', attachedTo: 'host' });
    const host = perm('host', 'p1', 'Bear', '', { type_line: 'Creature — Bear', attacking: true });
    const other = perm('ot', 'p1', 'Wolf', '', { type_line: 'Creature — Wolf', attacking: true });
    const wall = perm('wa', 'p2', 'Wall', '', { type_line: 'Creature — Wall' });
    expect(getBatch108BlockRestrictionReason(host, wall, [aura, host], 'p2')).toBeTruthy();
    expect(getBatch108BlockRestrictionReason(host, wall, [aura, host, other], 'p2')).toBeNull();
  });

  it('prevents Ironscale combat damage, redirects die-to-library, and locks Scheming Fence', () => {
    const hydra = perm('ih', 'p1', 'Ironscale Hydra', IRONSCALE, { type_line: 'Creature — Hydra', counters: {} });
    const source = perm('src', 'p2', 'Bear', '', { type_line: 'Creature — Bear' });
    const state = stateWith([hydra, source]);
    const applied = applyBatch108DamagePrevention({ state }, 5, 'p2', 'p1', 'src', 'ih', true);
    expect(applied?.amount).toBe(0);
    expect(hydra.counters['+1/+1']).toBe(1);
    expect(applyBatch108DamagePrevention({ state }, 5, 'p2', 'p1', 'src', 'ih', false)).toBeNull();
    expect(collectBatch108DamagePreventionSpecsFromState(state).length).toBeGreaterThan(0);

    const zombie = perm('gz', 'p1', 'Gravebane Zombie', GRAVEBANE);
    const zState = stateWith([zombie], { zones: { p1: { library: [{ id: 'other', type_line: 'Land' }] } } });
    expect(collectBatch108ZoneChangeReplacementSpecsFromState(zState).some((s) => (s.metadata as any)?.libraryPosition === 'top')).toBe(true);
    expect(applyCardToLibraryTop(zState, { id: 'gz-card', name: 'Gravebane Zombie' }, 'p1')).toBe(true);
    expect(zState.zones.p1.library[0].id).toBe('gz-card');

    const fence = perm('sf', 'p1', 'Scheming Fence', FENCE, { type_line: 'Creature — Human Rogue', chosenPermanentId: 'lock' });
    const locked = perm('lock', 'p2', 'Sol Ring', '{T}: Add {C}{C}.', { type_line: 'Artifact' });
    const other = perm('free', 'p2', 'Mana Vault', '{T}: Add {C}{C}{C}.', { type_line: 'Artifact' });
    const fState = stateWith([fence, locked, other]);
    expect(isAbilityActivationProhibitedByBatch108ChosenPermanent(fState, locked)).toBeTruthy();
    expect(isAbilityActivationProhibitedByBatch108ChosenPermanent(fState, other)).toBeNull();
  });

  it('grants Sorin lifelink, Balan double strike, typal must-attack, and only-attack-alone', () => {
    const sorin = perm('so', 'p1', 'Sorin, Vengeful Bloodlord', SORIN, { type_line: 'Legendary Planeswalker — Sorin' });
    const bear = perm('be', 'p1', 'Bear', '', { type_line: 'Creature — Bear' });
    const walker = perm('pw', 'p1', 'Gideon', '', { type_line: 'Legendary Planeswalker — Gideon' });
    const opp = perm('ob', 'p2', 'Opp Bear', '', { type_line: 'Creature — Bear' });
    const yours = stateWith([sorin, bear, walker, opp], { turnPlayer: 'p1' });
    expect(batch108PermanentHasKeyword(bear, yours, 'lifelink')).toBe(true);
    expect(batch108PermanentHasKeyword(walker, yours, 'lifelink')).toBe(true);
    expect(batch108PermanentHasKeyword(opp, yours, 'lifelink')).toBe(false);
    expect(batch108PermanentHasKeyword(bear, stateWith([sorin, bear], { turnPlayer: 'p2' }), 'lifelink')).toBe(false);

    const balan = perm('bn', 'p1', 'Balan, Wandering Knight', BALAN, { type_line: 'Legendary Creature — Human Knight' });
    const eq1 = perm('e1', 'p1', 'Sword', 'Equip {1}', { type_line: 'Artifact — Equipment', attachedTo: 'bn' });
    const eq2 = perm('e2', 'p1', 'Shield', 'Equip {1}', { type_line: 'Artifact — Equipment', attachedTo: 'bn' });
    expect(batch108PermanentHasKeyword(balan, stateWith([balan, eq1]), 'double strike')).toBe(false);
    expect(batch108PermanentHasKeyword(balan, stateWith([balan, eq1, eq2]), 'double strike')).toBe(true);

    const assault = perm('ga', 'p1', 'Goblin Assault', ASSAULT, { type_line: 'Enchantment' });
    const goblin = perm('go', 'p2', 'Goblin', '', { type_line: 'Creature — Goblin' });
    const elf = perm('el', 'p2', 'Elf', '', { type_line: 'Creature — Elf' });
    const aState = stateWith([assault, goblin, elf]);
    expect(batch108CreatureMustAttackIfAble(goblin, aState)).toBe(true);
    expect(batch108CreatureMustAttackIfAble(elf, aState)).toBe(false);

    const master = perm('mc', 'p1', 'Master of Cruelties', MASTER);
    expect(batch108CanOnlyAttackAloneReason(master, ['mc'])).toBeNull();
    expect(batch108CanOnlyAttackAloneReason(master, ['mc', 'be'])).toBeTruthy();
  });

  it('animates Life and Limb / Kormus, grants Dregscape unearth, and gates Slumbering / Talruum / Triton', () => {
    const limb = perm('ll', 'p1', 'Life and Limb', LIMB, { type_line: 'Enchantment' });
    const forest = perm('fo', 'p1', 'Forest', '', { type_line: 'Basic Land — Forest' });
    const sap = perm('sa', 'p1', 'Saproling', '', { type_line: 'Creature — Saproling' });
    const island = perm('is', 'p1', 'Island', '', { type_line: 'Basic Land — Island' });
    const lState = stateWith([limb, forest, sap, island]);
    expect(batch108AdditionalTypes(forest, lState)).toEqual(expect.arrayContaining(['Creature', 'Land', 'Forest', 'Saproling']));
    expect(batch108AdditionalTypes(sap, lState)).toEqual(expect.arrayContaining(['Creature', 'Land', 'Forest', 'Saproling']));
    expect(batch108AdditionalTypes(island, lState)).toEqual([]);
    expect(readBatch108ColorSetting(lState, forest).set).toEqual(['G']);
    expect(layer4AddedTypesFor(forest, lState)).toEqual(expect.arrayContaining(['Creature', 'Forest', 'Saproling']));
    expect(layer4BasePowerToughnessFor(forest, lState)).toEqual({ power: 1, toughness: 1 });

    const bell = perm('kb', 'p1', 'Kormus Bell', KORMUS, { type_line: 'Artifact' });
    const swamp = perm('sw', 'p1', 'Swamp', '', { type_line: 'Basic Land — Swamp' });
    const kState = stateWith([bell, swamp]);
    expect(batch108AdditionalTypes(swamp, kState)).toEqual(['Creature']);
    expect(readBatch108ColorSetting(kState, swamp).set).toEqual(['B']);
    expect(layer4BasePowerToughnessFor(swamp, kState)).toEqual({ power: 1, toughness: 1 });

    const dreg = perm('ds', 'p1', 'Dregscape Sliver', DREGSCAPE, { type_line: 'Creature — Sliver' });
    const sliver = { id: 'sl', name: 'Sidewinder Sliver', type_line: 'Creature — Sliver', oracle_text: '', zone: 'graveyard', owner: 'p1' };
    const elf = { id: 'elf', name: 'Llanowar Elves', type_line: 'Creature — Elf', oracle_text: '', zone: 'graveyard', owner: 'p1' };
    const uState = stateWith([dreg], { activePlayer: 'p1', turnPlayer: 'p1' });
    const granted = getGrantedUnearthInfo({ state: uState } as any, 'p1' as any, sliver);
    expect(granted.hasIt).toBe(true);
    expect(String((granted as any).cost || '')).toMatch(/\{2\}/);
    expect(getGrantedUnearthInfo({ state: uState } as any, 'p1' as any, elf).hasIt).toBe(false);

    const dragon = perm('sd', 'p1', 'Slumbering Dragon', SLUMBER, { type_line: 'Creature — Dragon', counters: {} });
    expect(batch108AttackRestrictionReason(dragon, 'p2', stateWith([dragon]))).toBeTruthy();
    expect(batch108CannotBlockReason(dragon)).toBeTruthy();
    dragon.counters = { '+1/+1': 5 };
    expect(batch108AttackRestrictionReason(dragon, 'p2', stateWith([dragon]))).toBeNull();
    expect(batch108CannotBlockReason(dragon)).toBeNull();

    const piper = perm('tp', 'p1', 'Talruum Piper', TALRUUM);
    expect(attackerMustBeBlockedByFlyingIfAble(piper)).toBe(true);
    const triton = perm('tw', 'p1', 'Triton Wavebreaker', TRITON, { type_line: 'Artifact — Vehicle', layer4AddedTypes: ['Creature'] });
    expect(batch108PermanentHasKeyword(triton, stateWith([triton]), 'prowess')).toBe(true);
    const hull = perm('hu', 'p1', 'Triton Wavebreaker', TRITON, { type_line: 'Artifact — Vehicle' });
    expect(batch108PermanentHasKeyword(hull, stateWith([hull]), 'prowess')).toBe(false);
  });
});

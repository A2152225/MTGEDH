// server/tests/batch106-statics.unit.test.ts
// Live-path B106 tests: call hooked functions, not only helpers.
import { describe, expect, it } from 'vitest';
import { parseKickerPayLifeAmount } from '../src/state/modules/kickerPayLifeCost.js';
import { parseNontokenTypeActivatedAdditionalCost } from '../src/state/modules/batch103Parsers.js';
import { getManaSpendAsThoughRules, canSpendManaAs } from '../src/state/modules/manaSpendAsThough.js';
import { parseDiceExchangeWithBasePT } from '../src/state/modules/batch103Parsers.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import {
  collectReplacementEffectSpecsFromState,
  evaluateDeclarativeReplacementEvent,
} from '../src/state/modules/replacementEffectSpec.js';
import { collectOraclePatternDamagePreventionSpecsFromState } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamagePreventionOracleTemplates.js';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec.js';
import { listGrantedActivatedAbilityLinesForPermanent } from '../src/state/modules/grantedActivatedAbilityResolution.js';
import { playerHasHexproof } from '../src/state/modules/triggers/mimic-vat-modal-and-storm.js';
import { detectCombatDamageReplacement, applyCombatDamageReplacement } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsMillDamage.js';
import { getGrantedEncoreCost } from '../src/state/modules/graveyardEncoreGrants.js';
import { hasGlobalPlayersSkipUntapSteps } from '../src/state/modules/skipUntapStepUtils.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { getKeywordDeathTriggersForPermanent } from '../src/state/modules/counters_tokens-handlers/countersTokensDeathTriggerKeywords.js';
import {
  parseWouldDieInsteadExileWithNamedCounters,
  parseWouldDealCombatDamageToPlayerInsteadCountersAndMill,
  parseIfCreatureWouldDealDamageToYouPreventN,
  parseYouHaveHexproof,
  parseCreaturesYouControlWithPlusCountersCopyExiledActivated,
  parseHasEachActivatedAbilityOfCraftExiledCards,
  parseSpendManaAsAnyToActivateCreatureAbilities,
  parseEnchantedCreatureGetsPTAndHasAfterlife,
  parseGyCardsHaveEncore,
  parseGetsPlusXPowerGreatestGyCreaturePower,
} from '../src/state/modules/batch106Parsers.js';
import { parseBatch106LongTailStaticKind } from '../src/state/modules/staticEffectSpec-handlers/batch106LongTailStatics.js';
import { collectBatch106ReplacementSpecsFromState } from '../src/state/modules/replacementBatch106Collect.js';
import {
  applyBatch106NamedCountersOnExiled,
  applyBatch106PowerToughnessAdjustment,
  batch106AdditionalTypes,
  batch106AttackRestrictionReason,
  batch106CanAttackAsThoughItDidntHaveDefender,
  batch106CreatureMustAttackIfAble,
  appendGrantedAfterlifeDeathTriggers,
} from '../src/state/modules/batch106Apply.js';
import { listCraftGrantedActivatedAbilityLines } from '../src/state/modules/batch106CraftGrantedActivated.js';
import { getBatch106ManaSpendAsThoughRules, canSpendManaAsForCreatureActivation } from '../src/state/modules/batch106ManaSpendAsThough.js';
import { parseAbilitiesFromTail } from '../src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParseHelpers.js';

const SCUTA = 'Kicker—Pay 3 life.\nIf Phyrexian Scuta was kicked, it enters with four +1/+1 counters on it.';
const BRUTAL = 'Activated abilities of nontoken artifacts cost an additional "Sacrifice a land" to activate.';
const DAWN = 'Lands you control are Plains.\nYou may spend white mana as though it were mana of any color. You may spend other mana only as though it were colorless mana.';
const LATTICE = 'All permanents are artifacts in addition to their other types.\nPlayers may spend mana as though it were mana of any color.';
const WHACKER = "If you would roll one or more 6-sided dice, instead roll them and you may exchange one result with this creature's base power or base toughness.";
const DARIGAAZ = 'Flying, trample, haste\nIf Darigaaz would die, instead exile it with three egg counters on it.';
const SZADEK = 'Flying\nIf Szadek, Lord of Secrets would deal combat damage to a player, instead put that many +1/+1 counters on Szadek and that player mills that many cards.';
const ORBS = 'You have hexproof.\nIf a creature would deal damage to you, prevent 1 of that damage.';
const LOCUS = 'Locus of Enlightenment has each activated ability of the exiled cards used to craft it. You may activate each of those abilities only once each turn.';
const AGATHA = 'You may spend mana as though it were mana of any color to activate abilities of creatures you control.\nCreatures you control with +1/+1 counters on them have all activated abilities of all creature cards exiled with Agatha\'s Soul Cauldron.';
const INDEBTED = 'Bestow {2}{W}\nAfterlife 1\nEnchanted creature gets +1/+1 and has afterlife 1.';
const WIRE = 'Each artifact creature card in your graveyard has encore. Its encore cost is equal to its mana cost.';
const GRUB = 'Carrion Grub gets +X/+0, where X is the greatest power among creature cards in your graveyard.';
const SANDS = 'Each player skips their untap step.';
const ARCADE = 'Nonland permanents you control and nonland permanent spells you control are enchantments in addition to their other types.';
const ANIMATE = "Enchanted Wall can attack as though it didn't have defender.";
const PUBLIC_ENEMY = "All creatures attack enchanted creature's controller each combat if able.";
const AKRON = 'Except for Akron Legionnaire and artifact creatures, creatures you control can\'t attack.';
const SCOURGE = "Scourge of the Skyclaves's power and toughness are each equal to 20 minus the highest life total among players.";
const THELON = 'Each Fungus creature gets +1/+1 for each spore counter on it.';
const TOXRILL = "Creatures you don't control get -1/-1 for each slime counter on them.";
const TIMBER = 'Timberpack Wolf gets +1/+1 for each other creature you control with the same name as it.';

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    card: { id: `${id}-card`, name, oracle_text: oracle, type_line: extra.type_line || 'Creature', power: extra.power, toughness: extra.toughness, mana_cost: extra.mana_cost },
    ...extra,
  };
}

describe('B106 UI-worker live hooks classified elsewhere', () => {
  it('Phyrexian Scuta kicker pay-life is parsed by the live kicker hook', () => {
    expect(parseKickerPayLifeAmount(SCUTA)).toBe(3);
  });

  it('Brutal Suppression additional sacrifice is parsed and found on the battlefield', () => {
    expect(parseNontokenTypeActivatedAdditionalCost(BRUTAL)).toEqual({ typeWord: 'artifact', costText: 'Sacrifice a land' });
    const state = { battlefield: [perm('bs', 'p1', 'Brutal Suppression', BRUTAL, { type_line: 'Enchantment' })] };
    expect(parseNontokenTypeActivatedAdditionalCost(BRUTAL)?.costText).toBe('Sacrifice a land');
  });

  it('Celestial Dawn and Mycosynth Lattice spend-as-though rules are live', () => {
    const dawnState = { battlefield: [perm('cd', 'p1', 'Celestial Dawn', DAWN, { type_line: 'Enchantment' })] };
    const dawn = getManaSpendAsThoughRules(dawnState, 'p1');
    expect(dawn.colorAsAny).toBe('white');
    expect(dawn.otherOnlyColorless).toBe(true);
    expect(canSpendManaAs('white', 'blue', dawn)).toBe(true);
    expect(canSpendManaAs('blue', 'white', dawn)).toBe(false);
    expect(canSpendManaAs('blue', 'colorless', dawn)).toBe(true);

    const latticeState = { battlefield: [perm('ml', 'p2', 'Mycosynth Lattice', LATTICE, { type_line: 'Artifact' })] };
    const lattice = getManaSpendAsThoughRules(latticeState, 'p1');
    expect(lattice.anyColor).toBe(true);
    expect(canSpendManaAs('red', 'white', lattice)).toBe(true);
  });

  it('Vedalken Squirrel-Whacker dice-exchange parser used by the live hook is present', () => {
    expect(parseDiceExchangeWithBasePT(WHACKER)).toEqual({ sides: 6 });
  });
});

describe('B106 Darigaaz would-die exile with named counters', () => {
  it('collects and evaluates a battlefield-to-exile redirect with egg counters', () => {
    expect(parseWouldDieInsteadExileWithNamedCounters(DARIGAAZ)).toEqual({ count: 3, counter: 'egg' });
    const darigaaz = perm('d1', 'p1', 'Darigaaz, Reincarnated', DARIGAAZ, { type_line: 'Legendary Creature — Dragon' });
    const state = { battlefield: [darigaaz], zones: { p1: { exile: [], graveyard: [] } } };
    const specs = collectBatch106ReplacementSpecsFromState(state);
    expect(specs.some((s) => s.effectId === 'would-die-instead-exile-with-named-counters')).toBe(true);
    const live = collectReplacementEffectSpecsFromState(state);
    expect(live.some((s: any) => s.effectId === 'would-die-instead-exile-with-named-counters')).toBe(true);
    const result = evaluateDeclarativeReplacementEvent({
      type: 'zone-change',
      object: darigaaz,
      objectId: 'd1',
      sourceZone: 'battlefield',
      destinationZone: 'graveyard',
      controller: 'p1',
      owner: 'p1',
    } as any, state);
    expect(result?.applied).toBe(true);
    expect(result?.replacementDestination).toBe('exile');
    expect((result as any)?.metadata?.namedCountersOnExile).toEqual({ count: 3, counter: 'egg' });
  });

  it('stamps named counters on the exiled card', () => {
    const card = { id: 'd1-card', name: 'Darigaaz, Reincarnated', counters: {} };
    const ctx = { state: { zones: { p1: { exile: [card] } } } };
    expect(applyBatch106NamedCountersOnExiled(ctx, { id: 'd1', owner: 'p1', card }, { namedCountersOnExile: { count: 3, counter: 'egg' } })).toBe(true);
    expect(card.counters).toEqual({ egg: 3 });
  });
});

describe('B106 Szadek combat-damage replacement', () => {
  it('is detected and applied by the live combat-damage mill path', () => {
    expect(parseWouldDealCombatDamageToPlayerInsteadCountersAndMill(SZADEK)).toBe(true);
    const attacker = perm('sz', 'p1', 'Szadek, Lord of Secrets', SZADEK, { type_line: 'Legendary Creature — Vampire' });
    const effect = detectCombatDamageReplacement({ state: {} } as any, attacker.card, attacker);
    expect(effect?.putPlusOneCountersOnSource).toBe(true);
    expect(effect?.millDamagedPlayer).toBe(true);
    expect(effect?.preventsDamage).toBe(true);
    const applied = applyCombatDamageReplacement({ state: {} } as any, attacker.card, attacker, 'p1', 5, 'p2');
    expect(applied.plusOneCountersOnSource).toBe(5);
  });
});

describe('B106 Orbs of Warding', () => {
  it('grants player hexproof through the live hook and prevents 1 creature damage', () => {
    expect(parseYouHaveHexproof(ORBS)).toBe(true);
    expect(parseIfCreatureWouldDealDamageToYouPreventN(ORBS)).toEqual({ n: 1 });
    const orbs = perm('ow', 'p1', 'Orbs of Warding', ORBS, { type_line: 'Artifact' });
    expect(playerHasHexproof({ battlefield: [orbs] }, 'p1')).toBe(true);
    const specs = parseStaticEffectSpecsFromOraclePermanent(orbs as any);
    expect(specs.some((s) => s.grant?.abilities?.includes('hexproof'))).toBe(true);
    const collected = collectOraclePatternDamagePreventionSpecsFromState({ battlefield: [orbs] });
    expect(collected.some((s: any) => s.reason === 'prevent_n_damage_to_you' && s.instead?.value === -1)).toBe(true);
  });
});

describe('B106 Enigma Jewel / Locus craft-granted activated abilities', () => {
  it('lists activated abilities of the crafted-from cards, once each turn', () => {
    expect(parseHasEachActivatedAbilityOfCraftExiledCards(LOCUS)).toBe(true);
    const locus = perm('loc', 'p1', 'Locus of Enlightenment', LOCUS, {
      type_line: 'Artifact',
      craftedFromCards: [
        { id: 'ex1', name: 'Manalith', type_line: 'Artifact', oracle_text: '{T}: Add one mana of any color.' },
        { id: 'ex2', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
      ],
    });
    const lines = listCraftGrantedActivatedAbilityLines(locus, { battlefield: [locus] });
    expect(lines.some((l) => l.includes('{T}: Add one mana of any color'))).toBe(true);
    expect(lines.some((l) => l.includes('{T}: Add {C}{C}'))).toBe(true);
    expect(lines.every((l) => /activate only once each turn/i.test(l))).toBe(true);
    const merged = listGrantedActivatedAbilityLinesForPermanent(locus, { battlefield: [locus] });
    expect(merged.some((l) => /activate only once each turn/i.test(l))).toBe(true);
  });
});

describe("B106 Agatha's Soul Cauldron", () => {
  it('grants exiled creature activated abilities to +1/+1-countered creatures you control', () => {
    expect(parseCreaturesYouControlWithPlusCountersCopyExiledActivated(AGATHA)?.cardType).toBe('creature');
    const cauldron = perm('ag', 'p1', "Agatha's Soul Cauldron", AGATHA, { type_line: 'Legendary Artifact' });
    const bearer = perm('cr', 'p1', 'Bear', '{T}: Draw a card.', { type_line: 'Creature — Bear', counters: { '+1/+1': 1 } });
    const uncountered = perm('cr2', 'p1', 'Elk', '{T}: Add {G}.', { type_line: 'Creature — Elk' });
    const state = {
      battlefield: [cauldron, bearer, uncountered],
      zones: {
        p1: {
          exile: [{
            id: 'ex-c',
            name: 'Snapcaster Mage',
            type_line: 'Creature — Human Wizard',
            oracle_text: '{1}{U}: Target instant or sorcery card in your graveyard gains flashback until end of turn.',
            exiledWithSourceId: 'ag',
          }],
        },
      },
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(cauldron as any);
    expect(specs.some((s: any) => s.grant?.copyActivatedFromExiledWithCardType === 'creature')).toBe(true);
    const granted = getContinuousGrantedAbilitiesForPermanent(bearer, state);
    expect(granted.some((line: any) => String(line).toLowerCase().includes('flashback'))).toBe(true);
    const notGranted = getContinuousGrantedAbilitiesForPermanent(uncountered, state);
    expect(notGranted.some((line: any) => String(line).toLowerCase().includes('flashback'))).toBe(false);
  });

  it('spend-as-any for creature activations imports manaSpendAsThough and is context-gated', () => {
    expect(parseSpendManaAsAnyToActivateCreatureAbilities(AGATHA)).toBe(true);
    const state = { battlefield: [perm('ag', 'p1', "Agatha's Soul Cauldron", AGATHA, { type_line: 'Legendary Artifact' })] };
    const idle = getBatch106ManaSpendAsThoughRules(state, 'p1');
    expect(idle.anyColor).toBe(false);
    const activating = getBatch106ManaSpendAsThoughRules(state, 'p1', { activatingCreatureAbility: true });
    expect(activating.anyColor).toBe(true);
    expect(canSpendManaAsForCreatureActivation('red', 'white', state, 'p1', true)).toBe(true);
    expect(canSpendManaAsForCreatureActivation('red', 'white', state, 'p1', false)).toBe(false);
  });
});

describe('B106 Indebted Spirit afterlife grant', () => {
  it('parses +1/+1 and afterlife 1, and death triggers include the granted afterlife', () => {
    expect(parseEnchantedCreatureGetsPTAndHasAfterlife(INDEBTED)).toEqual({ power: 1, toughness: 1, afterlife: 1 });
    expect(parseAbilitiesFromTail('afterlife 1')).toContain('afterlife 1');
    const aura = perm('is', 'p1', 'Indebted Spirit', INDEBTED, { type_line: 'Enchantment Creature — Spirit', attachedTo: 'host' });
    const host = perm('host', 'p1', 'Grizzly Bears', '', { type_line: 'Creature — Bear' });
    const state = { battlefield: [aura, host] };
    const triggers = getKeywordDeathTriggersForPermanent(host, 'p1', state);
    expect(triggers.some((t: any) => String(t.effect).toLowerCase().includes('afterlife') && t.value === 1)).toBe(true);
    const appended = appendGrantedAfterlifeDeathTriggers(host, 'p1', [], state);
    expect(appended.some((t) => t.value === 1)).toBe(true);
  });
});

describe('B106 Wire Surgeons encore grant', () => {
  it('grants encore equal to the card mana cost for artifact creatures in the graveyard', () => {
    expect(parseGyCardsHaveEncore(WIRE)?.costMode).toBe('mana_cost');
    const state = {
      battlefield: [perm('ws', 'p1', 'Wire Surgeons', WIRE, { type_line: 'Creature — Human Artificer' })],
    };
    const gyCard = { id: 'gy1', name: 'Ornithopter', type_line: 'Artifact Creature — Thopter', mana_cost: '{0}', oracle_text: 'Flying' };
    expect(getGrantedEncoreCost(state, 'p1', gyCard)).toBe('{0}');
    const nonArtifact = { id: 'gy2', name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}' };
    expect(getGrantedEncoreCost(state, 'p1', nonArtifact)).toBeUndefined();
  });
});

describe('B106 Carrion Grub and CDA/combat tails', () => {
  it('adds greatest graveyard creature power to Carrion Grub', () => {
    expect(parseGetsPlusXPowerGreatestGyCreaturePower(GRUB)).toBe(true);
    const grub = perm('cg', 'p1', 'Carrion Grub', GRUB, { type_line: 'Creature — Insect', power: 0, toughness: 5 });
    const state = {
      battlefield: [grub],
      zones: {
        p1: {
          graveyard: [
            { id: 'g1', name: 'Craw Wurm', type_line: 'Creature — Wurm', power: 6, toughness: 4 },
            { id: 'g2', name: 'Shock', type_line: 'Instant' },
          ],
        },
      },
    };
    const pt = applyBatch106PowerToughnessAdjustment(grub, state, 0, 5);
    expect(pt.power).toBe(6);
    expect(pt.toughness).toBe(5);
  });

  it('computes Scourge of the Skyclaves as 20 minus the highest life total', () => {
    const card = { name: 'Scourge of the Skyclaves', oracle_text: SCOURGE, power: '*', toughness: '*', controller: 'p1' };
    const pt = calculateVariablePT(card, { battlefield: [], life: { p1: 12, p2: 18 }, players: [{ id: 'p1', life: 12 }, { id: 'p2', life: 18 }] });
    expect(pt).toEqual({ power: 2, toughness: 2 });
  });

  it('applies Thelon, Toxrill, and Timberpack P/T adjustments', () => {
    const thelon = perm('th', 'p1', 'Thelon of Havenwood', THELON, { type_line: 'Legendary Creature — Elf Shaman' });
    const fungus = perm('fu', 'p1', 'Fungusaur', 'Trample', { type_line: 'Creature — Fungus Lizard', counters: { spore: 3 } });
    const slimey = perm('sl', 'p2', 'Bear', '', { type_line: 'Creature — Bear', counters: { slime: 2 } });
    const tox = perm('tx', 'p1', 'Toxrill, the Corrosive', TOXRILL, { type_line: 'Legendary Creature — Slug Horror' });
    const wolf1 = perm('w1', 'p1', 'Timberpack Wolf', TIMBER, { type_line: 'Creature — Wolf' });
    const wolf2 = perm('w2', 'p1', 'Timberpack Wolf', TIMBER, { type_line: 'Creature — Wolf' });
    const state = { battlefield: [thelon, fungus, slimey, tox, wolf1, wolf2] };
    expect(applyBatch106PowerToughnessAdjustment(fungus, state, 2, 2)).toEqual({ power: 5, toughness: 5 });
    expect(applyBatch106PowerToughnessAdjustment(slimey, state, 2, 2)).toEqual({ power: 0, toughness: 0 });
    expect(applyBatch106PowerToughnessAdjustment(wolf1, state, 2, 2)).toEqual({ power: 3, toughness: 3 });
  });

  it('skips the untap step, adds enchantment types, and enforces combat requirements', () => {
    expect(hasGlobalPlayersSkipUntapSteps({ state: { battlefield: [perm('st', 'p1', 'Sands of Time', SANDS, { type_line: 'Artifact' })] } } as any)).toBe(true);
    const arcade = perm('sa', 'p1', 'Secret Arcade', ARCADE, { type_line: 'Enchantment' });
    const bear = perm('b1', 'p1', 'Bear', '', { type_line: 'Creature — Bear' });
    const land = perm('l1', 'p1', 'Forest', '', { type_line: 'Basic Land — Forest' });
    const typeState = { battlefield: [arcade, bear, land] };
    expect(batch106AdditionalTypes(bear, typeState)).toEqual(['Enchantment']);
    expect(batch106AdditionalTypes(land, typeState)).toEqual([]);

    const wall = perm('w', 'p1', 'Wall of Wood', 'Defender', { type_line: 'Creature — Wall' });
    const aura = perm('aw', 'p1', 'Animate Wall', ANIMATE, { type_line: 'Enchantment — Aura', attachedTo: 'w' });
    expect(batch106CanAttackAsThoughItDidntHaveDefender(wall, { battlefield: [wall, aura] })).toBe(true);

    const publicEnemy = perm('pe', 'p2', 'Public Enemy', PUBLIC_ENEMY, { type_line: 'Enchantment — Aura', attachedTo: 'host2' });
    const host2 = perm('host2', 'p2', 'Host', '', { type_line: 'Creature' });
    const attacker = perm('atk', 'p1', 'Bear', '', { type_line: 'Creature — Bear' });
    const attackState = { battlefield: [publicEnemy, host2, attacker] };
    expect(batch106CreatureMustAttackIfAble(attacker, attackState)).toBe(true);
    expect(batch106AttackRestrictionReason(attacker, 'p1', attackState)).toMatch(/enchanted creature's controller/i);

    const akron = perm('ak', 'p1', 'Akron Legionnaire', AKRON, { type_line: 'Creature — Giant Soldier' });
    const grunt = perm('gr', 'p1', 'Grunt', '', { type_line: 'Creature — Soldier' });
    const tank = perm('tk', 'p1', 'Tank', '', { type_line: 'Artifact Creature — Construct' });
    const akronState = { battlefield: [akron, grunt, tank] };
    expect(batch106AttackRestrictionReason(grunt, 'p2', akronState)).toMatch(/Akron Legionnaire/);
    expect(batch106AttackRestrictionReason(tank, 'p2', akronState)).toBeNull();
    expect(batch106AttackRestrictionReason(akron, 'p2', akronState)).toBeNull();
  });

  it('parseBatch106LongTailStaticKind covers the named tails', () => {
    expect(parseBatch106LongTailStaticKind(ORBS)).toBe('you_have_hexproof');
    expect(parseBatch106LongTailStaticKind(AGATHA)).toBe('plus_counter_creatures_copy_exiled_activated');
    expect(parseBatch106LongTailStaticKind(INDEBTED)).toBe('enchanted_pt_afterlife');
    expect(parseBatch106LongTailStaticKind(WIRE)).toBe('gy_cards_have_encore');
    expect(parseBatch106LongTailStaticKind(SANDS)).toBe('skip_untap_step');
  });
});

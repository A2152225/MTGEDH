import { describe, expect, it } from 'vitest';
import {
  parseCardYouDidntControlToOpponentsGyExileInstead,
  parseDuringTurnsOtherThanYoursThisIsArtifactCreature,
  parseEnchantedAttackingAloneCantBeBlocked,
  parseEnchantedCantBeBlockedExceptByArtifactAndOrColor,
  parseEquipmentYouControlHaveEquipTypalCost,
  parseMagnetCounterAlsoAttackIfAble,
  parseNoncombatDamagePlusSourcePower,
  parseNontokenOpponentCreatureWouldDieExileWithNamedCounter,
  parseRedOrArtifactSourceDamagePlusN,
  parseSlumberCounterIsLandNotCreature,
  parseYouWouldGetCountersPlusOneEachKind,
  typalEquipGrantFragment,
} from '../src/state/modules/batch107Parsers.js';
import {
  parseBatch107LongTailStaticKind,
  pushBatch107LongTailStaticSpecs,
} from '../src/state/modules/staticEffectSpec-handlers/batch107LongTailStatics.js';
import {
  applyBatch107PlayerCounterPlusOne,
  applyBatch107PowerToughnessAdjustment,
  batch107AdditionalTypes,
  batch107CreatureMustAttackIfAble,
  batch107EffectiveTypeLineOverride,
  batch107GrantedCreatureTypes,
  batch107GrantedTypalEquipFragments,
  batch107MustAlsoAttackDueToMagnet,
  batch107PermanentHasKeyword,
  batch107PermanentIsLandNotCreature,
  calculateBatch107VariablePT,
  getBatch107BushidoValue,
  isLandPlayProhibitedByBatch107ChosenNames,
  readBatch107ColorSetting,
} from '../src/state/modules/batch107Apply.js';
import {
  collectBatch107DamageScalingSpecs,
  collectBatch107ReplacementSpecs,
  collectBatch107ReplacementSpecsFromState,
} from '../src/state/modules/replacementBatch107Collect.js';
import { collectBatch21DamageScalingSpecs } from '../src/state/modules/replacementBatch21DamageScaling.js';
import { matchesDamagePreventionExtras } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamagePreventionOracleTemplates.js';
import { matchesZoneChangeOwnershipExtras } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecZoneChangeDiesExileTemplates.js';
import { detectUntapStepEffects, getUntapStepEffects } from '../src/state/modules/triggers/turn-phases-handlers/turnPhaseUntapStepEffects.js';
import { parseLandWouldEnterNamedSacrificeReplacement } from '../src/state/modules/land-would-enter-replacement.js';
import { computeStaticMaxHandSize } from '../src/state/modules/handSizeStaticModifiers.js';
import { LATE_BATCH_OTHER_SYSTEMS_B107 } from '../scripts/static-replacement-census-classify-late-batches-b107.js';
import { getBatch25BlockRestrictionReason, isAttackingAlone } from '../src/socket/combat-handlers/combatBatch25BlockRestrictions.js';

const MAGNET = "If a creature with a magnet counter on it attacks, all creatures with magnet counters on them attack if able.\nWhenever a creature with a magnet counter on it attacks, all creatures with magnet counters on them block that creature this turn if able.\n{1}, {T}: Put a magnet counter on target creature.";
const HAWKEYE = "Reach\nIf a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, instead it deals that much damage plus X, where X is Hawkeye's power.";
const MECHANIZED = "If a red or artifact source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.";
const WINDING = "If one or more counters would be put on an artifact or creature you control, that many plus one of each of those kinds of counters are put on that permanent instead.\nIf you would get one or more counters, you get that many plus one of each of those kinds of counters instead.";
const SYR = "Vigilance, menace\nWhenever an equipped creature you control attacks, you draw a card and you lose 1 life.\nEquipment you control have equip Knight {0}.";
const LIFECRAFT = "As this Vehicle enters, choose a creature type.\nVehicle creatures you control are the chosen creature type in addition to their other types.\nEach creature you control of the chosen type other than this Vehicle gets +1/+1.\nCrew 3";
const PALLIMUD = "As this creature enters, choose an opponent.\nPallimud's power is equal to the number of tapped lands the chosen player controls.";
const SEEKER = "Enchant creature\nEnchanted creature can't be blocked except by artifact creatures and/or white creatures.";
const MANGLER = "During turns other than yours, this Vehicle is an artifact creature.\nCrew 2 (Tap any number of creatures you control with total power 2 or more: This Vehicle becomes an artifact creature until end of turn.)";
const VALGAVOTH = "Flying, lifelink\nWard—Sacrifice three nonland permanents.\nIf a card you didn't control would be put into an opponent's graveyard from anywhere, exile it instead.\nDuring your turn, you may play cards exiled with Valgavoth. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.";
const GLORY = "Renown 1 (When this creature deals combat damage to a player, if it isn't renowned, put a +1/+1 counter on it and it becomes renowned.)\nAs long as this creature is renowned, it has menace. (It can't be blocked except by two or more creatures.)";
const ARIX = "Arixmethes enters tapped with five slumber counters on it.\nAs long as Arixmethes has a slumber counter on it, it's a land. (It's not a creature.)\nWhenever you cast a spell, you may remove a slumber counter from Arixmethes.\n{T}: Add {G}{U}.";
const BYPASS = "Enchant creature\nAs long as enchanted creature is attacking alone, it can't be blocked.\nEnchanted creature has \"Whenever this creature deals combat damage to a player, it connives.\" (Its controller draws a card, then discards a card. If they discarded a nonland card, they put a +1/+1 counter on this creature.)";
const NULL_CHAMBER = "As this enchantment enters, you and an opponent each choose a card name other than a basic land card name.\nSpells with the chosen names can't be cast and lands with the chosen names can't be played.";
const GHOSTFLAME = "All Slivers are colorless.";
const ACE = "This creature gets +2/+0 as long as it isn't attacking or blocking.";
const QUEST = "Whenever a creature you control becomes tapped, you may put a quest counter on this enchantment.\nAs long as there are four or more quest counters on this enchantment, untap all creatures you control during each other player's untap step.";
const FUMIKO = "Fumiko has bushido X, where X is the number of attacking creatures. (Whenever this creature blocks or becomes blocked, it gets +X/+X until end of turn.)\nCreatures your opponents control attack each combat if able.";
const FLYER = "Flying\nThis creature gets +1/+1 as long as there's a Lesson card in your graveyard.";
const SURVIVOR = "Survival — At the beginning of your second main phase, if this creature is tapped, exile up to one target card from a graveyard.\nAs long as there are three or more cards exiled with this creature, it gets +3/+3 and has hexproof. (It can't be the target of spells or abilities your opponents control.)";
const HUNT = "Enchant player\nCreatures enchanted player controls attack each combat if able.";
const DEPALA = "Other Dwarves you control get +1/+1.\nEach Vehicle you control gets +1/+1 as long as it's a creature.\nWhenever Depala becomes tapped, you may pay {X}. If you do, reveal the top X cards of your library, put all Dwarf and Vehicle cards from among them into your hand, then put the rest on the bottom of your library in a random order.";
const DRAUGR = "If a nontoken creature an opponent controls would die, exile that card with an ice counter on it instead.\nYou may cast spells from among cards in exile your opponents own with ice counters on them, and you may spend mana from snow sources as though it were mana of any color to cast those spells.";
const TOAD = "Your maximum hand size is twenty.\nWhenever you attack with two or more creatures, put a +1/+1 counter on this creature and draw a card.\nWhenever this creature attacks, you win the game if there are twenty or more counters on it or you have twenty or more cards in hand.";
const SHELTERED = "If this land would enter, instead sacrifice each other permanent named Sheltered Valley you control, then put this land onto the battlefield.\nAt the beginning of your upkeep, if you control three or fewer lands, you gain 1 life.\n{T}: Add {C}.";
const NATURAL = "When this enchantment enters, return a red or green enchantment you control to its owner's hand.\nLands you control are 2/2 creatures with first strike. They're still lands.";
const APPARITION = "Flying\nAs this creature enters, choose an opponent.\nHaunting Apparition's power is equal to 1 plus the number of green creature cards in the chosen player's graveyard.";
const COGWORK = "Reveal this card as you draft it and note the player who passed it to you.\nThis creature attacks each combat if able.\nThis creature attacks a player you noted for cards named Cogwork Tracker each combat if able.";

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    card: { id: `${id}-card`, name, oracle_text: oracle, type_line: String(extra.type_line || 'Creature'), power: extra.power, colors: extra.colors },
    ...extra,
  };
}

function stateWith(battlefield: any[], extra: Record<string, unknown> = {}) {
  return { battlefield, zones: extra.zones || {}, activePlayer: extra.activePlayer || 'p1', players: extra.players || [{ id: 'p1' }, { id: 'p2' }], ...extra };
}

describe('B107 parsers and long-tail specs', () => {
  it('parses the named static and replacement wordings', () => {
    expect(parseMagnetCounterAlsoAttackIfAble(MAGNET)).toBe(true);
    expect(parseNoncombatDamagePlusSourcePower(HAWKEYE)).toBe(true);
    expect(parseRedOrArtifactSourceDamagePlusN(MECHANIZED)).toBe(1);
    expect(parseYouWouldGetCountersPlusOneEachKind(WINDING)).toBe(true);
    expect(parseEquipmentYouControlHaveEquipTypalCost(SYR)).toEqual({ typal: 'Knight', cost: '{0}' });
    expect(parseEnchantedCantBeBlockedExceptByArtifactAndOrColor(SEEKER)).toBe('white');
    expect(parseDuringTurnsOtherThanYoursThisIsArtifactCreature(MANGLER)).toBe(true);
    expect(parseCardYouDidntControlToOpponentsGyExileInstead(VALGAVOTH)).toBe(true);
    expect(parseSlumberCounterIsLandNotCreature(ARIX)).toBe(true);
    expect(parseEnchantedAttackingAloneCantBeBlocked(BYPASS)).toBe(true);
    expect(parseNontokenOpponentCreatureWouldDieExileWithNamedCounter(DRAUGR)).toEqual({ counter: 'ice', count: 1 });
    expect(parseLandWouldEnterNamedSacrificeReplacement(SHELTERED)).toBe(true);
  });

  it('emits long-tail static specs for the census-handled wordings', () => {
    const cases = [
      [MAGNET, 'magnet_also_attack'],
      [SYR, 'equip_typal_grant'],
      [LIFECRAFT, 'vehicle_chosen_type'],
      [PALLIMUD, 'cda_tapped_lands_chosen'],
      [SEEKER, 'enchanted_block_except_artifact_or_color'],
      [MANGLER, 'off_turn_artifact_creature'],
      [GLORY, 'renowned_menace'],
      [ARIX, 'slumber_is_land'],
      [BYPASS, 'enchanted_alone_unblockable'],
      [NULL_CHAMBER, 'chosen_names_cant_cast_or_play'],
      [GHOSTFLAME, 'typal_colorless'],
      [ACE, 'pt_if_not_attacking_or_blocking'],
      [QUEST, 'counter_gate_other_untap'],
      [FUMIKO, 'bushido_x_attackers'],
      [FLYER, 'pt_if_lesson_in_gy'],
      [SURVIVOR, 'exiled_with_pt_hexproof'],
      [HUNT, 'enchanted_player_must_attack'],
      [DEPALA, 'vehicle_creature_pt'],
      [TOAD, 'hand_size_twenty'],
      [NATURAL, 'lands_you_control_nn_keyword'],
      [APPARITION, 'cda_plus_color_creatures_chosen_gy'],
    ] as const;
    for (const [oracle, kind] of cases) {
      expect(parseBatch107LongTailStaticKind(oracle), kind).toBe(kind);
      const specs: any[] = [];
      pushBatch107LongTailStaticSpecs(specs, { sourcePermanentId: 's', sourceController: 'p1', sourceName: 'x' } as any, perm('s', 'p1', 'x', oracle) as any, oracle);
      expect(specs.length, kind).toBeGreaterThan(0);
    }
  });

  it('classifies Cogwork Tracker draft lines as other-system elsewhere', () => {
    expect(LATE_BATCH_OTHER_SYSTEMS_B107.some(([, re]) => re.test('Reveal this card as you draft it and note the player who passed it to you.'))).toBe(true);
    expect(LATE_BATCH_OTHER_SYSTEMS_B107.some(([, re]) => re.test('This creature attacks a player you noted for cards named Cogwork Tracker each combat if able.'))).toBe(true);
    expect(LATE_BATCH_OTHER_SYSTEMS_B107.some(([, re]) => re.test(COGWORK))).toBe(true);
  });
});

describe('B107 replacement collect and live matchers', () => {
  it('collects Hawkeye and Mechanized Warfare through the batch 21 hook', () => {
    const hawk = collectBatch21DamageScalingSpecs(HAWKEYE, { sourcePermanentId: 'h', sourceController: 'p1', sourceName: 'Hawkeye', power: 4 } as any);
    const hawkDirect = collectBatch107DamageScalingSpecs(HAWKEYE, { sourcePermanentId: 'h', sourceController: 'p1', sourceName: 'Hawkeye', power: 4 });
    expect(hawkDirect.some((s) => s.effectId === 'noncombat-damage-plus-source-power' && (s.instead as any).value === 4)).toBe(true);
    expect(hawk.some((s) => s.effectId === 'noncombat-damage-plus-source-power')).toBe(true);

    const mech = collectBatch21DamageScalingSpecs(MECHANIZED, { sourcePermanentId: 'm', sourceController: 'p1', sourceName: 'Mechanized Warfare' });
    expect(mech.some((s) => String(s.effectId).includes('red-or-artifact-source-damage-plus-1'))).toBe(true);
  });

  it('matches Mechanized Warfare only for red or artifact sources', () => {
    const spec = collectBatch107DamageScalingSpecs(MECHANIZED, { sourcePermanentId: 'm', sourceController: 'p1', sourceName: 'Mechanized Warfare' })[0];
    const state = stateWith([
      perm('m', 'p1', 'Mechanized Warfare', MECHANIZED, { type_line: 'Enchantment' }),
      perm('bolt', 'p1', 'Bolt', '', { type_line: 'Instant', colors: ['R'] }),
      perm('bear', 'p1', 'Bear', '', { type_line: 'Creature', colors: ['G'] }),
      perm('cog', 'p1', 'Cog', '', { type_line: 'Artifact Creature', colors: [] }),
    ]);
    expect(matchesDamagePreventionExtras(spec, { damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'bolt' }, state)).toBe(true);
    expect(matchesDamagePreventionExtras(spec, { damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'cog' }, state)).toBe(true);
    expect(matchesDamagePreventionExtras(spec, { damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'bear' }, state)).toBe(false);
  });

  it('collects Winding, Valgavoth, Draugr, and Sheltered Valley and matches Valgavoth extras', () => {
    const winding = collectBatch107ReplacementSpecs(WINDING, { sourcePermanentId: 'w', sourceController: 'p1', sourceName: 'Winding Constrictor' });
    expect(winding.some((s) => s.effectId === 'player-counters-plus-one-each-kind')).toBe(true);
    expect(applyBatch107PlayerCounterPlusOne(stateWith([perm('w', 'p1', 'Winding Constrictor', WINDING)]), 'p1', 2)).toBe(3);
    expect(applyBatch107PlayerCounterPlusOne(stateWith([perm('w', 'p1', 'Winding Constrictor', WINDING)]), 'p2', 2)).toBe(2);

    const valg = collectBatch107ReplacementSpecs(VALGAVOTH, { sourcePermanentId: 'v', sourceController: 'p1', sourceName: 'Valgavoth' })
      .find((s) => s.effectId === 'card-you-didnt-control-opponent-gy-exile')!;
    expect(valg.instead).toEqual({ redirectZone: 'exile' });
    expect(matchesZoneChangeOwnershipExtras({ object: { id: 'c', controller: 'p2' }, owner: 'p2' }, valg)).toBe(true);
    expect(matchesZoneChangeOwnershipExtras({ object: { id: 'c', controller: 'p1' }, owner: 'p2' }, valg)).toBe(false);
    expect(matchesZoneChangeOwnershipExtras({ object: { id: 'c', controller: 'p2' }, owner: 'p1' }, valg)).toBe(false);

    const draugr = collectBatch107ReplacementSpecs(DRAUGR, { sourcePermanentId: 'd', sourceController: 'p1', sourceName: 'Draugr' })
      .find((s) => s.effectId === 'nontoken-opponent-creature-die-exile-named-counter')!;
    expect((draugr.metadata as any).namedCountersOnExile).toEqual({ counter: 'ice', count: 1 });
    expect((draugr.metadata as any).nontokenOnly).toBe(true);

    const valley = collectBatch107ReplacementSpecsFromState(stateWith([
      perm('sv', 'p1', 'Sheltered Valley', SHELTERED, { type_line: 'Land' }),
    ]));
    expect(valley.some((s) => s.effectId === 'land-would-enter-sacrifice-each-other-named')).toBe(true);
  });
});

describe('B107 live apply helpers', () => {
  it('forces other magnet creatures to attack only once a magnet creature is already attacking', () => {
    const web = perm('web', 'p1', 'Magnetic Web', MAGNET, { type_line: 'Artifact' });
    const a = perm('a', 'p1', 'A', 'Just a bear.', { counters: { magnet: 1 }, attacking: true });
    const b = perm('b', 'p1', 'B', 'Just a bear.', { counters: { magnet: 1 } });
    const c = perm('c', 'p1', 'C', 'Just a bear.', { counters: {} });
    const armed = stateWith([web, a, b, c]);
    expect(batch107MustAlsoAttackDueToMagnet(b, armed)).toBe(true);
    expect(batch107MustAlsoAttackDueToMagnet(c, armed)).toBe(false);
    const idle = stateWith([web, { ...a, attacking: false }, b, c]);
    expect(batch107MustAlsoAttackDueToMagnet(b, idle)).toBe(false);
  });

  it('applies Syr Gwyn typal equip, Lifecraft types and lord, and CDA power', () => {
    const gwyn = perm('g', 'p1', 'Syr Gwyn', SYR, { type_line: 'Legendary Creature — Human Knight' });
    const sword = perm('s', 'p1', 'Sword', 'Equip {2}', { type_line: 'Artifact — Equipment' });
    const frags = batch107GrantedTypalEquipFragments(sword, stateWith([gwyn, sword]));
    expect(frags.join(' ')).toContain('Equip Knight {0}');
    expect(typalEquipGrantFragment({ typal: 'Knight', cost: '{0}' })).toBe('Equip Knight {0}.');

    const engine = perm('e', 'p1', 'Lifecraft Engine', LIFECRAFT, { type_line: 'Artifact — Vehicle', chosenCreatureType: 'Elf', isCreature: true });
    const truck = perm('t', 'p1', 'Truck', 'Crew 1', { type_line: 'Artifact — Vehicle', isCreature: true });
    const st = stateWith([engine, truck]);
    expect(batch107GrantedCreatureTypes(truck, st).map((x) => x.toLowerCase())).toContain('elf');
    const lorded = applyBatch107PowerToughnessAdjustment(truck, st, 4, 4);
    expect(lorded).toEqual({ power: 5, toughness: 5 });

    const pallimud = perm('p', 'p1', 'Pallimud', PALLIMUD, { type_line: 'Creature — Beast', chosenPlayer: 'p2', power: '*' });
    const land1 = perm('l1', 'p2', 'Island', '', { type_line: 'Basic Land — Island', tapped: true });
    const land2 = perm('l2', 'p2', 'Forest', '', { type_line: 'Basic Land — Forest', tapped: false });
    const cda = calculateBatch107VariablePT(pallimud.card, PALLIMUD.toLowerCase(), pallimud, stateWith([pallimud, land1, land2]), 'p1');
    expect(cda).toEqual({ power: 1, toughness: 3 });

    const ghost = perm('h', 'p1', 'Haunting Apparition', APPARITION, { type_line: 'Creature — Spirit', chosenPlayer: 'p2' });
    const gy = [
      { id: 'g1', type_line: 'Creature — Elf', colors: ['G'] },
      { id: 'g2', type_line: 'Creature — Bear', colors: ['G'] },
      { id: 'g3', type_line: 'Instant', colors: ['G'] },
    ];
    const ap = calculateBatch107VariablePT(ghost.card, APPARITION.toLowerCase(), ghost, stateWith([ghost], { zones: { p2: { graveyard: gy } } }), 'p1');
    expect(ap).toEqual({ power: 3, toughness: 2 });
  });

  it('handles Midnight Mangler, Arixmethes, color, P/T tails, must-attack, keywords, and hand size', () => {
    const mangler = perm('mm', 'p1', 'Midnight Mangler', MANGLER, { type_line: 'Artifact — Vehicle' });
    expect(batch107AdditionalTypes(mangler, stateWith([mangler], { activePlayer: 'p2' }))).toContain('Creature');
    expect(batch107AdditionalTypes(mangler, stateWith([mangler], { activePlayer: 'p1' }))).not.toContain('Creature');

    const arix = perm('ax', 'p1', 'Arixmethes, Slumbering Isle', ARIX, { type_line: 'Legendary Creature — Kraken', counters: { slumber: 2 } });
    expect(batch107PermanentIsLandNotCreature(arix)).toBe(true);
    expect(String(batch107EffectiveTypeLineOverride(arix))).toMatch(/land/i);
    expect(String(batch107EffectiveTypeLineOverride(arix))).not.toMatch(/creature/i);

    const sliver = perm('sl', 'p1', 'Sliver', '', { type_line: 'Creature — Sliver' });
    const gf = perm('gf', 'p1', 'Ghostflame Sliver', GHOSTFLAME, { type_line: 'Creature — Sliver' });
    expect(readBatch107ColorSetting(stateWith([sliver, gf]), sliver).colorless).toBe(true);

    const ace = perm('ace', 'p1', 'Intrepid Ace', ACE, { type_line: 'Creature — Human Pilot' });
    expect(applyBatch107PowerToughnessAdjustment(ace, stateWith([ace]), 2, 1)).toEqual({ power: 4, toughness: 1 });
    expect(applyBatch107PowerToughnessAdjustment({ ...ace, attacking: true }, stateWith([ace]), 2, 1)).toEqual({ power: 2, toughness: 1 });

    const flyer = perm('ff', 'p1', 'First-Time Flyer', FLYER, { type_line: 'Creature — Human Pilot Ally' });
    const lessonState = stateWith([flyer], { zones: { p1: { graveyard: [{ id: 'l', type_line: 'Sorcery — Lesson' }] } } });
    expect(applyBatch107PowerToughnessAdjustment(flyer, lessonState, 1, 2)).toEqual({ power: 2, toughness: 3 });

    const survivor = perm('vs', 'p1', 'Veteran Survivor', SURVIVOR, { type_line: 'Creature — Human Survivor' });
    const survivorState = stateWith([survivor], {
      zones: {
        p2: {
          exile: [
            { id: 'e1', exiledWithSourceId: 'vs' },
            { id: 'e2', exiledWithSourceId: 'vs' },
            { id: 'e3', exiledWithSourceId: 'vs' },
          ],
        },
      },
    });
    expect(applyBatch107PowerToughnessAdjustment(survivor, survivorState, 2, 1)).toEqual({ power: 5, toughness: 4 });
    expect(batch107PermanentHasKeyword(survivor, survivorState, 'hexproof')).toBe(true);

    const glory = perm('gg', 'p1', 'Goblin Glory Chaser', GLORY, { type_line: 'Creature — Goblin Warrior', renowned: true });
    expect(batch107PermanentHasKeyword(glory, stateWith([glory]), 'menace')).toBe(true);

    const land = perm('pl', 'p1', 'Plains', '', { type_line: 'Basic Land — Plains' });
    const emergence = perm('ne', 'p1', 'Natural Emergence', NATURAL, { type_line: 'Enchantment' });
    const animState = stateWith([land, emergence]);
    expect(applyBatch107PowerToughnessAdjustment(land, animState, 0, 0)).toEqual({ power: 2, toughness: 2 });
    expect(batch107PermanentHasKeyword(land, animState, 'first strike')).toBe(true);
    expect(batch107AdditionalTypes(land, animState)).toContain('Creature');

    const depala = perm('de', 'p1', 'Depala', DEPALA, { type_line: 'Legendary Creature — Dwarf Pilot' });
    const car = perm('car', 'p1', 'Car', 'Crew 1', { type_line: 'Artifact — Vehicle', isCreature: true });
    expect(applyBatch107PowerToughnessAdjustment(car, stateWith([depala, car]), 3, 3)).toEqual({ power: 4, toughness: 4 });

    const fumiko = perm('fu', 'p1', 'Fumiko', FUMIKO, { type_line: 'Legendary Creature — Human Samurai' });
    const opp = perm('ogre', 'p2', 'Ogre', '', { type_line: 'Creature — Ogre' });
    expect(batch107CreatureMustAttackIfAble(opp, stateWith([fumiko, opp]))).toBe(true);
    expect(batch107CreatureMustAttackIfAble(fumiko, stateWith([fumiko, opp]))).toBe(false);
    expect(getBatch107BushidoValue(fumiko, stateWith([fumiko, { ...opp, attacking: true }, { ...perm('a2', 'p1', 'A', ''), attacking: true }]))).toBe(2);

    const curse = perm('cu', 'p1', 'Curse of the Nightly Hunt', HUNT, { type_line: 'Enchantment — Aura Curse', attachedTo: 'p2', enchantedPlayer: 'p2' });
    expect(batch107CreatureMustAttackIfAble(opp, stateWith([curse, opp]))).toBe(true);

    const toad = perm('tt', 'p1', 'Twenty-Toed Toad', TOAD, { type_line: 'Creature — Frog Wizard' });
    const toadState = stateWith([toad]);
    expect(computeStaticMaxHandSize(toadState.battlefield as any, 'p1')).toBe(20);

    const nullPerm = perm('nc', 'p1', 'Null Chamber', NULL_CHAMBER, { type_line: 'World Enchantment', chosenCardNames: ['Lightning Bolt', 'Forest'] });
    expect(isLandPlayProhibitedByBatch107ChosenNames(stateWith([nullPerm]), 'Forest')).toBe(true);
    expect(isLandPlayProhibitedByBatch107ChosenNames(stateWith([nullPerm]), 'Island')).toBe(false);
  });

  it('detects Quest for Renewal through the live other-player untap hook', () => {
    const quest = perm('q', 'p1', 'Quest for Renewal', QUEST, { type_line: 'Enchantment', counters: { quest: 4 } });
    const detected = detectUntapStepEffects(quest.card, quest);
    expect(detected.some((effect) => /untap all creatures you control during each other player's untap step/i.test(effect.description))).toBe(true);
    const ctx = { state: stateWith([quest, perm('c', 'p1', 'Bear', '', { type_line: 'Creature', tapped: true })]) } as any;
    const effects = getUntapStepEffects(ctx, 'p2');
    expect(effects.some((effect) => effect.permanentId === 'q')).toBe(true);
    const unarmed = perm('q2', 'p1', 'Quest for Renewal', QUEST, { type_line: 'Enchantment', counters: { quest: 3 } });
    const skipped = getUntapStepEffects({ state: stateWith([unarmed]) } as any, 'p2');
    expect(skipped.some((effect) => effect.permanentId === 'q2')).toBe(false);
  });

  it('applies Seeker and Security Bypass through the batch 25 block-restriction hook', () => {
    const host = perm('h', 'p1', 'Bear', '', { type_line: 'Creature — Bear', attacking: true });
    const seeker = perm('sk', 'p1', 'Seeker', SEEKER, { type_line: 'Enchantment — Aura', attachedTo: 'h' });
    const white = perm('w', 'p2', 'White Knight', '', { type_line: 'Creature — Human Knight', colors: ['W'] });
    const artifact = perm('ar', 'p2', 'Myr', '', { type_line: 'Artifact Creature — Myr', colors: [] });
    const green = perm('gr', 'p2', 'Bear', '', { type_line: 'Creature — Bear', colors: ['G'] });
    const bf = [host, seeker, white, artifact, green];
    const has = () => false;
    expect(getBatch25BlockRestrictionReason(host, white, bf, [], has, 'p2')).toBeNull();
    expect(getBatch25BlockRestrictionReason(host, artifact, bf, [], has, 'p2')).toBeNull();
    expect(getBatch25BlockRestrictionReason(host, green, bf, [], has, 'p2')).toMatch(/can't be blocked except/i);

    const bypass = perm('bp', 'p1', 'Security Bypass', BYPASS, { type_line: 'Enchantment — Aura', attachedTo: 'h' });
    const aloneBf = [host, bypass];
    expect(isAttackingAlone(host, aloneBf)).toBe(true);
    expect(getBatch25BlockRestrictionReason(host, green, aloneBf, [], has, 'p2')).toMatch(/attacking alone/i);
    const friend = perm('f', 'p1', 'Friend', '', { type_line: 'Creature', attacking: true });
    expect(getBatch25BlockRestrictionReason(host, green, [host, bypass, friend], [], has, 'p2')).toBeNull();
  });
});

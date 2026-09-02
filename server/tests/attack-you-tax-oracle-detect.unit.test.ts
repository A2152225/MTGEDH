import { describe, expect, it } from 'vitest';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { collectStaticEffectSpecsFromState } from '../src/state/modules/staticEffectSpec.js';
import {
  blockerCantBlockCreaturesYouControl,
  collectAttackYouMaxAttackersForDefender,
  collectAttackYouProhibitionForAttacker,
  collectAttackYouTaxForDefender,
  collectBlockLifeTax,
  collectBlockTax,
  collectMaxAttackersEachCombat,
  collectMaxBlockersEachCombat,
} from '../src/state/modules/staticEffectSpecAttackYouTax.js';
import { collectAttackYouTaxPhyrexianForDefender } from '../src/state/modules/staticEffectSpecAttackYouTaxPhyrexian.js';
import { CANT_ATTACK } from '../src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingCantAttack.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-27.
const GHOSTLY_PRISON_ORACLE =
  "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.";
const BAIRD_ORACLE =
  "Vigilance\nCreatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.";
const SPHERE_OF_SAFETY_ORACLE =
  "Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.";
const COLLECTIVE_RESTRAINT_ORACLE =
  "Domain — Creatures can't attack you unless their controller pays {X} for each creature they control that's attacking you, where X is the number of basic land types among lands you control.";
const NORNS_ANNEX_ORACLE =
  "({W/P} can be paid with either {W} or 2 life.)\nCreatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures.";
const ARCHANGEL_ORACLE =
  "Flying\nAs long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.\nAs long as this creature is attacking, creatures can't block unless their controller pays {1} for each of those creatures.";
const WAR_TAX_ORACLE =
  "{X}{U}: This turn, creatures can't attack unless their controller pays {X} for each attacking creature they control.";
const WAR_CADENCE_ORACLE =
  "{X}{R}: This turn, creatures can't block unless their controller pays {X} for each blocking creature they control.";
const ELEPHANT_GRASS_ORACLE =
  "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nBlack creatures can't attack you.\nNonblack creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.";
const BLAZING_ARCHON_ORACLE = "Flying\nCreatures can't attack you.";
const FORM_OF_THE_DRAGON_ORACLE =
  "At the beginning of your upkeep, this enchantment deals 5 damage to any target.\nAt the beginning of each end step, your life total becomes 5.\nCreatures without flying can't attack you.";
const SANDWURM_ORACLE =
  "Creatures with flying can't attack you or planeswalkers you control.\nAt the beginning of your end step, create a 5/5 green Wurm creature token.";
const REVERENCE_ORACLE = "Creatures with power 2 or less can't attack you.";
const CALLIGRAPHER_ORACLE =
  "Flying\nInklings can't attack you or planeswalkers you control.\nWhenever a player attacks one of your opponents, that attacking player creates a tapped 2/1 white and black Inkling creature token with flying that's attacking that opponent.";
const LEVITATION_ORACLE = 'Creatures you control have flying.';
const GRAVITY_SPHERE_ORACLE = 'All creatures lose flying.';
const TEFERIS_MOAT_ORACLE =
  "As this enchantment enters, choose a color.\nCreatures of the chosen color without flying can't attack you.";
const VOW_DUTY_ORACLE =
  "Enchant creature\nEnchanted creature gets +2/+2, has vigilance, and can't attack you or planeswalkers you control.";
const SPECTRAL_GRASP_ORACLE =
  "Enchant creature\nEnchanted creature can't attack you or planeswalkers you control.\nEnchanted creature can't block creatures you control.";
const ASSAULT_SUIT_ORACLE =
  "Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed.\nAt the beginning of each opponent's upkeep, you may have that player gain control of equipped creature until end of turn. If you do, untap it.\nEquip {3}";
const CRAWLSPACE_ORACLE = 'No more than two creatures can attack you each combat.';
const SILENT_ARBITER_ORACLE =
  'No more than one creature can attack each combat.\nNo more than one creature can block each combat.';
const CAVERNS_OF_DESPAIR_ORACLE =
  'No more than two creatures can attack each combat.\nNo more than two creatures can block each combat.';
const ERIETTE_ORACLE =
  "Each creature that's enchanted by an Aura you control can't attack you or planeswalkers you control.\nAt the beginning of your end step, each opponent loses X life and you gain X life, where X is the number of Auras you control.";
const ISLAND_SANCTUARY_ORACLE =
  "If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, you can't be attacked except by creatures with flying and/or islandwalk.";
const ISLAND_SANCTUARY_LOCK_CLAUSE =
  "until your next turn, you can't be attacked except by creatures with flying and/or islandwalk";
const ISLAND_SANCTUARY_LOCK_STANDALONE =
  "You can't be attacked except by creatures with flying and/or islandwalk.";

describe('attack-you tax oracle detect', () => {
  it('charges {2} from Ghostly Prison oracle and does not grant blanket can\'t-attack', () => {
    const state = {
      battlefield: [
        {
          id: 'prison_1',
          controller: 'p2',
          card: { name: 'Ward Veil', type_line: 'Enchantment', oracle_text: GHOSTLY_PRISON_ORACLE },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    expect(collectStaticEffectSpecsFromState(state)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'player_you' },
        grant: { attackYouTaxGeneric: 2 },
        sourceController: 'p2',
      }),
    ]));
    expect(collectStaticEffectSpecsFromState(state).some(
      (spec) => spec.grant.abilities?.includes(CANT_ATTACK),
    )).toBe(false);
    const blackBear = {
      id: 'black_bear_1',
      controller: 'p1',
      card: { name: 'Walking Corpse', type_line: 'Creature — Zombie', oracle_text: '', colors: ['B'] },
    };
    const greenBear = {
      id: 'green_bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', colors: ['G'] },
    };
    expect(collectAttackYouTaxForDefender(state, 'p2')).toEqual({
      cost: 2,
      sources: ['Ward Veil'],
    });
    expect(collectAttackYouTaxForDefender(state, 'p2', blackBear as any).cost).toBe(2);
    expect(collectAttackYouTaxForDefender(state, 'p2', greenBear as any).cost).toBe(2);
    expect(collectAttackYouProhibitionForAttacker(state, 'p2', greenBear as any)).toBeNull();
    expect(collectAttackYouTaxForDefender(state, 'p1').cost).toBe(0);
  });

  it('does not tax from the Ghostly Prison name when oracle is unrelated', () => {
    const state = {
      battlefield: [{
        id: 'named_1',
        controller: 'p2',
        card: { name: 'Ghostly Prison', type_line: 'Enchantment', oracle_text: 'Flying' },
      }],
    };
    expect(collectAttackYouTaxForDefender(state, 'p2').cost).toBe(0);
  });

  it('parses Baird plural planeswalkers, Sphere enchantment count, and domain', () => {
    const baird = {
      battlefield: [{
        id: 'baird_1',
        controller: 'p2',
        card: { name: 'Argive Steward', type_line: 'Creature — Human Soldier', oracle_text: BAIRD_ORACLE },
      }],
    };
    expect(collectAttackYouTaxForDefender(baird, 'p2').cost).toBe(1);

    const sphere = {
      battlefield: [
        {
          id: 'sphere_1',
          controller: 'p2',
          card: { name: 'Safety Field', type_line: 'Enchantment', oracle_text: SPHERE_OF_SAFETY_ORACLE },
        },
        {
          id: 'other_ench_1',
          controller: 'p2',
          card: { name: 'Pacifism', type_line: 'Enchantment — Aura', oracle_text: '' },
        },
        {
          id: 'enemy_ench_1',
          controller: 'p1',
          card: { name: 'Propaganda', type_line: 'Enchantment', oracle_text: GHOSTLY_PRISON_ORACLE },
        },
      ],
    };
    expect(collectAttackYouTaxForDefender(sphere, 'p2').cost).toBe(2);

    const domain = {
      battlefield: [
        {
          id: 'restraint_1',
          controller: 'p2',
          card: { name: 'Domain Veil', type_line: 'Enchantment', oracle_text: COLLECTIVE_RESTRAINT_ORACLE },
        },
        {
          id: 'plains_1',
          controller: 'p2',
          card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
        },
        {
          id: 'island_1',
          controller: 'p2',
          card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
        },
      ],
    };
    expect(collectAttackYouTaxForDefender(domain, 'p2').cost).toBe(2);
  });

  it('parses {W/P} as phyrexian white-or-2-life, not generic 2', () => {
    const annex = {
      battlefield: [{
        id: 'annex_1',
        controller: 'p2',
        card: { name: 'White Gate', type_line: 'Artifact', oracle_text: NORNS_ANNEX_ORACLE },
      }],
    };
    expect(collectAttackYouTaxForDefender(annex, 'p2').cost).toBe(0);
    expect(collectAttackYouTaxPhyrexianForDefender(annex, 'p2').items).toEqual([
      expect.objectContaining({
        color: 'white',
        symbol: 'W',
        life: 2,
        source: 'White Gate',
      }),
    ]);
  });

  it('taxes Archangel of Tithes only while untapped and skips this-turn War Tax', () => {
    const archangel = {
      id: 'angel_1',
      controller: 'p2',
      tapped: false,
      card: { name: 'Tithe Angel', type_line: 'Creature — Angel', oracle_text: ARCHANGEL_ORACLE },
    };
    const untapped = { battlefield: [archangel] };
    expect(collectAttackYouTaxForDefender(untapped, 'p2').cost).toBe(1);

    const tapped = { battlefield: [{ ...archangel, tapped: true }] };
    expect(collectAttackYouTaxForDefender(tapped, 'p2').cost).toBe(0);

    const warTax = {
      battlefield: [{
        id: 'tax_1',
        controller: 'p2',
        card: { name: 'War Tax', type_line: 'Enchantment', oracle_text: WAR_TAX_ORACLE },
      }],
    };
    expect(collectAttackYouTaxForDefender(warTax, 'p2').cost).toBe(0);
  });

  it('taxes blockers from Archangel of Tithes only while attacking and skips this-turn War Cadence', () => {
    const archangel = {
      id: 'angel_1',
      controller: 'p1',
      tapped: true,
      attacking: 'p2',
      card: { name: 'Tithe Angel', type_line: 'Creature — Angel', oracle_text: ARCHANGEL_ORACLE },
    };
    const attacking = { battlefield: [archangel] };
    expect(collectStaticEffectSpecsFromState(attacking)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'all_creatures' },
        grant: { blockTaxGeneric: 1 },
        condition: { kind: 'source_is_attacking' },
        sourceController: 'p1',
      }),
    ]));
    expect(collectBlockTax(attacking)).toEqual({
      cost: 1,
      sources: ['Tithe Angel'],
    });

    const idle = { battlefield: [{ ...archangel, attacking: undefined, tapped: false }] };
    expect(collectBlockTax(idle).cost).toBe(0);
    expect(collectAttackYouTaxForDefender(idle, 'p1').cost).toBe(1);

    const warCadence = {
      battlefield: [{
        id: 'cadence_1',
        controller: 'p1',
        attacking: 'p2',
        card: { name: 'War Cadence', type_line: 'Enchantment', oracle_text: WAR_CADENCE_ORACLE },
      }],
    };
    expect(collectBlockTax(warCadence).cost).toBe(0);
  });

  it('prohibits black attackers and taxes nonblack attackers from Elephant Grass oracle', () => {
    const grass = {
      id: 'grass_1',
      controller: 'p2',
      card: { name: 'Savanna Veil', type_line: 'Enchantment', oracle_text: ELEPHANT_GRASS_ORACLE },
    };
    const blackZombie = {
      id: 'zombie_1',
      controller: 'p1',
      card: { name: 'Walking Corpse', type_line: 'Creature — Zombie', oracle_text: '', colors: ['B'] },
    };
    const greenBear = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', colors: ['G'] },
    };
    const state = { battlefield: [grass, blackZombie, greenBear] };

    expect(collectStaticEffectSpecsFromState(state)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        grant: { attackYouProhibited: true },
        condition: { kind: 'target_has_mana_color', color: 'black' },
        sourceController: 'p2',
      }),
      expect.objectContaining({
        grant: { attackYouTaxGeneric: 2 },
        condition: { kind: 'target_is_not_black_creature' },
        sourceController: 'p2',
      }),
    ]));
    expect(collectStaticEffectSpecsFromState(state).some(
      (spec) => spec.grant.abilities?.includes(CANT_ATTACK),
    )).toBe(false);

    expect(collectAttackYouTaxForDefender(state, 'p2').cost).toBe(0);
    expect(collectAttackYouTaxForDefender(state, 'p2', blackZombie as any).cost).toBe(0);
    expect(collectAttackYouProhibitionForAttacker(state, 'p2', blackZombie as any)).toBe('Savanna Veil');
    expect(collectAttackYouTaxForDefender(state, 'p2', greenBear as any)).toEqual({
      cost: 2,
      sources: ['Savanna Veil'],
    });
    expect(collectAttackYouProhibitionForAttacker(state, 'p2', greenBear as any)).toBeNull();
  });

  it("prohibits all attackers from Blazing Archon oracle without granting blanket can't-attack", () => {
    const archon = {
      id: 'archon_1',
      controller: 'p2',
      card: { name: 'Sun Archon', type_line: 'Creature — Archon', oracle_text: BLAZING_ARCHON_ORACLE },
    };
    const greenBear = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', colors: ['G'] },
    };
    const state = { battlefield: [archon, greenBear] };

    expect(collectStaticEffectSpecsFromState(state)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        grant: { attackYouProhibited: true },
        sourceController: 'p2',
      }),
    ]));
    expect(collectStaticEffectSpecsFromState(state).some(
      (spec) => spec.grant.abilities?.includes(CANT_ATTACK),
    )).toBe(false);
    expect(collectAttackYouTaxForDefender(state, 'p2', greenBear as any).cost).toBe(0);
    expect(collectAttackYouProhibitionForAttacker(state, 'p2', greenBear as any)).toBe('Sun Archon');
  });

  it("prohibits non-flyers from Form of the Dragon and flyers from Sandwurm, without blanket can't-attack", () => {
    const dragon = {
      id: 'form_1',
      controller: 'p2',
      card: { name: 'Dragon Shape', type_line: 'Enchantment', oracle_text: FORM_OF_THE_DRAGON_ORACLE },
    };
    const bear = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: 2 },
    };
    const hawk = {
      id: 'hawk_1',
      controller: 'p1',
      card: { name: "Healer's Hawk", type_line: 'Creature — Bird', oracle_text: 'Flying, lifelink', power: 1 },
    };
    const dragonState = { battlefield: [dragon, bear, hawk] };
    expect(collectStaticEffectSpecsFromState(dragonState)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        grant: { attackYouProhibited: true },
        condition: { kind: 'target_lacks_keyword', keyword: 'flying' },
        sourceController: 'p2',
      }),
    ]));
    expect(collectStaticEffectSpecsFromState(dragonState).some(
      (spec) => spec.grant.abilities?.includes(CANT_ATTACK),
    )).toBe(false);
    expect(collectAttackYouProhibitionForAttacker(dragonState, 'p2', bear as any)).toBe('Dragon Shape');
    expect(collectAttackYouProhibitionForAttacker(dragonState, 'p2', hawk as any)).toBeNull();

    const sandwurm = {
      id: 'wurm_1',
      controller: 'p2',
      card: { name: 'Wurm Field', type_line: 'Enchantment', oracle_text: SANDWURM_ORACLE },
    };
    const wurmState = { battlefield: [sandwurm, bear, hawk] };
    expect(collectAttackYouProhibitionForAttacker(wurmState, 'p2', hawk as any)).toBe('Wurm Field');
    expect(collectAttackYouProhibitionForAttacker(wurmState, 'p2', bear as any)).toBeNull();
  });

  it('honors layer-6 flying grants and losses for Form of the Dragon', () => {
    const dragon = {
      id: 'form_1',
      controller: 'p2',
      card: { name: 'Dragon Shape', type_line: 'Enchantment', oracle_text: FORM_OF_THE_DRAGON_ORACLE },
    };
    const bear = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: 2 },
    };
    const hawk = {
      id: 'hawk_1',
      controller: 'p1',
      card: { name: "Healer's Hawk", type_line: 'Creature — Bird', oracle_text: 'Flying', power: 1 },
    };
    const levitation = {
      id: 'lev_1',
      controller: 'p1',
      card: { name: 'Sky Gift', type_line: 'Enchantment', oracle_text: LEVITATION_ORACLE },
    };
    const sphere = {
      id: 'sphere_1',
      controller: 'p3',
      card: { name: 'Gravity Well', type_line: 'Enchantment', oracle_text: GRAVITY_SPHERE_ORACLE },
    };
    const withLevitation = { battlefield: [dragon, bear, levitation] };
    expect(collectAttackYouProhibitionForAttacker(withLevitation, 'p2', bear as any)).toBeNull();

    const withSphere = { battlefield: [dragon, hawk, sphere] };
    expect(collectAttackYouProhibitionForAttacker(withSphere, 'p2', hawk as any)).toBe('Dragon Shape');
  });

  it('prohibits power 2 or less from Reverence and Inklings from Combat Calligrapher', () => {
    const reverence = {
      id: 'rev_1',
      controller: 'p2',
      card: { name: 'Quiet Shrine', type_line: 'Enchantment', oracle_text: REVERENCE_ORACLE },
    };
    const small = {
      id: 'small_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: 2 },
    };
    const large = {
      id: 'large_1',
      controller: 'p1',
      card: { name: 'Craw Wurm', type_line: 'Creature — Wurm', oracle_text: '', power: 6 },
    };
    const revState = { battlefield: [reverence, small, large] };
    expect(collectAttackYouProhibitionForAttacker(revState, 'p2', small as any)).toBe('Quiet Shrine');
    expect(collectAttackYouProhibitionForAttacker(revState, 'p2', large as any)).toBeNull();

    const calligrapher = {
      id: 'ink_1',
      controller: 'p2',
      card: { name: 'Ink Scribe', type_line: 'Creature — Demon', oracle_text: CALLIGRAPHER_ORACLE },
    };
    const inkling = {
      id: 'token_1',
      controller: 'p1',
      card: { name: 'Inkling', type_line: 'Creature — Inkling', oracle_text: 'Flying', power: 2 },
    };
    const inkState = { battlefield: [calligrapher, inkling, small] };
    expect(collectAttackYouProhibitionForAttacker(inkState, 'p2', inkling as any)).toBe('Ink Scribe');
    expect(collectAttackYouProhibitionForAttacker(inkState, 'p2', small as any)).toBeNull();
  });

  it("does not parse Teferi's Moat without a chosen color, and gates chosen-color non-flyers when chosen", () => {
    const moat = {
      id: 'moat_1',
      controller: 'p2',
      card: { name: 'Color Moat', type_line: 'Enchantment', oracle_text: TEFERIS_MOAT_ORACLE },
    };
    const redBear = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: 2, colors: ['R'] },
    };
    const blueBear = {
      id: 'bear_2',
      controller: 'p1',
      card: { name: 'Merfolk of the Pearl Trident', type_line: 'Creature — Merfolk', oracle_text: '', power: 1, colors: ['U'] },
    };
    const blueHawk = {
      id: 'hawk_1',
      controller: 'p1',
      card: { name: 'Storm Crow', type_line: 'Creature — Bird', oracle_text: 'Flying', power: 1, colors: ['U'] },
    };
    const unchosen = { battlefield: [moat, redBear] };
    expect(collectAttackYouProhibitionForAttacker(unchosen, 'p2', redBear as any)).toBeNull();
    expect(collectStaticEffectSpecsFromState(unchosen).some((spec) => spec.grant.attackYouProhibited)).toBe(false);

    const chosenMoat = { ...moat, chosenColor: 'blue' };
    const chosen = { battlefield: [chosenMoat, redBear, blueBear, blueHawk] };
    expect(collectAttackYouProhibitionForAttacker(chosen, 'p2', blueBear as any)).toBe('Color Moat');
    expect(collectAttackYouProhibitionForAttacker(chosen, 'p2', redBear as any)).toBeNull();
    expect(collectAttackYouProhibitionForAttacker(chosen, 'p2', blueHawk as any)).toBeNull();
  });

  it('prohibits only the enchanted or equipped host from attacking the aura/equipment controller', () => {
    const bear = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: 2 },
    };
    const other = {
      id: 'bear_2',
      controller: 'p1',
      card: { name: 'Runeclaw Bear', type_line: 'Creature — Bear', oracle_text: '', power: 2 },
    };
    const vow = {
      id: 'vow_1',
      controller: 'p2',
      attachedTo: 'bear_1',
      card: { name: 'Oath Band', type_line: 'Enchantment — Aura', oracle_text: VOW_DUTY_ORACLE },
    };
    const vowState = { battlefield: [vow, bear, other] };
    expect(collectStaticEffectSpecsFromState(vowState)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { attackYouProhibited: true },
        sourcePermanentId: 'bear_1',
        sourceController: 'p2',
      }),
    ]));
    expect(collectStaticEffectSpecsFromState(vowState).some(
      (spec) => spec.grant.abilities?.includes(CANT_ATTACK),
    )).toBe(false);
    expect(collectAttackYouProhibitionForAttacker(vowState, 'p2', bear as any)).toBe('Oath Band');
    expect(collectAttackYouProhibitionForAttacker(vowState, 'p2', other as any)).toBeNull();
    expect(collectAttackYouProhibitionForAttacker(vowState, 'p3', bear as any)).toBeNull();

    const unattached = {
      battlefield: [{ ...vow, attachedTo: undefined }, bear],
    };
    expect(collectAttackYouProhibitionForAttacker(unattached, 'p2', bear as any)).toBeNull();

    const grasp = {
      id: 'grasp_1',
      controller: 'p2',
      attachedTo: 'bear_1',
      card: { name: 'Pale Bind', type_line: 'Enchantment — Aura', oracle_text: SPECTRAL_GRASP_ORACLE },
    };
    const graspState = { battlefield: [grasp, bear, other] };
    expect(collectAttackYouProhibitionForAttacker(graspState, 'p2', bear as any)).toBe('Pale Bind');
    expect(collectAttackYouProhibitionForAttacker(graspState, 'p2', other as any)).toBeNull();

    const suit = {
      id: 'suit_1',
      controller: 'p2',
      attachedTo: 'bear_1',
      card: { name: 'War Harness', type_line: 'Artifact — Equipment', oracle_text: ASSAULT_SUIT_ORACLE },
    };
    const suitState = { battlefield: [suit, bear, other] };
    expect(collectAttackYouProhibitionForAttacker(suitState, 'p2', bear as any)).toBe('War Harness');
    expect(collectAttackYouProhibitionForAttacker(suitState, 'p2', other as any)).toBeNull();
  });

  it('caps attackers vs you from Crawlspace and globally from Silent Arbiter', () => {
    const crawl = {
      id: 'crawl_1',
      controller: 'p2',
      card: { name: 'Narrow Tunnel', type_line: 'Artifact', oracle_text: CRAWLSPACE_ORACLE },
    };
    const crawlState = { battlefield: [crawl] };
    expect(collectAttackYouMaxAttackersForDefender(crawlState, 'p2')).toEqual({
      max: 2,
      sources: ['Narrow Tunnel'],
    });
    expect(collectAttackYouMaxAttackersForDefender(crawlState, 'p1').max).toBeNull();

    const arbiter = {
      battlefield: [{
        id: 'arbiter_1',
        controller: 'p2',
        card: {
          name: 'Gate Warden',
          type_line: 'Artifact Creature — Construct',
          oracle_text: SILENT_ARBITER_ORACLE,
        },
      }],
    };
    expect(collectAttackYouMaxAttackersForDefender(arbiter, 'p2').max).toBeNull();
    expect(collectMaxAttackersEachCombat(arbiter)).toEqual({
      max: 1,
      sources: ['Gate Warden'],
    });
    expect(collectMaxBlockersEachCombat(arbiter)).toEqual({
      max: 1,
      sources: ['Gate Warden'],
    });
    expect(collectMaxAttackersEachCombat(crawlState).max).toBeNull();
    expect(collectMaxBlockersEachCombat(crawlState).max).toBeNull();

    const caverns = {
      battlefield: [{
        id: 'caverns_1',
        controller: 'p2',
        card: {
          name: 'Tight Pass',
          type_line: 'World Enchantment',
          oracle_text: CAVERNS_OF_DESPAIR_ORACLE,
        },
      }],
    };
    expect(collectMaxAttackersEachCombat(caverns)).toEqual({
      max: 2,
      sources: ['Tight Pass'],
    });
    expect(collectMaxBlockersEachCombat(caverns)).toEqual({
      max: 2,
      sources: ['Tight Pass'],
    });
  });

  it('prohibits creatures enchanted by an Aura you control from Eriette oracle', () => {
    const eriette = {
      id: 'eri_1',
      controller: 'p2',
      card: { name: 'Charmed Witch', type_line: 'Legendary Creature — Human', oracle_text: ERIETTE_ORACLE },
    };
    const bear = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: 2 },
    };
    const other = {
      id: 'bear_2',
      controller: 'p1',
      card: { name: 'Runeclaw Bear', type_line: 'Creature — Bear', oracle_text: '', power: 2 },
    };
    const yourAura = {
      id: 'aura_1',
      controller: 'p2',
      attachedTo: 'bear_1',
      card: {
        name: 'Glimmer',
        type_line: 'Enchantment — Aura',
        oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1.',
      },
    };
    const theirAura = {
      id: 'aura_2',
      controller: 'p1',
      attachedTo: 'bear_2',
      card: {
        name: 'Enemy Bind',
        type_line: 'Enchantment — Aura',
        oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1.',
      },
    };
    const state = { battlefield: [eriette, bear, other, yourAura, theirAura] };
    expect(collectAttackYouProhibitionForAttacker(state, 'p2', bear as any)).toBe('Charmed Witch');
    expect(collectAttackYouProhibitionForAttacker(state, 'p2', other as any)).toBeNull();
    expect(collectStaticEffectSpecsFromState(state).some(
      (spec) => spec.grant.abilities?.includes(CANT_ATTACK),
    )).toBe(false);
  });

  it('does not lock attackers from idle Island Sanctuary replacement oracle', () => {
    const sanctuary = {
      id: 'sanctuary_1',
      controller: 'p2',
      card: {
        name: 'Shore Refuge',
        type_line: 'Enchantment',
        oracle_text: ISLAND_SANCTUARY_ORACLE,
      },
    };
    const bear = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: 2 },
    };
    const hawk = {
      id: 'hawk_1',
      controller: 'p1',
      card: { name: "Healer's Hawk", type_line: 'Creature — Bird', oracle_text: 'Flying', power: 1 },
    };
    const idle = { battlefield: [sanctuary, bear, hawk] };
    expect(collectStaticEffectSpecsFromState(idle).some((spec) => spec.grant.attackYouProhibited)).toBe(false);
    expect(collectAttackYouProhibitionForAttacker(idle, 'p2', bear as any)).toBeNull();
    expect(collectAttackYouProhibitionForAttacker(idle, 'p2', hawk as any)).toBeNull();

    const standalone = {
      battlefield: [{
        ...sanctuary,
        card: { ...sanctuary.card, oracle_text: ISLAND_SANCTUARY_LOCK_STANDALONE },
      }, bear],
    };
    expect(collectStaticEffectSpecsFromState(standalone)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        grant: { attackYouProhibited: true },
        condition: { kind: 'target_lacks_all_keywords', keywords: ['flying', 'islandwalk'] },
        sourceController: 'p2',
      }),
    ]));
  });

  it('prohibits non-flyers without islandwalk from an injected Island Sanctuary stamp', () => {
    const bear = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: 2 },
    };
    const hawk = {
      id: 'hawk_1',
      controller: 'p1',
      card: { name: "Healer's Hawk", type_line: 'Creature — Bird', oracle_text: 'Flying', power: 1 },
    };
    const walker = {
      id: 'walker_1',
      controller: 'p1',
      card: {
        name: 'Harbor Scout',
        type_line: 'Creature — Merfolk',
        oracle_text: 'Islandwalk',
        power: 1,
      },
    };
    const state = {
      battlefield: [bear, hawk, walker],
      lastingEffects: [{
        type: 'attackYouProhibitedExceptKeywords',
        targetPlayer: 'p2',
        keywords: ['flying', 'islandwalk'],
        duration: 'until_next_turn',
        source: 'Shore Refuge',
      }],
    };
    expect(collectAttackYouProhibitionForAttacker(state, 'p2', bear as any)).toBe('Shore Refuge');
    expect(collectAttackYouProhibitionForAttacker(state, 'p2', hawk as any)).toBeNull();
    expect(collectAttackYouProhibitionForAttacker(state, 'p2', walker as any)).toBeNull();
  });

  it('honors layer-6 flying grants and losses for an Island Sanctuary stamp', () => {
    const bear = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: 2 },
    };
    const hawk = {
      id: 'hawk_1',
      controller: 'p1',
      card: { name: "Healer's Hawk", type_line: 'Creature — Bird', oracle_text: 'Flying', power: 1 },
    };
    const levitation = {
      id: 'lev_1',
      controller: 'p1',
      card: { name: 'Sky Gift', type_line: 'Enchantment', oracle_text: LEVITATION_ORACLE },
    };
    const sphere = {
      id: 'sphere_1',
      controller: 'p3',
      card: { name: 'Gravity Well', type_line: 'Enchantment', oracle_text: GRAVITY_SPHERE_ORACLE },
    };
    const stamp = {
      type: 'attackYouProhibitedExceptKeywords',
      targetPlayer: 'p2',
      keywords: ['flying', 'islandwalk'],
      duration: 'until_next_turn',
      source: 'Shore Refuge',
    };
    const withLevitation = { battlefield: [bear, levitation], lastingEffects: [stamp] };
    expect(collectAttackYouProhibitionForAttacker(withLevitation, 'p2', bear as any)).toBeNull();

    const withSphere = { battlefield: [hawk, sphere], lastingEffects: [stamp] };
    expect(collectAttackYouProhibitionForAttacker(withSphere, 'p2', hawk as any)).toBe('Shore Refuge');
  });

  it('stamps lastingEffects from the until-your-next-turn except-attacked lock clause', () => {
    const ir = parseOracleTextToIR(ISLAND_SANCTUARY_LOCK_CLAUSE, 'Shore Refuge');
    const grants = (ir.abilities || []).flatMap((ability) => ability.steps || [])
      .filter((step) => step.kind === 'grant_static_ability');
    expect(grants).toEqual([
      expect.objectContaining({
        kind: 'grant_static_ability',
        duration: 'until_next_turn',
        effectText: ["can't be attacked except by creatures with flying and/or islandwalk"],
      }),
    ]);

    const result = applyOracleIRStepsToGameState(
      {
        id: 'island-sanctuary-lock',
        format: 'commander',
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] },
          { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
        ],
        battlefield: [],
        stack: [],
        turnPlayer: 'p1',
        priority: 'p1',
        active: true,
        turnNumber: 3,
      } as any,
      grants,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'lock_1',
        sourceName: 'Shore Refuge',
        sourceObjectType: 'spell',
      } as any),
    );
    expect((result.state as any).lastingEffects).toEqual([
      expect.objectContaining({
        type: 'attackYouProhibitedExceptKeywords',
        duration: 'until_next_turn',
        targetPlayer: 'p1',
        keywords: ['flying', 'islandwalk'],
        source: 'Shore Refuge',
      }),
    ]);
  });

  it('charges Nils {X} equal to counters on the attacking creature', () => {
    const nilsOracle =
      "At the beginning of your end step, for each player, put a +1/+1 counter on up to one target creature that player controls.\nEach creature with one or more counters on it can't attack you or planeswalkers you control unless its controller pays {X}, where X is the number of counters on that creature.";
    const state = {
      battlefield: [
        {
          id: 'nils_1',
          controller: 'p2',
          card: {
            name: 'Nils, Discipline Enforcer',
            type_line: 'Legendary Creature — Human Cleric',
            oracle_text: nilsOracle,
          },
        },
      ],
    };
    const attacker = {
      id: 'bear_1',
      controller: 'p1',
      counters: { '+1/+1': 2, lore: 1 },
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    };
    expect(collectAttackYouTaxForDefender(state, 'p2', attacker as any).cost).toBe(3);
    expect(collectAttackYouTaxForDefender(state, 'p2', {
      ...attacker,
      counters: {},
    } as any).cost).toBe(0);
  });

  it('parses Onakke Oathkeeper as planeswalker-only tax', () => {
    const state = {
      battlefield: [
        {
          id: 'onakke_1',
          controller: 'p2',
          card: {
            name: 'Onakke Oathkeeper',
            type_line: 'Creature — Ogre Spirit',
            oracle_text:
              "Creatures can't attack planeswalkers you control unless their controller pays {1} for each creature they control that's attacking a planeswalker you control.",
          },
        },
        {
          id: 'pw_1',
          controller: 'p2',
          card: { name: 'Jace', type_line: 'Legendary Planeswalker — Jace', oracle_text: '' },
        },
      ],
    };
    const attacker = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    };
    expect(collectAttackYouTaxForDefender(state, 'p2', attacker as any).cost).toBe(0);
    expect(collectAttackYouTaxForDefender(state, 'p2', attacker as any, {
      attackTargetPermanentId: 'pw_1',
    }).cost).toBe(1);
  });

  it('parses Heat Wave as per-blocker life tax except blue', () => {
    const state = {
      battlefield: [
        {
          id: 'heat_1',
          controller: 'p2',
          card: {
            name: 'Heat Wave',
            type_line: 'Enchantment',
            oracle_text:
              "Cumulative upkeep {R} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nBlue creatures can't block creatures you control.\nNonblue creatures can't block creatures you control unless their controller pays 1 life for each blocking creature they control.",
          },
        },
        {
          id: 'blocker_green',
          controller: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear', colors: ['G'] },
        },
        {
          id: 'blocker_blue',
          controller: 'p1',
          card: { name: 'Merfolk', type_line: 'Creature — Merfolk', colors: ['U'] },
        },
      ],
    };
    expect(collectBlockLifeTax(state, {
      uniqueBlockerIds: new Set(['blocker_green', 'blocker_blue']),
      blockerIsTaxed: () => true,
    }).cost).toBe(1);
  });

  it('locks Heat Wave blue creatures from blocking the source controller\'s creatures', () => {
    const state = {
      battlefield: [
        {
          id: 'heat_1',
          controller: 'p2',
          card: {
            name: 'Heat Wave',
            type_line: 'Enchantment',
            oracle_text:
              "Cumulative upkeep {R} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nBlue creatures can't block creatures you control.\nNonblue creatures can't block creatures you control unless their controller pays 1 life for each blocking creature they control.",
          },
        },
        {
          id: 'blocker_green',
          controller: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear', colors: ['G'] },
        },
        {
          id: 'blocker_blue',
          controller: 'p1',
          card: { name: 'Merfolk', type_line: 'Creature — Merfolk', colors: ['U'] },
        },
      ],
    };
    const green = state.battlefield[1] as any;
    const blue = state.battlefield[2] as any;
    expect(blockerCantBlockCreaturesYouControl(state as any, blue, 'p2')).toBe(true);
    expect(blockerCantBlockCreaturesYouControl(state as any, green, 'p2')).toBe(false);
    expect(blockerCantBlockCreaturesYouControl(state as any, blue, 'p1')).toBe(false);
  });
});

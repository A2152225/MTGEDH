import { describe, expect, it } from 'vitest';

import {
  applyDeclarativeStaticSpecs,
  collectStaticEffectSpecsFromState,
  getContinuousGrantedAbilitiesForPermanent,
  recomputeContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import {
  ALL_ABLE_CREATURES_MUST_BLOCK,
  MUST_BE_BLOCKED_IF_ABLE,
} from '../src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingMustBeBlocked.js';
import { typedMustBeBlockedAbility } from '../src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingMustBeBlockedByType.js';

// Quoted from mtg_data.db / oracle-cards (is_token = 0), 2026-08-25.
const SARYTH_ORACLE =
  'Other tapped creatures you control have deathtouch.\nOther untapped creatures you control have hexproof.\n{1}, {T}: Untap another target creature or land you control.';
const LURE_ORACLE =
  'Enchant creature\nAll creatures able to block enchanted creature do so.';
const SHINEN_ORACLE =
  'All creatures able to block this creature do so.\nChannel — {2}{G}{G}, Discard this card: All creatures able to block target creature this turn do so.';
const FIRE_FIEND_ORACLE =
  'Haste\nThis creature must be blocked if able.\n{R}: This creature gets +1/+0 until end of turn.';
const PREDATORY_IMPETUS_ORACLE =
  'Enchant creature\nEnchanted creature gets +3/+3, must be blocked if able, and is goaded. (It attacks each combat if able and attacks a player other than you if able.)';
const INDRIK_UMBRA_ORACLE =
  'Enchant creature\nEnchanted creature gets +4/+4 and has first strike, and all creatures able to block it do so.\nUmbra armor (If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura.)';
const GIFT_OF_THE_DEITY_ORACLE =
  'Enchant creature\nAs long as enchanted creature is black, it gets +1/+1 and has deathtouch. (Any amount of damage it deals to a creature is enough to destroy that creature.)\nAs long as enchanted creature is green, it gets +1/+1 and all creatures able to block it do so.';
const NOBLE_QUARRY_ORACLE =
  "Bestow {5}{G} (If you cast this card for its bestow cost, it's an Aura spell with enchant creature. It becomes a creature again if it's not attached.)\nAll creatures able to block this creature or enchanted creature do so.\nEnchanted creature gets +1/+1.";
const JURIN_ORACLE =
  'Haste\nJurin must be blocked if able.\nWhenever Jurin attacks, each creature you control attacking a player gets +1/+0 until end of turn for each creature that player controls.';
const MASAMUNE_ORACLE =
  'As long as equipped creature is attacking, it has first strike and must be blocked if able.\nEquipped creature has "If a creature dying causes a triggered ability of this creature or an emblem you own to trigger, that ability triggers an additional time."\nEquip {2}';
const FRODO_BAGGINS_ORACLE =
  'Whenever Frodo Baggins or another legendary creature you control enters, the Ring tempts you.\nAs long as Frodo Baggins is your Ring-bearer, it must be blocked if able.';
const SETONS_DESIRE_ORACLE =
  'Enchant creature\nEnchanted creature gets +2/+2.\nThreshold — As long as there are seven or more cards in your graveyard, all creatures able to block enchanted creature do so.';
const ENKIRA_ORACLE =
  "When Enkira, Hostile Scavenger enters, create two Walker tokens. (They're 2/2 black Zombie creatures.)\nAs long as Enkira is equipped, it must be blocked if able.\nWhenever Enkira and at least two Zombies attack, Enkira gains indestructible until end of turn.";
// Synthetic template for the raid / if-you-attacked lure condition.
// No current mtg_data.db card prints both “must be blocked if able” and “if you attacked”.
const RAID_LURE_ORACLE =
  'As long as you attacked this turn, this creature must be blocked if able.';
const TYPED_MUST_BLOCK_ORACLE =
  'This creature must be blocked by a creature with flying if able.';
const GLARING_SPOTLIGHT_ORACLE =
  "Creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.\n{3}, Sacrifice this artifact: Creatures you control gain hexproof until end of turn and can't be blocked this turn.";
const ARCHETYPE_OF_ENDURANCE_ORACLE =
  "Creatures you control have hexproof.\nCreatures your opponents control lose hexproof and can't have or gain hexproof.";
const ARCANE_LIGHTHOUSE_ORACLE =
  "{T}: Add {C}.\n{1}, {T}: Until end of turn, creatures your opponents control lose hexproof and shroud and can't have hexproof or shroud.";
const NOWHERE_TO_RUN_ORACLE =
  "Flash\nWhen this enchantment enters, target creature an opponent controls gets -3/-3 until end of turn.\nCreatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof. Ward abilities of those creatures don't trigger.";
const KAYA_BANE_ORACLE =
  "Your opponents and permanents your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.\n[−3]: Exile target creature.";
const DETECTION_TOWER_ORACLE =
  "{T}: Add {C}.\n{1}, {T}: Until end of turn, your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.";
const YOU_PLANESWALKERS_OTHER_CREATURES_HEXPROOF_ORACLE =
  'Flying\nYou, planeswalkers you control, and other creatures you control have hexproof.\n{4}{G}{G}: Put a +1/+1 counter on each creature you control.';
const YOU_AND_OTHER_CREATURES_HEXPROOF_ORACLE =
  'You and other creatures you control have hexproof.';

describe('staticEffectSpec leftover oracle templates', () => {
  it('grants deathtouch to other tapped creatures and hexproof to other untapped creatures', () => {
    const state = {
      battlefield: [
        {
          id: 'saryth_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: "Saryth, the Viper's Fang",
            type_line: 'Legendary Creature — Human Warlock',
            oracle_text: SARYTH_ORACLE,
          },
        },
        {
          id: 'tapped_ally',
          controller: 'p1',
          tapped: true,
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
        {
          id: 'untapped_ally',
          controller: 'p1',
          tapped: false,
          card: { name: 'Elite Vanguard', type_line: 'Creature — Human Soldier', oracle_text: '' },
        },
        {
          id: 'tapped_enemy',
          controller: 'p2',
          tapped: true,
          card: { name: 'Goblin', type_line: 'Creature — Goblin', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'other_creatures_you_control' },
        grant: { abilities: ['deathtouch'] },
        condition: { kind: 'target_is_tapped' },
      }),
      expect.objectContaining({
        scope: { kind: 'other_creatures_you_control' },
        grant: { abilities: ['hexproof'] },
        condition: { kind: 'target_is_untapped' },
      }),
    ]));

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('tapped_ally')?.abilities?.has('deathtouch')).toBe(true);
    expect(merged.perPermanent.get('tapped_ally')?.abilities?.has('hexproof')).toBeFalsy();
    expect(merged.perPermanent.get('untapped_ally')?.abilities?.has('hexproof')).toBe(true);
    expect(merged.perPermanent.get('untapped_ally')?.abilities?.has('deathtouch')).toBeFalsy();
    expect(merged.perPermanent.get('saryth_1')?.abilities?.has('deathtouch')).toBeFalsy();
    expect(merged.perPermanent.get('saryth_1')?.abilities?.has('hexproof')).toBeFalsy();
    expect(merged.perPermanent.get('tapped_enemy')?.abilities?.has('deathtouch')).toBeFalsy();
  });

  it('grants all-able-must-block to an enchanted host from Lure oracle', () => {
    const state = {
      battlefield: [
        {
          id: 'lure_1',
          controller: 'p1',
          attachedTo: 'bear_1',
          card: {
            name: 'Lure',
            type_line: 'Enchantment — Aura',
            oracle_text: LURE_ORACLE,
          },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [ALL_ABLE_CREATURES_MUST_BLOCK] },
        sourcePermanentId: 'bear_1',
      }),
    ]));

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('bear_1')?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBe(true);
    expect(merged.perPermanent.get('bear_1')?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBeFalsy();
    expect(merged.perPermanent.get('lure_1')?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBeFalsy();
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state))
      .toContain(ALL_ABLE_CREATURES_MUST_BLOCK);
  });

  it('grants all-able-must-block to self from Shinen of Life\'s Roar oracle', () => {
    const state = {
      battlefield: [{
        id: 'shinen_1',
        controller: 'p1',
        card: {
          name: "Shinen of Life's Roar",
          type_line: 'Creature — Spirit',
          oracle_text: SHINEN_ORACLE,
        },
      }],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [ALL_ABLE_CREATURES_MUST_BLOCK] },
        sourcePermanentId: 'shinen_1',
      }),
    ]));
    expect(specs.filter((spec) => spec.grant.abilities?.includes(ALL_ABLE_CREATURES_MUST_BLOCK)))
      .toHaveLength(1);
    expect(specs.filter((spec) => spec.grant.abilities?.includes(MUST_BE_BLOCKED_IF_ABLE)))
      .toHaveLength(0);

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('shinen_1')?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBe(true);
    expect(merged.perPermanent.get('shinen_1')?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBeFalsy();
  });

  it('grants must-be-blocked-if-able to self from Goblin Fire Fiend oracle', () => {
    const state = {
      battlefield: [{
        id: 'fiend_1',
        controller: 'p1',
        card: {
          name: 'Goblin Fire Fiend',
          type_line: 'Creature — Goblin Berserker',
          oracle_text: FIRE_FIEND_ORACLE,
        },
      }],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [MUST_BE_BLOCKED_IF_ABLE] },
        sourcePermanentId: 'fiend_1',
      }),
    ]));
    expect(specs.filter((spec) => spec.grant.abilities?.includes(ALL_ABLE_CREATURES_MUST_BLOCK)))
      .toHaveLength(0);

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('fiend_1')?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBe(true);
    expect(merged.perPermanent.get('fiend_1')?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBeFalsy();
  });

  it('grants at-least-one to an Impetus host from the goad list, without faking goad', () => {
    const state = {
      battlefield: [
        {
          id: 'impetus_1',
          controller: 'p1',
          attachedTo: 'bear_1',
          card: {
            name: 'Predatory Impetus',
            type_line: 'Enchantment — Aura',
            oracle_text: PREDATORY_IMPETUS_ORACLE,
          },
        },
        {
          id: 'bear_1',
          controller: 'p2',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [MUST_BE_BLOCKED_IF_ABLE] },
        sourcePermanentId: 'bear_1',
      }),
    ]));
    expect(specs.filter((spec) => spec.grant.abilities?.includes(MUST_BE_BLOCKED_IF_ABLE)))
      .toHaveLength(1);
    expect(specs.filter((spec) => spec.grant.abilities?.includes(ALL_ABLE_CREATURES_MUST_BLOCK)))
      .toHaveLength(0);
    expect(specs.some((spec) => (
      spec.sourcePermanentId === 'bear_1'
      && Array.isArray(spec.grant.abilities)
      && spec.grant.abilities.some((ability) => String(ability).toLowerCase().includes('goad'))
    ))).toBe(false);

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('bear_1')?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBe(true);
    expect(merged.perPermanent.get('bear_1')?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBeFalsy();
    expect(merged.perPermanent.get('impetus_1')?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBeFalsy();
  });

  it('grants all-able to an Umbra host from "able to block it" list text', () => {
    const state = {
      battlefield: [
        {
          id: 'umbra_1',
          controller: 'p1',
          attachedTo: 'bear_1',
          card: {
            name: 'Indrik Umbra',
            type_line: 'Enchantment — Aura',
            oracle_text: INDRIK_UMBRA_ORACLE,
          },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [ALL_ABLE_CREATURES_MUST_BLOCK, 'first strike'] },
        sourcePermanentId: 'bear_1',
      }),
    ]));
    expect(specs.filter((spec) => spec.grant.abilities?.includes(ALL_ABLE_CREATURES_MUST_BLOCK)))
      .toHaveLength(1);

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('bear_1')?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBe(true);
    expect(merged.perPermanent.get('bear_1')?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBeFalsy();
  });

  it('grants all-able only while the Gift of the Deity host is green', () => {
    const state = {
      battlefield: [
        {
          id: 'gift_1',
          controller: 'p1',
          attachedTo: 'green_1',
          card: {
            name: 'Gift of the Deity',
            type_line: 'Enchantment — Aura',
            oracle_text: GIFT_OF_THE_DEITY_ORACLE,
          },
        },
        {
          id: 'green_1',
          controller: 'p2',
          card: {
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            oracle_text: '',
            colors: ['G'],
          },
        },
        {
          id: 'gift_2',
          controller: 'p1',
          attachedTo: 'red_1',
          card: {
            name: 'Gift of the Deity',
            type_line: 'Enchantment — Aura',
            oracle_text: GIFT_OF_THE_DEITY_ORACLE,
          },
        },
        {
          id: 'red_1',
          controller: 'p2',
          card: {
            name: 'Goblin',
            type_line: 'Creature — Goblin',
            oracle_text: '',
            colors: ['R'],
          },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [ALL_ABLE_CREATURES_MUST_BLOCK] },
        sourcePermanentId: 'green_1',
        condition: { kind: 'target_has_mana_color', color: 'green' },
      }),
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [ALL_ABLE_CREATURES_MUST_BLOCK] },
        sourcePermanentId: 'red_1',
        condition: { kind: 'target_has_mana_color', color: 'green' },
      }),
    ]));

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('green_1')?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBe(true);
    expect(merged.perPermanent.get('red_1')?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBeFalsy();
  });

  it('grants all-able to Noble Quarry itself, or to its bestowed host', () => {
    const creatureState = {
      battlefield: [{
        id: 'quarry_1',
        controller: 'p1',
        card: {
          name: 'Noble Quarry',
          type_line: 'Enchantment Creature — Unicorn',
          oracle_text: NOBLE_QUARRY_ORACLE,
        },
      }],
    };
    const bestowedState = {
      battlefield: [
        {
          id: 'quarry_1',
          controller: 'p1',
          attachedTo: 'bear_1',
          card: {
            name: 'Noble Quarry',
            type_line: 'Enchantment — Aura',
            oracle_text: NOBLE_QUARRY_ORACLE,
          },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    expect(collectStaticEffectSpecsFromState(creatureState)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [ALL_ABLE_CREATURES_MUST_BLOCK] },
        sourcePermanentId: 'quarry_1',
      }),
    ]));
    expect(recomputeContinuousEffects(creatureState as any).perPermanent.get('quarry_1')
      ?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBe(true);

    const bestowedSpecs = collectStaticEffectSpecsFromState(bestowedState);
    expect(bestowedSpecs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [ALL_ABLE_CREATURES_MUST_BLOCK] },
        sourcePermanentId: 'bear_1',
      }),
    ]));
    expect(bestowedSpecs.some((spec) => (
      spec.sourcePermanentId === 'quarry_1'
      && spec.grant.abilities?.includes(ALL_ABLE_CREATURES_MUST_BLOCK)
    ))).toBe(false);
    expect(recomputeContinuousEffects(bestowedState as any).perPermanent.get('bear_1')
      ?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBe(true);
  });

  it('grants at-least-one from named-self must-block oracle, not the printed name', () => {
    const state = {
      battlefield: [{
        id: 'jurin_1',
        controller: 'p1',
        card: {
          name: 'Jurin, Leading the Charge',
          type_line: 'Legendary Creature — Human Barbarian',
          oracle_text: JURIN_ORACLE,
        },
      }],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [MUST_BE_BLOCKED_IF_ABLE] },
        sourcePermanentId: 'jurin_1',
      }),
    ]));
    expect(recomputeContinuousEffects(state as any).perPermanent.get('jurin_1')
      ?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBe(true);
  });

  it('grants Masamune at-least-one only while the equipped host is attacking', () => {
    const attackingState = {
      battlefield: [
        {
          id: 'masamune_1',
          controller: 'p1',
          attachedTo: 'bear_1',
          card: {
            name: 'The Masamune',
            type_line: 'Legendary Artifact — Equipment',
            oracle_text: MASAMUNE_ORACLE,
          },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          attacking: 'p2',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };
    const idleState = {
      battlefield: [
        attackingState.battlefield[0],
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    expect(collectStaticEffectSpecsFromState(attackingState)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [MUST_BE_BLOCKED_IF_ABLE, 'first strike'] },
        sourcePermanentId: 'bear_1',
        condition: { kind: 'target_is_attacking' },
      }),
    ]));
    const attackingMerged = recomputeContinuousEffects(attackingState as any);
    expect(attackingMerged.perPermanent.get('bear_1')
      ?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBe(true);
    expect(attackingMerged.perPermanent.get('bear_1')
      ?.abilities?.has('first strike')).toBe(true);
    const idleMerged = recomputeContinuousEffects(idleState as any);
    expect(idleMerged.perPermanent.get('bear_1')
      ?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBeFalsy();
    expect(idleMerged.perPermanent.get('bear_1')
      ?.abilities?.has('first strike')).toBeFalsy();
  });

  it('grants Frodo at-least-one only while it is the controller Ring-bearer', () => {
    const bearerState = {
      battlefield: [{
        id: 'frodo_1',
        controller: 'p1',
        card: {
          name: 'Frodo Baggins',
          type_line: 'Legendary Creature — Halfling Scout',
          oracle_text: FRODO_BAGGINS_ORACLE,
        },
      }],
      players: [{ id: 'p1', ringBearerId: 'frodo_1' }],
    };
    const unmarkedState = {
      battlefield: bearerState.battlefield,
      players: [{ id: 'p1', ringBearerId: null }],
    };

    expect(collectStaticEffectSpecsFromState(bearerState)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [MUST_BE_BLOCKED_IF_ABLE] },
        sourcePermanentId: 'frodo_1',
        condition: { kind: 'target_is_ring_bearer' },
      }),
    ]));
    expect(recomputeContinuousEffects(bearerState as any).perPermanent.get('frodo_1')
      ?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBe(true);
    expect(recomputeContinuousEffects(unmarkedState as any).perPermanent.get('frodo_1')
      ?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBeFalsy();
  });

  it('grants threshold lure text only when the controller graveyard has seven or more cards', () => {
    const host = {
      id: 'bear_1',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const aura = {
      id: 'desire_1',
      controller: 'p1',
      attachedTo: 'bear_1',
      card: {
        name: "Seton's Desire",
        type_line: 'Enchantment — Aura',
        oracle_text: SETONS_DESIRE_ORACLE,
      },
    };
    const thresholdState = {
      battlefield: [aura, host],
      zones: { p1: { graveyard: Array.from({ length: 8 }, (_, index) => ({ id: `gy_${index}` })) } },
    };
    const belowState = {
      battlefield: [aura, host],
      zones: { p1: { graveyard: Array.from({ length: 6 }, (_, index) => ({ id: `gy_${index}` })) } },
    };

    expect(collectStaticEffectSpecsFromState(thresholdState)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [ALL_ABLE_CREATURES_MUST_BLOCK] },
        sourcePermanentId: 'bear_1',
        condition: { kind: 'source_controller_has_threshold' },
      }),
    ]));
    expect(recomputeContinuousEffects(thresholdState as any).perPermanent.get('bear_1')
      ?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBe(true);
    expect(recomputeContinuousEffects(belowState as any).perPermanent.get('bear_1')
      ?.abilities?.has(ALL_ABLE_CREATURES_MUST_BLOCK)).toBeFalsy();
  });

  it('grants Enkira at-least-one only while the creature is equipped', () => {
    const enkira = {
      id: 'enkira_1',
      controller: 'p1',
      card: {
        name: 'Enkira, Hostile Scavenger',
        type_line: 'Legendary Creature — Human Warrior',
        oracle_text: ENKIRA_ORACLE,
      },
    };
    const sword = {
      id: 'sword_1',
      controller: 'p1',
      attachedTo: 'enkira_1',
      card: {
        name: 'Bonesplitter',
        type_line: 'Artifact — Equipment',
        oracle_text: 'Equipped creature gets +2/+0.\nEquip {1}',
      },
    };
    const equippedState = { battlefield: [enkira, sword] };
    const unequippedState = { battlefield: [enkira] };

    expect(collectStaticEffectSpecsFromState(equippedState)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [MUST_BE_BLOCKED_IF_ABLE] },
        sourcePermanentId: 'enkira_1',
        condition: { kind: 'target_is_equipped' },
      }),
    ]));
    expect(recomputeContinuousEffects(equippedState as any).perPermanent.get('enkira_1')
      ?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBe(true);
    expect(recomputeContinuousEffects(unequippedState as any).perPermanent.get('enkira_1')
      ?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBeFalsy();
  });

  it('grants raid lure only after the source controller attacked this turn', () => {
    const host = {
      id: 'raid_lure_1',
      controller: 'p1',
      card: {
        name: 'Raid Lure Host',
        type_line: 'Creature — Warrior',
        oracle_text: RAID_LURE_ORACLE,
      },
    };
    const attacker = {
      id: 'attacker_1',
      controller: 'p1',
      attackedThisTurn: true,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const attackedState = { battlefield: [host, attacker] };
    const idleState = {
      battlefield: [
        host,
        { ...attacker, attackedThisTurn: false },
      ],
    };

    expect(collectStaticEffectSpecsFromState(attackedState)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [MUST_BE_BLOCKED_IF_ABLE] },
        sourcePermanentId: 'raid_lure_1',
        condition: { kind: 'source_controller_attacked_this_turn' },
      }),
    ]));
    expect(recomputeContinuousEffects(attackedState as any).perPermanent.get('raid_lure_1')
      ?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBe(true);
    expect(recomputeContinuousEffects(idleState as any).perPermanent.get('raid_lure_1')
      ?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBeFalsy();
  });

  it('grants must_be_blocked_by_flying from typed must-be-blocked-by sentences, not a lure', () => {
    const state = {
      battlefield: [{
        id: 'typed_1',
        controller: 'p1',
        card: {
          name: 'Typed Must Block',
          type_line: 'Creature — Illusion',
          oracle_text: TYPED_MUST_BLOCK_ORACLE,
        },
      }],
    };

    const flyingGrant = typedMustBeBlockedAbility('flying');
    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs.filter((spec) => (
      spec.grant.abilities?.includes(MUST_BE_BLOCKED_IF_ABLE)
      || spec.grant.abilities?.includes(ALL_ABLE_CREATURES_MUST_BLOCK)
    ))).toHaveLength(0);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'self' },
        grant: { abilities: [flyingGrant] },
        sourcePermanentId: 'typed_1',
      }),
    ]));
    expect(recomputeContinuousEffects(state as any).perPermanent.get('typed_1')
      ?.abilities?.has(flyingGrant)).toBe(true);
  });

  it('does not apply unknown static condition kinds', () => {
    const applied = applyDeclarativeStaticSpecs(
      {
        perPermanent: new Map(),
        playerHexproof: new Set(),
        playerShroud: new Set(),
        typeAdditions: new Map(),
        permanentAbilities: new Map(),
      },
      [{
        id: 'unknown-kind',
        scope: { kind: 'self' },
        grant: { abilities: [MUST_BE_BLOCKED_IF_ABLE] },
        condition: { kind: 'not_a_real_kind' as any },
        sourcePermanentId: 'bear_1',
        sourceController: 'p1',
      }],
      {
        battlefield: [{
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        }],
      },
    );

    expect(applied.perPermanent.get('bear_1')?.abilities?.has(MUST_BE_BLOCKED_IF_ABLE)).toBeFalsy();
  });

  it('parses Glaring Spotlight as controller-only as-though, without stripping hexproof', () => {
    const state = {
      battlefield: [
        {
          id: 'spotlight_1',
          controller: 'p1',
          card: {
            name: 'Glaring Spotlight',
            type_line: 'Artifact',
            oracle_text: GLARING_SPOTLIGHT_ORACLE,
          },
        },
        {
          id: 'enemy_hexproof_lord',
          controller: 'p2',
          card: {
            name: 'Hexproof Anthem',
            type_line: 'Enchantment',
            oracle_text: 'Creatures you control have hexproof.',
          },
        },
        {
          id: 'enemy_bear',
          controller: 'p2',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
        {
          id: 'ally_bear',
          controller: 'p1',
          card: { name: 'Elite Vanguard', type_line: 'Creature — Human Soldier', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'creatures_you_control' },
        grant: { abilities: ['hexproof'] },
        sourcePermanentId: 'enemy_hexproof_lord',
      }),
      expect.objectContaining({
        scope: { kind: 'opponent_creatures' },
        grant: { asThoughNoAbilitiesForController: ['hexproof'] },
        sourcePermanentId: 'spotlight_1',
      }),
    ]));
    expect(specs.some((spec) => (
      spec.sourcePermanentId === 'spotlight_1'
      && Array.isArray(spec.grant.removeAbilities)
      && spec.grant.removeAbilities.includes('hexproof')
    ))).toBe(false);
    expect(specs.some((spec) => (
      spec.sourcePermanentId === 'spotlight_1'
      && Array.isArray(spec.grant.asThoughNoAbilities)
    ))).toBe(false);
    expect(specs.some((spec) => (
      spec.sourcePermanentId === 'spotlight_1'
      && (
        spec.grant.asThoughNoAbilities?.includes('ward')
        || spec.grant.asThoughNoAbilitiesForController?.includes('ward')
      )
    ))).toBe(false);

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('enemy_bear')?.abilities?.has('hexproof')).toBe(true);
    expect(merged.perPermanent.get('ally_bear')?.abilities?.has('hexproof')).toBeFalsy();
  });

  it('strips granted hexproof from opponent creatures on lose-keyword oracle', () => {
    const state = {
      battlefield: [
        {
          id: 'archetype_1',
          controller: 'p1',
          card: {
            name: 'Archetype of Endurance',
            type_line: 'Enchantment Creature — Boar',
            oracle_text: ARCHETYPE_OF_ENDURANCE_ORACLE,
          },
        },
        {
          id: 'enemy_lord',
          controller: 'p2',
          card: {
            name: 'Hexproof Anthem',
            type_line: 'Enchantment',
            oracle_text: 'Creatures you control have hexproof.',
          },
        },
        {
          id: 'ally_bear',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
        {
          id: 'enemy_bear',
          controller: 'p2',
          card: { name: 'Goblin', type_line: 'Creature — Goblin', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'creatures_you_control' },
        grant: { abilities: ['hexproof'] },
        sourcePermanentId: 'archetype_1',
      }),
      expect.objectContaining({
        scope: { kind: 'opponent_creatures' },
        grant: { removeAbilities: ['hexproof'] },
        sourcePermanentId: 'archetype_1',
      }),
    ]));

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('ally_bear')?.abilities?.has('hexproof')).toBe(true);
    expect(merged.perPermanent.get('enemy_bear')?.abilities?.has('hexproof')).toBeFalsy();
    expect(merged.perPermanent.get('archetype_1')?.abilities?.has('hexproof')).toBe(true);
  });

  it('parses Nowhere to Run as global as-though plus ward skip, without stripping hexproof', () => {
    const state = {
      battlefield: [
        {
          id: 'nowhere_1',
          controller: 'p1',
          card: {
            name: 'Nowhere to Run',
            type_line: 'Enchantment',
            oracle_text: NOWHERE_TO_RUN_ORACLE,
          },
        },
        {
          id: 'enemy_lord',
          controller: 'p2',
          card: {
            name: 'Hexproof Anthem',
            type_line: 'Enchantment',
            oracle_text: 'Creatures you control have hexproof.',
          },
        },
        {
          id: 'enemy_bear',
          controller: 'p2',
          card: { name: 'Goblin', type_line: 'Creature — Goblin', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'opponent_creatures' },
        grant: { asThoughNoAbilities: ['hexproof', 'ward'] },
        sourcePermanentId: 'nowhere_1',
      }),
    ]));
    expect(specs.some((spec) => (
      spec.sourcePermanentId === 'nowhere_1'
      && Array.isArray(spec.grant.asThoughNoAbilitiesForController)
    ))).toBe(false);
    expect(specs.some((spec) => (
      spec.sourcePermanentId === 'nowhere_1'
      && Array.isArray(spec.grant.removeAbilities)
    ))).toBe(false);

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('enemy_bear')?.abilities?.has('hexproof')).toBe(true);
  });

  it('parses Kaya-style as-though for opponent permanents and players, controller-only', () => {
    const state = {
      battlefield: [
        {
          id: 'kaya_1',
          controller: 'p1',
          card: {
            name: 'Kaya, Bane of the Dead',
            type_line: 'Legendary Planeswalker — Kaya',
            oracle_text: KAYA_BANE_ORACLE,
          },
        },
        {
          id: 'enemy_lord',
          controller: 'p2',
          card: {
            name: 'Hexproof Anthem',
            type_line: 'Enchantment',
            oracle_text: 'Creatures you control have hexproof.',
          },
        },
        {
          id: 'enemy_bear',
          controller: 'p2',
          card: { name: 'Goblin', type_line: 'Creature — Goblin', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'opponent_permanents' },
        grant: { asThoughNoAbilitiesForController: ['hexproof'] },
        sourcePermanentId: 'kaya_1',
      }),
      expect.objectContaining({
        scope: { kind: 'player_opponents' },
        grant: { asThoughNoAbilitiesForController: ['hexproof'] },
        sourcePermanentId: 'kaya_1',
      }),
    ]));
    expect(specs.some((spec) => (
      spec.sourcePermanentId === 'kaya_1'
      && spec.scope.kind === 'opponent_creatures'
    ))).toBe(false);
    expect(specs.some((spec) => (
      spec.sourcePermanentId === 'kaya_1'
      && Array.isArray(spec.grant.asThoughNoAbilities)
    ))).toBe(false);

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('enemy_bear')?.abilities?.has('hexproof')).toBe(true);
  });

  it('does not treat Detection Tower until-EOT as-though text as a continuous static', () => {
    const state = {
      battlefield: [{
        id: 'tower_1',
        controller: 'p1',
        card: {
          name: 'Detection Tower',
          type_line: 'Land',
          oracle_text: DETECTION_TOWER_ORACLE,
        },
      }],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs.some((spec) => (
      Array.isArray(spec.grant.asThoughNoAbilitiesForController)
      || Array.isArray(spec.grant.asThoughNoAbilities)
      || Array.isArray(spec.grant.removeAbilities)
    ))).toBe(false);
  });

  it('grants hexproof to you, planeswalkers you control, and other creatures without self-buff', () => {
    const state = {
      battlefield: [
        {
          id: 'source_1',
          controller: 'p1',
          card: {
            name: 'Generic Hexproof Lord',
            type_line: 'Legendary Creature — Angel',
            oracle_text: YOU_PLANESWALKERS_OTHER_CREATURES_HEXPROOF_ORACLE,
          },
        },
        {
          id: 'other_creature',
          controller: 'p1',
          card: { name: 'Elite Vanguard', type_line: 'Creature — Human Soldier', oracle_text: '' },
        },
        {
          id: 'planeswalker_perm',
          controller: 'p1',
          card: { name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'player_you' },
        grant: { playerHexproof: true },
        sourcePermanentId: 'source_1',
      }),
      expect.objectContaining({
        scope: { kind: 'other_creatures_you_control' },
        grant: { abilities: ['hexproof'] },
        sourcePermanentId: 'source_1',
      }),
      expect.objectContaining({
        scope: { kind: 'planeswalkers_you_control' },
        grant: { abilities: ['hexproof'] },
        sourcePermanentId: 'source_1',
      }),
    ]));

    const merged = recomputeContinuousEffects(state as any);
    expect([...merged.playerHexproof]).toContain('p1');
    expect(merged.perPermanent.get('other_creature')?.abilities?.has('hexproof')).toBe(true);
    expect(merged.permanentAbilities.get('planeswalker_perm')?.has('hexproof')).toBe(true);
    expect(merged.perPermanent.get('source_1')?.abilities?.has('hexproof')).toBeFalsy();
  });

  it('does not treat you-and-other-creatures hexproof as covering planeswalkers', () => {
    const state = {
      battlefield: [
        {
          id: 'source_1',
          controller: 'p1',
          card: {
            name: 'Generic You And Other Hexproof',
            type_line: 'Creature — Angel',
            oracle_text: YOU_AND_OTHER_CREATURES_HEXPROOF_ORACLE,
          },
        },
        {
          id: 'planeswalker_perm',
          controller: 'p1',
          card: { name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs.some((spec) => spec.scope.kind === 'planeswalkers_you_control')).toBe(false);
    expect(recomputeContinuousEffects(state as any).permanentAbilities.get('planeswalker_perm')
      ?.has('hexproof')).toBeFalsy();
  });

  it('does not treat Arcane Lighthouse until-EOT lose text as a continuous static', () => {
    const state = {
      battlefield: [{
        id: 'lighthouse_1',
        controller: 'p1',
        card: {
          name: 'Arcane Lighthouse',
          type_line: 'Land',
          oracle_text: ARCANE_LIGHTHOUSE_ORACLE,
        },
      }],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs.some((spec) => Array.isArray(spec.grant.removeAbilities) && spec.grant.removeAbilities.length > 0))
      .toBe(false);
  });
});

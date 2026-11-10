import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { getCreatureTypesNow } from '../src/state/creatureTypeNow.js';
import { castRestrictionTailViolation } from '../src/state/modules/castRestrictionTailFamilies.js';
import { zoneEnterProhibitionReason } from '../src/state/modules/batch31CastLocks.js';
import { cyclingProhibitionReason } from '../src/state/modules/cycleRestrictionFamilies.js';
import { collectAttackerSelfAttackTax } from '../../shared/src/combatAttackerSelfTax.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch84 statics', () => {
  it('CDAs: Living Lore + Lost Order + Angry Mob', () => {
    const lore = calculateVariablePT(
      {
        name: 'Living Lore',
        power: '*',
        toughness: '*',
        oracle_text: "Living Lore's power and toughness are each equal to the exiled card's mana value.",
        controller: 'p1',
        id: 'src',
      },
      {
        battlefield: [{
          id: 'src', controller: 'p1',
          exiledCards: [{ mana_value: 4, cmc: 4 }],
          card: { name: 'Living Lore', power: '*', toughness: '*', oracle_text: "Living Lore's power and toughness are each equal to the exiled card's mana value." },
        }],
        zones: { p1: { exile: [] } },
      },
    );
    expect(lore).toEqual({ power: 4, toughness: 4 });

    const lost = calculateVariablePT(
      {
        name: 'Lost Order of Jarkeld',
        power: '1+*',
        toughness: '1+*',
        oracle_text: "Lost Order of Jarkeld's power and toughness are each equal to 1 plus the number of creatures the chosen player controls.",
        controller: 'p1',
      },
      {
        battlefield: [
          { id: 'src', controller: 'p1', chosenPlayer: 'p2', card: { name: 'Lost Order of Jarkeld', power: '1+*', toughness: '1+*', oracle_text: "Lost Order of Jarkeld's power and toughness are each equal to 1 plus the number of creatures the chosen player controls." } },
          { controller: 'p2', card: { type_line: 'Creature — Bear' } },
          { controller: 'p2', card: { type_line: 'Creature — Elf' } },
        ],
        zones: { p1: {}, p2: {} },
      },
    );
    expect(lost).toEqual({ power: 3, toughness: 3 });

    const mob = calculateVariablePT(
      {
        name: 'Angry Mob',
        power: '2+*',
        toughness: '2+*',
        oracle_text: "During your turn, Angry Mob's power and toughness are each equal to 2 plus the number of Swamps your opponents control. During turns other than yours, Angry Mob's power and toughness are each 2.",
        controller: 'p1',
      },
      {
        turnPlayer: 'p1',
        battlefield: [
          { id: 'src', controller: 'p1', card: { name: 'Angry Mob', power: '2+*', toughness: '2+*', oracle_text: "During your turn, Angry Mob's power and toughness are each equal to 2 plus the number of Swamps your opponents control. During turns other than yours, Angry Mob's power and toughness are each 2." } },
          { controller: 'p2', card: { type_line: 'Basic Land — Swamp' } },
          { controller: 'p2', card: { type_line: 'Basic Land — Swamp' } },
        ],
        zones: { p1: {}, p2: {} },
      },
    );
    expect(mob).toEqual({ power: 4, toughness: 4 });
  });

  it('Conspiracy + Aspect of Wolf + Serra + Tyrannical + Orochi + Gideon', () => {
    const consp = P('Conspiracy', 'Creatures you control are the chosen type.', 'Enchantment', { chosenCreatureType: 'Bear' });
    const elf = {
      id: 'e', controller: 'p1',
      card: { name: 'Elf', type_line: 'Creature — Elf', power: '1', toughness: '1' },
    };
    const cState: any = { battlefield: [consp, elf], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(cState);
    expect([...getCreatureTypesNow(elf as any)].map((t) => t.toLowerCase())).toContain('bear');

    const host = {
      id: 'h', controller: 'p1',
      card: { name: 'Wolf', type_line: 'Creature — Wolf', power: '2', toughness: '2' },
    };
    const aspect = P(
      'Aspect of Wolf',
      'Enchanted creature gets +X/+Y, where X is half the number of Forests you control, rounded down, and Y is half the number of Forests you control, rounded up.',
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    const fo1 = { id: 'f1', controller: 'p1', card: { name: 'Forest', type_line: 'Basic Land — Forest' } };
    const fo2 = { id: 'f2', controller: 'p1', card: { name: 'Forest', type_line: 'Basic Land — Forest' } };
    const fo3 = { id: 'f3', controller: 'p1', card: { name: 'Forest', type_line: 'Basic Land — Forest' } };
    const aState: any = { battlefield: [aspect, host, fo1, fo2, fo3], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(aState);
    expect(getCurrentPowerToughness(host as any, aState)).toEqual({ power: 3, toughness: 4 });

    const serra = P(
      "Serra's Emissary",
      'You and creatures you control have protection from the chosen card type.',
      'Creature',
      { chosenCardType: 'artifact' },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(serra).some(
      (s) => (s.grant.abilities || []).includes('protection from artifact'),
    )).toBe(true);

    const pit = P(
      'Tyrannical Pitlord',
      'The chosen creature gets +3/+3 and has flying.',
      'Creature',
      { chosenCreatureId: 'h' },
    );
    const pState: any = { battlefield: [pit, host], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(pState);
    expect(getCurrentPowerToughness(host as any, pState)?.power).toBe(5);
    expect(getContinuousGrantedAbilitiesForPermanent(host as any, pState)).toContain('flying');

    const orochi = P(
      'Orochi Merge-Keeper',
      'As long as this creature is modified, it has "{T}: Add {G}{G}."',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(orochi).some(
      (s) => s.condition?.kind === 'target_is_modified',
    )).toBe(true);

    const gideon = P(
      'Gideon Blackblade',
      "During your turn, Gideon Blackblade is a 4/4 Human Soldier creature with indestructible that's still a planeswalker.",
      'Legendary Planeswalker — Gideon',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(gideon).some(
      (s) => s.condition?.kind === 'during_source_controller_turn' && s.grant.setPower === 4,
    )).toBe(true);
  });

  it('combat tax + enter locks + cast locks + cycle', () => {
    const behemoth = {
      id: 'b', controller: 'p1',
      card: { name: 'Qal Sisma Behemoth', oracle_text: "This creature can't attack or block unless you pay {2}.", type_line: 'Creature' },
    };
    expect(collectAttackerSelfAttackTax(behemoth, [behemoth]).cost).toBe(2);

    const myr = {
      id: 'm', controller: 'p1', counters: { '+1/+1': 3 },
      card: { name: 'Myr Prototype', oracle_text: "This creature can't attack or block unless you pay {1} for each +1/+1 counter on it.", type_line: 'Creature' },
    };
    expect(collectAttackerSelfAttackTax(myr, [myr]).cost).toBe(3);

    const cage = {
      id: 'c', controller: 'p1',
      card: { name: "Grafdigger's Cage", oracle_text: "Creature cards in graveyards and libraries can't enter the battlefield.", type_line: 'Artifact' },
    };
    expect(zoneEnterProhibitionReason({ battlefield: [cage] }, 'graveyard', 'Creature — Bear')).toBeTruthy();

    const worms = {
      id: 'w', controller: 'p1',
      card: { name: 'Worms of the Earth', oracle_text: "Lands can't enter the battlefield.", type_line: 'Enchantment' },
    };
    expect(zoneEnterProhibitionReason({ battlefield: [worms] }, 'library', 'Basic Land — Forest')).toBeTruthy();

    const prelate = {
      id: 'p', controller: 'p1', chosenNumber: 3,
      card: { name: 'Sanctum Prelate', oracle_text: "Noncreature spells with mana value equal to the chosen number can't be cast.", type_line: 'Creature' },
    };
    const state: any = { battlefield: [prelate], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' };
    expect(castRestrictionTailViolation(state, 'p2', { name: 'Bolt', type_line: 'Instant', cmc: 3 }, 'hand')).toBeTruthy();
    expect(castRestrictionTailViolation(state, 'p2', { name: 'Bear', type_line: 'Creature', cmc: 3 }, 'hand')).toBeNull();

    const lavinia = {
      id: 'l', controller: 'p1',
      card: { name: 'Lavinia, Azorius Renegade', oracle_text: "Each opponent can't cast noncreature spells with mana value greater than the number of lands that player controls.", type_line: 'Creature' },
    };
    const lState: any = {
      battlefield: [lavinia],
      players: [{ id: 'p1' }, { id: 'p2' }],
      turnPlayer: 'p2',
    };
    expect(castRestrictionTailViolation(lState, 'p2', { name: 'Wrath', type_line: 'Sorcery', cmc: 4 }, 'hand')).toBeTruthy();

    const stab = {
      id: 's', controller: 'p1',
      card: { name: 'Stabilizer', oracle_text: "Players can't cycle cards.", type_line: 'Artifact' },
    };
    expect(cyclingProhibitionReason({ battlefield: [stab] })).toBeTruthy();
  });

  it('classifiers cover B84 families', () => {
    const lines: Array<[string, string]> = [
      ["Living Lore's power and toughness are each equal to the exiled card's mana value.", 'Living Lore'],
      ["Lost Order of Jarkeld's power and toughness are each equal to 1 plus the number of creatures the chosen player controls.", 'Lost Order of Jarkeld'],
      ["During your turn, Angry Mob's power and toughness are each equal to 2 plus the number of Swamps your opponents control.", 'Angry Mob'],
      ['Creatures you control are the chosen type.', 'Conspiracy'],
      ['Enchanted creature gets +X/+Y, where X is half the number of Forests you control, rounded down, and Y is half the number of Forests you control, rounded up.', 'Aspect of Wolf'],
      ['You and creatures you control have protection from the chosen card type.', "Serra's Emissary"],
      ['The chosen creature gets +3/+3 and has flying.', 'Tyrannical Pitlord'],
      ['As long as this creature is modified, it has "{T}: Add {G}{G}."', 'Orochi Merge-Keeper'],
      ['As long as you control a Cleric, this artifact has "Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life."', 'Relic Vial'],
      ["During your turn, Gideon Blackblade is a 4/4 Human Soldier creature with indestructible that's still a planeswalker.", 'Gideon Blackblade'],
      ["This creature can't attack or block unless you pay {2}.", 'Qal Sisma Behemoth'],
      ["This creature can't attack or block unless you pay {1} for each +1/+1 counter on it.", 'Myr Prototype'],
      ["Creature cards in graveyards and libraries can't enter the battlefield.", "Grafdigger's Cage"],
      ["Lands can't enter the battlefield.", 'Worms of the Earth'],
      ["Noncreature spells with mana value equal to the chosen number can't be cast.", 'Sanctum Prelate'],
      ["Each opponent can't cast noncreature spells with mana value greater than the number of lands that player controls.", 'Lavinia, Azorius Renegade'],
      ["Players can't cycle cards.", 'Stabilizer'],
      ["Players can't pay life or sacrifice nonland permanents to cast spells or activate abilities.", 'Yasharn, Implacable Earth'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});

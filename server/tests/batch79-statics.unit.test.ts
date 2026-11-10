import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { getMaximumBlockers } from '../src/socket/combat-handlers/combatBatch30BlockLimits.js';
import { getBatch79TypeExceptByTypeReason } from '../src/socket/combat-handlers/combatBatch79TypeExceptByType.js';
import { permanentIsSnowNow } from '../src/state/modules/effectiveSnowSupertype.js';
import { equipmentMinAttachPower, creatureMeetsEquipmentAttachPower } from '../src/state/modules/equipmentAttachPowerGate.js';
import { findOracleCastingLimitViolation } from '../src/state/modules/staticCastingRestrictionsOracleExtras.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch79 statics', () => {
  it('Falthis commanders + Soulcatchers feathers + Dark Matter every-N GY', () => {
    const falthis = P('Falthis, Shadowcat Familiar', 'Commanders you control have menace and deathtouch.');
    const cmd = {
      id: 'c', controller: 'p1', isCommander: true,
      card: { name: 'Cmd', type_line: 'Legendary Creature — Cat', power: '3', toughness: '3' },
    };
    const fState: any = { battlefield: [falthis, cmd], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(fState);
    expect(getContinuousGrantedAbilitiesForPermanent(cmd as any, fState)).toEqual(
      expect.arrayContaining(['menace', 'deathtouch']),
    );

    const aerie = P(
      "Soulcatchers' Aerie",
      'Bird creatures get +1/+1 for each feather counter on this enchantment.',
      'Enchantment',
      { counters: { feather: 2 } },
    );
    const bird = {
      id: 'b', controller: 'p1',
      card: { name: 'Bird', type_line: 'Creature — Bird', power: '1', toughness: '1' },
    };
    const bear = {
      id: 'x', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const aState: any = { battlefield: [aerie, bird, bear], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(aState);
    expect(getCurrentPowerToughness(bird as any, aState)?.power).toBe(3);
    expect(getCurrentPowerToughness(bear as any, aState)?.power).toBe(2);

    const dark = P(
      'Dark Matter Manipulator',
      'This creature gets +2/+0 for every seven cards in your graveyard.',
      'Creature',
      {},
      { power: '0', toughness: '4' },
    );
    const gy = Array.from({ length: 14 }, (_, i) => ({ name: `C${i}`, type_line: 'Instant' }));
    const dState: any = {
      battlefield: [dark],
      players: [{ id: 'p1' }],
      zones: { p1: { graveyard: gy } },
    };
    syncDerivedContinuousEffects(dState);
    expect(getCurrentPowerToughness(dark as any, dState)?.power).toBe(4);
  });

  it('Roc no-shell + Kumena Merfolk/Island + Goblinson dice + Battlefront + Shifting', () => {
    const roc = P(
      'Roc Hatchling',
      'As long as this creature has no shell counters on it, it gets +3/+2 and has flying.',
      'Creature — Bird',
      { counters: {} },
      { power: '0', toughness: '1' },
    );
    const rState: any = { battlefield: [roc], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(rState);
    expect(getCurrentPowerToughness(roc as any, rState)?.power).toBe(3);
    expect(getContinuousGrantedAbilitiesForPermanent(roc as any, rState)).toContain('flying');

    const kumena = P(
      "Kumena's Speaker",
      'This creature gets +1/+1 as long as you control another Merfolk or an Island.',
      'Creature — Merfolk',
      {},
      { power: '1', toughness: '1' },
    );
    const island = {
      id: 'i', controller: 'p1',
      card: { name: 'Island', type_line: 'Basic Land — Island' },
    };
    const kState: any = { battlefield: [kumena, island], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(kState);
    expect(getCurrentPowerToughness(kumena as any, kState)?.power).toBe(2);

    const gob = P(
      'The Space Family Goblinson',
      "The Space Family Goblinson has trample as long as you've rolled three or more dice this turn.",
    );
    const gState: any = {
      battlefield: [gob],
      players: [{ id: 'p1' }],
      dieRollsThisTurn: { p1: [{}, {}, {}] },
    };
    syncDerivedContinuousEffects(gState);
    expect(getContinuousGrantedAbilitiesForPermanent(gob as any, gState)).toContain('trample');

    const krushok = P(
      'Battlefront Krushok',
      "Each creature you control with a +1/+1 counter on it can't be blocked by more than one creature.",
    );
    const pumped = {
      id: 'p', controller: 'p1', counters: { '+1/+1': 1 },
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' },
    };
    expect(getMaximumBlockers(pumped, [krushok, pumped])).toBe(1);

    const shifting = P('Shifting Sliver', "Slivers can't be blocked except by Slivers.");
    const sliver = {
      id: 's', controller: 'p1',
      card: { name: 'Sliver', type_line: 'Creature — Sliver', oracle_text: '' },
    };
    const bear = {
      id: 'b', controller: 'p2',
      card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
    };
    expect(getBatch79TypeExceptByTypeReason(sliver, bear, [shifting, sliver, bear])).toMatch(/except by slivers/i);
    expect(getBatch79TypeExceptByTypeReason(sliver, {
      id: 's2', controller: 'p2',
      card: { name: 'Other Sliver', type_line: 'Creature — Sliver' },
    }, [shifting, sliver])).toBeNull();
  });

  it('Melting snow + O-Naginata + Cloak + Curse + classifiers', () => {
    const melting = P('Melting', 'All lands are no longer snow.', 'Enchantment');
    const snowLand = {
      id: 'l', controller: 'p1',
      card: { name: 'Snow Island', type_line: 'Basic Snow Land — Island' },
    };
    const mState: any = { battlefield: [melting, snowLand], players: [{ id: 'p1' }] };
    expect(permanentIsSnowNow(mState, snowLand)).toBe(false);

    const nagi = P(
      'O-Naginata',
      'This Equipment can be attached only to a creature with power 3 or greater.',
      'Artifact — Equipment',
    );
    expect(equipmentMinAttachPower(nagi)).toBe(3);
    expect(creatureMeetsEquipmentAttachPower({ card: { power: '2' }, counters: {} }, 3)).toBe(false);
    expect(creatureMeetsEquipmentAttachPower({ card: { power: '3' }, counters: {} }, 3)).toBe(true);

    const cloak = P(
      'Cloak of Invisibility',
      "Enchanted creature has phasing and can't be blocked except by Walls.",
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    const host = {
      id: 'h', controller: 'p1',
      card: { name: 'Host', type_line: 'Creature — Wizard', power: '1', toughness: '1' },
    };
    const cState: any = { battlefield: [cloak, host], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(cState);
    expect(getContinuousGrantedAbilitiesForPermanent(host as any, cState)).toEqual(
      expect.arrayContaining(['phasing', expect.stringMatching(/except by Walls/i)]),
    );

    const curse = P(
      'Curse of Exhaustion',
      "Enchanted player can't cast more than one spell each turn.",
      'Enchantment — Aura Curse',
      { enchantedPlayerId: 'p2', attachedTo: 'p2' },
    );
    const castState: any = {
      battlefield: [curse],
      players: [{ id: 'p1' }, { id: 'p2' }],
      spellsCastThisTurn: [{ casterId: 'p2', type_line: 'Instant' }],
    };
    expect(findOracleCastingLimitViolation(castState, 'p2', { type_line: 'Sorcery' }).prohibited).toBe(true);

    const lines: Array<[string, string]> = [
      ['Commanders you control have menace and deathtouch.', 'Falthis, Shadowcat Familiar'],
      ['Bird creatures get +1/+1 for each feather counter on this enchantment.', "Soulcatchers' Aerie"],
      ['This creature gets +2/+0 for every seven cards in your graveyard.', 'Dark Matter Manipulator'],
      ["As long as this creature has no shell counters on it, it gets +3/+2 and has flying.", 'Roc Hatchling'],
      ['This creature gets +1/+1 as long as you control another Merfolk or an Island.', "Kumena's Speaker"],
      ["Slivers can't be blocked except by Slivers.", 'Shifting Sliver'],
      ['All lands are no longer snow.', 'Melting'],
      ["Combat damage can't be prevented.", 'Frenzied Baloth'],
      ['This Equipment can be attached only to a creature with power 3 or greater.', 'O-Naginata'],
      ["Enchanted player can't cast more than one spell each turn.", 'Curse of Exhaustion'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }

    expect(parseStaticEffectSpecsFromOraclePermanent(falthisSpecs()).length).toBeGreaterThan(0);
  });
});

function falthisSpecs() {
  return P('Falthis, Shadowcat Familiar', 'Commanders you control have menace and deathtouch.');
}

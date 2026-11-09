import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { findOracleCastingLimitViolation } from '../src/state/modules/staticCastingRestrictionsOracleExtras.js';
import { artifactOrColorBlockOnlyReason } from '../src/socket/combat-handlers/combatBatch31BlockRestrictions.js';
import { getMinimumBlockers } from '../src/socket/combat-handlers/combatMinimumBlockers.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch76 statics', () => {
  it('Brothers Yamazaki other named buff + haste', () => {
    const line = 'Each other creature named Brothers Yamazaki gets +2/+2 and has haste.';
    const a = P('Brothers Yamazaki', line, 'Legendary Creature — Human Samurai', { id: 'a' });
    const b = { ...P('Brothers Yamazaki', line, 'Legendary Creature — Human Samurai', { id: 'b' }), id: 'b' };
    expect(parseStaticEffectSpecsFromOraclePermanent(a).some(
      (s) => s.condition?.kind === 'target_has_name'
        && (s.grant.abilities || []).includes('haste'),
    )).toBe(true);
    const state: any = { battlefield: [a, b], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(b as any, state)?.power).toBe(4);
    expect(getContinuousGrantedAbilitiesForPermanent(b as any, state)).toContain('haste');
    expect(classifyStaticCensusLine(line, 'Brothers Yamazaki')?.system).toMatch(/named|batch76/i);
  });

  it('Balthier vehicles anthem + Homarid exact counters + Tenacious Hunter', () => {
    const vehLine = 'Vehicles you control get +1/+1 and have vigilance and reach.';
    const balthier = P('Balthier and Fran', vehLine, 'Legendary Creature — Human Rabbit');
    const vehicle = {
      id: 'v', controller: 'p1',
      card: { name: 'Skysovereign', type_line: 'Artifact — Vehicle', power: '6', toughness: '6' },
    };
    expect(parseStaticEffectSpecsFromOraclePermanent(balthier).some(
      (s) => s.scope.kind === 'permanents_you_control' && s.scope.qualifier?.subtype === 'vehicle',
    )).toBe(true);
    const state: any = { battlefield: [balthier, vehicle], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(vehicle as any, state)?.power).toBe(7);
    expect(getContinuousGrantedAbilitiesForPermanent(vehicle as any, state)).toEqual(
      expect.arrayContaining(['vigilance', 'reach']),
    );

    const homarid = P(
      'Homarid',
      'As long as there is exactly one tide counter on this creature, it gets -1/-1.\nAs long as there are exactly three tide counters on this creature, it gets +1/+1.',
      'Creature — Homarid',
      { counters: { tide: 1 } },
      { power: '2', toughness: '2' },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(homarid).filter(
      (s) => s.condition?.kind === 'source_counter_exactly',
    ).length).toBe(2);
    const hState: any = { battlefield: [homarid], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(hState);
    expect(getCurrentPowerToughness(homarid as any, hState)?.power).toBe(1);

    const hunterLine = 'As long as a creature has a -1/-1 counter on it, this creature has vigilance and deathtouch.';
    const hunter = P('Tenacious Hunter', hunterLine, 'Creature — Crocodile');
    const prey = {
      id: 'prey', controller: 'p2', counters: { '-1/-1': 1 },
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const huntState: any = { battlefield: [hunter, prey], players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(huntState);
    expect(getContinuousGrantedAbilitiesForPermanent(hunter as any, huntState)).toEqual(
      expect.arrayContaining(['vigilance', 'deathtouch']),
    );
    expect(classifyStaticCensusLine(hunterLine, 'Tenacious Hunter')?.system).toMatch(/counter|batch76/i);
  });

  it('Rusted Relic metalcraft + Nighthowler + Sonorous Howlbonder', () => {
    const relicLine = 'Metalcraft — This artifact is a 5/5 Golem artifact creature as long as you control three or more artifacts.';
    const relic = P('Rusted Relic', relicLine, 'Artifact', { id: 'relic' });
    const arts = [1, 2, 3].map((i) => ({
      id: `a${i}`, controller: 'p1',
      card: { name: `Art${i}`, type_line: 'Artifact' },
    }));
    expect(parseStaticEffectSpecsFromOraclePermanent(relic).some(
      (s) => (s.grant as any).setPower === 5 && s.condition?.kind === 'source_controller_controls_matching',
    )).toBe(true);
    const rState: any = { battlefield: [relic, ...arts], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(rState);
    expect(getCurrentPowerToughness(relic as any, rState)?.power).toBe(5);

    const nightLine = 'This creature and enchanted creature each get +X/+X, where X is the number of creature cards in all graveyards.';
    const host = {
      id: 'host', controller: 'p1',
      card: { name: 'Soldier', type_line: 'Creature — Soldier', power: '1', toughness: '1' },
    };
    const night = P('Nighthowler', nightLine, 'Enchantment Creature — Horror', {
      id: 'night', attachedTo: 'host',
    }, { power: '0', toughness: '0' });
    const nState: any = {
      battlefield: [night, host],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: {
        p1: { graveyard: [{ name: 'A', type_line: 'Creature — A', power: '1' }] },
        p2: { graveyard: [{ name: 'B', type_line: 'Creature — B', power: '2' }, { name: 'C', type_line: 'Instant' }] },
      },
    };
    syncDerivedContinuousEffects(nState);
    expect(getCurrentPowerToughness(host as any, nState)?.power).toBe(3);
    expect(getCurrentPowerToughness(night as any, nState)?.power).toBe(2);

    const howlLine = "Each creature you control with menace can't be blocked except by three or more creatures.";
    const howl = P('Sonorous Howlbonder', `Menace\n${howlLine}`, 'Creature — Human Warrior');
    const menacer = {
      id: 'm', controller: 'p1',
      card: { name: 'Goblin', type_line: 'Creature — Goblin', keywords: ['menace'], power: '1', toughness: '1' },
    };
    const hState: any = { battlefield: [howl, menacer], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(hState);
    const granted = getContinuousGrantedAbilitiesForPermanent(menacer as any, hState);
    expect(granted.some((a) => /can't be blocked except by 3 or more/.test(String(a)))).toBe(true);
    menacer.grantedAbilities = granted;
    expect(getMinimumBlockers(menacer)).toBeGreaterThanOrEqual(3);
    expect(classifyStaticCensusLine(howlLine, 'Sonorous Howlbonder')?.system).toMatch(/menace|blockers|batch76/i);
  });

  it('conditional self grants: monstrous / artifact-or-enchantment / wolf-or-werewolf / sacrificed', () => {
    const chill = P(
      'Chillerpillar',
      'As long as this creature is monstrous, it has flying.',
      'Snow Creature — Insect',
      { monstrous: true },
    );
    const cState: any = { battlefield: [chill], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(cState);
    expect(getContinuousGrantedAbilitiesForPermanent(chill as any, cState)).toContain('flying');

    const fox = P('Flutterfox', 'As long as you control an artifact or enchantment, this creature has flying.');
    const ring = { id: 'ring', controller: 'p1', card: { name: 'Sol Ring', type_line: 'Artifact' } };
    const fState: any = { battlefield: [fox, ring], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(fState);
    expect(getContinuousGrantedAbilitiesForPermanent(fox as any, fState)).toContain('flying');

    const wolf = P('Hungry Ridgewolf', 'As long as you control another Wolf or Werewolf, this creature gets +1/+0 and has trample.');
    const pack = {
      id: 'pack', controller: 'p1',
      card: { name: 'Wolf', type_line: 'Creature — Wolf', power: '1', toughness: '1' },
    };
    const wState: any = { battlefield: [wolf, pack], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(wState);
    expect(getCurrentPowerToughness(wolf as any, wState)?.power).toBe(3);
    expect(getContinuousGrantedAbilitiesForPermanent(wolf as any, wState)).toContain('trample');

    const blast = P(
      'Goblin Blast-Runner',
      'This creature gets +2/+0 and has menace as long as you sacrificed a permanent this turn.',
      'Creature — Goblin',
      {},
      { power: '1', toughness: '2' },
    );
    const bState: any = {
      battlefield: [blast],
      players: [{ id: 'p1' }],
      permanentsSacrificedThisTurn: { p1: 1 },
    };
    syncDerivedContinuousEffects(bState);
    expect(getCurrentPowerToughness(blast as any, bState)?.power).toBe(3);
    expect(getContinuousGrantedAbilitiesForPermanent(blast as any, bState)).toContain('menace');
  });

  it('Llawan cast lock + Nick/Dragster block except + Opalescence classifier', () => {
    const llawan = P('Llawan, Cephalid Empress', "Your opponents can't cast blue creature spells.");
    const state: any = { battlefield: [llawan], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' };
    const blueCreature = { name: 'Merfolk', type_line: 'Creature — Merfolk', colors: ['U'], mana_cost: '{U}' };
    expect(findOracleCastingLimitViolation(state, 'p2', blueCreature)?.prohibited).toBe(true);
    expect(findOracleCastingLimitViolation(state, 'p2', {
      name: 'Bear', type_line: 'Creature — Bear', colors: ['G'], mana_cost: '{G}',
    })?.prohibited).toBe(false);
    expect(classifyStaticCensusLine("Your opponents can't cast blue creature spells.", 'Llawan, Cephalid Empress')?.system)
      .toMatch(/creature spells|casting|batch76|Llawan/i);

    const nick = {
      id: 'nick',
      card: {
        name: 'Nick Valentine, Private Eye',
        oracle_text: "Nick Valentine can't be blocked except by artifact creatures.",
        type_line: 'Legendary Artifact Creature — Synth Detective',
      },
    };
    const bear = { card: { name: 'Bear', type_line: 'Creature — Bear' } };
    const myr = { card: { name: 'Myr', type_line: 'Artifact Creature — Myr' } };
    expect(artifactOrColorBlockOnlyReason(bear, nick)).toMatch(/artifact creatures/i);
    expect(artifactOrColorBlockOnlyReason(myr, nick)).toBeNull();

    const dragster = {
      id: 'd',
      card: {
        name: 'Deluxe Dragster',
        oracle_text: "This Vehicle can't be blocked except by Vehicles.",
        type_line: 'Artifact — Vehicle',
      },
    };
    expect(artifactOrColorBlockOnlyReason(bear, dragster)).toMatch(/Vehicles/i);
    expect(artifactOrColorBlockOnlyReason({ card: { type_line: 'Artifact — Vehicle' } }, dragster)).toBeNull();

    expect(classifyStaticCensusLine(
      'Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.',
      'Opalescence',
    )?.system).toMatch(/opalescence|layer4|non-aura|mana value/i);
  });
});

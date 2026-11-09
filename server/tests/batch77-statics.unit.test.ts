import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { computeStaticMaxHandSize } from '../src/state/modules/handSizeStaticModifiers.js';
import { getBatch25BlockRestrictionReason } from '../src/socket/combat-handlers/combatBatch25BlockRestrictions.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch77 statics', () => {
  it('Omnath unspent mana pump + Tom Bombadil lore keywords', () => {
    const omnath = P(
      'Omnath, Locus of the Void',
      'Omnath gets +1/+1 for each unspent mana you have.',
      'Legendary Creature — Elemental',
      {},
      { power: '4', toughness: '4' },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(omnath).some(
      (s) => (s.grant as any).countBasis === 'controller_unspent_mana',
    )).toBe(true);
    const oState: any = {
      battlefield: [omnath],
      players: [{ id: 'p1' }],
      manaPool: { p1: { R: 2, G: 1 } },
    };
    syncDerivedContinuousEffects(oState);
    expect(getCurrentPowerToughness(omnath as any, oState)?.power).toBe(7);

    const tom = P(
      'Tom Bombadil',
      'As long as there are four or more lore counters among Sagas you control, Tom Bombadil has hexproof and indestructible.',
      'Legendary Creature — God Bard',
    );
    const saga = {
      id: 'saga', controller: 'p1', counters: { lore: 4 },
      card: { name: 'The Bath Song', type_line: 'Enchantment — Saga' },
    };
    const tState: any = { battlefield: [tom, saga], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(tState);
    expect(getContinuousGrantedAbilitiesForPermanent(tom as any, tState)).toEqual(
      expect.arrayContaining(['hexproof', 'indestructible']),
    );
    expect(classifyStaticCensusLine(
      'As long as there are four or more lore counters among Sagas you control, Tom Bombadil has hexproof and indestructible.',
      'Tom Bombadil',
    )?.system).toMatch(/saga|lore|batch77/i);
  });

  it('Deification + Valentina + Blaster + Canopy Cover', () => {
    const dei = P(
      'Deification',
      'Planeswalkers you control of the chosen type have hexproof.',
      'Enchantment',
      { chosenPlaneswalkerType: 'Chandra' },
    );
    const chandra = {
      id: 'pw', controller: 'p1',
      card: { name: 'Chandra, Torch of Defiance', type_line: 'Legendary Planeswalker — Chandra' },
    };
    const dState: any = { battlefield: [dei, chandra], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(dState);
    expect(getContinuousGrantedAbilitiesForPermanent(chandra as any, dState)).toContain('hexproof');

    const val = P(
      'Valentina Allegra de Fontaine',
      'Other Villains you control are Heroes in addition to their other types.',
      'Legendary Creature — Human Advisor',
    );
    const villain = {
      id: 'v', controller: 'p1',
      card: { name: 'Taskmaster', type_line: 'Creature — Human Villain', power: '2', toughness: '2' },
    };
    expect(parseStaticEffectSpecsFromOraclePermanent(val).some(
      (s) => Array.isArray(s.grant.typeAdditions) && s.grant.typeAdditions!.includes('Hero'),
    )).toBe(true);

    const blaster = P(
      'Blaster, Morale Booster',
      'Other nontoken artifact creatures and Vehicles you control have modular 1.',
      'Legendary Artifact Creature — Robot',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(blaster).some(
      (s) => (s.grant.abilities || []).includes('modular 1'),
    )).toBe(true);

    const host = {
      id: 'host', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const canopy = P(
      'Canopy Cover',
      "Enchanted creature can't be blocked except by creatures with flying or reach.\nEnchanted creature can't be the target of spells or abilities your opponents control.",
      'Enchantment — Aura',
      { attachedTo: 'host', id: 'aura' },
    );
    const cState: any = { battlefield: [canopy, host], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(cState);
    expect(getContinuousGrantedAbilitiesForPermanent(host as any, cState)).toEqual(
      expect.arrayContaining(['hexproof', "can't be blocked except by creatures with flying or reach"]),
    );
    void villain;
  });

  it('Winter delirium hand size + Ayesha defending artifacts unblockable', () => {
    const winter = P(
      'Winter, Misanthropic Guide',
      'Delirium — As long as there are four or more card types among cards in your graveyard, each opponent\'s maximum hand size is equal to seven minus the number of those card types.',
    );
    const state: any = {
      battlefield: [winter],
      zones: {
        p1: {
          graveyard: [
            { type_line: 'Creature — Bear' },
            { type_line: 'Instant' },
            { type_line: 'Sorcery' },
            { type_line: 'Artifact' },
          ],
        },
      },
    };
    expect(computeStaticMaxHandSize([winter], 'p2', 7, state)).toBe(3);
    expect(computeStaticMaxHandSize([winter], 'p1', 7, state)).toBe(7);
    expect(classifyStaticCensusLine(
      "Delirium — As long as there are four or more card types among cards in your graveyard, each opponent's maximum hand size is equal to seven minus the number of those card types.",
      'Winter, Misanthropic Guide',
    )?.system).toMatch(/hand size|delirium|batch77/i);

    const ayesha = {
      id: 'a',
      attacking: 'p2',
      card: {
        name: 'Ayesha Tanaka, Armorer',
        oracle_text: "Ayesha Tanaka can't be blocked as long as defending player controls three or more artifacts.",
        type_line: 'Legendary Creature — Human Artificer',
      },
    };
    const arts = [1, 2, 3].map((i) => ({
      id: `art${i}`, controller: 'p2',
      card: { name: `Art${i}`, type_line: 'Artifact' },
    }));
    const reason = getBatch25BlockRestrictionReason(
      ayesha, { card: { type_line: 'Creature — Bear' } }, [ayesha, ...arts], [], () => false, 'p2',
    );
    expect(reason).toMatch(/can't be blocked/i);
    expect(classifyStaticCensusLine(
      "Ayesha Tanaka can't be blocked as long as defending player controls three or more artifacts.",
      'Ayesha Tanaka, Armorer',
    )?.system).toMatch(/artifact|defending|batch77|unblock/i);
  });
});

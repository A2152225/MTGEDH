import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { getCreatureTypesNow, isCreatureNow } from '../src/state/creatureTypeNow.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch83 statics', () => {
  it('CDA: Swarm of Rats + Cosmogoyf + Primalcrux chroma', () => {
    const rats = calculateVariablePT(
      {
        name: 'Swarm of Rats',
        power: '*',
        toughness: '1',
        oracle_text: "Swarm of Rats's power is equal to the number of Rats you control.",
        controller: 'p1',
      },
      {
        battlefield: [
          { id: 'src', controller: 'p1', card: { name: 'Swarm of Rats', type_line: 'Creature — Rat', power: '*', toughness: '1' } },
          { controller: 'p1', card: { name: 'Pack Rat', type_line: 'Creature — Rat', power: '2', toughness: '2' } },
        ],
        zones: { p1: {} },
      },
    );
    expect(rats?.power).toBe(2);
    expect(rats?.toughness).toBe(1);

    const cosmo = calculateVariablePT(
      {
        name: 'Cosmogoyf',
        power: '*',
        toughness: '1+*',
        oracle_text: "Cosmogoyf's power is equal to the number of cards you own in exile and its toughness is equal to that number plus 1.",
        controller: 'p1',
      },
      {
        battlefield: [],
        zones: { p1: { exile: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] } },
      },
    );
    expect(cosmo?.power).toBe(3);
    expect(cosmo?.toughness).toBe(4);

    const crux = calculateVariablePT(
      {
        name: 'Primalcrux',
        power: '*',
        toughness: '*',
        oracle_text: "Chroma — This creature's power and toughness are each equal to the number of green mana symbols in the mana costs of permanents you control.",
        controller: 'p1',
      },
      {
        battlefield: [
          { controller: 'p1', card: { type_line: 'Creature', mana_cost: '{G}{G}' } },
          { controller: 'p1', card: { type_line: 'Creature', mana_cost: '{1}{G}' } },
        ],
        zones: { p1: {} },
      },
    );
    expect(crux?.power).toBe(3);
    expect(crux?.toughness).toBe(3);
  });

  it('Living Lands + Burakos short-name is-also', () => {
    const forest = {
      id: 'f', controller: 'p1',
      card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' },
    };
    const lands = P('Living Lands', 'All Forests are 1/1 creatures that are still lands.', 'Enchantment');
    const state: any = { battlefield: [forest, lands], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(isCreatureNow(forest as any)).toBe(true);
    expect(getCurrentPowerToughness(forest as any, state)?.power).toBe(1);

    const burakos = P(
      'Burakos, Party Leader',
      'Burakos is also a Cleric, Rogue, Warrior, and Wizard.',
      'Legendary Creature — Orc',
    );
    const bState: any = { battlefield: [burakos], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(bState);
    const types = [...getCreatureTypesNow(burakos as any)].map((t) => t.toLowerCase());
    expect(types).toEqual(expect.arrayContaining(['cleric', 'rogue', 'warrior', 'wizard']));
  });

  it('Thieves Tools + Lovestruck + Song + Emissary + Knowledge', () => {
    const tools = P(
      "Thieves' Tools",
      "Equipped creature can't be blocked as long as its power is 3 or less.",
      'Artifact — Equipment',
      { attachedTo: 'h' },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(tools).some(
      (s) => (s.grant.abilities || []).includes("can't be blocked")
        && (s.condition?.kind === 'target_power_at_most' || s.conditions?.some((c) => c.kind === 'target_power_at_most')),
    )).toBe(true);

    const lovestruck = P(
      'Lovestruck Beast',
      "This creature can't attack unless you control a 1/1 creature.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(lovestruck).some(
      (s) => (s.grant.abilities || []).includes("can't attack") && s.conditionNegated === true,
    )).toBe(true);

    const host = {
      id: 'h', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const song = P(
      'Song of Stupefaction',
      'Enchanted permanent gets -X/-0, where X is the number of permanent cards in your graveyard.',
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    const sState: any = {
      battlefield: [song, host],
      players: [{ id: 'p1' }],
      zones: {
        p1: {
          graveyard: [
            { type_line: 'Creature — Elf' },
            { type_line: 'Instant' },
            { type_line: 'Land' },
          ],
        },
      },
    };
    syncDerivedContinuousEffects(sState);
    expect(getCurrentPowerToughness(host as any, sState)?.power).toBe(0);

    const escort = P(
      'Emissary Escort',
      'This creature gets +X/+0, where X is the greatest mana value among other artifacts you control.',
      'Artifact Creature — Robot',
      {},
      { power: '0', toughness: '4' },
    );
    const art = {
      id: 'a', controller: 'p1',
      card: { name: 'Rock', type_line: 'Artifact', mana_cost: '{4}', cmc: 4 },
    };
    const eState: any = { battlefield: [escort, art], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(eState);
    expect(getCurrentPowerToughness(escort as any, eState)?.power).toBe(4);

    const kip = P(
      'Knowledge Is Power',
      "Creatures you control get +X/+X, where X is the number of cards you've drawn this turn.",
      'Enchantment',
    );
    const bear = {
      id: 'b', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const kState: any = {
      battlefield: [kip, bear],
      players: [{ id: 'p1' }],
      cardsDrawnThisTurn: { p1: 2 },
    };
    syncDerivedContinuousEffects(kState);
    expect(getCurrentPowerToughness(bear as any, kState)?.power).toBe(4);
  });

  it('Spectral + Deathleaper + Cybermen + Born to Drive', () => {
    const guardian = P(
      'Spectral Guardian',
      'As long as this creature is untapped, noncreature artifacts have shroud.',
    );
    const rock = {
      id: 'r', controller: 'p2',
      card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    };
    const gState: any = { battlefield: [guardian, rock], players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(gState);
    expect(getContinuousGrantedAbilitiesForPermanent(rock as any, gState)).toContain('shroud');

    const death = P(
      'Deathleaper, Terror Weapon',
      'Creatures you control that entered this turn have double strike.',
    );
    const newbie = {
      id: 'n', controller: 'p1', enteredThisTurn: true,
      card: { name: 'Spawn', type_line: 'Creature — Tyranid', power: '1', toughness: '1' },
    };
    const dState: any = { battlefield: [death, newbie], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(dState);
    expect(getContinuousGrantedAbilitiesForPermanent(newbie as any, dState)).toContain('double strike');

    const cyber = P(
      'Cybermen Squadron',
      'Nonlegendary artifact creatures you control have myriad.',
      'Artifact Creature — Cyberman',
    );
    const drone = {
      id: 'd', controller: 'p1',
      card: { name: 'Myr', type_line: 'Artifact Creature — Myr', power: '1', toughness: '1' },
    };
    const cState: any = { battlefield: [cyber, drone], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(cState);
    expect(getContinuousGrantedAbilitiesForPermanent(drone as any, cState)).toContain('myriad');

    const vehicleHost = {
      id: 'h', controller: 'p1',
      card: { name: 'Car', type_line: 'Artifact Creature — Vehicle', power: '3', toughness: '3' },
    };
    const drive = P(
      'Born to Drive',
      'As long as enchanted permanent is a creature, it gets +1/+1 for each creature and/or Vehicle you control.',
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    const pilot = {
      id: 'p', controller: 'p1',
      card: { name: 'Pilot', type_line: 'Creature — Human', power: '1', toughness: '1' },
    };
    const vState: any = { battlefield: [drive, vehicleHost, pilot], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(vState);
    // Host + pilot + any Vehicle = at least 2 (host is both creature and vehicle, counted once via regex).
    expect(getCurrentPowerToughness(vehicleHost as any, vState)?.power).toBeGreaterThanOrEqual(5);
  });

  it('classifiers cover B83 families', () => {
    const lines: Array<[string, string]> = [
      ["Swarm of Rats's power is equal to the number of Rats you control.", 'Swarm of Rats'],
      ["Cosmogoyf's power is equal to the number of cards you own in exile and its toughness is equal to that number plus 1.", 'Cosmogoyf'],
      ["This creature's power and toughness are each equal to the number of green mana symbols in the mana costs of permanents you control.", 'Primalcrux'],
      ['All Forests are 1/1 creatures that are still lands.', 'Living Lands'],
      ['Burakos is also a Cleric, Rogue, Warrior, and Wizard.', 'Burakos, Party Leader'],
      ['Metalcraft — Equipment you control have equip {0} as long as you control three or more artifacts.', 'Puresteel Paladin'],
      ["Equipped creature can't be blocked as long as its power is 3 or less.", "Thieves' Tools"],
      ["This creature can't attack unless you control a 1/1 creature.", 'Lovestruck Beast'],
      ['Enchanted permanent gets -X/-0, where X is the number of permanent cards in your graveyard.', 'Song of Stupefaction'],
      ['This creature gets +X/+0, where X is the greatest mana value among other artifacts you control.', 'Emissary Escort'],
      ["Creatures you control get +X/+X, where X is the number of cards you've drawn this turn.", 'Knowledge Is Power'],
      ['As long as this creature is untapped, noncreature artifacts have shroud.', 'Spectral Guardian'],
      ['Creatures you control that entered this turn have double strike.', 'Deathleaper, Terror Weapon'],
      ['Nonlegendary artifact creatures you control have myriad.', 'Cybermen Squadron'],
      ['As long as enchanted permanent is a creature, it gets +1/+1 for each creature and/or Vehicle you control.', 'Born to Drive'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});

import { describe, it, expect } from 'vitest';
import { countDifferentlyNamedLands, countFederationCreatureTypes, assimilatedTypeLine } from '../../rules-engine/src/trekCountBases';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator';
import { applySpellSelfTrekCountCostReduction } from '../src/state/modules/spellSelfTrekCountCostReduction';
import { adjustActivationManaCostForPayment } from '../src/state/modules/ability-cost-adjustments';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';

const D = '\u2014';
function perm(id: string, controller: string, name: string, type_line: string, oracle_text = '', extra: any = {}) {
  return { id, controller, owner: controller, counters: {}, ...extra, card: { id: id + '_c', name, type_line, oracle_text } };
}
const lands = (pid: string) => [
  perm('f1', pid, 'Forest', 'Basic Land ' + D + ' Forest'),
  perm('f2', pid, 'Forest', 'Basic Land ' + D + ' Forest'),
  perm('f3', pid, 'Forest', 'Basic Land ' + D + ' Forest'),
  perm('i1', pid, 'Island', 'Basic Land ' + D + ' Island'),
  perm('bp', pid, 'Breeding Pool', 'Land ' + D + ' Forest Island'),
  perm('opp', 'p2', 'Swamp', 'Basic Land ' + D + ' Swamp'),
];
function allSteps(ir: any): any[] {
  const out: any[] = [];
  for (const a of ir?.abilities || []) out.push(...(a.steps || []));
  return out;
}

describe('round 31: Trek count bases', () => {
  it('strange new worlds counts each land name once', () => {
    expect(countDifferentlyNamedLands(lands('p1') as any, 'p1')).toBe(3);
  });
  it('federation counts creature types among non-Borg creatures (Hoshi Sato + Sisko = 3)', () => {
    const bf = [
      perm('h', 'p1', 'Hoshi Sato', 'Legendary Creature ' + D + ' Human Scientist'),
      perm('s', 'p1', 'Captain Benjamin Sisko', 'Legendary Creature ' + D + ' Human Officer'),
      perm('b', 'p1', 'Census Drone', 'Artifact Creature ' + D + ' Borg Vedalken Wizard'),
      perm('v', 'p1', 'Census Ship', 'Artifact ' + D + ' Spacecraft'),
      perm('o', 'p2', 'Opp Elf', 'Creature ' + D + ' Elf'),
    ];
    expect(countFederationCreatureTypes(bf as any, 'p1')).toBe(3);
  });
  it('assimilated type line keeps supertypes, other card types and non-creature subtypes', () => {
    expect(assimilatedTypeLine('Land Creature ' + D + ' Forest Dryad')).toBe('Artifact Land Creature ' + D + ' Forest Borg');
    expect(assimilatedTypeLine('Legendary Creature ' + D + ' Human Officer')).toBe('Legendary Artifact Creature ' + D + ' Borg');
    expect(assimilatedTypeLine('Artifact Creature ' + D + ' Golem')).toBe('Artifact Creature ' + D + ' Borg');
  });
});

describe('round 31: strange new worlds wiring', () => {
  it('P/T CDA with the ability-word prefix (Lt. Arex real text)', () => {
    const card: any = { id: 'ax', name: 'Lt. Arex', type_line: 'Legendary Creature ' + D + ' Edoan Officer', power: '*', toughness: '*', oracle_text: 'Strange new worlds ' + D + " Lt. Arex's power and toughness are each equal to the number of differently named lands you control." };
    expect(calculateVariablePT(card, { battlefield: [{ id: 'ax', controller: 'p1', card }, ...lands('p1')] })).toEqual({ power: 3, toughness: 3 });
  });
  it('power-only CDA (The Traveler style, made-up name)', () => {
    const card: any = { id: 'tv', name: 'Census Wanderer', type_line: 'Creature ' + D + ' Traveler', power: '*', toughness: '4', oracle_text: 'Strange new worlds ' + D + " Census Wanderer's power is equal to the number of differently named lands you control." };
    expect(calculateVariablePT(card, { battlefield: [{ id: 'tv', controller: 'p1', card }, ...lands('p1')] })).toEqual({ power: 3, toughness: 4 });
  });
  it('spell self cost reduction', () => {
    const r = applySpellSelfTrekCountCostReduction({ oracleText: 'Strange new worlds ' + D + ' This spell costs {X} less to cast, where X is the number of differently named lands you control.', cardName: 'Census Phaser', battlefield: lands('p1'), playerId: 'p1' });
    expect(r.generic).toBe(3);
  });
  it('activated ability self cost reduction (Warp Speed style)', () => {
    const text = '{7}{U}{U}, Sacrifice this enchantment: Draw two cards. This ability costs {X} less to activate, where X is the number of differently named lands you control.';
    const res = adjustActivationManaCostForPayment({ state: { battlefield: lands('p1') }, activatorId: 'p1', sourceCard: { name: 'Census Warp', oracle_text: text }, sourceZone: 'battlefield', sourceController: 'p1', isManaAbility: false, manaCostString: '{7}{U}{U}', sourceName: 'Census Warp', sourceId: 'w', abilityText: text });
    expect(res.adjustedManaCost).toBe('{4}{U}{U}');
    const plain = adjustActivationManaCostForPayment({ state: { battlefield: lands('p1') }, activatorId: 'p1', sourceCard: { name: 'Census Warp' }, sourceZone: 'battlefield', sourceController: 'p1', isManaAbility: false, manaCostString: '{7}{U}{U}', sourceId: 'w' });
    expect(plain.adjustedManaCost).toBe('{7}{U}{U}');
  });
});

describe('round 31: Cloaking Device', () => {
  const text = "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 6+.)\nCloaking Device " + D + " As long as this Spacecraft isn't a creature, it has hexproof.\n6+ | Flying";
  it('has hexproof while not a creature, loses it once stationed', () => {
    const ship = perm('rb', 'p1', 'Romulan Bird-of-Prey', 'Artifact ' + D + ' Spacecraft', text);
    let got = getContinuousGrantedAbilitiesForPermanent(ship as any, { battlefield: [ship] } as any);
    expect(got.map((a: string) => a.toLowerCase())).toContain('hexproof');
    const stationed = { ...ship, counters: { charge: 6 } };
    got = getContinuousGrantedAbilitiesForPermanent(stationed as any, { battlefield: [stationed] } as any);
    expect(got.map((a: string) => a.toLowerCase())).not.toContain('hexproof');
  });
});

function makeState(battlefield: any[], zones: any = {}): any {
  return {
    id: 'g', format: 'commander', turnPlayer: 'p1', priority: 'p1', stack: [], startingLife: 40, life: {},
    players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] }, { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: zones.p2Graveyard || [], exile: [] }],
    battlefield,
  };
}

describe('round 31: Assimilate', () => {
  it('lowers battlefield assimilate to gain control + counter + Borg type (Borg saga I real text)', () => {
    const ir: any = parseOracleTextToIR('Assimilate target nonartifact creature an opponent controls. (Gain control of it and put a +1/+1 counter on it. It' + "'" + 's a Borg artifact creature and loses all other creature types.)', 'Census Saga');
    const step = allSteps(ir).find((s: any) => s.kind === 'gain_control');
    expect(step).toBeTruthy();
    expect(step.assimilate).toBe(true);
    const victim = perm('v', 'p2', 'Census Arbor', 'Land Creature ' + D + ' Forest Dryad');
    const saga = perm('saga', 'p1', 'Census Saga', 'Enchantment ' + D + ' Saga');
    const res: any = applyOracleIRStepsToGameState(makeState([victim, saga]), [step], { controllerId: 'p1', sourceId: 'saga', targetPermanentId: 'v' } as any);
    const after = res.state.battlefield.find((p: any) => p.id === 'v');
    expect(after.controller).toBe('p1');
    expect(after.counters['+1/+1']).toBe(1);
    expect(after.card.type_line).toBe('Artifact Land Creature ' + D + ' Forest Borg');
    expect(res.state.battlefield.find((p: any) => p.id === 'saga').assimilatedIds).toEqual(['v']);
  });
  it('lowers card assimilate to a battlefield move with a counter and Borg type', () => {
    const ir: any = parseOracleTextToIR('At the beginning of your end step, assimilate target creature card from a graveyard. (Put it onto the battlefield under your control with a +1/+1 counter. It' + "'" + 's a Borg artifact creature and loses all other creature types.)', 'Census Cube');
    const step = allSteps(ir).find((s: any) => s.kind === 'move_zone');
    expect(step).toBeTruthy();
    expect(step.to).toBe('battlefield');
    expect(step.battlefieldAssimilate).toBe(true);
    expect(step.withCounters).toEqual({ '+1/+1': 1 });
  });
});

describe('round 31: Federation where-X', () => {
  it('pumps by creature types among non-Borg creatures (Captain Jonathan Archer style)', () => {
    const ir: any = parseOracleTextToIR('Federation ' + D + ' {G}, {T}: Target creature you control gets +X/+X until end of turn, where X is the number of creature types among non-Borg creatures you control. Activate only as a sorcery.', 'Census Archer');
    const steps = allSteps(ir);
    expect(steps.length).toBeGreaterThan(0);
    const bf = [
      perm('h', 'p1', 'Hoshi Sato', 'Legendary Creature ' + D + ' Human Scientist', '', { basePower: 1, baseToughness: 1 }),
      perm('s', 'p1', 'Captain Benjamin Sisko', 'Legendary Creature ' + D + ' Human Officer', '', { basePower: 2, baseToughness: 2 }),
      perm('b', 'p1', 'Census Drone', 'Artifact Creature ' + D + ' Borg Wizard'),
    ];
    const res: any = applyOracleIRStepsToGameState(makeState(bf), steps, { controllerId: 'p1', sourceId: 'h', targetCreatureId: 'h', targetPermanentId: 'h' } as any);
    expect(res.state.battlefield[0].effectivePower).toBe(4);
    expect(JSON.stringify(res.log || [])).toMatch(/3/);
  });
});

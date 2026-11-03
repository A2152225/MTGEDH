import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor';
import { applyStaticAbilitiesToBattlefield } from '../../rules-engine/src/staticAbilitiesBattlefield';
import { restoreAssimilatedCardsOutsideBattlefield } from '../../rules-engine/src/trekAssimilateZoneReset';
import { countFederationCreatureTypes, countDilemmasFacedThisTurn, countOpponentsAttackedThisTurn } from '../../rules-engine/src/trekCountBases';
import { applySpellSelfTrekCountCostReduction } from '../src/state/modules/spellSelfTrekCountCostReduction';
import { getContinuousGrantedAbilitiesForPermanent, getContinuousPTBonusForPermanent } from '../src/state/modules/staticEffectSpec';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator';

const D = '\u2014';
function perm(id: string, controller: string, name: string, type_line: string, oracle_text = '', extra: any = {}) {
  return { id, controller, owner: controller, counters: {}, ...extra, card: { id: id + '_c', name, type_line, oracle_text, ...(extra.cardExtra || {}) } };
}
function st(battlefield: any[], extra: any = {}): any {
  return {
    id: 'g', format: 'commander', turnPlayer: extra.turnPlayer || 'p1', priority: 'p1', stack: [], startingLife: 40, life: {},
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: extra.p1Library || [], hand: [], graveyard: [], exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: extra.p2Library || [], hand: [], graveyard: extra.p2Graveyard || [], exile: [] },
    ],
    battlefield,
  };
}
const kw = (p: any, s: any) => getContinuousGrantedAbilitiesForPermanent(p, s).map((a: string) => a.toLowerCase());
const steps = (text: string, name: string) => { const ir: any = parseOracleTextToIR(text, name); const out: any[] = []; for (const a of ir.abilities) out.push(...a.steps); return out; };

describe('round 32: Station thresholds', () => {
  const text = "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery.)\n9+ | Creatures you control get +3/+3.";
  it('applies the 9+ anthem only with 9 charge counters', () => {
    const ds = perm('ds', 'p1', 'Deep Space 9', 'Legendary Artifact ' + D + ' Spacecraft', text);
    const bear = perm('b', 'p1', 'Bear', 'Creature ' + D + ' Bear');
    let s = st([ds, bear]);
    expect(getContinuousPTBonusForPermanent(bear as any, s)).toEqual({ power: 0, toughness: 0 });
    const ds9 = { ...ds, counters: { charge: 9 } };
    s = st([ds9, bear]);
    expect(getContinuousPTBonusForPermanent(bear as any, s)).toEqual({ power: 3, toughness: 3 });
  });
  it('6+ artifact creatures have flying', () => {
    const t = "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 6+.)\n6+ | Artifact creatures you control have flying.";
    const ship = perm('sh', 'p1', 'Borg Scout Sphere', 'Artifact ' + D + ' Spacecraft', t, { counters: { charge: 6 } });
    const drone = perm('dr', 'p1', 'Drone', 'Artifact Creature ' + D + ' Borg');
    expect(kw(drone, st([ship, drone]))).toContain('flying');
    const low = { ...ship, counters: { charge: 5 } };
    expect(kw(drone, st([low, drone]))).not.toContain('flying');
  });
});

describe('round 32: counter-qualified and group grants', () => {
  it('McCoy / Dominion Supervisor grant only to creatures with counters', () => {
    const sup = perm('ds', 'p1', 'Dominion Supervisor', 'Creature ' + D + ' Vorta Doctor', 'Creatures you control with counters on them have trample.');
    const a = perm('a', 'p1', 'A', 'Creature ' + D + ' Bear', '', { counters: { '+1/+1': 1 } });
    const b = perm('b', 'p1', 'B', 'Creature ' + D + ' Bear');
    const s = st([sup, a, b]);
    expect(kw(a, s)).toContain('trample');
    expect(kw(b, s)).not.toContain('trample');
  });
  it("Hemmer / K'Vort grant hexproof only during your turn", () => {
    const hem = perm('h', 'p1', 'Hemmer, Fixing What Is Broken', 'Legendary Creature ' + D + ' Aenar Artificer', 'During your turn, Spacecraft you control have hexproof.');
    const ship = perm('sp', 'p1', 'Ship', 'Artifact ' + D + ' Spacecraft');
    expect(kw(ship, st([hem, ship], { turnPlayer: 'p1' }))).toContain('hexproof');
    expect(kw(ship, st([hem, ship], { turnPlayer: 'p2' }))).not.toContain('hexproof');
    const kv = perm('kv', 'p1', "K'Vort-Class Raider", 'Artifact ' + D + ' Spacecraft', 'During your turn, this Spacecraft and creatures you control have hexproof.');
    const bear = perm('b', 'p1', 'Bear', 'Creature ' + D + ' Bear');
    expect(kw(bear, st([kv, bear], { turnPlayer: 'p1' }))).toContain('hexproof');
    expect(kw(kv, st([kv, bear], { turnPlayer: 'p1' }))).toContain('hexproof');
    expect(kw(bear, st([kv, bear], { turnPlayer: 'p2' }))).not.toContain('hexproof');
  });
  it('On the Shoulders of Giants: historic creatures fly', () => {
    const ench = perm('e', 'p1', 'On the Shoulders of Giants', 'Enchantment', 'Historic creatures you control have flying.');
    const leg = perm('l', 'p1', 'Leg', 'Legendary Creature ' + D + ' Human');
    const plain = perm('p', 'p1', 'Plain', 'Creature ' + D + ' Human');
    const s = st([ench, leg, plain]);
    expect(kw(leg, s)).toContain('flying');
    expect(kw(plain, s)).not.toContain('flying');
  });
  it("Negh'Var: Klingons and Warriors have vigilance", () => {
    const nv = perm('n', 'p1', "I.K.S. Negh'Var, Imperial Flagship", 'Legendary Artifact ' + D + ' Spacecraft', 'Klingons and Warriors you control have vigilance.');
    const k = perm('k', 'p1', 'K', 'Creature ' + D + ' Klingon');
    const h = perm('hh', 'p1', 'H', 'Creature ' + D + ' Human');
    const s = st([nv, k, h]);
    expect(kw(k, s)).toContain('vigilance');
    expect(kw(h, s)).not.toContain('vigilance');
  });
  it('Kirk / Worf type lords', () => {
    const kirk = perm('ki', 'p1', 'Kirk, Man of Action', 'Legendary Creature ' + D + ' Human Officer', 'Other Officers, Artificers, Doctors, Pilots, Scientists, and Spacecraft creatures you control get +2/+2.');
    const doc = perm('d', 'p1', 'Doc', 'Creature ' + D + ' Human Doctor');
    const bear = perm('b', 'p1', 'Bear', 'Creature ' + D + ' Bear');
    let s = st([kirk, doc, bear]);
    expect(getContinuousPTBonusForPermanent(doc as any, s)).toEqual({ power: 2, toughness: 2 });
    expect(getContinuousPTBonusForPermanent(bear as any, s)).toEqual({ power: 0, toughness: 0 });
    expect(getContinuousPTBonusForPermanent(kirk as any, s)).toEqual({ power: 0, toughness: 0 });
    const worf = perm('w', 'p1', 'Worf, Son of Mogh', 'Legendary Creature ' + D + ' Klingon Warrior Officer', 'Menace\nOther Officers you control get +1/+1.');
    const off = perm('o', 'p1', 'Off', 'Creature ' + D + ' Human Officer');
    s = st([worf, off]);
    expect(getContinuousPTBonusForPermanent(off as any, s)).toEqual({ power: 1, toughness: 1 });
  });
});

describe('round 32: counted P/T', () => {
  it('Academy Instructor counts Officer tokens', () => {
    const ai = perm('ai', 'p1', 'Academy Instructor', 'Creature ' + D + ' Bolian Officer', 'This creature gets +1/+0 for each Officer token you control.');
    const t1 = perm('t1', 'p1', 'Officer', 'Token Creature ' + D + ' Officer', '', { isToken: true });
    const t2 = perm('t2', 'p1', 'Officer', 'Token Creature ' + D + ' Officer', '', { isToken: true });
    const nt = perm('nt', 'p1', 'Real Officer', 'Creature ' + D + ' Officer');
    expect(getContinuousPTBonusForPermanent(ai as any, st([ai, t1, t2, nt]))).toEqual({ power: 2, toughness: 0 });
  });
  it('Collective Drone power equals artifact creatures you control', () => {
    const card: any = { id: 'cd', name: 'Collective Drone', type_line: 'Artifact Creature ' + D + ' Borg', power: '*', toughness: '3', oracle_text: "Collective Drone's power is equal to the number of artifact creatures you control." };
    const bf = [{ id: 'cd', controller: 'p1', card }, perm('x', 'p1', 'X', 'Artifact Creature ' + D + ' Golem'), perm('y', 'p1', 'Y', 'Creature ' + D + ' Bear'), perm('z', 'p2', 'Z', 'Artifact Creature ' + D + ' Golem')];
    expect(calculateVariablePT(card, { battlefield: bf })).toEqual({ power: 2, toughness: 3 });
  });
});

describe('round 32: Koloth typal goad', () => {
  it('goads Tribbles (including your own) and pumps them', () => {
    const text = 'All Tribbles get +1/+0 and are goaded. (They attack each combat if able and attack a player other than you if able.)';
    const kol = perm('k', 'p1', 'Koloth, Tribble Hunter', 'Legendary Creature ' + D + ' Klingon Warrior Officer', text);
    const mine = perm('t1', 'p1', 'Tribble', 'Token Creature ' + D + ' Tribble', '', { isToken: true });
    const theirs = perm('t2', 'p2', 'Tribble', 'Token Creature ' + D + ' Tribble', '', { isToken: true });
    const bear = perm('b', 'p2', 'Bear', 'Creature ' + D + ' Bear');
    const s = st([kol, mine, theirs, bear]);
    const out: any[] = applyStaticAbilitiesToBattlefield(s.battlefield, () => [] as any, s);
    expect(out.find(p => p.id === 't1').isStaticallyGoaded).toBe(true);
    expect(out.find(p => p.id === 't2').isStaticallyGoaded).toBe(true);
    expect(out.find(p => p.id === 'b').isStaticallyGoaded).toBeFalsy();
    expect(getContinuousPTBonusForPermanent(theirs as any, s)).toEqual({ power: 1, toughness: 0 });
  });
});

describe('round 32: Assimilate follow-ups', () => {
  it('restores the printed type line once the card leaves the battlefield (CR 400.7)', () => {
    const s: any = st([]);
    s.players[1].graveyard = [{ id: 'c1', name: 'Elf', type_line: 'Artifact Creature ' + D + ' Borg', assimilatedPrintedTypeLine: 'Creature ' + D + ' Elf' }];
    restoreAssimilatedCardsOutsideBattlefield(s);
    expect(s.players[1].graveyard[0].type_line).toBe('Creature ' + D + ' Elf');
  });
  it('Federation counts a changeling as every non-Borg creature type', () => {
    const bf = [perm('c', 'p1', 'Shape', 'Creature ' + D + ' Shapeshifter', 'Changeling (This card is every creature type.)')];
    expect(countFederationCreatureTypes(bf as any, 'p1')).toBeGreaterThan(200);
  });
  it('Saga III exiles the Borg assimilated with this Saga, then returns it', () => {
    const saga = perm('saga', 'p1', 'The Best of Both Worlds', 'Enchantment ' + D + ' Saga', '', { assimilatedIds: ['v'] });
    const victim = perm('v', 'p1', 'Victim', 'Artifact Creature ' + D + ' Borg', '', { owner: 'p2', assimilatedBySourceId: 'saga' });
    const other = perm('o', 'p1', 'Other', 'Artifact Creature ' + D + ' Borg');
    const ex = steps('Exile the Borg assimilated with this Saga.', 'The Best of Both Worlds').find((x: any) => x.kind === 'exile');
    const res: any = applyOracleIRStepsToGameState(st([saga, victim, other]), [ex], { controllerId: 'p1', sourceId: 'saga' } as any);
    const ids = res.state.battlefield.map((p: any) => p.id);
    expect(ids).not.toContain('v');
    expect(ids).toContain('o');
  });
  it("Assimilation Assessor exiles target opponent's graveyard", () => {
    const g = [{ id: 'g1', name: 'Bear', type_line: 'Creature ' + D + ' Bear' }];
    const sx = steps("When this creature enters, exile target opponent's graveyard.", 'Assimilation Assessor');
    const res: any = applyOracleIRStepsToGameState(st([], { p2Graveyard: g }), sx, { controllerId: 'p1', sourceId: 'aa', selectorContext: { targetOpponentId: 'p2' } } as any);
    const p2 = res.state.players.find((p: any) => p.id === 'p2');
    expect(p2.graveyard.length).toBe(0);
    expect(p2.exile.map((c: any) => c.id)).toContain('g1');
  });
  it('Borg Cube falls back to exiling up to one target creature when nothing can be assimilated', () => {
    const sx = steps("Whenever this Spacecraft enters or attacks, assimilate a creature card exiled with it. If you can't, exile up to one target creature.", 'Borg Cube');
    const cube = perm('cube', 'p1', 'Borg Cube', 'Artifact ' + D + ' Spacecraft');
    const t = perm('t', 'p2', 'Target', 'Creature ' + D + ' Bear');
    const res: any = applyOracleIRStepsToGameState(st([cube, t]), sx, { controllerId: 'p1', sourceId: 'cube', targetPermanentId: 't' } as any);
    expect(res.state.battlefield.map((p: any) => p.id)).not.toContain('t');
  });
  it('Gift of Perfection reveals until a creature and parses the assimilate pick', () => {
    const sx = steps('Each opponent reveals cards from the top of their library until they reveal a creature card. Assimilate one of the creature cards revealed this way. Then each opponent puts the other cards they revealed this way on the bottom of their library in a random order.', 'Gift of Perfection');
    expect(sx[0]).toMatchObject({ kind: 'reveal_top', who: { kind: 'each_opponent' } });
    expect(sx[1]).toMatchObject({ kind: 'move_zone', battlefieldAssimilate: true });
    const ir: any = parseOracleTextToIR('Each opponent reveals cards from the top of their library until they reveal a creature card. Assimilate one of the creature cards revealed this way.', 'Gift of Perfection');
    expect(ir.abilities.every((a: any) => a.type === 'spell')).toBe(true);
  });
  it('Praxis: Strange new worlds prefix no longer hides the -X/-X and the X>=6 rider', () => {
    const sx = steps('Strange new worlds ' + D + ' All creatures get -X/-X until end of turn, where X is the number of differently named lands you control. If X is 6 or more, create two 2/1 red Klingon Warrior creature tokens with haste.', 'The Destruction of Praxis');
    expect(sx[0].kind).toBe('modify_pt');
    expect(sx[1].kind).toBe('conditional');
  });
});

describe('round 32: dilemma and battlefront count bases', () => {
  const lib = (p: string) => Array.from({ length: 6 }, (_, i) => ({ id: p + 'L' + i, name: 'C' + i, type_line: 'Creature' }));
  const mk = (dilemmas: number, attacked: string[]): any => ({
    id: 'g', turnPlayer: 'p1', stack: [],
    dilemmasFacedThisTurn: { p1: dilemmas }, attackedPlayersThisTurnByPlayer: { p1: attacked },
    players: ['p1', 'p2', 'p3'].map(id => ({ id, library: lib(id), hand: [], graveyard: [], exile: [] })),
    battlefield: [{ id: 'src', controller: 'p1', owner: 'p1', counters: {}, card: { name: 'Src', type_line: 'Creature' } }],
  });
  const run = (text: string, name: string, state: any) => {
    const ir: any = parseOracleTextToIR(text, name);
    return applyOracleIRStepsToGameState(state, ir.abilities[0].steps, { controllerId: 'p1', sourceId: 'src', selectorContext: { targetOpponentId: 'p2' } } as any) as any;
  };
  it('counts helpers', () => {
    expect(countDilemmasFacedThisTurn(mk(2, []), 'p1')).toBe(2);
    expect(countOpponentsAttackedThisTurn(mk(0, ['p2', 'p3', 'p1', 'p2']), 'p1')).toBe(2);
  });
  it('Worf exiles X = opponents attacked', () => {
    const r = run('Whenever you attack, exile the top X cards of your library, where X is the number of opponents you attacked this turn. Until the end of your next turn, you may play those cards.', 'Worf, Defiant Commander', mk(0, ['p2', 'p3']));
    expect(r.state.players[0].exile.length).toBe(2);
  });
  it('Sisko makes a token per dilemma', () => {
    const r = run("At the beginning of your end step, create a 1/1 red Officer creature token for each dilemma you've faced this turn.", 'Captain Benjamin Sisko', mk(2, []));
    expect(r.state.battlefield.length).toBe(3);
  });
  it('Caretaker checks faced a dilemma', () => {
    const text = 'At the beginning of each end step, if you faced a dilemma this turn, target opponent exiles cards from the top of their library until they exile a nonland card. You may cast that card without paying its mana cost.';
    expect(run(text, 'The Caretaker', mk(1, [])).state.players[1].exile.length).toBe(1);
    expect(run(text, 'The Caretaker', mk(0, [])).state.players[1].exile.length).toBe(0);
  });
  it('Own the Day costs {1} less per opponent attacked', () => {
    const r = applySpellSelfTrekCountCostReduction({ oracleText: 'Battlefront \u2014 This spell costs {1} less to cast for each opponent you attacked this turn.', cardName: 'Own the Day', battlefield: [], playerId: 'p1', state: mk(0, ['p2', 'p3']) });
    expect(r.generic).toBe(2);
  });
});

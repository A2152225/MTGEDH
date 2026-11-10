import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch81 statics', () => {
  it('Dire Wolves plains + Snarling Warg or-type + Guul empty hand + Secretkeeper', () => {
    const dire = P('Dire Wolves', 'This creature has banding as long as you control a Plains.');
    const plains = {
      id: 'l', controller: 'p1',
      card: { name: 'Plains', type_line: 'Basic Land — Plains' },
    };
    const dState: any = { battlefield: [dire, plains], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(dState);
    expect(getContinuousGrantedAbilitiesForPermanent(dire as any, dState)).toContain('banding');

    const warg = P('Snarling Warg', 'As long as you control a Goblin or Orc, this creature gets +1/+0.');
    const goblin = {
      id: 'g', controller: 'p1',
      card: { name: 'Gob', type_line: 'Creature — Goblin', power: '1', toughness: '1' },
    };
    const wState: any = { battlefield: [warg, goblin], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(wState);
    expect(getCurrentPowerToughness(warg as any, wState)?.power).toBe(3);

    const guul = P(
      'Guul Draz Specter',
      'This creature gets +3/+3 as long as an opponent has no cards in hand.',
      'Creature',
      {},
      { power: '2', toughness: '2' },
    );
    const gState: any = {
      battlefield: [guul],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: { p1: { hand: [{}, {}] }, p2: { hand: [] } },
    };
    syncDerivedContinuousEffects(gState);
    expect(getCurrentPowerToughness(guul as any, gState)?.power).toBe(5);

    const secret = P(
      'Secretkeeper',
      'As long as you have more cards in hand than each opponent, this creature gets +2/+2 and has flying.',
    );
    const sState: any = {
      battlefield: [secret],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: { p1: { hand: [{}, {}, {}] }, p2: { hand: [{}] } },
    };
    syncDerivedContinuousEffects(sState);
    expect(getCurrentPowerToughness(secret as any, sState)?.power).toBe(4);
    expect(getContinuousGrantedAbilitiesForPermanent(secret as any, sState)).toContain('flying');
  });

  it('Formation Breaker + Rimestag + Faeburrow colors + Enemy opponents hands + Gleam', () => {
    const breaker = P(
      'Formation Breaker',
      'As long as you control a creature with a counter on it, this creature gets +1/+2.',
    );
    const counted = {
      id: 'c', controller: 'p1', counters: { '+1/+1': 1 },
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const bState: any = { battlefield: [breaker, counted], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(bState);
    expect(getCurrentPowerToughness(breaker as any, bState)?.power).toBe(3);

    const rimestag = P(
      'Saddled Rimestag',
      'This creature gets +2/+2 as long as you had another creature enter the battlefield under your control this turn.',
    );
    const entered = {
      id: 'e', controller: 'p1', enteredThisTurn: true,
      card: { name: 'Elk', type_line: 'Creature — Elk', power: '1', toughness: '1' },
    };
    const rState: any = { battlefield: [rimestag, entered], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(rState);
    expect(getCurrentPowerToughness(rimestag as any, rState)?.power).toBe(4);

    const elder = P(
      'Faeburrow Elder',
      'This creature gets +1/+1 for each color among permanents you control.',
      'Creature',
      {},
      { power: '0', toughness: '0', colors: ['G'] },
    );
    const blue = {
      id: 'u', controller: 'p1',
      card: { name: 'Merfolk', type_line: 'Creature — Merfolk', colors: ['U'], power: '1', toughness: '1' },
    };
    const eState: any = { battlefield: [elder, blue], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(eState);
    expect(getCurrentPowerToughness(elder as any, eState)?.power).toBeGreaterThanOrEqual(2);

    const enemy = P(
      'Enemy of Enlightenment',
      "This creature gets -1/-1 for each card in your opponents' hands.",
      'Creature',
      {},
      { power: '5', toughness: '5' },
    );
    const enState: any = {
      battlefield: [enemy],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: { p1: { hand: [] }, p2: { hand: [{}, {}] } },
    };
    syncDerivedContinuousEffects(enState);
    expect(getCurrentPowerToughness(enemy as any, enState)?.power).toBe(3);

    const gleam = P(
      'Gleam of Authority',
      'Enchanted creature gets +1/+1 for each +1/+1 counter on other creatures you control.',
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    const host = {
      id: 'h', controller: 'p1',
      card: { name: 'Host', type_line: 'Creature — Soldier', power: '2', toughness: '2' },
    };
    const other = {
      id: 'o', controller: 'p1', counters: { '+1/+1': 2 },
      card: { name: 'Other', type_line: 'Creature — Soldier', power: '1', toughness: '1' },
    };
    const glState: any = { battlefield: [gleam, host, other], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(glState);
    expect(getCurrentPowerToughness(host as any, glState)?.power).toBe(4);
  });

  it('Lovisa + Curse + Raph + Ivory + Gwafa + Hithlain + Rolling/Piston + classifiers', () => {
    const lovisa = P(
      'Lovisa Coldeyes',
      "Each creature that's a Barbarian, a Warrior, or a Berserker gets +2/+2 and has haste.",
    );
    const warrior = {
      id: 'w', controller: 'p2',
      card: { name: 'Fighter', type_line: 'Creature — Human Warrior', power: '2', toughness: '2' },
    };
    const lState: any = { battlefield: [lovisa, warrior], players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(lState);
    expect(getCurrentPowerToughness(warrior as any, lState)?.power).toBe(4);
    expect(getContinuousGrantedAbilitiesForPermanent(warrior as any, lState)).toContain('haste');

    const curse = P(
      "Curse of Death's Hold",
      'Creatures enchanted player controls get -1/-1.',
      'Enchantment — Aura Curse',
      { enchantedPlayerId: 'p2' },
    );
    const victim = {
      id: 'v', controller: 'p2',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '3', toughness: '3' },
    };
    const cState: any = { battlefield: [curse, victim], players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(cState);
    expect(getCurrentPowerToughness(victim as any, cState)?.power).toBe(2);

    const raph = P("Raph's Bravado", 'During your turn, attacking creatures get +1/+0.');
    const atk = {
      id: 'a', controller: 'p1', attacking: 'p2', isAttacking: true,
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const rState: any = { battlefield: [raph, atk], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(rState);
    expect(getCurrentPowerToughness(atk as any, rState)?.power).toBe(3);

    const ivory = P(
      'Ivory Guardians',
      'Creatures named Ivory Guardians get +1/+1 as long as an opponent controls a nontoken red permanent.',
      'Creature',
      {},
      { power: '3', toughness: '3' },
    );
    const red = {
      id: 'r', controller: 'p2', isToken: false,
      card: { name: 'Goblin', type_line: 'Creature — Goblin', colors: ['R'], power: '1', toughness: '1' },
    };
    const iState: any = { battlefield: [ivory, red], players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(iState);
    expect(getCurrentPowerToughness(ivory as any, iState)?.power).toBe(4);

    const gwafa = P('Gwafa Hazid, Profiteer', "Creatures with bribery counters on them can't attack or block.");
    const bribed = {
      id: 'b', controller: 'p2', counters: { bribery: 1 },
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const gState: any = { battlefield: [gwafa, bribed], players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(gState);
    expect(getContinuousGrantedAbilitiesForPermanent(bribed as any, gState)).toEqual(
      expect.arrayContaining(["can't attack", "can't block"]),
    );

    const rope = P('Hithlain Rope', "This artifact can't be sacrificed.", 'Artifact');
    expect(parseStaticEffectSpecsFromOraclePermanent(rope).some(
      (s) => (s.grant.abilities || []).includes("can't be sacrificed"),
    )).toBe(true);

    const stones = P('Rolling Stones', "Wall creatures can attack as though they didn't have defender.");
    const wall = {
      id: 'wall', controller: 'p1',
      card: { name: 'Wall of Wood', type_line: 'Creature — Wall', power: '0', toughness: '3' },
    };
    const stState: any = { battlefield: [stones, wall], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(stState);
    const wallSpecs = parseStaticEffectSpecsFromOraclePermanent(stones);
    expect(wallSpecs.some((s) => (s.grant.asThoughNoAbilities || []).includes('defender'))).toBe(true);

    const piston = P(
      'Piston-Fist Cyclops',
      "As long as you've cast an instant or sorcery spell this turn, this creature can attack as though it didn't have defender.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(piston).some(
      (s) => s.condition?.kind === 'controller_instant_or_sorcery_cast_this_turn'
        && (s.grant.asThoughNoAbilities || []).includes('defender'),
    )).toBe(true);

    const lines: Array<[string, string]> = [
      ['This creature has banding as long as you control a Plains.', 'Dire Wolves'],
      ['As long as you control a Goblin or Orc, this creature gets +1/+0.', 'Snarling Warg'],
      ['This creature gets +3/+3 as long as an opponent has no cards in hand.', 'Guul Draz Specter'],
      ['As long as you have more cards in hand than each opponent, this creature gets +2/+2 and has flying.', 'Secretkeeper'],
      ['As long as you control a creature with a counter on it, this creature gets +1/+2.', 'Formation Breaker'],
      ['This creature gets +2/+2 as long as you had another creature enter the battlefield under your control this turn.', 'Saddled Rimestag'],
      ['This creature gets +1/+1 for each color among permanents you control.', 'Faeburrow Elder'],
      ["This creature gets -1/-1 for each card in your opponents' hands.", 'Enemy of Enlightenment'],
      ['Enchanted creature gets +1/+1 for each +1/+1 counter on other creatures you control.', 'Gleam of Authority'],
      ["Each creature that's a Barbarian, a Warrior, or a Berserker gets +2/+2 and has haste.", 'Lovisa Coldeyes'],
      ['Creatures enchanted player controls get -1/-1.', "Curse of Death's Hold"],
      ['During your turn, attacking creatures get +1/+0.', "Raph's Bravado"],
      ['Creatures named Ivory Guardians get +1/+1 as long as an opponent controls a nontoken red permanent.', 'Ivory Guardians'],
      ["Creatures with bribery counters on them can't attack or block.", 'Gwafa Hazid, Profiteer'],
      ["This artifact can't be sacrificed.", 'Hithlain Rope'],
      ["Wall creatures can attack as though they didn't have defender.", 'Rolling Stones'],
      ["As long as you've cast an instant or sorcery spell this turn, this creature can attack as though it didn't have defender.", 'Piston-Fist Cyclops'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});

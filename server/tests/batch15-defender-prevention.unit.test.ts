import { describe, it, expect } from 'vitest';
import { canAttackDespiteDefender, cowardsCantBlockWarriorsReason } from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';
import { parseDamagePreventionSentence, selfReferenceSentences, matchesDamagePreventionExtras } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamagePreventionOracleTemplates.js';

const wall = (id: string, controller = 'p1', extra: any = {}) => ({ id, controller, card: { name: 'Wall ' + id, type_line: 'Creature — Wall', oracle_text: 'Defender', power: '0', toughness: '4' }, ...extra });
const crt = (id: string, power: number, oracle = '', name = 'Bear ' + id, controller = 'p1') => ({ id, controller, card: { name, type_line: 'Creature — Bear', oracle_text: oracle, power: String(power), toughness: '2' } });

describe('batch15 defender attack permission', () => {
  it('global permission frees every defender you control, not opponents', () => {
    const bf = [wall('w1'), crt('h', 2, "Creatures you control can attack as though they didn't have defender.", 'High Alert')];
    expect(canAttackDespiteDefender(bf[0], bf, 'p1')).toBe(true);
    expect(canAttackDespiteDefender(wall('w2', 'p2'), bf, 'p2')).toBe(false);
  });
  it('self conditional only frees itself and only when the condition holds', () => {
    const sentry = { ...wall('s'), card: { name: 'Bristlepack Sentry', type_line: 'Creature — Wolf', power: '3', toughness: '3', oracle_text: "Defender\nAs long as you control a creature with power 4 or greater, Bristlepack Sentry can attack as though it didn't have defender." } };
    const other = wall('w1');
    expect(canAttackDespiteDefender(sentry, [sentry, other], 'p1')).toBe(false);
    const big = crt('b', 5);
    expect(canAttackDespiteDefender(sentry, [sentry, other, big], 'p1')).toBe(true);
    expect(canAttackDespiteDefender(other, [sentry, other, big], 'p1')).toBe(false);
  });
  it('counter condition', () => {
    const s: any = { ...wall('s'), card: { name: 'Skyclave Sentinel', type_line: 'Creature', power: '3', toughness: '3', oracle_text: "Defender\nAs long as this creature has a +1/+1 counter on it, it can attack as though it didn't have defender." } };
    expect(canAttackDespiteDefender(s, [s], 'p1')).toBe(false);
    s.counters = { '+1/+1': 1 };
    expect(canAttackDespiteDefender(s, [s], 'p1')).toBe(true);
  });
  it("cowards can't block warriors", () => {
    const src = crt('k', 3, "Cowards can't block Warriors.");
    const coward = { id: 'c', controller: 'p2', card: { name: 'C', type_line: 'Creature — Goblin Coward', oracle_text: '' } };
    const warrior = { id: 'w', controller: 'p1', card: { name: 'W', type_line: 'Creature — Human Warrior', oracle_text: '' } };
    expect(cowardsCantBlockWarriorsReason(coward, warrior, [src, coward, warrior])).toMatch(/Cowards/);
    expect(cowardsCantBlockWarriorsReason(coward, warrior, [coward, warrior])).toBeNull();
  });
});

describe('batch15 damage prevention shapes', () => {
  it('short legendary name becomes ~', () => {
    expect(selfReferenceSentences('Prevent all damage that would be dealt to Sevinne.', 'Sevinne, the Chronoclasm')).toEqual(['prevent all damage that would be dealt to ~']);
  });
  it('during your turn and you', () => {
    const [a] = parseDamagePreventionSentence('during your turn, prevent all damage that would be dealt to ~', undefined);
    expect(a.match).toMatchObject({ receivingPermanentIsSource: true, duringSourceControllerTurn: true });
    const spec: any = { ...a, id: 'x', sourcePermanentId: 'n', sourceController: 'p1' };
    const input = { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'n' };
    expect(matchesDamagePreventionExtras(spec, input, { turnPlayer: 'p1', battlefield: [] })).toBe(true);
    expect(matchesDamagePreventionExtras(spec, input, { turnPlayer: 'p2', battlefield: [] })).toBe(false);
    const [y] = parseDamagePreventionSentence('prevent all damage that would be dealt to you', undefined);
    expect(y.match).toMatchObject({ receivingIsPlayerOnly: true, receivingPlayerIsSourceController: true });
  });
  it('by creatures it is blocking', () => {
    const [a] = parseDamagePreventionSentence("prevent all damage that would be dealt to ~ by creatures it's blocking", undefined);
    const spec: any = { ...a, id: 'x', sourcePermanentId: 'wall', sourceController: 'p1' };
    const atk = { id: 'atk', controller: 'p2', card: { type_line: 'Creature — Ogre' } };
    const other = { id: 'o', controller: 'p2', card: { type_line: 'Creature — Ogre' } };
    const state = { battlefield: [{ id: 'wall', controller: 'p1', blocking: ['atk'], card: { type_line: 'Creature — Wall' } }, atk, other] };
    expect(matchesDamagePreventionExtras(spec, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'wall', damageSourcePermanentId: 'atk' }, state)).toBe(true);
    expect(matchesDamagePreventionExtras(spec, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'wall', damageSourcePermanentId: 'o' }, state)).toBe(false);
  });
});
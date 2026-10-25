import { describe, it, expect } from 'vitest';
import { canAttackDespiteDefender } from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';
import { collectReplacementEffectSpecsFromState, summarizeTokenAmountReplacements } from '../src/state/modules/replacementEffectSpec.js';
import { matchesZoneChangeOwnershipExtras } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecZoneChangeDiesExileTemplates.js';
import { applyDamageSideEffectReplacements } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsDamageSideEffects.js';
import { dropSkippedExtraTurns, tryStaticRegenerateInsteadOfDestroy } from '../src/state/modules/replacementBatch16LongTail.js';
import { crewSaddlePowerBonus } from '../src/socket/crewSaddlePowerBonus.js';
import { applyDieRollAdvantage, countDieRollAdvantage } from '../../rules-engine/src/dieRollAdvantage.js';
import { parseLandWouldEnterSacrificeReplacement } from '../src/state/modules/land-would-enter-replacement.js';

const perm = (id: string, name: string, oracle: string, controller = 'p1', extra: any = {}) =>
  ({ id, controller, owner: controller, card: { name, type_line: 'Creature', oracle_text: oracle, power: '2', toughness: '2' }, ...extra });

describe('batch16 Assault Formation-style activated permission', () => {
  const af = perm('af', 'Assault Formation', "{G}: Target creature with defender can attack this turn as though it didn't have defender.");
  const wall = perm('w', 'Wall', 'Defender');
  it('the static text alone grants nothing', () => {
    expect(canAttackDespiteDefender(wall, [af, wall], 'p1')).toBe(false);
  });
  it('a resolved grant (temporaryEffects) lets that creature attack', () => {
    const granted = { ...wall, temporaryEffects: [{ description: "can attack as though it didn't have defender", expiresAt: 'end_of_turn' }] };
    expect(canAttackDespiteDefender(granted, [af, granted], 'p1')).toBe(true);
  });
});

describe('batch16 replacement long tail', () => {
  it('Tomik / Artist\'s Talent / Solphim noncombat damage templates', () => {
    const st = { battlefield: [
      perm('t', 'Tomik, Wielder of Law', 'If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.'),
      perm('s', 'Solphim, Mayhem Dominus', 'If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals double that damage to that player or permanent instead.'),
    ] };
    const specs = collectReplacementEffectSpecsFromState(st).filter((s) => String(s.id).includes('noncombat-damage-to-opponent'));
    expect(specs.map((s) => s.instead)).toEqual(expect.arrayContaining([{ modify: 'add_flat', value: 1 }, { modify: 'double' }]));
    expect(specs.every((s) => (s.match as any)?.noncombatDamageOnly === true)).toBe(true);
  });
  it('Necrodominance: own cards only', () => {
    const st = { battlefield: [perm('n', 'Necrodominance', 'If a card or token would be put into your graveyard from anywhere, exile it instead.')] };
    const spec = collectReplacementEffectSpecsFromState(st).find((s) => String(s.id).includes('own-graveyard-to-exile'))!;
    expect(spec).toBeTruthy();
    expect(matchesZoneChangeOwnershipExtras({ object: { id: 'x', owner: 'p1' } }, spec)).toBe(true);
    expect(matchesZoneChangeOwnershipExtras({ object: { id: 'x', owner: 'p2' } }, spec)).toBe(false);
  });
  it('Phytohydra: damage becomes +1/+1 counters', () => {
    const p: any = perm('ph', 'Phytohydra', 'If damage would be dealt to Phytohydra, put that many +1/+1 counters on it instead.');
    const res = applyDamageSideEffectReplacements({ state: { battlefield: [p] } } as any, 3, 'x', 'ph', undefined, 'ph');
    expect(res?.amount).toBe(0);
    expect(p.counters['+1/+1']).toBe(3);
  });
  it('Xorn: one extra Treasure only for Treasure tokens', () => {
    const st = { battlefield: [perm('x', 'Xorn', 'If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.')] };
    expect(summarizeTokenAmountReplacements(st, 'p1', { tokenName: 'Treasure', tokenTypeLine: 'Token Artifact — Treasure' }).extraTokens).toBe(1);
    expect(summarizeTokenAmountReplacements(st, 'p1', { tokenName: 'Clue', tokenTypeLine: 'Token Artifact — Clue' }).extraTokens).toBe(0);
    expect(summarizeTokenAmountReplacements(st, 'p2', { tokenName: 'Treasure' }).extraTokens).toBe(0);
  });
  it('Knight of the Holy Nimbus regenerates instead of being destroyed', () => {
    const k: any = perm('k', 'Knight of the Holy Nimbus', 'Flanking\nIf Knight of the Holy Nimbus would be destroyed, regenerate it.', 'p1', { markedDamage: 3, attacking: 'p2' });
    const st = { battlefield: [k] };
    expect(tryStaticRegenerateInsteadOfDestroy(st, 'k', { lethalDamageOnly: true })).toBe(true);
    expect(k.tapped).toBe(true);
    expect(k.markedDamage).toBe(0);
    expect(k.attacking).toBeUndefined();
    expect(tryStaticRegenerateInsteadOfDestroy(st, 'k', { lethalDamageOnly: true })).toBe(false); // no damage: 0-toughness death
    k.temporaryEffects = [{ description: "can't be regenerated this turn" }];
    expect(tryStaticRegenerateInsteadOfDestroy(st, 'k')).toBe(false);
  });
  it('dice: roll one more and ignore the lowest', () => {
    const st = { battlefield: [perm('b', 'Barbarian Class', 'If you would roll one or more dice, instead roll that many dice plus one and ignore the lowest roll.')] };
    expect(countDieRollAdvantage(st, 'p1')).toBe(1);
    expect(countDieRollAdvantage(st, 'p2')).toBe(0);
    expect(applyDieRollAdvantage([2], 1, () => 5)).toEqual({ kept: [5], all: [2, 5], ignored: [2] });
  });
  it('extra turns are skipped while Ugin\'s Nexus is out', () => {
    const st: any = { battlefield: [perm('u', "Ugin's Nexus", 'If a player would begin an extra turn, that player skips that turn instead.')] };
    const turns = [{ playerId: 'p2' }];
    expect(dropSkippedExtraTurns(st, turns)).toBe(1);
    expect(turns).toEqual([]);
    expect(st.skippedExtraTurns[0]).toMatchObject({ playerId: 'p2', sourceName: "Ugin's Nexus" });
    expect(dropSkippedExtraTurns({ battlefield: [] }, [{ playerId: 'p1' }])).toBe(0);
  });
  it('Lotus Vale is parsed by the existing land-would-enter replacement', () => {
    expect(parseLandWouldEnterSacrificeReplacement('If this land would enter, sacrifice two untapped lands instead. If you do, put this land onto the battlefield. If you don\'t, put it into its owner\'s graveyard.')).toBeTruthy();
  });
  it('crew/saddle power bonus', () => {
    expect(crewSaddlePowerBonus(perm('d', 'Deathless Pilot', 'This creature saddles Mounts and crews Vehicles as though its power were 2 greater.'), 'crew')).toBe(2);
    expect(crewSaddlePowerBonus(perm('d', 'Deathless Pilot', 'This creature saddles Mounts and crews Vehicles as though its power were 2 greater.'), 'saddle')).toBe(2);
    expect(crewSaddlePowerBonus(perm('b', 'Bear', ''), 'crew')).toBe(0);
  });
});
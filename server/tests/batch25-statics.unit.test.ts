import { describe, expect, it } from 'vitest';
import { chooseAIBatch24OptionSelection } from '../src/socket/ai-handlers/aiBatch24OptionChoices.js';
import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates.js';
import { getGrantedVehicleCrewValue, resolveCrewPowerRequirement } from '../src/socket/crewGrantedVehicleCrew.js';
import { castOnlyIfCastAnotherViolation } from '../src/state/modules/castOnlyIfCastAnotherRestriction.js';
import { findOracleCastingLimitViolation } from '../src/state/modules/staticCastingRestrictionsOracleExtras.js';
import { permanentHasSummoningSickness } from '../src/socket/game-actions-handlers/gameActionsPermanentKeywordGrants.js';

function perm(id: string, name: string, type: string, oracle: string, controller = 'p1', extra: any = {}): any {
  return { id, controller, owner: controller, tapped: false, counters: {}, ...extra, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, keywords: extra.keywords || [] } };
}
const rid = (o: any) => String(o?.id || o);

describe('batch25 AI option choices', () => {
  it('reveals every amplify card', () => {
    const r = chooseAIBatch24OptionSelection({ state: {} }, 'p1', { amplifyRevealChoice: true, maxSelections: 2 }, [{ id: 'a' }, { id: 'b' }], rid);
    expect(r).toEqual({ selections: ['a', 'b'], cancelled: false });
  });
  it('Fasting: draws with a small hand, skips with a big hand or low life', () => {
    const opts = [{ id: 'skip' }, { id: 'draw' }];
    const step = { optionalDrawStepSkipChoice: true };
    const g = (hand: number, life: number) => ({ state: { zones: { p1: { handCount: hand } }, life: { p1: life } } });
    expect(chooseAIBatch24OptionSelection(g(1, 30), 'p1', step, opts, rid)?.selections).toEqual(['draw']);
    expect(chooseAIBatch24OptionSelection(g(5, 30), 'p1', step, opts, rid)?.selections).toEqual(['skip']);
    expect(chooseAIBatch24OptionSelection(g(1, 8), 'p1', step, opts, rid)?.selections).toEqual(['skip']);
    expect(chooseAIBatch24OptionSelection(g(1, 8), 'p1', {}, opts, rid)).toBeNull();
  });
});

describe('batch25 block restrictions', () => {
  const ground = perm('g', 'Bear', 'Creature - Bear', '', 'p2');
  const reach = perm('r', 'Spider', 'Creature - Spider', 'Reach', 'p2', { keywords: ['Reach'] });
  const flyer = perm('f', 'Bird', 'Creature - Bird', 'Flying', 'p2', { keywords: ['Flying'] });
  it('except by flying or reach', () => {
    const pest = perm('sp', 'Signal Pest', 'Artifact Creature - Pest', "Battle cry\nSignal Pest can't be blocked except by creatures with flying or reach.", 'p1', { attacking: 'p2' });
    const bf = [pest, ground, reach];
    expect(canBlockAttacker(ground, pest, bf, 'p2').canBlock).toBe(false);
    expect(canBlockAttacker(reach, pest, bf, 'p2').canBlock).toBe(true);
  });
  it('except by flying only', () => {
    const sil = perm('sl', 'Silhana Ledgewalker', 'Creature - Elf Rogue', "Hexproof\nSilhana Ledgewalker can't be blocked except by creatures with flying.", 'p1', { attacking: 'p2' });
    const bf = [sil, reach, flyer];
    expect(canBlockAttacker(reach, sil, bf, 'p2').canBlock).toBe(false);
    expect(canBlockAttacker(flyer, sil, bf, 'p2').canBlock).toBe(true);
  });
  it('attacking alone', () => {
    const dp = perm('dp', 'Dream Prowler', 'Creature - Illusion', "Dream Prowler can't be blocked as long as it's attacking alone.", 'p1', { attacking: 'p2' });
    const other = perm('o', 'Grizzly', 'Creature - Bear', '', 'p1');
    expect(canBlockAttacker(ground, dp, [dp, other, ground], 'p2').canBlock).toBe(false);
    other.attacking = 'p2';
    expect(canBlockAttacker(ground, dp, [dp, other, ground], 'p2').canBlock).toBe(true);
  });
});

describe('batch25 crew grants and token haste', () => {
  it('granted crew N on vehicles; cheapest wins', () => {
    const kotori = perm('k', 'Kotori', 'Legendary Creature', 'Vehicles you control have crew 1.');
    const v = perm('v', 'Cart', 'Artifact - Vehicle', 'Crew 3');
    expect(getGrantedVehicleCrewValue([kotori, v], 'p1', v)).toBe(1);
    expect(getGrantedVehicleCrewValue([kotori, v], 'p2', v)).toBeNull();
    expect(resolveCrewPowerRequirement('Crew 3', [kotori, v], 'p1', v)).toBe(1);
    expect(resolveCrewPowerRequirement('Crew 3', [v], 'p1', v)).toBe(3);
  });
  it('creature tokens you control have haste', () => {
    const lord = perm('l', 'Brudiclad', 'Legendary Artifact Creature', 'Creature tokens you control have haste.');
    const tok = perm('t', 'Thopter', 'Token Artifact Creature - Thopter', '', 'p1', { isToken: true, summoningSickness: true });
    const nontoken = perm('n', 'Bear', 'Creature - Bear', '', 'p1', { summoningSickness: true });
    expect(permanentHasSummoningSickness(tok, [lord, tok, nontoken], 'p1')).toBe(false);
    expect(permanentHasSummoningSickness(nontoken, [lord, tok, nontoken], 'p1')).toBe(true);
  });
});

describe('batch25 cast only if cast another spell', () => {
  const angel = { id: 'ia', name: 'Illusory Angel', type_line: 'Creature - Angel Illusion', oracle_text: "Flying\nCast this spell only if you've cast another spell this turn." };
  const talara = { id: 'tb', name: "Talara's Battalion", type_line: 'Creature - Elf Warrior', oracle_text: "Trample\nCast this spell only if you've cast another green spell this turn." };
  it('requires a prior spell by the caster', () => {
    expect(castOnlyIfCastAnotherViolation({ spellsCastThisTurn: [] }, 'p1', angel)).toMatch(/another spell/);
    expect(castOnlyIfCastAnotherViolation({ spellsCastThisTurn: [{ casterId: 'p2', card: { id: 'x' } }] }, 'p1', angel)).not.toBeNull();
    expect(castOnlyIfCastAnotherViolation({ spellsCastThisTurn: [{ casterId: 'p1', card: { id: 'x' } }] }, 'p1', angel)).toBeNull();
    expect(castOnlyIfCastAnotherViolation({ spellsCastThisTurn: [{ casterId: 'p1', card: { id: 'ia' } }] }, 'p1', angel)).not.toBeNull();
    expect(findOracleCastingLimitViolation({ battlefield: [], spellsCastThisTurn: [] }, 'p1', angel).prohibited).toBe(true);
  });
  it('color variant', () => {
    const red = { casterId: 'p1', card: { id: 'r', colors: ['R'] } };
    const green = { casterId: 'p1', card: { id: 'g', colors: ['G'] } };
    expect(castOnlyIfCastAnotherViolation({ spellsCastThisTurn: [red] }, 'p1', talara)).toMatch(/green/);
    expect(castOnlyIfCastAnotherViolation({ spellsCastThisTurn: [red, green] }, 'p1', talara)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { turnFaceUpCounterAdditions, applyTurnFaceUpCounters } from '../src/state/modules/turnFaceUpCounterPlacement.js';
import { findEnchantedDestroyReplacementAura, tryEnchantedPermanentDestroyReplacement } from '../src/state/modules/enchantedPermanentDestroyReplacement.js';
import { evaluateDefenderCondition, typeEnteredUnderControlThisTurn } from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

const sys = (line: string, name = 'Test Card') => String(classifyStaticCensusLine(line, name)?.system ?? '');
const HARMONIOUS = 'Enchant land\nEnchanted land has "{T}: Add {G}."\nIf enchanted land would be destroyed, instead sacrifice Harmonious Emergence and that land gains indestructible until end of turn.';

describe('B49: turned face up counters', () => {
  it('Hooded Hydra gets five +1/+1 counters, megamorph still one', () => {
    const hydra = { name: 'Hooded Hydra', oracle_text: 'Hooded Hydra enters with X +1/+1 counters on it.\nMorph {3}{G}{G}\nAs Hooded Hydra is turned face up, put five +1/+1 counters on it.' };
    expect(turnFaceUpCounterAdditions(hydra)).toEqual({ '+1/+1': 5 });
    expect(turnFaceUpCounterAdditions({ name: 'X', oracle_text: 'Megamorph {2}{G}' })).toEqual({ '+1/+1': 1 });
    expect(turnFaceUpCounterAdditions({ name: 'Y', oracle_text: 'Morph {2}' })).toEqual({});
    const perm: any = { counters: { '+1/+1': 1 } };
    applyTurnFaceUpCounters(perm, hydra);
    expect(perm.counters['+1/+1']).toBe(6);
  });
  it('"this creature" wording and digits are handled', () => {
    expect(turnFaceUpCounterAdditions({ name: 'Z', oracle_text: 'As this creature is turned face up, put 2 oil counters on it.' })).toEqual({ oil: 2 });
  });
});

describe('B49: enchanted destroy -> sacrifice aura', () => {
  const mk = () => {
    const land = { id: 'l1', controller: 'p1', card: { name: 'Forest', type_line: 'Basic Land - Forest' } };
    const aura = { id: 'a1', controller: 'p1', attachedTo: 'l1', card: { name: 'Harmonious Emergence', type_line: 'Enchantment - Aura', oracle_text: HARMONIOUS } };
    return { battlefield: [land, aura] as any[] };
  };
  it('sacrifices the Aura and grants indestructible until end of turn', () => {
    const state: any = mk();
    const sacked: string[] = [];
    expect(tryEnchantedPermanentDestroyReplacement(state, 'l1', (id) => { sacked.push(id); state.battlefield = state.battlefield.filter((p: any) => p.id !== id); })).toBe(true);
    expect(sacked).toEqual(['a1']);
    const land = state.battlefield.find((p: any) => p.id === 'l1');
    expect(land.grantedAbilities).toContain('Indestructible');
    expect(land.untilEndOfTurn.grantedAbilitiesToRemove).toContain('Indestructible');
    expect(state.replacementLog[0].kind).toBe('enchanted-destroy-sacrifice-aura');
  });
  it('does not apply to other permanents or mismatched types', () => {
    const state: any = mk();
    expect(tryEnchantedPermanentDestroyReplacement(state, 'a1', () => undefined)).toBe(false);
    state.battlefield[0].card.type_line = 'Creature - Elf';
    expect(findEnchantedDestroyReplacementAura(state.battlefield, state.battlefield[0])).toBeNull();
  });
});

describe('B49: defender after a type entered this turn', () => {
  const cond = 'an artifact entered the battlefield under your control this turn';
  it('uses per-turn tracking or the battlefield', () => {
    expect(evaluateDefenderCondition(cond, {}, [], 'p1', { artifactsEnteredBattlefieldThisTurnByController: { p1: 1 } })).toBe(true);
    expect(evaluateDefenderCondition(cond, {}, [], 'p1', { artifactsEnteredBattlefieldThisTurnByController: { p2: 1 } })).toBe(false);
    const bf = [{ controller: 'p1', enteredThisTurn: true, card: { type_line: 'Artifact - Equipment' } }];
    expect(typeEnteredUnderControlThisTurn('artifact', bf, 'p1')).toBe(true);
    expect(typeEnteredUnderControlThisTurn('artifact', bf, 'p2')).toBe(false);
  });
});

describe('B49: census classifier', () => {
  it('classifies the B49 families', () => {
    expect(sys("As long as an artifact entered the battlefield under your control this turn, Mechan Shieldmate can attack as though it didn't have defender.", 'Mechan Shieldmate')).toMatch(/defender permission/);
    expect(sys('If enchanted land would be destroyed, instead sacrifice Harmonious Emergence and that land gains indestructible until end of turn.', 'Harmonious Emergence')).toMatch(/sacrifice aura/);
    expect(sys('As Hooded Hydra is turned face up, put five +1/+1 counters on it.', 'Hooded Hydra')).toMatch(/turned face up/);
    expect(sys('Draft Whispergear Sneak face up.', 'Whispergear Sneak')).toMatch(/draft-only/);
  });
});

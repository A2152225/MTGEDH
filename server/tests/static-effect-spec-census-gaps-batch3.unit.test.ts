import { describe, expect, it, vi } from 'vitest';

import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates.js';
import { getDefendingLandAttackRestrictionReason } from '../src/socket/combat-handlers/combatDefendingLandRestriction.js';
import { runTurnStepDrawTurnAction } from '../src/state/modules/turn-handlers/turnStepDrawTurnAction.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { syncAuraControlChanges } from '../src/state/modules/staticEffectSpecAuraControl.js';
import { permanentLostPrintedActivatedAbility } from '../src/state/modules/staticEffectSpecActivationLocks.js';

const land = (id: string, controller: string, type_line: string) => ({ id, controller, card: { name: id, type_line, oracle_text: '' } });
const creature = (id: string, controller: string, oracle = '', colors: string[] = ['G']) =>
  ({ id, controller, owner: controller, card: { name: id, type_line: 'Creature \u2014 Test', oracle_text: oracle, colors } });

describe('census batch 3: color-based "can\'t be blocked by"', () => {
  it('blocks only creatures of the named colors', () => {
    const attacker = creature('ghost', 'p1', "This creature can't be blocked by black or red creatures.");
    const bf = [attacker, creature('b', 'p2', '', ['B']), creature('r', 'p2', '', ['R']), creature('g', 'p2', '', ['G'])];
    expect(canBlockAttacker(bf[1], attacker, bf, 'p2').canBlock).toBe(false);
    expect(canBlockAttacker(bf[2], attacker, bf, 'p2').canBlock).toBe(false);
    expect(canBlockAttacker(bf[3], attacker, bf, 'p2').canBlock).toBe(true);
  });
});

describe('census batch 3: "can\'t attack unless defending player controls a <land type>"', () => {
  const serpent = creature('serpent', 'p1', "This creature can't attack unless defending player controls an Island.");
  it('checks basic land types on the defender', () => {
    expect(getDefendingLandAttackRestrictionReason(serpent, 'p2', [land('i', 'p2', 'Basic Land \u2014 Island')])).toBeNull();
    expect(getDefendingLandAttackRestrictionReason(serpent, 'p2', [land('i', 'p1', 'Basic Land \u2014 Island')])).toMatch(/island/);
  });
  it('works for nonbasic land types (Desert)', () => {
    const c = creature('c', 'p1', "This creature can't attack unless defending player controls a Desert.");
    expect(getDefendingLandAttackRestrictionReason(c, 'p2', [land('d', 'p2', 'Land \u2014 Desert')])).toBeNull();
    expect(getDefendingLandAttackRestrictionReason(c, 'p2', [land('f', 'p2', 'Basic Land \u2014 Forest')])).not.toBeNull();
  });
});

describe('census batch 3: "Skip your draw step"', () => {
  it('skips the draw turn action for the controller of a skip-draw static', () => {
    const shouldDraw = vi.fn(() => true);
    const ctx: any = { state: { turnPlayer: 'p1', battlefield: [
      { id: 'n', controller: 'p1', card: { name: 'Necropotence', type_line: 'Enchantment', oracle_text: 'Skip your draw step.\nWhenever you discard a card, exile that card from your graveyard.' } },
    ] } };
    runTurnStepDrawTurnAction(ctx, shouldDraw);
    expect(shouldDraw).not.toHaveBeenCalled();
  });
});

describe('census batch 3: P/T equal to a count (existing variablePTCalculator reader)', () => {
  it('counts lands you control and cards in hand', () => {
    const molimo: any = { id: 'm', name: 'Test Lands Avatar', type_line: 'Creature', controller: 'p1',
      oracle_text: "This creature's power and toughness are each equal to the number of lands you control." };
    const bf = [land('a', 'p1', 'Land'), land('b', 'p1', 'Land'), land('c', 'p2', 'Land')];
    expect(calculateVariablePT(molimo, { battlefield: bf, zones: {} })).toEqual({ power: 2, toughness: 2 });
    const maro: any = { id: 'x', name: 'Test Hand Avatar', type_line: 'Creature', controller: 'p1',
      oracle_text: "This creature's power and toughness are each equal to the number of cards in your hand." };
    expect(calculateVariablePT(maro, { battlefield: [], zones: { p1: { handCount: 5 } } })).toEqual({ power: 5, toughness: 5 });
  });
});

describe('census batch 3: "You control enchanted creature" (layer 2)', () => {
  it('moves control while attached and reverts when the Aura leaves', () => {
    const host: any = creature('host', 'p2');
    const aura: any = { id: 'cm', controller: 'p1', attachedTo: 'host',
      card: { name: 'Control Magic', type_line: 'Enchantment \u2014 Aura', oracle_text: 'Enchant creature\nYou control enchanted creature.' } };
    const state: any = { battlefield: [host, aura] };
    expect(syncAuraControlChanges(state)).toBe(true);
    expect(host.controller).toBe('p1');
    expect(host.summoningSickness).toBe(true);
    state.battlefield = [host];
    syncAuraControlChanges(state);
    expect(host.controller).toBe('p2');
    expect(host.auraControl).toBeUndefined();
  });
});

describe('census batch 3: Humility-style loss of non-keyword abilities', () => {
  it('blocks printed activated abilities, not granted ones', () => {
    const elf: any = creature('elf', 'p1', '{T}: Add {G}.');
    const humility = { id: 'h', controller: 'p2', card: { name: 'Humility', type_line: 'Enchantment',
      oracle_text: 'All creatures lose all abilities and have base power and toughness 1/1.' } };
    expect(permanentLostPrintedActivatedAbility(elf, { battlefield: [elf, humility] }, '{T}: Add {G}.')).toBe(true);
    expect(permanentLostPrintedActivatedAbility(elf, { battlefield: [elf] }, '{T}: Add {G}.')).toBe(false);
    expect(permanentLostPrintedActivatedAbility(elf, { battlefield: [elf, humility] }, '{1}: Scry 1.')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec.js';
import {
  CANT_ATTACK,
  CANT_BLOCK,
} from '../src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingCantAttack.js';
import { canPermanentAttack } from '../src/socket/combat-handlers/combatLegalityGates.js';

// Quoted from oracle-cards.jsonl (2026-10-24).
const GLACIAL_CHASM_ORACLE =
  "Cumulative upkeep\u2014Pay 2 life.\nWhen this land enters, sacrifice a land.\nCreatures you control can't attack.\nPrevent all damage that would be dealt to you.";
const LIGHT_OF_DAY_ORACLE = "Black creatures can't attack or block.";

function bear(id: string, controller: string, colors: string[] = ['G']) {
  return { id, controller, card: { name: 'Bear ' + id, type_line: 'Creature \u2014 Bear', oracle_text: '', colors } };
}

describe('Phase 5 census: blanket mass can\'t-attack grants', () => {
  it('Glacial Chasm locks only its controller\'s creatures', () => {
    const state: any = {
      battlefield: [
        { id: 'chasm', controller: 'p1', card: { name: 'Glacial Chasm', type_line: 'Land', oracle_text: GLACIAL_CHASM_ORACLE } },
        bear('mine', 'p1'),
        bear('theirs', 'p2'),
      ],
    };
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1], state)).toContain(CANT_ATTACK);
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[2], state)).not.toContain(CANT_ATTACK);
    expect(canPermanentAttack(state.battlefield[1], state.battlefield, 'p1').canAttack).toBe(false);
  });

  it('Light of Day locks black creatures only', () => {
    const state: any = {
      battlefield: [
        { id: 'light', controller: 'p1', card: { name: 'Light of Day', type_line: 'Enchantment', oracle_text: LIGHT_OF_DAY_ORACLE } },
        bear('black', 'p2', ['B']),
        bear('green', 'p2', ['G']),
      ],
    };
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1], state))
      .toEqual(expect.arrayContaining([CANT_ATTACK, CANT_BLOCK]));
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[2], state)).not.toContain(CANT_ATTACK);
  });
});

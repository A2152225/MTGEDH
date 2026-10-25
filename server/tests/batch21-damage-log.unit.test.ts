import { describe, it, expect } from 'vitest';
import type { GameContext } from '../src/state/context.js';
import { combatDamagePreventedThisTurnLogged } from '../src/state/modules/turn-handlers/turnCombatDamagePreventedThisTurnLog.js';
import { applyDamageToPermanentWithCounterEffects } from '../src/state/modules/counter-common-effects.js';
import { resolveOpponentDirectedDamage } from '../src/state/modules/game-state-effects.js';

type LogState = { battlefield: unknown[]; damageReplacementLog?: Array<{ messages: string[]; original: number; amount: number }>; [k: string]: unknown };
// Single fixture adapter: tests build plain state objects, the API takes a GameContext.
const ctxOf = (state: LogState): GameContext => ({ state, libraries: new Map() }) as unknown as GameContext;
const creature = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, controller: 'p1', owner: 'p1', card: { name, type_line: 'Creature', oracle_text: '', power: '2', toughness: '2' }, ...extra });

describe('batch21 damage-log lines', () => {
  it('this-turn combat prevention logs the prevented amount', () => {
    const target = creature('t', 'Guarded Bear', { tempAbilities: ['Prevent all combat damage that would be dealt to it this turn.'] });
    const state: LogState = { battlefield: [target] };
    expect(combatDamagePreventedThisTurnLogged(ctxOf(state), target, null, 3)).toBe(true);
    expect(state.damageReplacementLog?.[0]).toMatchObject({ original: 3, amount: 0 });
    expect(state.damageReplacementLog?.[0].messages[0]).toBe('Guarded Bear: prevented 3 combat damage (prevent all combat damage dealt to it this turn)');
  });
  it('no grant -> not prevented, nothing logged', () => {
    const target = creature('t', 'Bear');
    const state: LogState = { battlefield: [target] };
    expect(combatDamagePreventedThisTurnLogged(ctxOf(state), target, null, 3)).toBe(false);
    expect(state.damageReplacementLog).toBeUndefined();
  });
  it('shield counter removal logs the prevented damage', () => {
    const target = creature('s', 'Shielded Bear', { counters: { shield: 1 } });
    const state: LogState = { battlefield: [target] };
    const r = applyDamageToPermanentWithCounterEffects(target, 4, 'damageMarked', { state });
    expect(r.prevented).toBe(true);
    expect(state.damageReplacementLog?.[0].messages[0]).toBe('Shielded Bear: shield counter removed, prevented 4 damage');
  });
  it('noncombat damage to a player records replacement messages', () => {
    const shield = { id: 'w', controller: 'p1', owner: 'p1', card: { name: 'Personal Ward', type_line: 'Enchantment', oracle_text: 'Prevent all damage that would be dealt to you.' } };
    const state: LogState = { battlefield: [shield], players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 20 }], life: { p1: 20, p2: 20 } };
    const r = resolveOpponentDirectedDamage(ctxOf(state), { sourceControllerId: 'p2', targetPlayerId: 'p1', damageAmount: 3 });
    expect(r.damageDealt).toBe(0);
    expect(state.damageReplacementLog?.length).toBeGreaterThan(0);
  });
});

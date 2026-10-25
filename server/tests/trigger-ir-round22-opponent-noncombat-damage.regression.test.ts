import { describe, expect, it } from 'vitest';
import { dealtDamageWatcherAppliesToPlayer, processPlayerDealtDamageTriggers } from '../src/state/modules/triggers/dealt-damage-watchers.js';

const spitfire = {
  id: 'spit', controller: 'p1',
  card: { name: "Chandra's Spitfire", type_line: 'Creature \u2014 Elemental', oracle_text: 'Flying\nWhenever an opponent is dealt noncombat damage, this creature gets +3/+0 until end of turn.' },
};

describe('round 22: whenever an opponent is dealt noncombat damage', () => {
  it('applies only to noncombat damage to an opponent', () => {
    expect(dealtDamageWatcherAppliesToPlayer(spitfire, 'p2', { isCombatDamage: false })).toBe(true);
    expect(dealtDamageWatcherAppliesToPlayer(spitfire, 'p2', { isCombatDamage: true })).toBe(false);
    expect(dealtDamageWatcherAppliesToPlayer(spitfire, 'p1', { isCombatDamage: false })).toBe(false);
  });

  it('queues the trigger once for noncombat damage', () => {
    const ctx: any = { state: { stack: [], battlefield: [spitfire], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' }, bumpSeq() {} };
    const queued = processPlayerDealtDamageTriggers(ctx, { damagedPlayerId: 'p2', damageAmount: 2, isCombatDamage: false });
    expect(queued).toHaveLength(1);
    expect(String(queued[0]?.description || queued[0]?.effect || '')).toMatch(/gets \+3\/\+0/);
    const ctx2: any = { state: { stack: [], battlefield: [spitfire], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' }, bumpSeq() {} };
    expect(processPlayerDealtDamageTriggers(ctx2, { damagedPlayerId: 'p2', damageAmount: 2, isCombatDamage: true })).toHaveLength(0);
  });
});

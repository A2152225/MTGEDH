import { describe, expect, it } from 'vitest';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers.js';

const CULTIST_ORACLE = 'Commander creatures you own get +3/+3 and have flying, deathtouch, "Ward—Pay 3 life," and "At the beginning of your upkeep, sacrifice a creature."';

function perm(id: string, controller: string, card: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: `${id}_card`, ...card }, ...extra };
}

function upkeep(battlefield: any[], commandZone: Record<string, unknown> = {}) {
  const state: any = { seq: 1, stack: [], battlefield, players: [{ id: 'p1' }, { id: 'p2' }], commandZone, turnPlayer: 'p1', life: { p1: 40, p2: 40 } };
  const ctx: any = { state, gameId: 'cultist_upkeep', bumpSeq() {}, isReplaying: false };
  return getUpkeepTriggersForPlayer(ctx, 'p1') as any[];
}

describe('Cultist of the Absolute: granted upkeep sacrifice', () => {
  const cultist = () => perm('cultist', 'p1', { name: 'Cultist of the Absolute', type_line: 'Creature — Human Cleric', oracle_text: CULTIST_ORACLE, power: '1', toughness: '1' });
  const creature = (id: string, name: string, extra: Record<string, unknown> = {}) =>
    perm(id, 'p1', { name, type_line: 'Legendary Creature — Elf', oracle_text: '', power: '2', toughness: '2' }, extra);

  it('fires once on the commander (not on Cultist or other creatures) at its controller\'s upkeep', () => {
    const triggers = upkeep([cultist(), creature('cmd', 'Some Commander', { isCommander: true }), creature('bear', 'Bear')]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].permanentId).toBe('cmd');
    expect(String(triggers[0].effect || triggers[0].description)).toMatch(/^sacrifice a creature\.?$/i);
  });

  it('recognises a commander through the command-zone identity too', () => {
    const triggers = upkeep(
      [cultist(), creature('cmd', 'Some Commander')],
      { p1: { commanderIds: ['cmd_card'], commanderNames: ['Some Commander'] } },
    );
    expect(triggers.map((t) => t.permanentId)).toEqual(['cmd']);
  });

  it('does not trigger without a commander, and not for a commander owned by another player', () => {
    expect(upkeep([cultist(), creature('bear', 'Bear')])).toHaveLength(0);
    const theirs = perm('theirs', 'p1', { name: 'Stolen Commander', type_line: 'Legendary Creature — Elf', oracle_text: '', power: '2', toughness: '2' }, { isCommander: true, owner: 'p2' });
    expect(upkeep([cultist(), theirs])).toHaveLength(0);
  });
});
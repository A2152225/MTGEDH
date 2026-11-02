import { describe, it, expect } from 'vitest';
import { recordPermanentAttackedPlayer, alreadyAttackedPlayerRestrictionReason } from '../src/socket/combat-handlers/combatBatch37Restrictions.js';
import { canTargetPermanent } from '../../rules-engine/src/permanentTargeting.js';
import { colorConvokeGrantMatch } from '../src/state/modules/convokeColorGrants.js';
import { parseEquipDiscardCost, equipDiscardCandidates } from '../src/state/modules/equipNonManaCosts.js';

describe('batch 37 statics', () => {
  it('Port Razer cannot attack a player twice in one turn', () => {
    const razer = { id: 'r1', controller: 'p1', card: { name: 'Port Razer', oracle_text: "Port Razer can't attack a player it has already attacked this turn." } };
    const state: any = { turnNumber: 4 };
    expect(alreadyAttackedPlayerRestrictionReason(razer, 'p2', state)).toBeNull();
    recordPermanentAttackedPlayer(state, 'r1', 'p2');
    expect(alreadyAttackedPlayerRestrictionReason(razer, 'p2', state)).toMatch(/already attacked/);
    expect(alreadyAttackedPlayerRestrictionReason(razer, 'p3', state)).toBeNull();
    state.turnNumber = 5;
    expect(alreadyAttackedPlayerRestrictionReason(razer, 'p2', state)).toBeNull();
  });
  it('Canopy Cover: opponents cannot target the enchanted creature', () => {
    const bear: any = { id: 'b1', controller: 'p1', card: { name: 'Bear', type_line: 'Creature \u2014 Bear', oracle_text: '' } };
    const cover: any = { id: 'c1', controller: 'p1', attachedTo: 'b1', card: { name: 'Canopy Cover', type_line: 'Enchantment \u2014 Aura', oracle_text: "Enchant creature\nEnchanted creature can't be blocked except by creatures with flying or reach.\nEnchanted creature can't be the target of spells or abilities your opponents control." } };
    const state: any = { battlefield: [bear, cover] };
    expect(canTargetPermanent(bear, { controllerId: 'p2', colors: [] } as any, state).canTarget).toBe(false);
    expect(canTargetPermanent(bear, { controllerId: 'p1', colors: [] } as any, state).canTarget).toBe(true);
    expect(canTargetPermanent(bear, { controllerId: 'p2', colors: [] } as any, { battlefield: [bear] } as any).canTarget).toBe(true);
  });
  it('color convoke grants only match spells of that color', () => {
    const t = 'Green spells you cast have convoke.';
    expect(colorConvokeGrantMatch(t, { colors: ['G'] })).toBe(true);
    expect(colorConvokeGrantMatch(t, { colors: ['R'] })).toBe(false);
    expect(colorConvokeGrantMatch(t, { mana_cost: '{1}{G}' })).toBe(true);
    expect(colorConvokeGrantMatch('Spells you cast have convoke.', { colors: [] })).toBeNull();
  });
  it('Equip-Discard a card parses and lists hand cards', () => {
    expect(parseEquipDiscardCost('Discard a card')).toBe(true);
    expect(parseEquipDiscardCost('Sacrifice a creature')).toBe(false);
    const state = { zones: { p1: { hand: [{ id: 'h1', name: 'Island' }] } } };
    expect(equipDiscardCandidates(state, 'p1', 'Discard a card').map((c: any) => c.id)).toEqual(['h1']);
  });
});

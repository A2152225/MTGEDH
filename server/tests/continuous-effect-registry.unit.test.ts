import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { GamePhase, GameStep } from '../../shared/src/index.js';
import type { PlayerID } from '../../shared/src';
import { syncAuraControlChanges } from '../src/state/modules/staticEffectSpecAuraControl.js';
import { permanentHasTriggeredAbilities } from '../src/state/modules/triggers/triggeredAbilitySuppression.js';
import { allocateTimestamp, stampAttachmentTimestamp, stampPermanentEntryTimestamp } from '../../rules-engine/src/permanentTimestamps.js';
import { permanentHasKeywordAbility } from '../../rules-engine/src/permanentKeywordAbilities.js';

const p1 = 'p1' as PlayerID; // Control Magic caster
const p2 = 'p2' as PlayerID; // owner of the creature
const p3 = 'p3' as PlayerID; // Threaten caster
const emptyZone = () => ({ hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 });

function setupGame(id: string) {
  const g = createInitialGameState(id);
  const s: any = g.state;
  s.players = [p1, p2, p3].map((pid) => ({ id: pid, name: pid.toUpperCase(), spectator: false, life: 40 }));
  s.turnOrder = [p1, p2, p3];
  s.turnPlayer = p1;
  s.activePlayer = p1;
  s.stack = [];
  s.zones = { [p1]: emptyZone(), [p2]: emptyZone(), [p3]: emptyZone() };
  s.battlefield = [];
  return g;
}

function creature(id: string, owner: PlayerID, extra: Record<string, unknown> = {}) {
  return {
    id, owner, controller: owner, tapped: false, counters: {},
    card: { id: id + '_card', name: 'Sample Bear', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2', oracle_text: '', zone: 'battlefield' },
    ...extra,
  } as any;
}

function controlMagic(id: string, controller: PlayerID, hostId: string) {
  return {
    id, owner: controller, controller, tapped: false, counters: {}, attachedTo: hostId,
    card: { id: id + '_card', name: 'Control Magic', type_line: 'Enchantment \u2014 Aura', oracle_text: 'Enchant creature\nYou control enchanted creature.', zone: 'battlefield' },
  } as any;
}

function enter(g: any, perm: any) {
  g.state.battlefield.push(perm);
  stampPermanentEntryTimestamp(g.state, perm);
  if (perm.attachedTo) stampAttachmentTimestamp(g.state, perm);
  syncAuraControlChanges(g.state);
}

function threaten(g: any, caster: PlayerID, targetId: string) {
  g.state.stack = [{
    id: 'stack_threaten', type: 'spell', controller: caster, targets: [targetId],
    card: { id: 'threaten_card', name: 'Threaten', type_line: 'Sorcery', mana_cost: '{2}{R}',
      oracle_text: 'Untap target creature and gain control of it until end of turn. That creature gains haste until end of turn. (It can attack and {T} this turn.)' },
  }];
  g.resolveTopOfStack();
}

function leave(g: any, id: string) {
  g.state.battlefield = g.state.battlefield.filter((perm: any) => perm.id !== id);
  syncAuraControlChanges(g.state);
}

function cleanup(g: any) {
  g.state.phase = GamePhase.ENDING;
  g.state.step = GameStep.CLEANUP;
  g.applyEvent({ type: 'nextStep' } as any);
}

const ctrl = (g: any, id = 'bear') => g.state.battlefield.find((perm: any) => perm.id === id)?.controller;

describe('continuous effect registry: layer 2 control in timestamp order', () => {
  it('Control Magic, then Threaten, then the Aura leaves: Threaten keeps control until end of turn', () => {
    const g = setupGame('t_registry_cm_then_threaten');
    enter(g, creature('bear', p2));
    enter(g, controlMagic('cm', p1, 'bear'));
    expect(ctrl(g)).toBe(p1);
    threaten(g, p3, 'bear');
    expect(ctrl(g)).toBe(p3);
    leave(g, 'cm');
    expect(ctrl(g)).toBe(p3);
    cleanup(g);
    expect(ctrl(g)).toBe(p2);
    expect((g.state as any).controlChangeEffects).toBeUndefined();
  });

  it('Threaten, then Control Magic: the Aura holds control past end of turn', () => {
    const g = setupGame('t_registry_threaten_then_cm');
    enter(g, creature('bear', p2));
    threaten(g, p3, 'bear');
    expect(ctrl(g)).toBe(p3);
    enter(g, controlMagic('cm', p1, 'bear'));
    expect(ctrl(g)).toBe(p1);
    cleanup(g);
    expect(ctrl(g)).toBe(p1);
    leave(g, 'cm');
    expect(ctrl(g)).toBe(p2);
  });

  it('a moved control Aura uses its attachment timestamp, not its entry timestamp', () => {
    const g = setupGame('t_registry_moved_aura');
    enter(g, creature('bear', p2));
    enter(g, creature('other', p2));
    const older = controlMagic('cm_old', p1, 'other');
    enter(g, older); // entered first
    enter(g, controlMagic('cm_new', p3, 'bear'));
    expect(ctrl(g)).toBe(p3);
    older.attachedTo = 'bear'; // moved later: new attachment timestamp
    stampAttachmentTimestamp(g.state, older);
    syncAuraControlChanges(g.state);
    expect(ctrl(g)).toBe(p1);
    expect(ctrl(g, 'other')).toBe(p2);
  });
});

describe('layer 6 ability grants vs. removals in timestamp order', () => {
  const humility = () => ({
    id: 'humility', owner: p1, controller: p1, tapped: false, counters: {},
    card: { id: 'humility_card', name: 'Humility', type_line: 'Enchantment', oracle_text: 'All creatures lose all abilities and have base power and toughness 1/1.', zone: 'battlefield' },
  } as any);

  it('flying granted after Humility is kept', () => {
    const g = setupGame('t_registry_flying_after');
    const bear = creature('bear', p2);
    enter(g, bear);
    enter(g, humility());
    expect(permanentHasKeywordAbility(bear, 'flying', g.state.battlefield)).toBe(false);
    bear.grantedAbilities = ['Flying'];
    syncAuraControlChanges(g.state);
    expect(permanentHasKeywordAbility(bear, 'flying', g.state.battlefield)).toBe(true);
  });

  it('flying granted before Humility is lost', () => {
    const g = setupGame('t_registry_flying_before');
    const bear = creature('bear', p2, { grantedAbilities: ['Flying'] });
    enter(g, bear);
    expect(permanentHasKeywordAbility(bear, 'flying', g.state.battlefield)).toBe(true);
    enter(g, humility());
    expect(permanentHasKeywordAbility(bear, 'flying', g.state.battlefield)).toBe(false);
  });

  it('a triggered ability granted after Humility still triggers; printed ones stay suppressed', () => {
    const g = setupGame('t_registry_trigger_after');
    const bear = creature('bear', p2);
    bear.card.oracle_text = 'Whenever Sample Bear attacks, draw a card.';
    enter(g, bear);
    enter(g, humility());
    expect(permanentHasTriggeredAbilities(bear, g.state)).toBe(false);
    bear.grantedAbilities = ['Whenever this creature deals combat damage to a player, draw a card.'];
    syncAuraControlChanges(g.state);
    expect(permanentHasTriggeredAbilities(bear, g.state)).toBe(true);
  });

  it('allocateTimestamp is counter-only once seeded', () => {
    const state: any = { battlefield: [{ id: 'x', timestamp: 5000 }] };
    expect(allocateTimestamp(state)).toBe(5001); // seeded from the board once
    state.battlefield.push({ id: 'y', timestamp: 9000 });
    expect(allocateTimestamp(state)).toBe(5002); // no rescan
  });
});

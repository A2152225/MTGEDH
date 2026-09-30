import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { sumLongDurationPtModifiers } from '../src/state/modules/longDurationPtModifiers.js';
import { expireSourceLinkedPtModifiers } from '../src/state/modules/sourceLinkedPtModifiers.js';
import { untapPermanentsForPlayer } from '../src/state/modules/turn-handlers/turnUntapPermanents.js';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function setup(bf: any[]) {
  const game = createInitialGameState('for_as_long_as');
  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
  const state: any = game.state;
  state.turnNumber = 5;
  state.turnPlayer = p1;
  state.battlefield = bf;
  return { game, state };
}
const bear = (id: string, extra: any = {}) => ({
  id, controller: p1, owner: p1, tapped: false, counters: {},
  card: { id: `c-${id}`, name: `Bear ${id}`, type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' },
  ...extra,
});
const armor = (tapped: boolean) => ({
  id: 'armor', controller: p1, owner: p1, tapped, counters: {},
  card: { id: 'c-armor', name: 'Flowstone Armor', type_line: 'Artifact', oracle_text: 'You may choose not to untap this artifact during your untap step.\n{3}: Target creature gets +1/-1 for as long as this artifact remains tapped.' },
});
const linked = (link: any, extra: any = {}) => ({
  type: 'powerToughness', power: 1, toughness: -1, sourceId: 'armor', duration: 'static', turnApplied: 5,
  linkCondition: link, linkControllerId: p1, ...extra,
});

describe('source-linked "for as long as" P/T modifiers (server)', () => {
  it('counts while the source stays tapped and stops the moment it untaps', () => {
    const { state } = setup([bear('b', { modifiers: [linked({ kind: 'source_tapped' })] }), armor(true)]);
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 3, toughness: 1 });
    state.battlefield[1].tapped = false;
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 2, toughness: 2 });
    state.battlefield[1].tapped = true;
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 3, toughness: 1 });
  });

  it('stops counting when the source left the battlefield, and expiry removes the stale modifier', () => {
    const { state } = setup([bear('b', { modifiers: [linked({ kind: 'source_tapped' })] })]);
    expect(sumLongDurationPtModifiers(state.battlefield[0], state)).toEqual({ power: 0, toughness: 0 });
    expect(expireSourceLinkedPtModifiers(state)).toBe(1);
    expect(state.battlefield[0].modifiers).toBeUndefined();
  });

  it('untapping the source in the untap step ends the pump', () => {
    const { state, game } = setup([bear('b', { modifiers: [linked({ kind: 'source_tapped' })] }), armor(true)]);
    untapPermanentsForPlayer(game as any, p1);
    expect(state.battlefield[1].tapped).toBe(false);
    expect(state.battlefield[0].modifiers).toBeUndefined();
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 2, toughness: 2 });
  });

  it('a source that stays tapped (player chose not to untap) keeps the pump', () => {
    const { state, game } = setup([bear('b', { modifiers: [linked({ kind: 'source_tapped' })] }), { ...armor(true), doesntUntap: true }]);
    untapPermanentsForPlayer(game as any, p1);
    expect(state.battlefield[0].modifiers).toHaveLength(1);
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 3, toughness: 1 });
  });

  it('attached: counts while the Equipment stays attached to the host', () => {
    const equip = { id: 'armor', controller: p1, owner: p1, tapped: false, attachedTo: 'b', card: { id: 'e', name: 'Test Rod', type_line: 'Artifact - Equipment', oracle_text: '' } };
    const { state } = setup([bear('b', { modifiers: [linked({ kind: 'source_attached' })] }), equip]);
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 3, toughness: 1 });
    state.battlefield[1].attachedTo = 'other';
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 2, toughness: 2 });
  });

  it('controller_controls_source and controls-matching follow control of the source / a Forest', () => {
    const forest = { id: 'f', controller: p1, owner: p1, tapped: false, card: { id: 'f', name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '' } };
    const { state } = setup([
      bear('b', { modifiers: [linked({ kind: 'controller_controls_matching', matching: 'forest' })] }),
      bear('c', { modifiers: [linked({ kind: 'controller_controls_source' }, { sourceId: 'b' })] }),
      forest,
    ]);
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 3, toughness: 1 });
    expect(getCurrentPowerToughness(state.battlefield[1], state)).toEqual({ power: 3, toughness: 1 });
    state.battlefield.pop();
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 2, toughness: 2 });
    state.battlefield[0].controller = p2;
    expect(getCurrentPowerToughness(state.battlefield[1], state)).toEqual({ power: 2, toughness: 2 });
  });

  it('unlinked static modifiers and no-state reads keep counting (compat)', () => {
    const { state } = setup([bear('b', { modifiers: [{ type: 'powerToughness', power: 2, toughness: 2, duration: 'static', sourceId: 'x' }] })]);
    expect(sumLongDurationPtModifiers(state.battlefield[0], state)).toEqual({ power: 2, toughness: 2 });
    expect(sumLongDurationPtModifiers({ modifiers: [linked({ kind: 'source_tapped' })] })).toEqual({ power: 1, toughness: -1 });
  });

  it('Thran Weaponry activated text is not read as a permanent all-creatures anthem', () => {
    const weaponry = { id: 'wp', controller: p1, owner: p1, tapped: false, counters: {}, card: { id: 'w', name: 'Thran Weaponry', type_line: 'Artifact', oracle_text: 'Echo {4}\nYou may choose not to untap this artifact during your untap step.\n{2}, {T}: All creatures get +2/+2 for as long as this artifact remains tapped.' } };
    const { state } = setup([bear('b'), weaponry]);
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 2, toughness: 2 });
  });
});
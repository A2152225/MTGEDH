import { describe, expect, it } from 'vitest';

import {
  SHORTCUT_ITERABLE_ACTION_TYPES,
  acceptShortcut,
  canPlayerAcceptShortcut,
  isIterableShortcutAction,
  isShortcutActionType,
  isShortcutFullyAccepted,
  proposeShortcut,
  rejectShortcut,
  validateShortcut,
  type ShortcutAction,
} from '../src/specialGameMechanics';

describe('specialGameMechanics shortcuts', () => {
  it('covers the supported iterable shortcut action types', () => {
    expect(SHORTCUT_ITERABLE_ACTION_TYPES).toEqual([
      'pass_priority',
      'pass_until_step',
      'yield_until_event',
      'activate_mana_ability',
      'activate_ability',
      'cast_spell',
      'attack_with',
      'block_with',
      'repeat_loop',
    ]);
  });

  it('recognizes all declared shortcut action types', () => {
    SHORTCUT_ITERABLE_ACTION_TYPES.forEach(type => {
      expect(isShortcutActionType(type)).toBe(true);
    });

    expect(isShortcutActionType('draw_card')).toBe(false);
  });

  it('treats each supported action shape as iterable', () => {
    const actions: ShortcutAction[] = [
      { type: 'pass_priority' },
      { type: 'pass_until_step', step: 'end' },
      { type: 'yield_until_event', event: 'opponent_casts_spell' },
      { type: 'activate_mana_ability', sourceId: 'land-1', abilityId: 'tap-for-blue' },
      { type: 'activate_ability', sourceId: 'artifact-1', abilityId: 'loot' },
      { type: 'cast_spell', cardId: 'card-1', spellName: 'Opt' },
      { type: 'attack_with', attackerIds: ['creature-1', 'creature-2'] },
      { type: 'block_with', blockerId: 'creature-3', attackerIds: ['creature-4'] },
      { type: 'repeat_loop', loopId: 'freed-from-the-real', description: 'Generate blue mana repeatedly' },
    ];

    actions.forEach(action => {
      expect(isIterableShortcutAction(action)).toBe(true);
    });
  });

  it('rejects malformed shortcut actions', () => {
    expect(isIterableShortcutAction({ type: 'pass_until_step', step: '' })).toBe(false);
    expect(isIterableShortcutAction({ type: 'activate_ability', sourceId: 'perm-1', abilityId: '' })).toBe(false);
    expect(isIterableShortcutAction({ type: 'attack_with', attackerIds: [] })).toBe(false);
    expect(isIterableShortcutAction({ type: 'repeat_loop', loopId: '', description: 'loop' })).toBe(false);
  });

  it('creates valid shortcuts for supported actions', () => {
    const shortcut = proposeShortcut(
      'player-a',
      { type: 'activate_mana_ability', sourceId: 'island-1', abilityId: 'tap-blue' },
      3,
    );

    expect(validateShortcut(shortcut)).toBe(true);
    expect(shortcut.accepted).toEqual([]);
  });

  it('rejects invalid shortcut proposals', () => {
    const invalidShortcut = {
      proposer: 'player-a',
      action: { type: 'block_with', blockerId: 'blocker-1', attackerIds: [] as string[] },
      iterations: 0,
      accepted: [],
    };

    expect(validateShortcut(invalidShortcut)).toBe(false);
  });

  it('tracks acceptances without duplicating or accepting the proposer', () => {
    const proposed = proposeShortcut('player-a', { type: 'pass_priority' }, 2);
    const acceptedByB = acceptShortcut(proposed, 'player-b');
    const acceptedAgain = acceptShortcut(acceptedByB, 'player-b');
    const acceptedByProposer = acceptShortcut(acceptedAgain, 'player-a');

    expect(acceptedByB.accepted).toEqual(['player-b']);
    expect(acceptedAgain.accepted).toEqual(['player-b']);
    expect(acceptedByProposer.accepted).toEqual(['player-b']);
    expect(canPlayerAcceptShortcut(acceptedByB, 'player-c')).toBe(true);
    expect(canPlayerAcceptShortcut(acceptedByB, 'player-b')).toBe(false);
    expect(canPlayerAcceptShortcut(acceptedByB, 'player-a')).toBe(false);
  });

  it('checks whether all non-proposers have accepted', () => {
    const shortcut = acceptShortcut(
      acceptShortcut(proposeShortcut('player-a', { type: 'yield_until_event', event: 'combat' }, 1), 'player-b'),
      'player-c',
    );

    expect(isShortcutFullyAccepted(shortcut, ['player-a', 'player-b', 'player-c'])).toBe(true);
    expect(isShortcutFullyAccepted(shortcut, ['player-a', 'player-b', 'player-c', 'player-d'])).toBe(false);
  });

  it('rejects shortcuts explicitly', () => {
    const shortcut = proposeShortcut('player-a', { type: 'cast_spell', cardId: 'card-1' }, 1);
    expect(rejectShortcut(shortcut)).toBeNull();
  });
});
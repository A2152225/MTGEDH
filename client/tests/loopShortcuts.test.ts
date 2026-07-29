import { describe, expect, it } from 'vitest';

import {
  buildResolutionResponsePayload,
  canAdvanceLoopShortcutAfterState,
  createRecordedEmitItem,
  createRecordedResolutionResponseItem,
  deleteSavedLoopShortcut,
  isLoopShortcutPhaseAdvanceEmit,
  loadLoopShortcutDraft,
  loadSavedLoopShortcuts,
  matchesPromptFingerprint,
  sanitizeLoopShortcutItems,
  saveLoopShortcutDraft,
  shouldLoopShortcutAutoPassPriority,
  upsertSavedLoopShortcut,
} from '../src/utils/loopShortcuts';
import type { ClientGameView } from '../../shared/src';

function makeView(): ClientGameView {
  return {
    id: 'game-1',
    players: [
      { id: 'p1', name: 'P1' } as any,
      { id: 'p2', name: 'P2' } as any,
    ],
    battlefield: [
      { id: 'merfolk-a', controller: 'p1', isToken: false, type_line: 'Creature — Merfolk Wizard' },
      { id: 'merfolk-b', controller: 'p1', isToken: false, type_line: 'Creature — Merfolk Wizard' },
      { id: 'token-1', controller: 'p1', isToken: true, type_line: 'Creature — Merfolk Wizard' },
      { id: 'token-2', controller: 'p1', isToken: true, type_line: 'Creature — Merfolk Wizard' },
      { id: 'token-3', controller: 'p1', isToken: true, type_line: 'Creature — Merfolk Wizard' },
    ] as any,
    zones: {},
    stack: [],
    turn: 1,
    phase: 'main' as any,
    step: 'main' as any,
    turnPlayer: 'p1',
    priority: 'p1',
  } as any;
}

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } as Storage;
}

describe('loopShortcuts', () => {
  it('waits for empty stack and no pending prompts before advancing', () => {
    const view = makeView();
    expect(canAdvanceLoopShortcutAfterState({
      view,
      myPendingResolutionCount: 0,
      hasActiveResolutionPrompt: false,
    })).toBe(true);

    expect(canAdvanceLoopShortcutAfterState({
      view: { ...view, stack: [{ id: 't1' }] as any },
      myPendingResolutionCount: 0,
    })).toBe(false);

    expect(canAdvanceLoopShortcutAfterState({
      view,
      myPendingResolutionCount: 1,
    })).toBe(false);

    expect(canAdvanceLoopShortcutAfterState({
      view,
      myPendingResolutionCount: 0,
      hasActiveResolutionPrompt: true,
    })).toBe(false);
  });

  it('waits while a paid spell is still in hand before advancing', () => {
    const view = makeView();
    view.zones = {
      p1: {
        hand: [{ id: 'summon_1', name: 'Summon the School' }],
        handCount: 1,
      },
    } as any;

    expect(canAdvanceLoopShortcutAfterState({
      view,
      myPendingResolutionCount: 0,
      waitingForCastCardId: 'summon_1',
      playerId: 'p1',
    })).toBe(false);

    view.zones = {
      p1: {
        hand: [],
        handCount: 0,
      },
    } as any;

    expect(canAdvanceLoopShortcutAfterState({
      view,
      myPendingResolutionCount: 0,
      waitingForCastCardId: 'summon_1',
      playerId: 'p1',
    })).toBe(true);
  });

  it('auto-passes only while the stack is non-empty and the player has priority', () => {
    const view = makeView();

    expect(shouldLoopShortcutAutoPassPriority({
      view,
      playerId: 'p1',
      myPendingResolutionCount: 0,
    })).toBe(false);

    expect(shouldLoopShortcutAutoPassPriority({
      view: { ...view, stack: [{ id: 'spell_1' }] as any },
      playerId: 'p1',
      myPendingResolutionCount: 0,
    })).toBe(true);

    expect(shouldLoopShortcutAutoPassPriority({
      view: { ...view, stack: [{ id: 'spell_1' }] as any, priority: 'p2' },
      playerId: 'p1',
      myPendingResolutionCount: 0,
    })).toBe(false);

    expect(shouldLoopShortcutAutoPassPriority({
      view: { ...view, stack: [{ id: 'spell_1' }] as any },
      playerId: 'p1',
      myPendingResolutionCount: 1,
    })).toBe(false);

    expect(shouldLoopShortcutAutoPassPriority({
      view: { ...view, stack: [{ id: 'spell_1' }] as any },
      playerId: 'p1',
      hasActiveResolutionPrompt: true,
    })).toBe(false);
  });

  it('strips passPriority emits that would advance the phase', () => {
    const items = [
      createRecordedEmitItem('requestCastSpell', { cardId: 'summon_1' }, 'game-1'),
      createRecordedEmitItem('passPriority', { by: 'p1' }, 'game-1'),
      createRecordedEmitItem('activateGraveyardAbility', { abilityId: 'return-from-graveyard' }, 'game-1'),
      createRecordedEmitItem('passPriority', {}, 'game-1'),
    ];

    expect(isLoopShortcutPhaseAdvanceEmit(items[1])).toBe(true);
    const sanitized = sanitizeLoopShortcutItems(items);
    expect(sanitized.removedPassPriorityCount).toBe(2);
    expect(sanitized.items.map((item) => item.kind === 'emit' ? item.event : item.kind)).toEqual([
      'requestCastSpell',
      'activateGraveyardAbility',
    ]);
  });

  it('records dynamic target selection templates for tap-creature cost prompts', () => {
    const view = makeView();
    const step = {
      type: 'target_selection',
      sourceName: 'Summon the School',
      description: 'Tap four untapped Merfolk you control',
      tapCreaturesCost: true,
      validTargets: [
        { id: 'merfolk-a' },
        { id: 'merfolk-b' },
        { id: 'token-1' },
        { id: 'token-2' },
      ],
    };

    const item = createRecordedResolutionResponseItem(step, ['merfolk-a', 'merfolk-b', 'token-1', 'token-2'], view, 'p1');

    expect(item?.kind).toBe('resolution_response');
    if (!item || item.kind !== 'resolution_response' || item.template.kind !== 'select_valid_targets') {
      throw new Error('Expected dynamic target template');
    }

    expect(item.template.count).toBe(4);
    expect(matchesPromptFingerprint(item.fingerprint, step)).toBe(true);
  });

  it('prefers token targets when replaying a dynamic selection template', () => {
    const view = makeView();
    const step = {
      type: 'target_selection',
      sourceName: 'Phyrexian Altar',
      description: 'Choose a creature to sacrifice',
      validTargets: [
        { id: 'merfolk-a' },
        { id: 'token-1' },
        { id: 'token-2' },
      ],
    };

    const payload = buildResolutionResponsePayload(
      {
        kind: 'select_valid_targets',
        count: 2,
        preferTokens: true,
        requireSelfControlled: true,
      },
      step,
      view,
      'p1'
    );

    expect(payload).toEqual({ selections: ['token-1', 'token-2'] });
  });

  it('keeps specific player target responses stable', () => {
    const view = makeView();
    const step = {
      type: 'target_selection',
      sourceName: 'Drowner of Secrets',
      description: 'Target player mills a card',
      validTargets: [
        { id: 'p1', type: 'player' },
        { id: 'p2', type: 'player' },
      ],
    };

    const item = createRecordedResolutionResponseItem(step, ['p2'], view, 'p1');
    expect(item?.kind).toBe('resolution_response');
    if (!item || item.kind !== 'resolution_response') {
      throw new Error('Expected recorded response item');
    }

    const payload = buildResolutionResponsePayload(item.template, step, view, 'p1');
    expect(payload).toEqual({ selections: ['p2'] });
  });

  it('fails specific-id playback when required targets are no longer legal', () => {
    const view = makeView();
    const step = {
      type: 'graveyard_selection',
      sourceName: 'Tortured Existence',
      validTargets: [
        { id: 'grave-1' },
      ],
    };

    const payload = buildResolutionResponsePayload(
      {
        kind: 'specific_ids',
        ids: ['grave-2'],
      },
      step,
      view,
      'p1'
    );

    expect(payload).toBeNull();
  });

  it('records tap-target object responses and rebinds them against live legal targets', () => {
    const originalView = makeView();
    const replayView: ClientGameView = {
      ...originalView,
      battlefield: [
        { id: 'merfolk-a', controller: 'p1', isToken: false, type_line: 'Creature — Merfolk Wizard' },
        { id: 'token-2', controller: 'p1', isToken: true, type_line: 'Creature — Merfolk Wizard' },
        { id: 'token-3', controller: 'p1', isToken: true, type_line: 'Creature — Merfolk Wizard' },
      ] as any,
    };
    const step = {
      id: 'tap-step',
      type: 'tap_untap_target',
      sourceId: 'drowner',
      sourceName: 'Drowner of Secrets',
      description: 'Tap an untapped Merfolk you control',
      targetFilter: {
        types: ['creature', 'merfolk'],
        controller: 'you',
        tapStatus: 'untapped',
        excludeSource: true,
      },
    };

    const item = createRecordedResolutionResponseItem(
      step,
      { targetIds: ['token-1'], action: 'tap' },
      originalView,
      'p1'
    );

    expect(item?.kind).toBe('resolution_response');
    if (!item || item.kind !== 'resolution_response' || item.template.kind !== 'selection_object') {
      throw new Error('Expected a recorded selection object template');
    }

    const payload = buildResolutionResponsePayload(item.template, step, replayView, 'p1');
    expect(payload).toEqual({
      selections: {
        action: 'tap',
        targetIds: ['token-2'],
      },
    });
  });

  it('keeps structured payment responses intact for replay', () => {
    const view = makeView();
    const step = {
      type: 'mana_payment_choice',
      sourceName: 'Summon the School',
      description: 'Choose how to pay the spell cost',
    };

    const item = createRecordedResolutionResponseItem(
      step,
      {
        payment: [{ permanentId: 'plains-1', mana: 'W' }],
        xValue: 0,
        alternateCostId: 'normal',
      },
      view,
      'p1'
    );

    expect(item?.kind).toBe('resolution_response');
    if (!item || item.kind !== 'resolution_response') {
      throw new Error('Expected recorded payment response');
    }

    const payload = buildResolutionResponsePayload(item.template, step, view, 'p1');
    expect(payload).toEqual({
      selections: {
        payment: [{ permanentId: 'plains-1', mana: 'W' }],
        xValue: 0,
        alternateCostId: 'normal',
      },
    });
  });

  it('round-trips loop shortcut drafts and saved shortcuts through storage', () => {
    const storage = makeStorage();
    const items = [createRecordedEmitItem('activateBattlefieldAbility', { permanentId: 'altar-1' }, 'game-1')];

    saveLoopShortcutDraft(storage, 'game-1', {
      name: 'Merfolk Draft',
      items,
      iterationCount: 3,
      updatedAt: 10,
    });

    expect(loadLoopShortcutDraft(storage, 'game-1')).toEqual({
      name: 'Merfolk Draft',
      items,
      iterationCount: 3,
      updatedAt: 10,
    });

    const saved = upsertSavedLoopShortcut(storage, 'game-1', {
      id: 'saved-1',
      name: 'Merfolk Loop',
      items,
      iterationCount: 2,
      updatedAt: 20,
    });
    expect(saved).toHaveLength(1);
    expect(loadSavedLoopShortcuts(storage, 'game-1')[0]?.name).toBe('Merfolk Loop');

    const afterDelete = deleteSavedLoopShortcut(storage, 'game-1', 'saved-1');
    expect(afterDelete).toEqual([]);
    expect(loadSavedLoopShortcuts(storage, 'game-1')).toEqual([]);
  });
});
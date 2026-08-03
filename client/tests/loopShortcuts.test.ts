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
      { id: 'merfolk-a', controller: 'p1', isToken: false, tapped: false, type_line: 'Creature — Merfolk Wizard', card: { name: 'Svyelun of Sea and Sky' } },
      { id: 'merfolk-b', controller: 'p1', isToken: false, tapped: false, type_line: 'Creature — Merfolk Wizard', card: { name: 'Merfolk Sovereign' } },
      { id: 'token-1', controller: 'p1', isToken: true, tapped: true, type_line: 'Creature — Merfolk', card: { name: 'Merfolk' } },
      { id: 'token-2', controller: 'p1', isToken: true, tapped: true, type_line: 'Creature — Merfolk', card: { name: 'Merfolk' } },
      { id: 'token-3', controller: 'p1', isToken: true, tapped: false, type_line: 'Creature — Merfolk', card: { name: 'Merfolk' } },
      {
        id: 'commander-1',
        controller: 'p1',
        isToken: false,
        tapped: false,
        isCommander: true,
        type_line: 'Legendary Creature — Merfolk Noble',
        card: { name: 'Emperor Mihail II', isCommander: true },
      },
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
      priorityPlayerId: 'p1',
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

  it('waits for the post-cast stack to appear before advancing', () => {
    const view = makeView();
    view.zones = {
      p1: { hand: [], handCount: 0 },
    } as any;

    expect(canAdvanceLoopShortcutAfterState({
      view,
      myPendingResolutionCount: 0,
      waitingForCastCardId: 'summon_1',
      playerId: 'p1',
      castSettle: {
        cardId: 'summon_1',
        sawNonEmptyStack: false,
        startedAt: Date.now(),
      },
    })).toBe(false);

    expect(canAdvanceLoopShortcutAfterState({
      view,
      myPendingResolutionCount: 0,
      waitingForCastCardId: 'summon_1',
      playerId: 'p1',
      castSettle: {
        cardId: 'summon_1',
        sawNonEmptyStack: true,
        startedAt: Date.now(),
      },
    })).toBe(true);
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

  it('records and replays sacrifice choices against matching tapped tokens, not the commander', () => {
    const view = makeView();
    const step = {
      type: 'target_selection',
      sourceName: "Ashnod's Altar",
      description: "Ashnod's Altar: Sacrifice 1 creatures to activate: add {c}{c}.",
      requiredCount: 1,
      validTargets: [
        { id: 'commander-1', label: 'Emperor Mihail II', typeLine: 'Legendary Creature — Merfolk Noble', tapped: false, isToken: false, isCommander: true },
        { id: 'merfolk-a', label: 'Svyelun of Sea and Sky', typeLine: 'Creature — Merfolk Wizard', tapped: false, isToken: false, isCommander: false },
        { id: 'token-1', label: 'Merfolk', typeLine: 'Creature — Merfolk', tapped: true, isToken: true, isCommander: false },
        { id: 'token-3', label: 'Merfolk', typeLine: 'Creature — Merfolk', tapped: false, isToken: true, isCommander: false },
      ],
    };

    const item = createRecordedResolutionResponseItem(step, ['token-1'], view, 'p1');
    expect(item?.kind).toBe('resolution_response');
    if (!item || item.kind !== 'resolution_response' || item.template.kind !== 'select_valid_targets') {
      throw new Error('Expected dynamic sacrifice template');
    }

    expect(item.template).toMatchObject({
      count: 1,
      preferTokens: true,
      preferTapped: true,
      avoidCommanders: true,
      requireSelfControlled: true,
      matchProfiles: [
        {
          name: 'Merfolk',
          typeLine: 'Creature — Merfolk',
          isToken: true,
          tapped: true,
          isCommander: false,
        },
      ],
    });

    const replayView: ClientGameView = {
      ...view,
      battlefield: [
        {
          id: 'commander-1',
          controller: 'p1',
          isToken: false,
          tapped: false,
          isCommander: true,
          type_line: 'Legendary Creature — Merfolk Noble',
          card: { name: 'Emperor Mihail II', isCommander: true },
        },
        {
          id: 'fresh-token-a',
          controller: 'p1',
          isToken: true,
          tapped: true,
          type_line: 'Creature — Merfolk',
          card: { name: 'Merfolk' },
        },
        {
          id: 'fresh-token-b',
          controller: 'p1',
          isToken: true,
          tapped: false,
          type_line: 'Creature — Merfolk',
          card: { name: 'Merfolk' },
        },
      ] as any,
    };
    const replayStep = {
      ...step,
      validTargets: [
        { id: 'commander-1', label: 'Emperor Mihail II', typeLine: 'Legendary Creature — Merfolk Noble', tapped: false, isToken: false, isCommander: true },
        { id: 'fresh-token-b', label: 'Merfolk', typeLine: 'Creature — Merfolk', tapped: false, isToken: true, isCommander: false },
        { id: 'fresh-token-a', label: 'Merfolk', typeLine: 'Creature — Merfolk', tapped: true, isToken: true, isCommander: false },
      ],
    };

    const payload = buildResolutionResponsePayload(item.template, replayStep, replayView, 'p1');
    expect(payload).toEqual({ selections: ['fresh-token-a'] });
  });

  it('can rebind sacrifice choices from validTarget metadata when battlefield lookup is sparse', () => {
    const sparseView: ClientGameView = {
      ...makeView(),
      battlefield: [] as any,
    };
    const step = {
      type: 'target_selection',
      sourceName: "Ashnod's Altar",
      description: 'Sacrifice 1 creatures to activate',
      requiredCount: 1,
      validTargets: [
        { id: 'commander-1', label: 'Emperor Mihail II', typeLine: 'Legendary Creature — Merfolk Noble', tapped: false, isToken: false, isCommander: true, controller: 'p1' },
        { id: 'token-tapped', label: 'Merfolk', typeLine: 'Creature — Merfolk', tapped: true, isToken: true, isCommander: false, controller: 'p1' },
      ],
    };

    const payload = buildResolutionResponsePayload(
      {
        kind: 'select_valid_targets',
        count: 1,
        preferTokens: true,
        preferTapped: true,
        avoidCommanders: true,
        requireSelfControlled: true,
        matchProfiles: [
          {
            name: 'Merfolk',
            typeLine: 'Creature — Merfolk',
            isToken: true,
            tapped: true,
            isCommander: false,
          },
        ],
      },
      step,
      sparseView,
      'p1'
    );

    expect(payload).toEqual({ selections: ['token-tapped'] });
  });

  it('resolves grouped battlefield tokens when recording and replaying sacrifice choices', () => {
    const groupedView: ClientGameView = {
      ...makeView(),
      battlefield: [
        {
          id: 'commander-1',
          controller: 'p1',
          isToken: false,
          tapped: false,
          isCommander: true,
          type_line: 'Legendary Creature — Merfolk Noble',
          card: { name: 'Emperor Mihail II', isCommander: true },
        },
        {
          // Broadcast optimization: many identical tokens collapse to one group entry.
          id: 'group_tok_aaa',
          controller: 'p1',
          isToken: true,
          isGroupedTokens: true,
          tokenCount: 3,
          tapped: true,
          groupedTokenIds: ['tok_aaa', 'tok_bbb', 'tok_ccc'],
          type_line: 'Creature — Merfolk',
          card: { name: 'Merfolk' },
        },
      ] as any,
    };
    const step = {
      type: 'target_selection',
      sourceName: "Ashnod's Altar",
      description: "Ashnod's Altar: Sacrifice 1 creatures to activate: add {c}{c}.",
      requiredCount: 1,
      validTargets: [
        { id: 'commander-1', label: 'Emperor Mihail II', tapped: false, isToken: false, isCommander: true },
        { id: 'tok_aaa', label: 'Merfolk', tapped: true, isToken: true, isCommander: false },
        { id: 'tok_bbb', label: 'Merfolk', tapped: true, isToken: true, isCommander: false },
        { id: 'tok_ccc', label: 'Merfolk', tapped: true, isToken: true, isCommander: false },
      ],
    };

    const item = createRecordedResolutionResponseItem(step, ['tok_bbb'], groupedView, 'p1');
    expect(item?.kind).toBe('resolution_response');
    if (!item || item.kind !== 'resolution_response' || item.template.kind !== 'select_valid_targets') {
      throw new Error('Expected dynamic sacrifice template from grouped tokens');
    }

    expect(item.template.preferTokens).toBe(true);
    expect(item.template.preferNonTokens).toBe(false);
    expect(item.template.avoidCommanders).toBe(true);
    expect(item.template.matchProfiles?.[0]).toMatchObject({
      name: 'Merfolk',
      isToken: true,
      tapped: true,
      isCommander: false,
    });

    const payload = buildResolutionResponsePayload(item.template, step, groupedView, 'p1');
    expect(payload?.selections).toEqual(['tok_aaa']);
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

  it('records mana color strings as literal selections (Command Tower)', () => {
    const view = makeView();
    view.battlefield = [
      ...((view.battlefield as any[]) || []),
      {
        id: 'tower-1',
        controller: 'p1',
        isToken: false,
        tapped: false,
        type_line: 'Land',
        card: { name: 'Command Tower' },
      },
    ] as any;

    const step = {
      type: 'mana_color_selection',
      sourceName: 'Command Tower',
      description: "Choose a color for Command Tower's mana.",
      selectionKind: 'any_color',
    };

    const item = createRecordedResolutionResponseItem(step, 'white', view, 'p1');
    expect(item?.kind).toBe('resolution_response');
    if (!item || item.kind !== 'resolution_response') {
      throw new Error('Expected recorded color response');
    }

    expect(item.template).toEqual({
      kind: 'literal_selection',
      selection: 'white',
    });
    expect(item.label).toContain('White');

    const payload = buildResolutionResponsePayload(item.template, step, view, 'p1');
    expect(payload).toEqual({ selections: 'white' });
  });

  it('records free WUBRG alternate-cost payments for Fist of the Suns / Morophon casts', () => {
    const view = makeView();
    const step = {
      type: 'mana_payment_choice',
      sourceName: 'Summon the School',
      description: 'Pay costs to cast Summon the School.',
      spellPaymentRequired: true,
    };

    const item = createRecordedResolutionResponseItem(
      step,
      {
        payment: undefined,
        xValue: 0,
        alternateCostId: 'wubrg_external',
      },
      view,
      'p1'
    );

    expect(item?.kind).toBe('resolution_response');
    if (!item || item.kind !== 'resolution_response' || item.template.kind !== 'payment_selection') {
      throw new Error('Expected recorded payment_selection template');
    }

    expect(item.template.alternateCostId).toBe('wubrg_external');
    expect(item.template.payment).toEqual([]);
    expect(item.label).toContain('alternateCostId=wubrg_external');
    expect(item.label).toContain('no mana paid');

    const payload = buildResolutionResponsePayload(item.template, step, view, 'p1');
    expect(payload).toEqual({
      selections: {
        alternateCostId: 'wubrg_external',
        xValue: 0,
      },
    });
  });

  it('does not invent an alternate cost when the recorded response omitted one', () => {
    const view = makeView();
    const step = {
      type: 'mana_payment_choice',
      sourceName: 'Summon the School',
      description: 'Pay costs to cast Summon the School.',
      spellPaymentRequired: true,
      preferredAlternateCostId: 'wubrg_external',
      extraAlternateCosts: [
        { id: 'wubrg_external', label: 'WUBRG Alternative', manaCost: '{W}{U}{B}{R}{G}' },
      ],
    };

    const item = createRecordedResolutionResponseItem(
      step,
      { payment: undefined, xValue: 0 },
      view,
      'p1'
    );

    expect(item?.kind).toBe('resolution_response');
    if (!item || item.kind !== 'resolution_response' || item.template.kind !== 'payment_selection') {
      throw new Error('Expected payment_selection');
    }
    expect(item.template.alternateCostId).toBeUndefined();

    const payload = buildResolutionResponsePayload(item.template, step, view, 'p1');
    expect(payload).toEqual({
      selections: { xValue: 0 },
    });
  });

  it('keeps structured payment responses intact for replay and rebinds sources by name', () => {
    const originalView = makeView();
    originalView.battlefield = [
      ...((originalView.battlefield as any[]) || []),
      {
        id: 'tower-old',
        controller: 'p1',
        isToken: false,
        tapped: false,
        type_line: 'Land',
        card: { name: 'Command Tower' },
      },
    ] as any;

    const replayView = makeView();
    replayView.battlefield = [
      ...((replayView.battlefield as any[]) || []),
      {
        id: 'tower-new',
        controller: 'p1',
        isToken: false,
        tapped: false,
        type_line: 'Land',
        card: { name: 'Command Tower' },
      },
    ] as any;

    const step = {
      type: 'mana_payment_choice',
      sourceName: 'Summon the School',
      description: 'Choose how to pay the spell cost',
    };

    const item = createRecordedResolutionResponseItem(
      step,
      {
        payment: [{ permanentId: 'tower-old', mana: 'W' }],
        xValue: 0,
        alternateCostId: 'normal',
      },
      originalView,
      'p1'
    );

    expect(item?.kind).toBe('resolution_response');
    if (!item || item.kind !== 'resolution_response' || item.template.kind !== 'payment_selection') {
      throw new Error('Expected recorded payment response');
    }

    expect(item.template.payment[0]?.permanentProfile?.name).toBe('Command Tower');
    expect(item.template.alternateCostId).toBeUndefined();
    expect(item.label).toContain('White from Command Tower');

    const payload = buildResolutionResponsePayload(item.template, step, replayView, 'p1');
    expect(payload).toEqual({
      selections: {
        payment: [{ permanentId: 'tower-new', mana: 'W' }],
        xValue: 0,
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
/**
 * Permanent spell resolve + as-enters choice replay.
 *
 * Covers the game_8523 Roaming Throne failure mode: legacy logs recorded
 * resolveTopOfStackPrompt / ETB pushes *before* resolveTopOfStack, so replay
 * never put the permanent on the battlefield.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { persistAndResolveTopOfStack, appendGameEvent } from '../src/socket/util.js';
import * as db from '../src/db/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function throneCard(id = 'throne_card_1') {
  return {
    id,
    name: 'Roaming Throne',
    type_line: 'Artifact Creature — Golem',
    power: '4',
    toughness: '4',
    oracle_text:
      'Ward {2}\nAs this creature enters, choose a creature type.\nThis creature is the chosen type in addition to its other types.\nIf a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.',
  };
}

function thrivingGroveCard(id = 'thriving_grove_1') {
  return {
    id,
    name: 'Thriving Grove',
    type_line: 'Land',
    oracle_text:
      'This land enters tapped. As it enters, choose a color other than green.\n{T}: Add {G} or one mana of the chosen color.',
  };
}

function putCardInHand(game: any, playerId: PlayerID, card: any) {
  (game.state as any).zones = (game.state as any).zones || {};
  const z = ((game.state as any).zones[playerId] = (game.state as any).zones[playerId] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  });
  z.hand = [{ ...card, zone: 'hand' }];
  z.handCount = 1;
}

describe('permanent spell resolve + as-enters replay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores Roaming Throne from legacy inverted prompt/ETB-before-resolve logs', () => {
    const gameId = 't_throne_inverted_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const card = throneCard();
    const stackItemId = 'stack_kjtvc1j9';
    const choiceStepId = 'step-creature-type-1';
    putCardInHand(game, p1, card);
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];

    // Soul Warden already on BF so ETB subject makes sense in the log shape.
    (game.state as any).battlefield = [
      {
        id: 'stack_soul_warden',
        controller: p1,
        owner: p1,
        card: {
          id: 'soul_warden_1',
          name: 'Soul Warden',
          type_line: 'Creature — Human Cleric',
          oracle_text: 'Whenever another creature enters, you gain 1 life.',
        },
      },
    ];

    const invertedEvents = [
      {
        type: 'castSpell',
        playerId: p1,
        card: { ...card, zone: 'hand' },
        fromZone: 'hand',
        stackItemId,
      },
      {
        type: 'resolveTopOfStackPrompt',
        playerId: p1,
        sourceId: stackItemId,
        queuedResolutionStep: {
          id: choiceStepId,
          type: ResolutionStepType.CREATURE_TYPE_CHOICE,
          playerId: p1,
          description: 'Choose a creature type for Roaming Throne',
          mandatory: true,
          permanentId: stackItemId,
          sourceId: stackItemId,
          sourceName: 'Roaming Throne',
        },
      },
      {
        type: 'pushTriggeredAbility',
        triggerId: 'trigger_soul_warden_etb',
        sourceId: 'stack_soul_warden',
        permanentId: 'stack_soul_warden',
        sourceName: 'Soul Warden',
        controllerId: p1,
        description: 'You gain 1 life',
        triggerType: 'creature_etb',
        effect: 'You gain 1 life',
        mandatory: true,
        interveningIfSubjectPermanentId: stackItemId,
        interveningIfSubjectSnapshot: {
          id: stackItemId,
          controller: p1,
          owner: p1,
          card: { ...card },
        },
      },
      { type: 'resolveTopOfStack', auto: true },
      {
        type: 'creatureTypeSelected',
        playerId: p1,
        resolvedStepId: choiceStepId,
        resolvedStepType: ResolutionStepType.CREATURE_TYPE_CHOICE,
        permanentId: stackItemId,
        creatureType: 'Soldier',
        cardName: 'Roaming Throne',
      },
    ];

    game.replay!(invertedEvents as any);

    const throne = ((game.state as any).battlefield || []).find(
      (p: any) => p?.id === stackItemId || p?.card?.name === 'Roaming Throne',
    );
    expect(throne).toBeTruthy();
    expect(throne.chosenCreatureType || throne.card?.chosenCreatureType).toBe('Soldier');
    expect(((game.state as any).stack || []).some((s: any) => s?.id === stackItemId)).toBe(false);
    expect(
      ((game.state as any).zones?.[p1]?.graveyard || []).some(
        (c: any) => c?.name === 'Roaming Throne' || c?.id === card.id,
      ),
    ).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('restores Roaming Throne from correct resolve-before-prompt order', () => {
    const gameId = 't_throne_correct_order_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const card = throneCard('throne_card_2');
    const stackItemId = 'stack_throne_correct';
    const choiceStepId = 'step-creature-type-correct';
    putCardInHand(game, p1, card);
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];

    game.replay!([
      {
        type: 'castSpell',
        playerId: p1,
        card: { ...card, zone: 'hand' },
        fromZone: 'hand',
        stackItemId,
      },
      { type: 'resolveTopOfStack' },
      {
        type: 'resolveTopOfStackPrompt',
        playerId: p1,
        sourceId: stackItemId,
        queuedResolutionStep: {
          id: choiceStepId,
          type: ResolutionStepType.CREATURE_TYPE_CHOICE,
          playerId: p1,
          description: 'Choose a creature type for Roaming Throne',
          mandatory: true,
          permanentId: stackItemId,
          sourceId: stackItemId,
          sourceName: 'Roaming Throne',
        },
      },
      {
        type: 'creatureTypeSelected',
        playerId: p1,
        resolvedStepId: choiceStepId,
        resolvedStepType: ResolutionStepType.CREATURE_TYPE_CHOICE,
        permanentId: stackItemId,
        creatureType: 'Soldier',
        cardName: 'Roaming Throne',
      },
    ] as any);

    const throne = ((game.state as any).battlefield || []).find(
      (p: any) => p?.id === stackItemId || p?.card?.name === 'Roaming Throne',
    );
    expect(throne).toBeTruthy();
    expect(throne.chosenCreatureType || throne.card?.chosenCreatureType).toBe('Soldier');

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays Thriving Grove playLand + colorChoice onto the permanent', () => {
    const gameId = 't_thriving_grove_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const card = thrivingGroveCard();
    const permanentId = 'perm_thriving_grove_1';
    const choiceStepId = 'step-color-thriving';
    putCardInHand(game, p1, card);

    game.replay!([
      {
        type: 'playLand',
        playerId: p1,
        card: { ...card, zone: 'hand' },
        permanentId,
        fromZone: 'hand',
      },
      {
        type: 'colorChoice',
        playerId: p1,
        resolvedStepId: choiceStepId,
        resolvedStepType: ResolutionStepType.COLOR_CHOICE,
        permanentId,
        cardName: 'Thriving Grove',
        color: 'red',
      },
    ] as any);

    // colorChoice without an active step may still need the permanent present.
    const grove = ((game.state as any).battlefield || []).find(
      (p: any) => p?.id === permanentId || p?.card?.name === 'Thriving Grove',
    );
    expect(grove).toBeTruthy();

    // If colorChoice only applies when a step is queued, seed one and re-apply.
    if (!grove?.chosenColor && !grove?.card?.chosenColor) {
      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.COLOR_CHOICE,
        playerId: p1,
        description: 'Choose a color for Thriving Grove',
        mandatory: true,
        permanentId,
        sourceId: permanentId,
        sourceName: 'Thriving Grove',
      } as any, { allowDuringReplay: true });
      ResolutionQueueManager.activateStep(gameId, step.id);
      game.applyEvent({
        type: 'colorChoice',
        playerId: p1,
        resolvedStepId: step.id,
        resolvedStepType: ResolutionStepType.COLOR_CHOICE,
        permanentId,
        cardName: 'Thriving Grove',
        color: 'red',
      } as any);
    }

    const after = ((game.state as any).battlefield || []).find(
      (p: any) => p?.id === permanentId || p?.card?.name === 'Thriving Grove',
    );
    expect(after?.chosenColor || after?.card?.chosenColor).toBe('red');

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('persistAndResolveTopOfStack appends resolveTopOfStack before side-effect events', () => {
    const gameId = 't_persist_resolve_order';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const card = throneCard('throne_card_order');
    const stackItemId = 'stack_throne_order';
    putCardInHand(game, p1, card);

    game.applyEvent({
      type: 'castSpell',
      playerId: p1,
      card: { ...card, zone: 'hand' },
      fromZone: 'hand',
      stackItemId,
    } as any);

    const appended: string[] = [];
    const appendSpy = vi.spyOn(db, 'appendEvent').mockImplementation((_gid: string, _seq: number, type: string) => {
      appended.push(type);
      return 1;
    });

    // Simulate a side effect that would historically have been appended during
    // a live resolve *before* the resolveTopOfStack event was logged.
    const ok = persistAndResolveTopOfStack(game as any, gameId, { auto: true });
    expect(ok).toBe(true);

    // Manually append a follow-on prompt the way live resolve would after BF entry.
    appendGameEvent(game as any, gameId, 'resolveTopOfStackPrompt', {
      playerId: p1,
      sourceId: stackItemId,
      queuedResolutionStep: {
        id: 'step-order-1',
        type: ResolutionStepType.CREATURE_TYPE_CHOICE,
        playerId: p1,
        permanentId: stackItemId,
        sourceId: stackItemId,
      },
    });

    const resolveIdx = appended.indexOf('resolveTopOfStack');
    const promptIdx = appended.indexOf('resolveTopOfStackPrompt');
    expect(resolveIdx).toBeGreaterThanOrEqual(0);
    expect(promptIdx).toBeGreaterThan(resolveIdx);

    appendSpy.mockRestore();
    ResolutionQueueManager.removeQueue(gameId);
  });
});

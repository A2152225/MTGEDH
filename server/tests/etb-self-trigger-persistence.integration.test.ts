import { beforeEach, describe, expect, it } from 'vitest';

import { getEvents, deleteGame, createGameIfNotExists, initDb } from '../src/db/index.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/stack.js';

describe('triggerETBEffectsForPermanent self trigger persistence', () => {
  const gameId = 'test_etb_self_trigger_persistence';

  beforeEach(async () => { await initDb(); deleteGame(gameId); createGameIfNotExists(gameId, 'commander', 40); });

  function buildStateAndPermanent() {
    const playerId = 'p1';
    const permanent = {
      id: 'etb_perm_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: {},
      card: {
        id: 'etb_card_1',
        name: 'Visionary Adept',
        type_line: 'Creature - Human Wizard',
        oracle_text: 'When Visionary Adept enters, draw a card.',
        power: '2',
        toughness: '2',
        zone: 'battlefield',
      },
    } as any;

    const state = {
      players: [{ id: playerId, name: 'P1', spectator: false, life: 40 }],
      battlefield: [permanent],
      stack: [],
    } as any;

    return { playerId, permanent, state };
  }

  it('queues and persists self ETB triggers by default', () => {
    const { playerId, permanent, state } = buildStateAndPermanent();
    const eventStart = getEvents(gameId).length;

    triggerETBEffectsForPermanent(
      {
        state,
        gameId,
        inactive: new Set(),
        libraries: {},
        players: state.players,
      } as any,
      permanent,
      playerId,
    );

    const liveTrigger = state.stack.find((entry: any) => entry?.source === permanent.id) as any;
    expect(liveTrigger).toBeTruthy();
    expect(liveTrigger).toMatchObject({
      sourceName: 'Visionary Adept',
      triggerType: 'etb',
    });

    const persistedTrigger = getEvents(gameId)
      .slice(eventStart)
      .find((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.sourceId === permanent.id) as any;
    expect(persistedTrigger).toBeTruthy();
    expect(persistedTrigger.payload).toMatchObject({
      sourceId: permanent.id,
      permanentId: permanent.id,
      sourceName: 'Visionary Adept',
      triggerType: 'etb',
    });
  });

  it('suppresses self ETB trigger creation when includeSelfTriggers is false', () => {
    const { playerId, permanent, state } = buildStateAndPermanent();
    const eventStart = getEvents(gameId).length;

    triggerETBEffectsForPermanent(
      {
        state,
        gameId,
        inactive: new Set(),
        libraries: {},
        players: state.players,
      } as any,
      permanent,
      playerId,
      false,
    );

    expect(state.stack).toHaveLength(0);
    expect(
      getEvents(gameId)
        .slice(eventStart)
        .some((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.sourceId === permanent.id)
    ).toBe(false);
  });
});


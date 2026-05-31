import { beforeEach, describe, expect, it } from 'vitest';

import { getEvents, deleteGame, createGameIfNotExists, initDb } from '../src/db/index.js';
import { triggerETBEffectsForPermanent, triggerETBEffectsForToken } from '../src/state/modules/stack.js';

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

  it('orders simultaneous non-self ETB triggers by APNAP before persistence', () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';
    const eventStart = getEvents(gameId).length;

    const enteringPermanent = {
      id: 'entering_perm_1',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: {
        id: 'entering_card_1',
        name: 'Entering Bear',
        type_line: 'Creature - Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
        zone: 'battlefield',
      },
    } as any;

    const p2Watcher = {
      id: 'watcher_p2',
      controller: p2,
      owner: p2,
      tapped: false,
      counters: {},
      card: {
        id: 'watcher_p2_card',
        name: 'P2 Watcher',
        type_line: 'Enchantment',
        oracle_text: "Whenever a creature enters the battlefield under an opponent's control, you gain 1 life.",
        zone: 'battlefield',
      },
    } as any;

    const p3Watcher = {
      id: 'watcher_p3',
      controller: p3,
      owner: p3,
      tapped: false,
      counters: {},
      card: {
        id: 'watcher_p3_card',
        name: 'P3 Watcher',
        type_line: 'Enchantment',
        oracle_text: "Whenever a creature enters the battlefield under an opponent's control, you gain 1 life.",
        zone: 'battlefield',
      },
    } as any;

    const state = {
      players: [
        { id: p1, name: 'P1', spectator: false, life: 40 },
        { id: p2, name: 'P2', spectator: false, life: 40 },
        { id: p3, name: 'P3', spectator: false, life: 40 },
      ],
      activePlayer: p3,
      turnPlayer: p1,
      battlefield: [p2Watcher, p3Watcher, enteringPermanent],
      stack: [],
    } as any;

    triggerETBEffectsForPermanent(
      {
        state,
        gameId,
        inactive: new Set(),
        libraries: {},
        players: state.players,
      } as any,
      enteringPermanent,
      p1 as any,
      false,
    );

    const liveTriggers = (state.stack || []).filter(
      (entry: any) => entry?.type === 'triggered_ability' && (entry?.sourceName === 'P2 Watcher' || entry?.sourceName === 'P3 Watcher')
    );
    expect(liveTriggers.map((entry: any) => entry.sourceName)).toEqual(['P3 Watcher', 'P2 Watcher']);

    const persistedTriggers = getEvents(gameId)
      .slice(eventStart)
      .filter((event: any) => event.type === 'pushTriggeredAbility' && (event.payload?.sourceName === 'P2 Watcher' || event.payload?.sourceName === 'P3 Watcher'));
    expect(persistedTriggers.map((event: any) => event.payload?.sourceName)).toEqual(['P3 Watcher', 'P2 Watcher']);
  });

  it('orders graveyard-resident ETB triggers by APNAP before persistence', () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';
    const eventStart = getEvents(gameId).length;

    const enteringPermanent = {
      id: 'graveyard_entry_perm_1',
      controller: p1,
      owner: p1,
      enteredFromZone: 'graveyard',
      tapped: false,
      counters: {},
      card: {
        id: 'graveyard_entry_card_1',
        name: 'Reborn Bear',
        type_line: 'Creature - Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
        zone: 'battlefield',
        enteredFromZone: 'graveyard',
      },
    } as any;

    const state = {
      players: [
        { id: p1, name: 'P1', spectator: false, life: 40 },
        { id: p2, name: 'P2', spectator: false, life: 40 },
        { id: p3, name: 'P3', spectator: false, life: 40 },
      ],
      activePlayer: p3,
      turnPlayer: p1,
      battlefield: [enteringPermanent],
      zones: {
        [p1]: { graveyard: [], graveyardCount: 0 },
        [p2]: {
          graveyard: [
            {
              id: 'graveyard_trigger_p2',
              name: 'P2 Graveyard Watcher',
              type_line: 'Creature - Spirit',
              oracle_text: 'Whenever a creature enters the battlefield, if it entered from your graveyard or you cast it from your graveyard, return this card from your graveyard to the battlefield tapped at the beginning of the next end step.',
              zone: 'graveyard',
            },
          ],
          graveyardCount: 1,
        },
        [p3]: {
          graveyard: [
            {
              id: 'graveyard_trigger_p3',
              name: 'P3 Graveyard Watcher',
              type_line: 'Creature - Spirit',
              oracle_text: 'Whenever a creature enters the battlefield, if it entered from your graveyard or you cast it from your graveyard, return this card from your graveyard to the battlefield tapped at the beginning of the next end step.',
              zone: 'graveyard',
            },
          ],
          graveyardCount: 1,
        },
      },
      stack: [],
    } as any;

    triggerETBEffectsForPermanent(
      {
        state,
        gameId,
        inactive: new Set(),
        libraries: {},
        players: state.players,
      } as any,
      enteringPermanent,
      p1 as any,
      false,
    );

    const liveTriggers = (state.stack || []).filter(
      (entry: any) => entry?.type === 'triggered_ability' && (entry?.sourceName === 'P2 Graveyard Watcher' || entry?.sourceName === 'P3 Graveyard Watcher')
    );
    expect(liveTriggers.map((entry: any) => entry.sourceName)).toEqual(['P3 Graveyard Watcher', 'P2 Graveyard Watcher']);

    const persistedTriggers = getEvents(gameId)
      .slice(eventStart)
      .filter((event: any) => event.type === 'pushTriggeredAbility' && (event.payload?.sourceName === 'P2 Graveyard Watcher' || event.payload?.sourceName === 'P3 Graveyard Watcher'));
    expect(persistedTriggers.map((event: any) => event.payload?.sourceName)).toEqual(['P3 Graveyard Watcher', 'P2 Graveyard Watcher']);
  });

  it('orders simultaneous token ETB watcher triggers by APNAP before persistence', () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';
    const eventStart = getEvents(gameId).length;

    const token = {
      id: 'token_perm_1',
      controller: p1,
      owner: p1,
      isToken: true,
      tapped: false,
      counters: {},
      card: {
        id: 'token_card_1',
        name: 'Soldier Token',
        type_line: 'Token Creature - Soldier',
        oracle_text: '',
        power: '1',
        toughness: '1',
        zone: 'battlefield',
      },
    } as any;

    const p2Watcher = {
      id: 'token_watcher_p2',
      controller: p2,
      owner: p2,
      tapped: false,
      counters: {},
      card: {
        id: 'token_watcher_p2_card',
        name: 'P2 Token Watcher',
        type_line: 'Enchantment',
        oracle_text: "Whenever a creature enters the battlefield under an opponent's control, you gain 1 life.",
        zone: 'battlefield',
      },
    } as any;

    const p3Watcher = {
      id: 'token_watcher_p3',
      controller: p3,
      owner: p3,
      tapped: false,
      counters: {},
      card: {
        id: 'token_watcher_p3_card',
        name: 'P3 Token Watcher',
        type_line: 'Enchantment',
        oracle_text: "Whenever a creature enters the battlefield under an opponent's control, you gain 1 life.",
        zone: 'battlefield',
      },
    } as any;

    const state = {
      players: [
        { id: p1, name: 'P1', spectator: false, life: 40 },
        { id: p2, name: 'P2', spectator: false, life: 40 },
        { id: p3, name: 'P3', spectator: false, life: 40 },
      ],
      activePlayer: p3,
      turnPlayer: p1,
      battlefield: [p2Watcher, p3Watcher, token],
      stack: [],
    } as any;

    triggerETBEffectsForToken(
      {
        state,
        gameId,
        inactive: new Set(),
        libraries: {},
        players: state.players,
      } as any,
      token,
      p1 as any,
    );

    const liveTriggers = (state.stack || []).filter(
      (entry: any) => entry?.type === 'triggered_ability' && (entry?.sourceName === 'P2 Token Watcher' || entry?.sourceName === 'P3 Token Watcher')
    );
    expect(liveTriggers.map((entry: any) => entry.sourceName)).toEqual(['P3 Token Watcher', 'P2 Token Watcher']);

    const persistedTriggers = getEvents(gameId)
      .slice(eventStart)
      .filter((event: any) => event.type === 'pushTriggeredAbility' && (event.payload?.sourceName === 'P2 Token Watcher' || event.payload?.sourceName === 'P3 Token Watcher'));
    expect(persistedTriggers.map((event: any) => event.payload?.sourceName)).toEqual(['P3 Token Watcher', 'P2 Token Watcher']);
  });
});


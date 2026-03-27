import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

function seedGame(gameId: string, cardId: string, oracleText: string, options?: { manaCost?: string; manaPool?: any; life?: number; hand?: any[]; extraGraveyard?: any[] }) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const playerId = 'p1';
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: options?.life ?? 40 }];
  (game.state as any).life = { [playerId]: options?.life ?? 40 };
  (game.state as any).zones = {
    [playerId]: {
      hand: options?.hand || [],
      handCount: Array.isArray(options?.hand) ? options?.hand.length : 0,
      library: [],
      libraryCount: 0,
      graveyard: [
        {
          id: cardId,
          name: 'Grave Spell',
          type_line: 'Sorcery',
          mana_cost: options?.manaCost,
          oracle_text: oracleText,
          zone: 'graveyard',
        },
        ...((options?.extraGraveyard || []).map((card: any) => ({ ...card, zone: 'graveyard' }))),
      ],
      graveyardCount: 1 + ((options?.extraGraveyard || []).length),
      exile: [],
      exileCount: 0,
    },
  };
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [playerId]: options?.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };

  return { game, playerId };
}

describe('cast-from-graveyard replay semantics (integration)', () => {
  const gameId = 'test_cast_from_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('live jump-start activation spends mana and moves the card from graveyard to stack', async () => {
    const { game, playerId } = seedGame(gameId, 'jump_start_1', 'Draw a card.\nJump-start {1}{U}', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      hand: [
        {
          id: 'jump_start_discard_1',
          name: 'Spare Idea',
          type_line: 'Instant',
          oracle_text: '',
          zone: 'hand',
        },
      ],
    });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'jump_start_1',
      abilityId: 'jump-start',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);
    const discardStep = steps.find(step => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect((discardStep.hand || []).map((card: any) => card.id)).toEqual(['jump_start_discard_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['jump_start_discard_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['jump_start_discard_1']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('jump_start_1');
    expect(stack[0]?.card?.castWithAbility).toBe('jump-start');
    expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
    expect((game.state as any).cardLeftGraveyardThisTurn?.[playerId]).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const activateEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'activateGraveyardAbility') as any;
    expect(activateEvent?.payload?.discardedCardIds).toEqual(['jump_start_discard_1']);
  });

  it('live retrace activation requires discarding a land card from hand', async () => {
    const retraceGameId = `${gameId}_retrace_live`;
    const { game, playerId } = seedGame(retraceGameId, 'retrace_1', 'Flame Jab deals 1 damage to any target.\nRetrace', {
      manaCost: '{R}',
      manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      hand: [
        {
          id: 'retrace_land_1',
          name: 'Mountain',
          type_line: 'Basic Land - Mountain',
          oracle_text: '',
          zone: 'hand',
        },
        {
          id: 'retrace_spell_1',
          name: 'Shock',
          type_line: 'Instant',
          oracle_text: '',
          zone: 'hand',
        },
      ],
    });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, retraceGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: retraceGameId,
      cardId: 'retrace_1',
      abilityId: 'retrace',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(retraceGameId, playerId);
    const discardStep = steps.find(step => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect((discardStep.hand || []).map((card: any) => card.id)).toEqual(['retrace_land_1']);

    await handlers['submitResolutionResponse']({
      gameId: retraceGameId,
      stepId: String(discardStep.id),
      selections: ['retrace_land_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['retrace_land_1']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('retrace_1');
    expect(stack[0]?.card?.castWithAbility).toBe('retrace');
  });

  it('live escape activation requires exiling other cards from your graveyard', async () => {
    const escapeGameId = `${gameId}_escape_live`;
    const { game, playerId } = seedGame(escapeGameId, 'escape_1', 'Return target creature card from your graveyard to your hand.\nEscape {2}{G}, Exile three other cards from your graveyard.', {
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 2 },
      extraGraveyard: [
        { id: 'escape_cost_1', name: 'Card One', type_line: 'Instant', oracle_text: '' },
        { id: 'escape_cost_2', name: 'Card Two', type_line: 'Sorcery', oracle_text: '' },
        { id: 'escape_cost_3', name: 'Card Three', type_line: 'Creature - Human', oracle_text: '' },
      ],
    });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, escapeGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: escapeGameId,
      cardId: 'escape_1',
      abilityId: 'escape',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(escapeGameId, playerId);
    const selectionStep = steps.find(step => step.type === ResolutionStepType.GRAVEYARD_SELECTION) as any;
    expect(selectionStep).toBeDefined();
    expect((selectionStep.validTargets || []).map((card: any) => card.id).sort()).toEqual(['escape_cost_1', 'escape_cost_2', 'escape_cost_3']);

    await handlers['submitResolutionResponse']({
      gameId: escapeGameId,
      stepId: String(selectionStep.id),
      selections: ['escape_cost_1', 'escape_cost_2', 'escape_cost_3'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual([]);
    expect((zones?.exile || []).map((card: any) => card.id).sort()).toEqual(['escape_cost_1', 'escape_cost_2', 'escape_cost_3']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('escape_1');
    expect(stack[0]?.card?.castWithAbility).toBe('escape');
    expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
    expect((game.state as any).cardLeftGraveyardThisTurn?.[playerId]).toBe(true);
  });

  for (const abilityId of ['flashback', 'retrace', 'escape']) {
    it(`replays ${abilityId} as a cast-from-graveyard stack item`, () => {
      const replayGameId = `${gameId}_${abilityId}`;
      const oracleText = abilityId === 'flashback'
        ? 'Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life.'
        : abilityId === 'escape'
          ? 'Escape {2}{G}, Exile three other cards from your graveyard.'
          : `${abilityId} sample text`;
      const { game, playerId } = seedGame(replayGameId, `${abilityId}_1`, oracleText, {
        manaCost: abilityId === 'retrace' ? '{2}{B}' : undefined,
        manaPool: abilityId === 'flashback'
          ? { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 }
          : abilityId === 'escape'
            ? { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 2 }
            : { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 2 },
        life: abilityId === 'flashback' ? 20 : 40,
      });

      game.applyEvent({
        type: 'activateGraveyardAbility',
        playerId,
        cardId: `${abilityId}_1`,
        abilityId,
        ...(abilityId === 'flashback' ? { manaCost: '{1}{U}', lifePaidForCost: 3 } : {}),
        ...(abilityId === 'escape' ? { manaCost: '{2}{G}' } : {}),
        ...(abilityId === 'retrace' ? { manaCost: '{2}{B}' } : {}),
      });

      const zones = (game.state as any).zones?.[playerId];
      expect(zones?.graveyardCount).toBe(0);
      const stack = (game.state as any).stack || [];
      expect(stack).toHaveLength(1);
      expect(stack[0]?.card?.id).toBe(`${abilityId}_1`);
      expect(stack[0]?.card?.castWithAbility).toBe(abilityId);
      expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
      if (abilityId === 'flashback') {
        expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
        expect((game.state as any).life?.[playerId]).toBe(17);
      }
    });
  }

  it('replay applies recorded jump-start discard choices before moving the spell to the stack', () => {
    const replayGameId = `${gameId}_jump_start_replay`;
    const { game, playerId } = seedGame(replayGameId, 'jump_start_replay_1', 'Draw a card.\nJump-start {1}{U}', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      hand: [
        {
          id: 'jump_start_replay_discard_1',
          name: 'Spare Idea',
          type_line: 'Instant',
          oracle_text: '',
          zone: 'hand',
        },
      ],
    });

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'jump_start_replay_1',
      abilityId: 'jump-start',
      manaCost: '{1}{U}',
      discardedCardIds: ['jump_start_replay_discard_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual([]);
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['jump_start_replay_discard_1']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('jump_start_replay_1');
    expect(stack[0]?.card?.castWithAbility).toBe('jump-start');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replay applies recorded escape exile choices before moving the spell to the stack', () => {
    const replayGameId = `${gameId}_escape_replay`;
    const { game, playerId } = seedGame(replayGameId, 'escape_replay_1', 'Return target creature card from your graveyard to your hand.\nEscape {2}{G}, Exile three other cards from your graveyard.', {
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 2 },
      extraGraveyard: [
        { id: 'escape_replay_cost_1', name: 'Card One', type_line: 'Instant', oracle_text: '' },
        { id: 'escape_replay_cost_2', name: 'Card Two', type_line: 'Sorcery', oracle_text: '' },
        { id: 'escape_replay_cost_3', name: 'Card Three', type_line: 'Creature - Human', oracle_text: '' },
      ],
    });

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'escape_replay_1',
      abilityId: 'escape',
      manaCost: '{2}{G}',
      exiledCardIdsFromGraveyardForCost: ['escape_replay_cost_1', 'escape_replay_cost_2', 'escape_replay_cost_3'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual([]);
    expect((zones?.exile || []).map((card: any) => card.id).sort()).toEqual(['escape_replay_cost_1', 'escape_replay_cost_2', 'escape_replay_cost_3']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('escape_replay_1');
    expect(stack[0]?.card?.castWithAbility).toBe('escape');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });
});
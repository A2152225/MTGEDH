import { afterEach, describe, expect, it } from 'vitest';

import type { KnownCardRef, PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { categorizeSpellWithoutPrimaryRetirement } from '../src/rules-engine/targeting.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function ensureZonesForPlayer(g: any, pid: PlayerID) {
  (g.state as any).zones = (g.state as any).zones || {};
  (g.state as any).zones[pid] = (g.state as any).zones[pid] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
}

function setupPlayerLibrary(g: any, pid: PlayerID, libraryIds: string[]) {
  const player = (g.state as any).players.find((entry: any) => entry.id === pid);
  player.library = libraryIds.map((id) => ({ id, name: id, zone: 'library' }));
  ensureZonesForPlayer(g, pid);
  (g.state as any).zones[pid].library = player.library.map((card: any) => ({ ...card }));
  (g.state as any).zones[pid].libraryCount = player.library.length;
  g.libraries = g.libraries || new Map();
  g.libraries.set(pid, player.library.map((card: any) => ({ ...card })));
}

function castAndResolve(
  g: any,
  p1: PlayerID,
  card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'>,
  targets: string[] = [],
  afterImport?: (game: any) => void,
) {
  g.importDeckResolved(p1, [card] as any);
  g.drawCards(p1, 1);
  ensureZonesForPlayer(g, p1);
  if (afterImport) {
    afterImport(g);
  }

  (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
  (g.state as any).turnPlayer = p1;
  (g.state as any).priority = p1;

  g.applyEvent!({
    type: 'castSpell',
    playerId: p1,
    cardId: card.id,
    targets,
  });

  expect((g.state as any).stack?.length || 0).toBe(1);
  g.resolveTopOfStack();
}

describe('oracle IR spell categorize parity (primary mode)', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('resolves DRAW_CARDS via IR primary without legacy categorizeSpell execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Draw two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Divination', oracleText)?.op).toBe('DRAW_CARDS');

    const gameId = 'oracle_ir_parity_draw';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'draw_1',
      name: 'Test Divination',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1', 'lib-2', 'lib-3']));

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const handCount = (player?.hand || (g.state as any).zones?.[p1]?.hand || []).length;
    const libraryCount = (player?.library || (g.state as any).zones?.[p1]?.library || []).length;

    expect(handCount).toBe(2);
    expect(libraryCount).toBe(1);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('resolves GAIN_LIFE via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'You gain 5 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Healing', oracleText)?.op).toBe('GAIN_LIFE');

    const gameId = 'oracle_ir_parity_gain_life';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);
    (g.state as any).life = { [p1]: 20 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'gain_1',
      name: 'Test Healing',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    });

    expect((g.state as any).life[p1]).toBe(25);
  });

  it('resolves GAIN_LIFE_TARGET_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Target player gains 3 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Healing Salve', oracleText)?.op).toBe('GAIN_LIFE_TARGET_PLAYER');

    const gameId = 'oracle_ir_parity_gain_life_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'gain_target_1',
      name: 'Test Healing Salve',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }, [p2]);

    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2Player?.life ?? (g.state as any).life?.[p2]).toBe(43);
  });

  it('resolves GAIN_LIFE_EACH_OPPONENT via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each opponent gains 1 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Group Hug', oracleText)?.op).toBe('GAIN_LIFE_EACH_OPPONENT');

    const gameId = 'oracle_ir_parity_gain_life_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'gain_each_1',
      name: 'Test Group Hug',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{W}',
    });

    const p1Player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1Player?.life ?? (g.state as any).life?.[p1]).toBe(40);
    expect(p2Player?.life ?? (g.state as any).life?.[p2]).toBe(41);
  });

  it('resolves GAIN_LIFE_EACH_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each player gains 2 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Team Heal', oracleText)?.op).toBe('GAIN_LIFE_EACH_PLAYER');

    const gameId = 'oracle_ir_parity_gain_life_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'gain_each_player_1',
      name: 'Test Team Heal',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{W}',
    });

    const p1Player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1Player?.life ?? (g.state as any).life?.[p1]).toBe(42);
    expect(p2Player?.life ?? (g.state as any).life?.[p2]).toBe(42);
  });

  it('resolves LOSE_LIFE via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'You lose 2 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Shock', oracleText)?.op).toBe('LOSE_LIFE');

    const gameId = 'oracle_ir_parity_lose_life';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);
    (g.state as any).life = { [p1]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'lose_1',
      name: 'Test Shock',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    });

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life ?? (g.state as any).life?.[p1]).toBe(38);
  });

  it('resolves LOSE_LIFE_TARGET_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Target player loses 2 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Bump', oracleText)?.op).toBe('LOSE_LIFE_TARGET_PLAYER');

    const gameId = 'oracle_ir_parity_lose_life_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'lose_target_1',
      name: 'Test Bump',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{B}',
    }, [p2]);

    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2Player?.life ?? (g.state as any).life?.[p2]).toBe(38);
  });

  it('resolves LOSE_LIFE_EACH_OPPONENT via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each opponent loses 3 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Fiery', oracleText)?.op).toBe('LOSE_LIFE_EACH_OPPONENT');

    const gameId = 'oracle_ir_parity_lose_life_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'lose_each_1',
      name: 'Test Fiery',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    });

    const p1Player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1Player?.life ?? (g.state as any).life?.[p1]).toBe(40);
    expect(p2Player?.life ?? (g.state as any).life?.[p2]).toBe(37);
  });

  it('resolves LOSE_LIFE_EACH_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each player loses 2 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Pox', oracleText)?.op).toBe('LOSE_LIFE_EACH_PLAYER');

    const gameId = 'oracle_ir_parity_lose_life_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'lose_each_player_1',
      name: 'Test Pox',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{B}',
    });

    const p1Player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1Player?.life ?? (g.state as any).life?.[p1]).toBe(38);
    expect(p2Player?.life ?? (g.state as any).life?.[p2]).toBe(38);
  });

  it('queues SCRY via IR primary without duplicate legacy scry steps', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Scry 2.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Scry', oracleText)?.op).toBe('SCRY');

    const gameId = 'oracle_ir_parity_scry';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'scry_1',
      name: 'Test Scry',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1', 'lib-2', 'lib-3']));

    const scrySteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(1);
    expect((scrySteps[0] as any)?.scryCount).toBe(2);
  });

  it('queues SURVEIL via IR primary without duplicate legacy surveil steps', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Surveil 2.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Surveil', oracleText)?.op).toBe('SURVEIL');

    const gameId = 'oracle_ir_parity_surveil';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'surveil_1',
      name: 'Test Surveil',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1', 'lib-2', 'lib-3']));

    const surveilSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(1);
    expect((surveilSteps[0] as any)?.surveilCount).toBe(2);
  });

  it('queues DISCARD_TARGET_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Target player discards two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Mind Rot', oracleText)?.op).toBe('DISCARD_TARGET_PLAYER');

    const gameId = 'oracle_ir_parity_discard_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const handCards = [
      { id: 'h1', name: 'Hand 1', zone: 'hand' },
      { id: 'h2', name: 'Hand 2', zone: 'hand' },
      { id: 'h3', name: 'Hand 3', zone: 'hand' },
    ];
    (g.state as any).zones[p2].hand = handCards.map((card) => ({ ...card }));
    (g.state as any).zones[p2].handCount = handCards.length;
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    p2Player.hand = handCards.map((card) => ({ ...card }));

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'discard_1',
      name: 'Test Mind Rot',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{B}',
    }, [p2]);

    const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardSteps).toHaveLength(1);
    expect((discardSteps[0] as any)?.discardCount).toBe(2);
  });

  it('queues DISCARD_EACH_OPPONENT via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each opponent discards two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Discard', oracleText)?.op).toBe('DISCARD_EACH_OPPONENT');

    const gameId = 'oracle_ir_parity_discard_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const handCards = [
      { id: 'h1', name: 'Hand 1', zone: 'hand' },
      { id: 'h2', name: 'Hand 2', zone: 'hand' },
      { id: 'h3', name: 'Hand 3', zone: 'hand' },
    ];
    (g.state as any).zones[p2].hand = handCards.map((card) => ({ ...card }));
    (g.state as any).zones[p2].handCount = handCards.length;
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    p2Player.hand = handCards.map((card) => ({ ...card }));

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'discard_each_opp_1',
      name: 'Test Opp Discard',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{B}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardSteps).toHaveLength(1);
    expect((discardSteps[0] as any)?.discardCount).toBe(2);
  });

  it('queues DISCARD_EACH_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each player discards two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Player Discard', oracleText)?.op).toBe('DISCARD_EACH_PLAYER');

    const gameId = 'oracle_ir_parity_discard_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const p2HandCards = [
      { id: 'p2-1', name: 'Hand 1', zone: 'hand' },
      { id: 'p2-2', name: 'Hand 2', zone: 'hand' },
      { id: 'p2-3', name: 'Hand 3', zone: 'hand' },
    ];
    (g.state as any).zones[p2].hand = p2HandCards.map((card) => ({ ...card }));
    (g.state as any).zones[p2].handCount = p2HandCards.length;
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    p2Player.hand = p2HandCards.map((card) => ({ ...card }));

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'discard_each_player_1',
      name: 'Test Player Discard',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{B}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      const extraHand = [
        { id: 'p1-1', name: 'Hand 1', zone: 'hand' },
        { id: 'p1-2', name: 'Hand 2', zone: 'hand' },
        { id: 'p1-3', name: 'Hand 3', zone: 'hand' },
      ];
      const existingHand = Array.isArray((game.state as any).zones[p1]?.hand)
        ? (game.state as any).zones[p1].hand.map((card: any) => ({ ...card }))
        : [];
      const mergedHand = [...existingHand, ...extraHand];
      (game.state as any).zones[p1].hand = mergedHand;
      (game.state as any).zones[p1].handCount = mergedHand.length;
      const p1Player = (game.state as any).players.find((entry: any) => entry.id === p1);
      p1Player.hand = mergedHand.map((card: any) => ({ ...card }));
    });

    for (const playerId of [p1, p2]) {
      const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
        .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
      expect(discardSteps).toHaveLength(1);
      expect((discardSteps[0] as any)?.discardCount).toBe(2);
    }
  });

  it('resolves DESTROY_TARGET via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Destroy target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Murder', oracleText)?.op).toBe('DESTROY_TARGET');

    const gameId = 'oracle_ir_parity_destroy';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'destroy_1',
        name: 'Test Murder',
        type_line: 'Instant',
        oracle_text: oracleText,
        mana_cost: '{1}{B}',
      },
      ['c1'],
    );

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('resolves MILL_TARGET_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Target player mills three cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Mill', oracleText)?.op).toBe('MILL_TARGET_PLAYER');

    const gameId = 'oracle_ir_parity_mill';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'mill_1',
        name: 'Test Mill',
        type_line: 'Sorcery',
        oracle_text: oracleText,
        mana_cost: '{1}{U}',
      },
      [p2],
      (game) => setupPlayerLibrary(game, p2, ['mill-1', 'mill-2', 'mill-3', 'mill-4']),
    );

    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.length).toBe(3);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(1);
  });

  it('resolves MILL_EACH_OPPONENT via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each opponent mills two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Mill', oracleText)?.op).toBe('MILL_EACH_OPPONENT');

    const gameId = 'oracle_ir_parity_mill_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'mill_each_opp_1',
      name: 'Test Opp Mill',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      setupPlayerLibrary(game, p2, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);
    });

    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.length).toBe(2);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(2);
  });

  it('resolves MILL_EACH_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each player mills two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Player Mill', oracleText)?.op).toBe('MILL_EACH_PLAYER');

    const gameId = 'oracle_ir_parity_mill_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'mill_each_player_1',
      name: 'Test Player Mill',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-mill-1', 'p1-mill-2', 'p1-mill-3', 'p1-mill-4']);
      setupPlayerLibrary(game, p2, ['p2-mill-1', 'p2-mill-2', 'p2-mill-3', 'p2-mill-4']);
    });

    for (const playerId of [p1, p2]) {
      const gy = (g.state as any).zones?.[playerId]?.graveyard || [];
      expect(gy.length).toBe(playerId === p1 ? 3 : 2);
      expect((g.state as any).zones?.[playerId]?.libraryCount ?? 0).toBe(2);
    }
  });

  it('does not double-apply draw when IR primary owns the spell', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Draw two cards.';
    const gameId = 'oracle_ir_parity_no_double_draw';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'draw_double_guard',
      name: 'Test Divination',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1', 'lib-2', 'lib-3', 'lib-4']));

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const handCount = (player?.hand || (g.state as any).zones?.[p1]?.hand || []).length;
    expect(handCount).toBe(2);
  });

  it('does not double-apply gain life when IR primary owns the spell', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'You gain 5 life.';
    const gameId = 'oracle_ir_parity_no_double_gain_life';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);
    (g.state as any).life = { [p1]: 20 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'gain_double_guard',
      name: 'Test Healing',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    });

    expect((g.state as any).life[p1]).toBe(25);
  });

  it('resolves CREATE_TOKEN via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Create a Treasure token.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Strike It Rich', oracleText)?.op).toBe('CREATE_TOKEN');

    const gameId = 'oracle_ir_parity_create_token';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const battlefieldBefore = (g.state as any).battlefield?.length ?? 0;

    castAndResolve(g, p1, {
      id: 'token_parity_1',
      name: 'Test Strike It Rich',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{R}',
    });

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Treasure')).toBe(true);
  });

  it('resolves DAMAGE_TARGET_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Deal 3 damage to target player.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Lightning Strike', oracleText)?.op).toBe('DAMAGE_TARGET_PLAYER');

    const gameId = 'oracle_ir_parity_damage_target_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'damage_target_parity_1',
      name: 'Test Lightning Strike',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [p2]);

    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2Player?.life ?? (g.state as any).life?.[p2]).toBe(37);
  });

  it('resolves DAMAGE_EACH_OPPONENT via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Deal 2 damage to each opponent.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Fiery Impulse', oracleText)?.op).toBe('DAMAGE_EACH_OPPONENT');

    const gameId = 'oracle_ir_parity_damage_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'damage_each_opp_parity_1',
      name: 'Test Fiery Impulse',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    });

    const p1Player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1Player?.life ?? (g.state as any).life?.[p1]).toBe(40);
    expect(p2Player?.life ?? (g.state as any).life?.[p2]).toBe(38);
  });

  it('resolves DAMAGE_EACH_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Deal 1 damage to each player.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Earthquake', oracleText)?.op).toBe('DAMAGE_EACH_PLAYER');

    const gameId = 'oracle_ir_parity_damage_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'damage_each_player_parity_1',
      name: 'Test Earthquake',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{X}{R}',
    });

    const p1Player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1Player?.life ?? (g.state as any).life?.[p1]).toBe(39);
    expect(p2Player?.life ?? (g.state as any).life?.[p2]).toBe(39);
  });

  it('resolves creature CREATE_TOKEN via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Create a 1/1 white Soldier creature token.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Recruit', oracleText)?.op).toBe('CREATE_TOKEN');

    const gameId = 'oracle_ir_parity_create_creature_token';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const battlefieldBefore = (g.state as any).battlefield?.length ?? 0;

    castAndResolve(g, p1, {
      id: 'creature_token_parity_1',
      name: 'Test Recruit',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{W}',
    });

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) => String(perm?.card?.name || '').includes('Soldier'))).toBe(true);
  });

  it('resolves ANY_TARGET_DAMAGE via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Lightning Bolt deals 3 damage to any target.';
    expect(categorizeSpellWithoutPrimaryRetirement('Lightning Bolt', oracleText)?.op).toBe('ANY_TARGET_DAMAGE');

    const gameId = 'oracle_ir_parity_any_target_damage';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [{
      id: 'c1',
      controller: p2,
      owner: p2,
      tapped: false,
      basePower: 1,
      baseToughness: 1,
      card: {
        id: 'c1_card',
        name: 'Target Creature',
        type_line: 'Creature — Human',
        power: '1',
        toughness: '1',
        oracle_text: '',
      },
    }];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'bolt_parity_1',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }, ['c1']);

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
  });

  it('resolves DAMAGE_TARGET via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Deal 3 damage to target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Shock', oracleText)?.op).toBe('DAMAGE_TARGET');

    const gameId = 'oracle_ir_parity_damage_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [{
      id: 'c1',
      controller: p2,
      owner: p2,
      tapped: false,
      basePower: 1,
      baseToughness: 1,
      card: {
        id: 'c1_card',
        name: 'Target Creature',
        type_line: 'Creature — Human',
        power: '1',
        toughness: '1',
        oracle_text: '',
      },
    }];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'damage_creature_parity_1',
      name: 'Test Shock',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }, ['c1']);

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
  });

  it('resolves DAMAGE_EACH via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Deal 1 damage to each creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Sweep', oracleText)?.op).toBe('DAMAGE_EACH');

    const gameId = 'oracle_ir_parity_damage_each_creature';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'damage_each_parity_1',
      name: 'Test Sweep',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [], (game) => {
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p1, 'Knight', 1, 2, 2);
    });

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(1);
    expect(battlefield[0]?.card?.name).toBe('Knight');
  });

  it('resolves scoped DAMAGE_EACH you-control via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Deal 1 damage to each creature you control.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Self Sweep', oracleText)?.controllerOnly).toBe(true);

    const gameId = 'oracle_ir_parity_damage_each_you_control';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'self_sweep_parity_1',
      name: 'Test Self Sweep',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [], (game) => {
      game.createToken!(p1, 'P1 Token', 1, 1, 1);
      game.createToken!(p2, 'P2 Token', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(false);
    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(true);
  });

  it('resolves planeswalker-only DAMAGE_EACH via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Deal 1 damage to each planeswalker.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test PW Burn', oracleText)?.op).toBe('DAMAGE_EACH');
    expect(categorizeSpellWithoutPrimaryRetirement('Test PW Burn', oracleText)?.filter).toBe('PLANESWALKER');

    const gameId = 'oracle_ir_parity_damage_each_planeswalker';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'pw_burn_parity_1',
      name: 'Test PW Burn',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [], (game) => {
      (game.state as any).battlefield.push({
        id: 'pw1',
        owner: p1,
        controller: p1,
        tapped: false,
        loyalty: 3,
        card: { id: 'jace', name: 'Jace', type_line: 'Planeswalker — Jace', oracle_text: '' },
      });
    });

    const pwPerm = (g.state as any).battlefield.find((perm: any) => perm?.id === 'pw1');
    expect(pwPerm?.loyalty ?? pwPerm?.damageMarked ?? pwPerm?.damage ?? 0).toBeLessThanOrEqual(2);
  });

  it('resolves DESTROY_ALL creatures via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Destroy all creatures.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Wrath', oracleText)?.op).toBe('DESTROY_ALL');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Wrath', oracleText)?.filter).toBe('CREATURE');

    const gameId = 'oracle_ir_parity_destroy_all_creatures';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'wrath_parity_1',
      name: 'Test Wrath',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{W}{W}',
    }, [], (game) => {
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('resolves DESTROY_EACH creatures via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Destroy each creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Wrath', oracleText)?.op).toBe('DESTROY_EACH');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Wrath', oracleText)?.filter).toBe('CREATURE');

    const gameId = 'oracle_ir_parity_destroy_each_creature';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'each_wrath_parity_1',
      name: 'Test Each Wrath',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{W}{W}',
    }, [], (game) => {
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('resolves DESTROY_ALL artifacts via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Destroy all artifacts.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Shatter Storm', oracleText)?.op).toBe('DESTROY_ALL');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Shatter Storm', oracleText)?.filter).toBe('ARTIFACT');

    const gameId = 'oracle_ir_parity_destroy_all_artifacts';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'a1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'a1_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
      {
        id: 'a2',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'a2_card',
          name: 'Mana Vault',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'shatter_storm_parity_1',
      name: 'Test Shatter Storm',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{R}',
    }, ['lib-1']);

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line === 'Artifact')).toBe(false);
  });

  it('resolves EXILE_TARGET via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Exile target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Path to Exile', oracleText)?.op).toBe('EXILE_TARGET');

    const gameId = 'oracle_ir_parity_exile_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'exile_1',
        name: 'Test Path to Exile',
        type_line: 'Instant',
        oracle_text: oracleText,
        mana_cost: '{W}',
      },
      ['c1'],
      (game) => setupPlayerLibrary(game, p1, ['lib-1']),
    );

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const exile2 = (g.state as any).zones?.[p2]?.exile || [];
    expect(exile2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('resolves EXILE_ALL creatures via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Exile all creatures.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Terminus', oracleText)?.op).toBe('EXILE_ALL');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Terminus', oracleText)?.filter).toBe('CREATURE');

    const gameId = 'oracle_ir_parity_exile_all_creatures';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'terminus_parity_1',
      name: 'Test Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{4}{W}{W}',
    }, [], (game) => {
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('resolves exile-each-creature via IR primary without categorize op', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Exile each creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Terminus', oracleText)).toBeNull();

    const gameId = 'oracle_ir_parity_exile_each_creature';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'each_terminus_parity_1',
      name: 'Test Each Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{4}{W}{W}',
    }, [], (game) => {
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('resolves EXILE_ALL artifacts via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Exile all artifacts.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Shatter Exile', oracleText)?.op).toBe('EXILE_ALL');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Shatter Exile', oracleText)?.filter).toBe('ARTIFACT');

    const gameId = 'oracle_ir_parity_exile_all_artifacts';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'a1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'a1_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
      {
        id: 'a2',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'a2_card',
          name: 'Mana Vault',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'shatter_exile_parity_1',
      name: 'Test Shatter Exile',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{W}',
    }, ['lib-1']);

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line === 'Artifact')).toBe(false);
  });

  it('resolves opponent-scoped EXILE_ALL via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Exile all creatures your opponents control.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Terminus', oracleText)?.op).toBe('EXILE_ALL');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Terminus', oracleText)?.opponentOnly).toBe(true);

    const gameId = 'oracle_ir_parity_exile_all_opponent_creatures';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'opp_terminus_parity_1',
      name: 'Test Opp Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{4}{W}{W}',
    }, [], (game) => {
      game.createToken!(p1, 'P1 Token', 1, 1, 1);
      game.createToken!(p2, 'P2 Token', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(true);
    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(false);
  });

  it('resolves EXILE_TARGET nonland permanent via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Exile target nonland permanent.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Oblivion Ring', oracleText)?.op).toBe('EXILE_TARGET');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Oblivion Ring', oracleText)?.nonlandOnly).toBe(true);

    const gameId = 'oracle_ir_parity_exile_nonland';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'a1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'a1_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'exile_nonland_parity_1',
        name: 'Test Oblivion Ring',
        type_line: 'Instant',
        oracle_text: oracleText,
        mana_cost: '{2}{W}',
      },
      ['a1'],
      (game) => setupPlayerLibrary(game, p1, ['lib-1']),
    );

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'a1')).toBe(false);
    const exile2 = (g.state as any).zones?.[p2]?.exile || [];
    expect(exile2.some((card: any) => card?.id === 'a1_card')).toBe(true);
  });

  it('resolves BOUNCE_TARGET via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = "Return target creature to its owner's hand.";
    expect(categorizeSpellWithoutPrimaryRetirement('Test Unsummon', oracleText)?.op).toBe('BOUNCE_TARGET');

    const gameId = 'oracle_ir_parity_bounce_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'bounce_parity_1',
        name: 'Test Unsummon',
        type_line: 'Instant',
        oracle_text: oracleText,
        mana_cost: '{U}',
      },
      ['c1'],
      (game) => setupPlayerLibrary(game, p1, ['lib-1']),
    );

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    expect((g.state as any).zones?.[p2]?.hand?.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('resolves graveyard exile via move_zone IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = "Exile all cards from target player's graveyard.";
    expect(categorizeSpellWithoutPrimaryRetirement('Test Bojuka Bog', oracleText)?.op).toBe('EXILE_ALL');

    const gameId = 'oracle_ir_parity_exile_graveyard';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'bog_parity_1',
      name: 'Test Bojuka Bog',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }, [p2], (game) => {
      (game.state as any).zones[p2].graveyard = [{ id: 'dead-1', name: 'Dead Card', zone: 'graveyard' }];
      (game.state as any).zones[p2].graveyardCount = 1;
    });

    expect(((g.state as any).zones?.[p2]?.graveyard || []).length).toBe(0);
    expect(((g.state as any).zones?.[p2]?.exile || []).some((card: any) => card?.id === 'dead-1')).toBe(true);
  });

  it('resolves sacrifice-target-creature via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Sacrifice target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Edict', oracleText)?.op).toBe('TARGET_CREATURE');

    const gameId = 'oracle_ir_parity_sacrifice_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'edict_parity_1',
        name: 'Test Edict',
        type_line: 'Instant',
        oracle_text: oracleText,
        mana_cost: '{1}{B}',
      },
      ['c1'],
      (game) => setupPlayerLibrary(game, p1, ['lib-1']),
    );

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('resolves COUNTER_TARGET_SPELL via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Counter target spell.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Counterspell', oracleText)?.op).toBe('COUNTER_TARGET_SPELL');

    const gameId = 'oracle_ir_parity_counter_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const stackBoltId = 'stack_bolt_parity';

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    g.applyEvent!({
      type: 'pushStack',
      item: {
        id: stackBoltId,
        type: 'spell',
        controller: p2,
        card: {
          id: 'bolt_card',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        },
        targets: [],
      },
    });

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'counter_parity_1',
      name: 'Test Counterspell',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'counter_parity_1',
      targets: [stackBoltId],
    });

    expect((g.state as any).stack?.length || 0).toBe(2);
    g.resolveTopOfStack();

    expect((g.state as any).stack?.length || 0).toBe(0);
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'bolt_card')).toBe(true);
  });

  it('resolves COUNTER_TARGET_ABILITY via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Counter target activated ability.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Stifle', oracleText)?.op).toBe('COUNTER_TARGET_ABILITY');

    const gameId = 'oracle_ir_parity_counter_ability';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const stackAbilityId = 'stack_ability_parity';

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    g.applyEvent!({
      type: 'pushStack',
      item: {
        id: stackAbilityId,
        type: 'activated_ability',
        controller: p2,
        description: '{T}: Draw a card.',
        isManaAbility: false,
      },
    });

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'counter_ability_parity_1',
      name: 'Test Stifle',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'counter_ability_parity_1',
      targets: [stackAbilityId],
    });

    expect((g.state as any).stack?.length || 0).toBe(2);
    g.resolveTopOfStack();

    expect((g.state as any).stack?.length || 0).toBe(0);
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.length).toBe(0);
  });

  it('resolves TAP_TARGET via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Tap target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Twiddle', oracleText)?.op).toBe('TAP_TARGET');

    const gameId = 'oracle_ir_parity_tap_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'tap_parity_1',
        name: 'Test Twiddle',
        type_line: 'Instant',
        oracle_text: oracleText,
        mana_cost: '{U}',
      },
      ['c1'],
      (game) => setupPlayerLibrary(game, p1, ['lib-1']),
    );

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.tapped).toBe(true);
  });

  it('resolves ADD_COUNTERS_TARGET via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Put a +1/+1 counter on target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Incubate', oracleText)?.op).toBe('ADD_COUNTERS_TARGET');

    const gameId = 'oracle_ir_parity_add_counters_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        counters: {},
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'counter_parity_1',
        name: 'Test Incubate',
        type_line: 'Instant',
        oracle_text: oracleText,
        mana_cost: '{G}',
      },
      ['c1'],
      (game) => setupPlayerLibrary(game, p1, ['lib-1']),
    );

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.counters?.['+1/+1']).toBe(1);
  });

  it('resolves ADD_COUNTERS_EACH via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Put a +1/+1 counter on each creature you control.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Collective Growth', oracleText)?.op).toBe('ADD_COUNTERS_EACH');

    const gameId = 'oracle_ir_parity_add_counters_each';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'each_counter_parity_1',
        name: 'Test Collective Growth',
        type_line: 'Sorcery',
        oracle_text: oracleText,
        mana_cost: '{2}{G}',
      },
      [],
      (game) => {
        setupPlayerLibrary(game, p1, ['lib-1']);
        game.createToken!(p1, 'P1 Token A', 1, 1, 1);
        game.createToken!(p1, 'P1 Token B', 1, 1, 1);
        game.createToken!(p2, 'P2 Token', 1, 1, 1);
      },
    );

    const p1Creatures = (g.state as any).battlefield.filter((entry: any) => entry?.controller === p1);
    const p2Creature = (g.state as any).battlefield.find((entry: any) => entry?.controller === p2);
    expect(p1Creatures.length).toBe(2);
    expect(p1Creatures.every((entry: any) => entry?.counters?.['+1/+1'] === 1)).toBe(true);
    expect(p2Creature?.counters?.['+1/+1']).toBeUndefined();
  });

  it('resolves DRAW_TARGET_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Target player draws two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Target Draw', oracleText)?.op).toBe('DRAW_TARGET_PLAYER');

    const gameId = 'oracle_ir_parity_draw_target_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'draw_target_parity',
        name: 'Test Target Draw',
        type_line: 'Sorcery',
        oracle_text: oracleText,
        mana_cost: '{2}{U}',
      },
      [p2],
      (game) => {
        setupPlayerLibrary(game, p1, ['lib-1']);
        setupPlayerLibrary(game, p2, ['draw-1', 'draw-2', 'draw-3']);
      },
    );

    expect((g.state as any).zones?.[p2]?.hand?.length ?? 0).toBe(2);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(1);
  });

  it('resolves DRAW_CARDS_EACH_OPPONENT via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each opponent draws two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Draw', oracleText)?.op).toBe('DRAW_CARDS_EACH_OPPONENT');

    const gameId = 'oracle_ir_parity_draw_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'draw_each_opp_parity',
        name: 'Test Opp Draw',
        type_line: 'Sorcery',
        oracle_text: oracleText,
        mana_cost: '{3}{U}',
      },
      [],
      (game) => {
        setupPlayerLibrary(game, p1, ['lib-1']);
        setupPlayerLibrary(game, p2, ['opp-draw-1', 'opp-draw-2', 'opp-draw-3']);
      },
    );

    expect((g.state as any).zones?.[p2]?.hand?.length ?? 0).toBe(2);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(1);
  });

  it('resolves DRAW_CARDS_EACH_PLAYER via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each player draws a card.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test All Draw', oracleText)?.op).toBe('DRAW_CARDS_EACH_PLAYER');

    const gameId = 'oracle_ir_parity_draw_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'draw_each_player_parity',
        name: 'Test All Draw',
        type_line: 'Sorcery',
        oracle_text: oracleText,
        mana_cost: '{2}{U}',
      },
      [],
      (game) => {
        setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2']);
        setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2']);
      },
    );

    expect((g.state as any).zones?.[p1]?.hand?.length ?? 0).toBe(1);
    expect((g.state as any).zones?.[p2]?.hand?.length ?? 0).toBe(1);
    expect((g.state as any).zones?.[p1]?.libraryCount ?? 0).toBe(1);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(1);
  });

  it('resolves MILL_SELF via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Mill two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Mill Self', oracleText)?.op).toBe('MILL_SELF');

    const gameId = 'oracle_ir_parity_mill_self';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'mill_self_parity',
        name: 'Test Mill Self',
        type_line: 'Sorcery',
        oracle_text: oracleText,
        mana_cost: '{1}{U}',
      },
      [],
      (game) => {
        setupPlayerLibrary(game, p1, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);
      },
    );

    const gy = (g.state as any).zones?.[p1]?.graveyard || [];
    expect(gy.length).toBe(3);
    expect((g.state as any).zones?.[p1]?.libraryCount ?? 0).toBe(2);
  });

  it('queues SCRY_EACH_PLAYER via IR primary without duplicate legacy scry steps', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each player scries 1.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Player Scry', oracleText)?.op).toBe('SCRY_EACH_PLAYER');

    const gameId = 'oracle_ir_parity_scry_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'scry_each_player_parity',
      name: 'Test Each Player Scry',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2']);
      setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2']);
    });

    const scrySteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .concat(ResolutionQueueManager.getStepsForPlayer(gameId, p2))
      .filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(2);
    expect((g.state as any).pendingScry).toBeUndefined();
  });

  it('queues SCRY_EACH_OPPONENT via IR primary without duplicate legacy scry steps', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each opponent scries 2.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Opp Scry', oracleText)?.op).toBe('SCRY_EACH_OPPONENT');

    const gameId = 'oracle_ir_parity_scry_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'scry_each_opponent_parity',
      name: 'Test Each Opp Scry',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2', 'p1-lib-3']);
      setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2', 'p2-lib-3']);
    });

    const scrySteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(1);
    expect((scrySteps[0] as any)?.scryCount).toBe(2);
    expect((g.state as any).pendingScry).toBeUndefined();
  });

  it('queues SURVEIL_EACH_PLAYER via IR primary without duplicate legacy surveil steps', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each player surveils 1.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Player Surveil', oracleText)?.op).toBe('SURVEIL_EACH_PLAYER');

    const gameId = 'oracle_ir_parity_surveil_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'surveil_each_player_parity',
      name: 'Test Each Player Surveil',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2']);
      setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2']);
    });

    const surveilSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .concat(ResolutionQueueManager.getStepsForPlayer(gameId, p2))
      .filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(2);
  });

  it('queues SURVEIL_EACH_OPPONENT via IR primary without duplicate legacy surveil steps', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each opponent surveils 2.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Opp Surveil', oracleText)?.op).toBe('SURVEIL_EACH_OPPONENT');

    const gameId = 'oracle_ir_parity_surveil_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'surveil_each_opponent_parity',
      name: 'Test Each Opp Surveil',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2', 'p1-lib-3']);
      setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2', 'p2-lib-3']);
    });

    const surveilSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(1);
    expect((surveilSteps[0] as any)?.surveilCount).toBe(2);
  });

  it('resolves INVESTIGATE via IR primary without legacy categorize execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Investigate.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Investigate', oracleText)?.op).toBe('INVESTIGATE');

    const gameId = 'oracle_ir_parity_investigate';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const battlefieldBefore = (g.state as any).battlefield?.length ?? 0;

    castAndResolve(g, p1, {
      id: 'investigate_parity',
      name: 'Test Investigate',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{2}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Clue')).toBe(true);
  });

  it('queues SURVEIL_TARGET_PLAYER via IR primary without legacy categorize execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Target player surveils two.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Surveil Target', oracleText)?.op).toBe('SURVEIL_TARGET_PLAYER');

    const gameId = 'oracle_ir_parity_surveil_target_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'surveil_target_parity',
      name: 'Test Surveil Target',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [p2], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      setupPlayerLibrary(game, p2, ['surv-1', 'surv-2', 'surv-3']);
    });

    const surveilSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(1);
    expect((surveilSteps[0] as any)?.surveilCount).toBe(2);
  });

  it('resolves GOAD_TARGET via IR primary without legacy categorize execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Goad target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Goad', oracleText)?.op).toBe('GOAD_TARGET');

    const gameId = 'oracle_ir_parity_goad_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    g.createToken!(p2, 'P2 Creature', 1, 2, 2);
    const creatureId = (g.state as any).battlefield.find((entry: any) => entry?.controller === p2)?.id;

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'goad_parity',
      name: 'Test Goad',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{R}',
    }, [creatureId], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === creatureId);
    expect(Array.isArray(perm?.goadedBy) ? perm.goadedBy.includes(p1) : false).toBe(true);
  });

  it('resolves TAP_ALL via IR primary without legacy categorize execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Tap all creatures.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Sleep', oracleText)?.op).toBe('TAP_ALL');

    const gameId = 'oracle_ir_parity_tap_all';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    g.createToken!(p1, 'P1 Creature', 1, 2, 2);
    g.createToken!(p2, 'P2 Creature', 1, 2, 2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'tap_all_parity',
      name: 'Test Sleep',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const creatures = (g.state as any).battlefield.filter((entry: any) => entry?.card?.type_line?.includes('Creature'));
    expect(creatures.every((entry: any) => entry?.tapped === true)).toBe(true);
  });

  it('resolves DESTROY_ALL_TARGET_PLAYER via IR primary without legacy categorize execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Destroy all creatures target player controls.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Target Wrath', oracleText)?.op).toBe('DESTROY_ALL_TARGET_PLAYER');

    const gameId = 'oracle_ir_parity_destroy_all_target_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'target_wrath_parity',
      name: 'Test Target Wrath',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{B}',
    }, [p2], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Creature', 1, 2, 2);
      game.createToken!(p2, 'P2 Creature', 1, 2, 2);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(false);
    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(true);
  });

  it('resolves FLICKER_TARGET immediate blink via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = "Exile target creature you control, then return it to the battlefield under its owner's control.";
    expect(categorizeSpellWithoutPrimaryRetirement('Test Momentary Blink', oracleText)?.op).toBe('FLICKER_TARGET');

    const gameId = 'oracle_ir_parity_flicker_immediate';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'flicker_immediate_parity',
        name: 'Test Momentary Blink',
        type_line: 'Instant',
        oracle_text: oracleText,
        mana_cost: '{1}{W}',
      },
      ['c1'],
      (game) => {
        setupPlayerLibrary(game, p1, ['lib-1']);
        (game.state as any).battlefield = [
          {
            id: 'c1',
            controller: p1,
            owner: p1,
            tapped: true,
            isToken: false,
            card: {
              id: 'c1_card',
              name: 'Target Creature',
              type_line: 'Creature — Human',
              oracle_text: '',
            },
          },
        ];
      },
    );

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(String(battlefield[0]?.id || '')).not.toBe('c1');
    expect(String(battlefield[0]?.card?.id || '')).toBe('c1_card');
    expect(String(battlefield[0]?.controller || '')).toBe(p1);
    expect(Boolean(battlefield[0]?.tapped)).toBe(false);
  });

  it('resolves FLICKER_TARGET delayed flicker via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = "Exile target creature. Return it to the battlefield under its owner's control at the beginning of the next end step.";
    expect(categorizeSpellWithoutPrimaryRetirement('Test Flickerwisp', oracleText)?.op).toBe('FLICKER_TARGET');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Flickerwisp', oracleText)?.returnDelay).toBe('end_of_turn');

    const gameId = 'oracle_ir_parity_flicker_delayed';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(
      g,
      p1,
      {
        id: 'flicker_delayed_parity',
        name: 'Test Flickerwisp',
        type_line: 'Instant',
        oracle_text: oracleText,
        mana_cost: '{2}{W}',
      },
      ['c1'],
      (game) => setupPlayerLibrary(game, p1, ['lib-1']),
    );

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const exile2 = (g.state as any).zones?.[p2]?.exile || [];
    expect(exile2.some((card: any) => card?.id === 'c1_card')).toBe(true);
    const pending = ((g.state as any).pendingFlickerReturns || []) as any[];
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: 'return_from_exile_to_battlefield',
      ownerId: p2,
      cardId: 'c1_card',
      returnAt: 'next_end_step',
    });
  });

  it('resolves EXILE_ALL_TARGET_PLAYER via IR primary without legacy categorize execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Exile all creatures target player controls.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Target Terminus', oracleText)?.op).toBe('EXILE_ALL_TARGET_PLAYER');

    const gameId = 'oracle_ir_parity_exile_all_target_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'target_terminus_parity',
      name: 'Test Target Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{3}{W}',
    }, [p2], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Creature', 1, 2, 2);
      game.createToken!(p2, 'P2 Creature', 1, 2, 2);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(false);
    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(true);
  });

  it('queues BLIGHT_EACH_OPPONENT via IR primary without legacy categorize execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Each opponent blights 1. (They each put a -1/-1 counter on a creature they control.)';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Opp Blight', oracleText)?.op).toBe('BLIGHT_EACH_OPPONENT');

    const gameId = 'oracle_ir_parity_blight_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'blight_each_opponent_parity',
      name: 'Test Each Opp Blight',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{B}',
    }, [], (game) => {
      game.createToken!(p2, 'Opp Creature', 1, 2, 2);
    });

    const blightSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.TARGET_SELECTION && (step as any)?.keywordBlight === true);
    expect(blightSteps).toHaveLength(1);
    expect((blightSteps[0] as any)?.keywordBlightN).toBe(1);
    expect((blightSteps[0] as any)?.keywordBlightController).toBe(p2);
  });

  it('queues BLIGHT_SELF via IR primary without legacy categorize execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Blight 2.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Self Blight', oracleText)?.op).toBe('BLIGHT_SELF');

    const gameId = 'oracle_ir_parity_blight_self';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'blight_self_parity',
      name: 'Test Self Blight',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{B}',
    }, [], (game) => {
      game.createToken!(p1, 'Self Creature', 1, 2, 2);
    });

    const blightSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.TARGET_SELECTION && (step as any)?.keywordBlight === true);
    expect(blightSteps).toHaveLength(1);
    expect((blightSteps[0] as any)?.keywordBlightN).toBe(2);
    expect((blightSteps[0] as any)?.keywordBlightController).toBe(p1);
  });

  it('queues BLIGHT_TARGET_OPPONENT via IR primary without legacy categorize execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const oracleText = 'Target opponent blights 2.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Target Opp Blight', oracleText)?.op).toBe('BLIGHT_TARGET_OPPONENT');

    const gameId = 'oracle_ir_parity_blight_target_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent!({ type: 'join', playerId: p3, name: 'P3' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    ensureZonesForPlayer(g, p3);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'blight_target_opponent_parity',
      name: 'Test Target Opp Blight',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{B}',
    }, [p2], (game) => {
      game.createToken!(p2, 'Opp Creature', 1, 2, 2);
    });

    const blightSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.TARGET_SELECTION && (step as any)?.keywordBlight === true);
    expect(blightSteps).toHaveLength(1);
    expect((blightSteps[0] as any)?.keywordBlightN).toBe(2);
  });
});

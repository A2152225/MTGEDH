import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KnownCardRef, PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { categorizeSpellWithoutPrimaryRetirement } from '../src/rules-engine/targeting.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { isOracleIrSpellPrimaryEnabled } from '../src/state/modules/oracleIrSpellExecution.js';
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

describe('oracle IR spell primary production default', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  const previousLegacy = process.env.ORACLE_IR_SPELL_LEGACY;

  beforeEach(() => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
    if (previousLegacy === undefined) {
      delete process.env.ORACLE_IR_SPELL_LEGACY;
    } else {
      process.env.ORACLE_IR_SPELL_LEGACY = previousLegacy;
    }
  });

  it('enables spell primary when env overrides are cleared', () => {
    expect(isOracleIrSpellPrimaryEnabled()).toBe(true);
  });

  it('resolves draw spells through IR primary without legacy categorize execution', () => {
    const oracleText = 'Draw two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Divination', oracleText)?.op).toBe('DRAW_CARDS');

    const gameId = 'oracle_ir_default_primary_draw';
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
      mana_cost: '{2}{U}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1', 'lib-2', 'lib-3']));

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    expect(player.hand.length + player.library.length).toBe(3);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)).toHaveLength(0);
  });

  it('queues a single scry step under production default without legacy duplicates', () => {
    const oracleText = 'Scry 2.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Scry', oracleText)?.op).toBe('SCRY');

    const gameId = 'oracle_ir_default_primary_scry';
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

  it('queues a single surveil step under production default without legacy duplicates', () => {
    const oracleText = 'Surveil 2.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Surveil', oracleText)?.op).toBe('SURVEIL');

    const gameId = 'oracle_ir_default_primary_surveil';
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

  it('queues discard through IR primary under production default', () => {
    const oracleText = 'Target player discards two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Mind Rot', oracleText)?.op).toBe('DISCARD_TARGET_PLAYER');

    const gameId = 'oracle_ir_default_primary_discard';
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
      id: 'discard_primary',
      name: 'Test Mind Rot',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{B}',
    }, [p2], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardSteps).toHaveLength(1);
    expect((discardSteps[0] as any)?.discardCount).toBe(2);
  });

  it('queues each-opponent discard through IR primary under production default', () => {
    const oracleText = 'Each opponent discards two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Discard', oracleText)?.op).toBe('DISCARD_EACH_OPPONENT');

    const gameId = 'oracle_ir_default_primary_discard_each_opponent';
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
      id: 'discard_each_primary',
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

  it('resolves each-opponent mill through IR primary under production default', () => {
    const oracleText = 'Each opponent mills two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Mill', oracleText)?.op).toBe('MILL_EACH_OPPONENT');

    const gameId = 'oracle_ir_default_primary_mill_each_opponent';
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
      id: 'mill_each_primary',
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

  it('queues each-player discard through IR primary under production default', () => {
    const oracleText = 'Each player discards two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Player Discard', oracleText)?.op).toBe('DISCARD_EACH_PLAYER');

    const gameId = 'oracle_ir_default_primary_discard_each_player';
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
      id: 'discard_each_player_primary',
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

  it('resolves each-player mill through IR primary under production default', () => {
    const oracleText = 'Each player mills two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Player Mill', oracleText)?.op).toBe('MILL_EACH_PLAYER');

    const gameId = 'oracle_ir_default_primary_mill_each_player';
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
      id: 'mill_each_player_primary',
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
      const expectedGyCount = playerId === p1 ? 3 : 2;
      expect(gy.length).toBe(expectedGyCount);
      expect((g.state as any).zones?.[playerId]?.libraryCount ?? 0).toBe(2);
    }
  });

  it('resolves destroy spells through IR primary under production default', () => {
    const oracleText = 'Destroy target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Murder', oracleText)?.op).toBe('DESTROY_TARGET');

    const gameId = 'oracle_ir_default_primary_destroy';
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

    castAndResolve(g, p1, {
      id: 'destroy_primary',
      name: 'Test Murder',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{B}',
    }, ['c1'], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('resolves mill spells through IR primary under production default', () => {
    const oracleText = 'Target player mills three cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Mill', oracleText)?.op).toBe('MILL_TARGET_PLAYER');

    const gameId = 'oracle_ir_default_primary_mill';
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
      id: 'mill_primary',
      name: 'Test Mill',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [p2], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      setupPlayerLibrary(game, p2, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);
    });

    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.length).toBe(3);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(1);
  });

  it('routes gain-life spells through IR primary under production default', () => {
    const oracleText = 'You gain 3 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Healing Salve', oracleText)?.op).toBe('GAIN_LIFE');

    const gameId = 'oracle_ir_default_primary_gain_life';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const playerBefore = (g.state as any).players.find((entry: any) => entry.id === p1);
    const lifeBefore = playerBefore?.life ?? (g.state as any).life?.[p1] ?? 40;

    castAndResolve(g, p1, {
      id: 'gain_1',
      name: 'Healing Salve',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life ?? (g.state as any).life?.[p1]).toBe(lifeBefore + 3);
  });

  it('routes gain-life target-player spells through IR primary under production default', () => {
    const oracleText = 'Target player gains 3 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Healing Salve', oracleText)?.op).toBe('GAIN_LIFE_TARGET_PLAYER');

    const gameId = 'oracle_ir_default_primary_gain_life_target';
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
      name: 'Healing Salve',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }, [p2], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(43);
  });

  it('routes each-opponent gain-life spells through IR primary under production default', () => {
    const oracleText = 'Each opponent gains 1 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Group Hug', oracleText)?.op).toBe('GAIN_LIFE_EACH_OPPONENT');

    const gameId = 'oracle_ir_default_primary_gain_life_each_opponent';
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
      name: 'Group Hug',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const p1After = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (g.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(41);
  });

  it('routes each-player gain-life spells through IR primary under production default', () => {
    const oracleText = 'Each player gains 2 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Team Heal', oracleText)?.op).toBe('GAIN_LIFE_EACH_PLAYER');

    const gameId = 'oracle_ir_default_primary_gain_life_each_player';
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
      name: 'Team Heal',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{W}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const p1After = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (g.state as any).life?.[p1]).toBe(42);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(42);
  });

  it('routes lose-life spells through IR primary under production default', () => {
    const oracleText = 'You lose 2 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Shock', oracleText)?.op).toBe('LOSE_LIFE');

    const gameId = 'oracle_ir_default_primary_lose_life';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const playerBefore = (g.state as any).players.find((entry: any) => entry.id === p1);
    const lifeBefore = playerBefore?.life ?? (g.state as any).life?.[p1] ?? 40;

    castAndResolve(g, p1, {
      id: 'lose_1',
      name: 'Test Shock',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life ?? (g.state as any).life?.[p1]).toBe(lifeBefore - 2);
  });

  it('routes each-opponent lose-life spells through IR primary under production default', () => {
    const oracleText = 'Each opponent loses 3 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Fiery', oracleText)?.op).toBe('LOSE_LIFE_EACH_OPPONENT');

    const gameId = 'oracle_ir_default_primary_lose_life_each_opponent';
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
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const p1After = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (g.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(37);
  });

  it('routes each-player lose-life spells through IR primary under production default', () => {
    const oracleText = 'Each player loses 2 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Pox', oracleText)?.op).toBe('LOSE_LIFE_EACH_PLAYER');

    const gameId = 'oracle_ir_default_primary_lose_life_each_player';
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
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const p1After = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (g.state as any).life?.[p1]).toBe(38);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(38);
  });

  it('routes create-token spells through IR primary under production default', () => {
    const oracleText = 'Create a Treasure token.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Strike It Rich', oracleText)?.op).toBe('CREATE_TOKEN');

    const gameId = 'oracle_ir_default_primary_create_token';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const battlefieldBefore = (g.state as any).battlefield?.length ?? 0;

    castAndResolve(g, p1, {
      id: 'token_1',
      name: 'Test Strike It Rich',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Treasure' && perm?.controller === p1)).toBe(true);
  });

  it('routes damage-target-player spells through IR primary under production default', () => {
    const oracleText = 'Deal 3 damage to target player.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Lightning Strike', oracleText)?.op).toBe('DAMAGE_TARGET_PLAYER');

    const gameId = 'oracle_ir_default_primary_damage_target_player';
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
      id: 'damage_target_1',
      name: 'Test Lightning Strike',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [p2], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(37);
  });

  it('routes each-opponent damage spells through IR primary under production default', () => {
    const oracleText = 'Deal 2 damage to each opponent.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Fiery Impulse', oracleText)?.op).toBe('DAMAGE_EACH_OPPONENT');

    const gameId = 'oracle_ir_default_primary_damage_each_opponent';
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
      id: 'damage_each_opp_1',
      name: 'Test Fiery Impulse',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const p1After = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (g.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(38);
  });

  it('routes each-player damage spells through IR primary under production default', () => {
    const oracleText = 'Deal 1 damage to each player.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Earthquake', oracleText)?.op).toBe('DAMAGE_EACH_PLAYER');

    const gameId = 'oracle_ir_default_primary_damage_each_player';
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
      id: 'damage_each_player_1',
      name: 'Test Earthquake',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{X}{R}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const p1After = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (g.state as any).life?.[p1]).toBe(39);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(39);
  });

  it('routes creature-token spells through IR primary under production default', () => {
    const oracleText = 'Create a 1/1 white Soldier creature token.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Recruit', oracleText)?.op).toBe('CREATE_TOKEN');

    const gameId = 'oracle_ir_default_primary_create_creature_token';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const battlefieldBefore = (g.state as any).battlefield?.length ?? 0;

    castAndResolve(g, p1, {
      id: 'creature_token_1',
      name: 'Test Recruit',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{W}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) =>
      perm?.controller === p1
      && String(perm?.card?.name || '').includes('Soldier'),
    )).toBe(true);
  });

  it('routes any-target damage spells through IR primary under production default', () => {
    const oracleText = 'Lightning Bolt deals 3 damage to any target.';
    expect(categorizeSpellWithoutPrimaryRetirement('Lightning Bolt', oracleText)?.op).toBe('ANY_TARGET_DAMAGE');

    const gameId = 'oracle_ir_default_primary_any_target_damage';
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
      id: 'bolt_1',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }, ['c1'], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
  });

  it('routes damage-target spells through IR primary under production default', () => {
    const oracleText = 'Deal 3 damage to target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Shock', oracleText)?.op).toBe('DAMAGE_TARGET');

    const gameId = 'oracle_ir_default_primary_damage_target';
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
      id: 'damage_creature_1',
      name: 'Test Shock',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }, ['c1'], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
  });

  it('routes each-creature damage spells through IR primary under production default', () => {
    const oracleText = 'Deal 1 damage to each creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Sweep', oracleText)?.op).toBe('DAMAGE_EACH');

    const gameId = 'oracle_ir_default_primary_damage_each_creature';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'damage_each_1',
      name: 'Test Sweep',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p1, 'Knight', 1, 2, 2);
    });

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(1);
    expect(battlefield[0]?.card?.name).toBe('Knight');
  });

  it('routes opponent-scoped damage-target spells through IR primary under production default', () => {
    const oracleText = 'Deal 3 damage to target creature an opponent controls.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Scoped Burn', oracleText)?.op).toBe('DAMAGE_TARGET');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Scoped Burn', oracleText)?.opponentOnly).toBe(true);

    const gameId = 'oracle_ir_default_primary_damage_target_opponent_creature';
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

    g.importDeckResolved(p1, [{
      id: 'scoped_burn_1',
      name: 'Test Scoped Burn',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    g.createToken!(p1, 'P1 Token', 1, 1, 1);
    g.createToken!(p2, 'P2 Token', 1, 1, 1);
    const p2CreatureId = (g.state as any).battlefield.find((perm: any) => perm?.controller === p2)?.id;
    expect(p2CreatureId).toBeTruthy();

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'scoped_burn_1',
      targets: [p2CreatureId],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const p1Creature = (g.state as any).battlefield.find((perm: any) => perm?.controller === p1);
    const p2Creature = (g.state as any).battlefield.find((perm: any) => perm?.controller === p2);
    expect(p1Creature).toBeDefined();
    expect(p2Creature).toBeUndefined();
  });

  it('routes each-creature-you-control damage spells through IR primary under production default', () => {
    const oracleText = 'Deal 1 damage to each creature you control.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Self Sweep', oracleText)?.op).toBe('DAMAGE_EACH');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Self Sweep', oracleText)?.controllerOnly).toBe(true);

    const gameId = 'oracle_ir_default_primary_damage_each_you_control';
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
      id: 'self_sweep_1',
      name: 'Test Self Sweep',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Token', 1, 1, 1);
      game.createToken!(p2, 'P2 Token', 1, 1, 1);
    });

    const p1Creature = (g.state as any).battlefield.find((perm: any) => perm?.controller === p1);
    const p2Creature = (g.state as any).battlefield.find((perm: any) => perm?.controller === p2);
    expect(p1Creature).toBeUndefined();
    expect(p2Creature).toBeDefined();
  });

  it('routes each-opponent-creature damage spells through IR primary under production default', () => {
    const oracleText = 'Deal 1 damage to each creature your opponents control.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Sweep', oracleText)?.op).toBe('DAMAGE_EACH');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Sweep', oracleText)?.opponentOnly).toBe(true);

    const gameId = 'oracle_ir_default_primary_damage_each_opponent_creatures';
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
      id: 'opp_sweep_1',
      name: 'Test Opp Sweep',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Token', 1, 1, 1);
      game.createToken!(p2, 'P2 Token', 1, 1, 1);
    });

    const p1Creature = (g.state as any).battlefield.find((perm: any) => perm?.controller === p1);
    const p2Creature = (g.state as any).battlefield.find((perm: any) => perm?.controller === p2);
    expect(p1Creature).toBeDefined();
    expect(p2Creature).toBeUndefined();
  });

  it('routes each-creature-and-planeswalker damage spells through IR primary under production default', () => {
    const oracleText = 'Deal 1 damage to each creature and each planeswalker.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Swelter', oracleText)?.op).toBe('DAMAGE_EACH');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Swelter', oracleText)?.multiFilter).toEqual(['CREATURE', 'PLANESWALKER']);

    const gameId = 'oracle_ir_default_primary_damage_each_creature_pw';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'swelter_1',
      name: 'Test Swelter',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{R}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      (game.state as any).battlefield.push({
        id: 'pw1',
        owner: p1,
        controller: p1,
        tapped: false,
        loyalty: 3,
        card: { id: 'jace', name: 'Jace', type_line: 'Planeswalker — Jace', oracle_text: '' },
      });
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.name === 'Soldier')).toBe(false);
    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'pw1')).toBe(true);
  });

  it('routes planeswalker-only each damage spells through IR primary under production default', () => {
    const oracleText = 'Deal 1 damage to each planeswalker.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test PW Burn', oracleText)?.op).toBe('DAMAGE_EACH');
    expect(categorizeSpellWithoutPrimaryRetirement('Test PW Burn', oracleText)?.filter).toBe('PLANESWALKER');

    const gameId = 'oracle_ir_default_primary_damage_each_planeswalker';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'pw_burn_1',
      name: 'Test PW Burn',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
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

  it('resolves destroy-all-creatures spells through IR primary under production default', () => {
    const oracleText = 'Destroy all creatures.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Wrath', oracleText)?.op).toBe('DESTROY_ALL');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Wrath', oracleText)?.filter).toBe('CREATURE');

    const gameId = 'oracle_ir_default_primary_destroy_all_creatures';
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
      id: 'wrath_1',
      name: 'Test Wrath',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{W}{W}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('resolves destroy-each-creature spells through IR primary under production default', () => {
    const oracleText = 'Destroy each creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Wrath', oracleText)?.op).toBe('DESTROY_EACH');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Wrath', oracleText)?.filter).toBe('CREATURE');

    const gameId = 'oracle_ir_default_primary_destroy_each_creature';
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
      id: 'each_wrath_1',
      name: 'Test Each Wrath',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{W}{W}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('resolves exile-target-creature spells through IR primary under production default', () => {
    const oracleText = 'Exile target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Path to Exile', oracleText)?.op).toBe('EXILE_TARGET');

    const gameId = 'oracle_ir_default_primary_exile_target';
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

    castAndResolve(g, p1, {
      id: 'exile_primary',
      name: 'Test Path to Exile',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }, ['c1'], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const exile2 = (g.state as any).zones?.[p2]?.exile || [];
    expect(exile2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('resolves exile-all-creatures spells through IR primary under production default', () => {
    const oracleText = 'Exile all creatures.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Terminus', oracleText)?.op).toBe('EXILE_ALL');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Terminus', oracleText)?.filter).toBe('CREATURE');

    const gameId = 'oracle_ir_default_primary_exile_all_creatures';
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
      id: 'terminus_1',
      name: 'Test Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{4}{W}{W}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('resolves exile-each-creature spells through IR primary under production default', () => {
    const oracleText = 'Exile each creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Terminus', oracleText)).toBeNull();

    const gameId = 'oracle_ir_default_primary_exile_each_creature';
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
      id: 'each_terminus_1',
      name: 'Test Each Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{4}{W}{W}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('routes opponent-scoped exile-all-creatures spells through IR primary under production default', () => {
    const oracleText = 'Exile all creatures your opponents control.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Terminus', oracleText)?.op).toBe('EXILE_ALL');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Terminus', oracleText)?.opponentOnly).toBe(true);

    const gameId = 'oracle_ir_default_primary_exile_all_opponent_creatures';
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
      id: 'opp_terminus_1',
      name: 'Test Opp Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{4}{W}{W}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Token', 1, 1, 1);
      game.createToken!(p2, 'P2 Token', 1, 1, 1);
    });

    const p1Creature = (g.state as any).battlefield.find((perm: any) => perm?.controller === p1);
    const p2Creature = (g.state as any).battlefield.find((perm: any) => perm?.controller === p2);
    expect(p1Creature).toBeDefined();
    expect(p2Creature).toBeUndefined();
  });

  it('resolves exile-target-nonland-permanent spells through IR primary under production default', () => {
    const oracleText = 'Exile target nonland permanent.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Oblivion Ring', oracleText)?.op).toBe('EXILE_TARGET');
    expect(categorizeSpellWithoutPrimaryRetirement('Test Oblivion Ring', oracleText)?.nonlandOnly).toBe(true);

    const gameId = 'oracle_ir_default_primary_exile_nonland';
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

    castAndResolve(g, p1, {
      id: 'exile_nonland_primary',
      name: 'Test Oblivion Ring',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{2}{W}',
    }, ['a1'], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'a1')).toBe(false);
    const exile2 = (g.state as any).zones?.[p2]?.exile || [];
    expect(exile2.some((card: any) => card?.id === 'a1_card')).toBe(true);
  });

  it('resolves bounce-target-creature spells through IR primary under production default', () => {
    const oracleText = "Return target creature to its owner's hand.";
    expect(categorizeSpellWithoutPrimaryRetirement('Test Unsummon', oracleText)?.op).toBe('BOUNCE_TARGET');

    const gameId = 'oracle_ir_default_primary_bounce_target';
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

    castAndResolve(g, p1, {
      id: 'bounce_primary',
      name: 'Test Unsummon',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}',
    }, ['c1'], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    expect((g.state as any).zones?.[p2]?.hand?.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('resolves exile-target-player-graveyard spells through IR primary under production default', () => {
    const oracleText = "Exile all cards from target player's graveyard.";
    expect(categorizeSpellWithoutPrimaryRetirement('Test Bojuka Bog', oracleText)?.op).toBe('EXILE_ALL');

    const gameId = 'oracle_ir_default_primary_exile_graveyard';
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
      id: 'bog_primary',
      name: 'Test Bojuka Bog',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }, [p2], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      (game.state as any).zones[p2].graveyard = [
        { id: 'dead-1', name: 'Dead Card', zone: 'graveyard' },
        { id: 'dead-2', name: 'Dead Card Two', zone: 'graveyard' },
      ];
      (game.state as any).zones[p2].graveyardCount = 2;
    });

    expect(((g.state as any).zones?.[p2]?.graveyard || []).length).toBe(0);
    expect(((g.state as any).zones?.[p2]?.exile || []).length).toBeGreaterThanOrEqual(2);
  });

  it('resolves sacrifice-target-creature spells through IR primary under production default', () => {
    const oracleText = 'Sacrifice target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Edict', oracleText)?.op).toBe('TARGET_CREATURE');

    const gameId = 'oracle_ir_default_primary_sacrifice_target';
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

    castAndResolve(g, p1, {
      id: 'edict_primary',
      name: 'Test Edict',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{B}',
    }, ['c1'], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('resolves counter-target-spell through IR primary under production default', () => {
    const oracleText = 'Counter target spell.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Counterspell', oracleText)?.op).toBe('COUNTER_TARGET_SPELL');

    const gameId = 'oracle_ir_default_primary_counter_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const stackBoltId = 'stack_bolt_primary';

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
      id: 'counter_primary',
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
      cardId: 'counter_primary',
      targets: [stackBoltId],
    });

    expect((g.state as any).stack?.length || 0).toBe(2);
    g.resolveTopOfStack();

    expect((g.state as any).stack?.length || 0).toBe(0);
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'bolt_card')).toBe(true);
  });

  it('resolves tap-target-creature spells through IR primary under production default', () => {
    const oracleText = 'Tap target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Twiddle', oracleText)?.op).toBe('TAP_TARGET');

    const gameId = 'oracle_ir_default_primary_tap_target';
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

    castAndResolve(g, p1, {
      id: 'tap_primary',
      name: 'Test Twiddle',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}',
    }, ['c1'], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.tapped).toBe(true);
  });

  it('resolves untap-target-creature spells through IR primary under production default', () => {
    const oracleText = 'Untap target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Vitalize', oracleText)?.op).toBe('UNTAP_TARGET');

    const gameId = 'oracle_ir_default_primary_untap_target';
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

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'untap_primary',
      name: 'Test Vitalize',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{G}',
    }, ['c1'], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.tapped).toBe(false);
  });

  it('resolves add-counters-target spells through IR primary under production default', () => {
    const oracleText = 'Put a +1/+1 counter on target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Incubate', oracleText)?.op).toBe('ADD_COUNTERS_TARGET');

    const gameId = 'oracle_ir_default_primary_add_counters_target';
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

    castAndResolve(g, p1, {
      id: 'counter_primary',
      name: 'Test Incubate',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{G}',
    }, ['c1'], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.counters?.['+1/+1']).toBe(1);
  });

  it('resolves add-counters-each spells through IR primary under production default', () => {
    const oracleText = 'Put a +1/+1 counter on each creature you control.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Collective Growth', oracleText)?.op).toBe('ADD_COUNTERS_EACH');

    const gameId = 'oracle_ir_default_primary_add_counters_each';
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
      id: 'each_counter_primary',
      name: 'Test Collective Growth',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{G}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Token A', 1, 1, 1);
      game.createToken!(p1, 'P1 Token B', 1, 1, 1);
      game.createToken!(p2, 'P2 Token', 1, 1, 1);
    });

    const p1Creatures = (g.state as any).battlefield.filter((entry: any) => entry?.controller === p1);
    const p2Creature = (g.state as any).battlefield.find((entry: any) => entry?.controller === p2);
    expect(p1Creatures.length).toBe(2);
    expect(p1Creatures.every((entry: any) => entry?.counters?.['+1/+1'] === 1)).toBe(true);
    expect(p2Creature?.counters?.['+1/+1']).toBeUndefined();
  });

  it('resolves draw-target-player spells through IR primary under production default', () => {
    const oracleText = 'Target player draws two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Target Draw', oracleText)?.op).toBe('DRAW_TARGET_PLAYER');

    const gameId = 'oracle_ir_default_primary_draw_target_player';
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
      id: 'draw_target_primary',
      name: 'Test Target Draw',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, [p2], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      setupPlayerLibrary(game, p2, ['draw-1', 'draw-2', 'draw-3']);
    });

    expect((g.state as any).zones?.[p2]?.hand?.length ?? 0).toBe(2);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(1);
  });

  it('resolves each-opponent draw spells through IR primary under production default', () => {
    const oracleText = 'Each opponent draws two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Opp Draw', oracleText)?.op).toBe('DRAW_CARDS_EACH_OPPONENT');

    const gameId = 'oracle_ir_default_primary_draw_each_opponent';
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
      id: 'draw_each_opp_primary',
      name: 'Test Opp Draw',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{3}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      setupPlayerLibrary(game, p2, ['opp-draw-1', 'opp-draw-2', 'opp-draw-3']);
    });

    expect((g.state as any).zones?.[p2]?.hand?.length ?? 0).toBe(2);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(1);
  });

  it('resolves each-player draw spells through IR primary under production default', () => {
    const oracleText = 'Each player draws a card.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test All Draw', oracleText)?.op).toBe('DRAW_CARDS_EACH_PLAYER');

    const gameId = 'oracle_ir_default_primary_draw_each_player';
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
      id: 'draw_each_player_primary',
      name: 'Test All Draw',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2']);
      setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2']);
    });

    expect((g.state as any).zones?.[p1]?.hand?.length ?? 0).toBe(1);
    expect((g.state as any).zones?.[p2]?.hand?.length ?? 0).toBe(1);
    expect((g.state as any).zones?.[p1]?.libraryCount ?? 0).toBe(1);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(1);
  });

  it('resolves mill-self spells through IR primary under production default', () => {
    const oracleText = 'Mill two cards.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Mill Self', oracleText)?.op).toBe('MILL_SELF');

    const gameId = 'oracle_ir_default_primary_mill_self';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'mill_self_primary',
      name: 'Test Mill Self',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);
    });

    const gy = (g.state as any).zones?.[p1]?.graveyard || [];
    expect(gy.length).toBe(3);
    expect((g.state as any).zones?.[p1]?.libraryCount ?? 0).toBe(2);
  });

  it('queues each-player scry steps under production default without legacy duplicates', () => {
    const oracleText = 'Each player scries 1.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Player Scry', oracleText)?.op).toBe('SCRY_EACH_PLAYER');

    const gameId = 'oracle_ir_default_primary_scry_each_player';
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
      id: 'scry_each_player_primary',
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
    expect(scrySteps.map((step) => (step as any).playerId).sort()).toEqual([p1, p2].sort());
    expect((g.state as any).pendingScry).toBeUndefined();
  });

  it('queues each-opponent scry step under production default without legacy duplicates', () => {
    const oracleText = 'Each opponent scries 2.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Opp Scry', oracleText)?.op).toBe('SCRY_EACH_OPPONENT');

    const gameId = 'oracle_ir_default_primary_scry_each_opponent';
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
      id: 'scry_each_opponent_primary',
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
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SCRY)).toHaveLength(0);
    expect((g.state as any).pendingScry).toBeUndefined();
  });

  it('queues each-player surveil steps under production default without legacy duplicates', () => {
    const oracleText = 'Each player surveils 1.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Player Surveil', oracleText)?.op).toBe('SURVEIL_EACH_PLAYER');

    const gameId = 'oracle_ir_default_primary_surveil_each_player';
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
      id: 'surveil_each_player_primary',
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
    expect(surveilSteps.map((step) => (step as any).playerId).sort()).toEqual([p1, p2].sort());
  });

  it('queues each-opponent surveil step under production default without legacy duplicates', () => {
    const oracleText = 'Each opponent surveils 2.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Each Opp Surveil', oracleText)?.op).toBe('SURVEIL_EACH_OPPONENT');

    const gameId = 'oracle_ir_default_primary_surveil_each_opponent';
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
      id: 'surveil_each_opponent_primary',
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
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SURVEIL)).toHaveLength(0);
  });

  it('creates a Clue token via IR primary under production default', () => {
    const oracleText = 'Investigate.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Investigate', oracleText)?.op).toBe('INVESTIGATE');

    const gameId = 'oracle_ir_default_primary_investigate';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const battlefieldBefore = (g.state as any).battlefield?.length ?? 0;

    castAndResolve(g, p1, {
      id: 'investigate_primary',
      name: 'Test Investigate',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{2}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Clue')).toBe(true);
  });

  it('queues surveil-target-player through IR primary under production default', () => {
    const oracleText = 'Target player surveils two.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Surveil Target', oracleText)?.op).toBe('SURVEIL_TARGET_PLAYER');

    const gameId = 'oracle_ir_default_primary_surveil_target_player';
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
      id: 'surveil_target_primary',
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

  it('goads target creature through IR primary under production default', () => {
    const oracleText = 'Goad target creature.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Goad', oracleText)?.op).toBe('GOAD_TARGET');

    const gameId = 'oracle_ir_default_primary_goad_target';
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
      id: 'goad_primary',
      name: 'Test Goad',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{R}',
    }, [creatureId], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === creatureId);
    expect(Array.isArray(perm?.goadedBy) ? perm.goadedBy.includes(p1) : false).toBe(true);
  });

  it('taps all creatures through IR primary under production default', () => {
    const oracleText = 'Tap all creatures.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Sleep', oracleText)?.op).toBe('TAP_ALL');

    const gameId = 'oracle_ir_default_primary_tap_all';
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
      id: 'tap_all_primary',
      name: 'Test Sleep',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Creature', 1, 2, 2);
      game.createToken!(p2, 'P2 Creature', 1, 2, 2);
    });

    const creatures = (g.state as any).battlefield.filter((entry: any) => entry?.card?.type_line?.includes('Creature'));
    expect(creatures.length).toBe(2);
    expect(creatures.every((entry: any) => entry?.tapped === true)).toBe(true);
  });

  it('untaps all lands you control through IR primary under production default', () => {
    const oracleText = 'Untap all lands you control.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Revolt', oracleText)?.op).toBe('UNTAP_ALL');

    const gameId = 'oracle_ir_default_primary_untap_all';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'untap_all_primary',
      name: 'Test Revolt',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{G}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      (game.state as any).battlefield = [
        {
          id: 'land1',
          controller: p1,
          owner: p1,
          tapped: true,
          isToken: false,
          card: {
            id: 'land1_card',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '',
          },
        },
      ];
    });

    const land = (g.state as any).battlefield.find((entry: any) => entry?.id === 'land1');
    expect(land?.tapped).toBe(false);
  });

  it('taps all creatures target player controls through IR primary under production default', () => {
    const oracleText = 'Tap all creatures target player controls.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Sleep Target', oracleText)?.op).toBe('TAP_ALL_TARGET_PLAYER');

    const gameId = 'oracle_ir_default_primary_tap_all_target_player';
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
      id: 'tap_all_target_primary',
      name: 'Test Sleep Target',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, [p2], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Creature', 1, 2, 2);
      game.createToken!(p2, 'P2 Creature', 1, 2, 2);
    });

    const p1Creature = (g.state as any).battlefield.find((entry: any) => entry?.controller === p1);
    const p2Creature = (g.state as any).battlefield.find((entry: any) => entry?.controller === p2);
    expect(p1Creature).toBeTruthy();
    expect(p2Creature).toBeTruthy();
    expect(p1Creature?.tapped).toBe(false);
    expect(p2Creature?.tapped).toBe(true);
  });

  it('destroys all creatures target player controls through IR primary under production default', () => {
    const oracleText = 'Destroy all creatures target player controls.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Target Wrath', oracleText)?.op).toBe('DESTROY_ALL_TARGET_PLAYER');

    const gameId = 'oracle_ir_default_primary_destroy_all_target_player';
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
      id: 'target_wrath_primary',
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

  it('exiles all creatures target player controls through IR primary under production default', () => {
    const oracleText = 'Exile all creatures target player controls.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Target Terminus', oracleText)?.op).toBe('EXILE_ALL_TARGET_PLAYER');

    const gameId = 'oracle_ir_default_primary_exile_all_target_player';
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
      id: 'target_terminus_primary',
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
});

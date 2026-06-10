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
});

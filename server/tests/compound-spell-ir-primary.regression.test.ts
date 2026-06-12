import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { applyLegacySpellRegexDrawHandlers } from '../src/state/modules/stackResolveSpellLegacyRegexDrawUtils.js';
import {
  isSpellEffectFullyIrWired,
  shouldSkipLegacySpellRegexHandlers,
} from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { ResolutionStepType } from '../src/state/resolution/types.js';

function createBaseCtx(playerId: PlayerID): GameContext {
  const library = Array.from({ length: 10 }, (_, index) => ({
    id: `lib_${index}`,
    name: `Library Card ${index}`,
    type_line: 'Instant',
    zone: 'library',
  }));

  const ctx = createContext('compound-spell-ir') as GameContext;
  (ctx as any).state = {
    players: [{
      id: playerId,
      name: 'Player',
      hasLost: false,
      hand: [],
      library: [...library],
      graveyard: [],
    }],
    life: { [playerId]: 40 },
    battlefield: [],
    zones: {
      [playerId]: {
        library: [...library],
        libraryCount: library.length,
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    },
    stack: [],
    pendingDiscard: {},
  };

  ctx.libraries.set(playerId, library.map((card) => ({ ...card })));

  return ctx;
}

function createTwoPlayerCtx(playerId: PlayerID, player2Id: PlayerID): GameContext {
  const ctx = createBaseCtx(playerId);
  const state = (ctx as any).state;
  const p2Library = Array.from({ length: 10 }, (_, index) => ({
    id: `p2_lib_${index}`,
    name: `P2 Library ${index}`,
    type_line: 'Instant',
    zone: 'library',
  }));

  state.players.push({ id: player2Id, name: 'P2', hasLost: false, hand: [], library: [], graveyard: [] });
  state.zones[player2Id] = {
    library: [...p2Library],
    libraryCount: p2Library.length,
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };
  ctx.libraries.set(player2Id, p2Library.map((card) => ({ ...card })));
  return ctx;
}

describe('compound spell Oracle IR primary (batch 177)', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('Chart a Course is fully IR-wired and skips legacy compound draw regex', () => {
    const oracleText = 'Draw two cards, then discard a card.';
    expect(isSpellEffectFullyIrWired(oracleText, 'Chart a Course')).toBe(true);

    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(shouldSkipLegacySpellRegexHandlers(oracleText, 'Chart a Course')).toBe(true);
  });

  it('resolves draw-then-discard under IR primary without legacy regex', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const playerId = 'p1' as PlayerID;
    const ctx = createBaseCtx(playerId);
    const state = (ctx as any).state;
    const oracleText = 'Draw two cards, then discard a card.';

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: playerId,
      spellName: 'Chart a Course',
      oracleText,
      sourceId: 'chart-1',
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.applied).toBeGreaterThanOrEqual(1);
    expect(state.zones[playerId].hand.length).toBe(2);

    const queuedDiscard = ResolutionQueueManager
      .getQueue(String((ctx as any).gameId))
      .steps.some((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    const legacyPendingDiscard = state.pendingDiscard?.[playerId]?.count === 1;
    expect(queuedDiscard || legacyPendingDiscard).toBe(true);

    applyLegacySpellRegexDrawHandlers(ctx, {
      controller: playerId,
      effectiveCard: { name: 'Chart a Course' },
      oracleTextLower: oracleText.toLowerCase(),
    });

    expect(state.zones[playerId].hand.length).toBe(2);
  });

  it('Echo of Eons wheel text is fully IR-wired and skips legacy compound regex under primary', () => {
    const oracleText =
      'Each player shuffles their hand and graveyard into their library, then draws seven cards.';
    expect(isSpellEffectFullyIrWired(oracleText, 'Echo of Eons')).toBe(true);

    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(shouldSkipLegacySpellRegexHandlers(oracleText, 'Echo of Eons')).toBe(true);
  });

  it('resolves Echo wheel under IR primary without legacy regex', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const playerId = 'p1' as PlayerID;
    const player2Id = 'p2' as PlayerID;
    const ctx = createTwoPlayerCtx(playerId, player2Id);
    const state = (ctx as any).state;

    state.zones[player2Id].hand = [{ id: 'p2_hand_1', name: 'Shock', type_line: 'Instant', zone: 'hand' }];
    state.zones[player2Id].handCount = 1;
    state.zones[player2Id].graveyard = [{ id: 'p2_gy_1', name: 'Island', type_line: 'Basic Land - Island', zone: 'graveyard' }];
    state.zones[player2Id].graveyardCount = 1;

    state.zones[playerId].hand = [
      { id: 'p1_hand_1', name: 'Opt', type_line: 'Instant', zone: 'hand' },
      { id: 'p1_hand_2', name: 'Bolt', type_line: 'Instant', zone: 'hand' },
    ];
    state.zones[playerId].handCount = 2;
    state.zones[playerId].graveyard = [
      { id: 'p1_gy_1', name: 'Mountain', type_line: 'Basic Land - Mountain', zone: 'graveyard' },
    ];
    state.zones[playerId].graveyardCount = 1;

    const oracleText =
      'Each player shuffles their hand and graveyard into their library, then draws seven cards.';

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: playerId,
      spellName: 'Echo of Eons',
      oracleText,
      sourceId: 'echo-1',
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.applied).toBeGreaterThanOrEqual(2);
    expect(state.zones[playerId].hand.length).toBe(7);
    expect(state.zones[playerId].graveyard).toEqual([]);
    expect(state.zones[player2Id].hand.length).toBe(7);
    expect(state.zones[player2Id].graveyard).toEqual([]);

    applyLegacySpellRegexDrawHandlers(ctx, {
      controller: playerId,
      effectiveCard: { name: 'Echo of Eons' },
      oracleTextLower: oracleText.toLowerCase(),
    });

    expect(state.zones[playerId].hand.length).toBe(7);
    expect(state.zones[player2Id].hand.length).toBe(7);
  });

  it('Windfall and Reforge the Soul discard-hand wheels are fully IR-wired under primary', () => {
    const windfallText =
      'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.';
    const reforgeText = 'Each player discards their hand, then draws seven cards.';

    expect(isSpellEffectFullyIrWired(windfallText, 'Windfall')).toBe(true);
    expect(isSpellEffectFullyIrWired(reforgeText, 'Reforge the Soul')).toBe(true);

    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(shouldSkipLegacySpellRegexHandlers(windfallText, 'Windfall')).toBe(true);
    expect(shouldSkipLegacySpellRegexHandlers(reforgeText, 'Reforge the Soul')).toBe(true);
  });

  it('resolves Windfall under IR primary using greatest discarded hand size', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const playerId = 'p1' as PlayerID;
    const player2Id = 'p2' as PlayerID;
    const ctx = createTwoPlayerCtx(playerId, player2Id);
    const state = (ctx as any).state;

    state.zones[playerId].hand = [
      { id: 'p1_hand_1', name: 'Opt', type_line: 'Instant', zone: 'hand' },
      { id: 'p1_hand_2', name: 'Bolt', type_line: 'Instant', zone: 'hand' },
      { id: 'p1_hand_3', name: 'Shock', type_line: 'Instant', zone: 'hand' },
    ];
    state.zones[playerId].handCount = 3;
    state.zones[player2Id].hand = Array.from({ length: 5 }, (_, index) => ({
      id: `p2_hand_${index}`,
      name: `P2 Hand ${index}`,
      type_line: 'Instant',
      zone: 'hand',
    }));
    state.zones[player2Id].handCount = 5;

    const oracleText =
      'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.';

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: playerId,
      spellName: 'Windfall',
      oracleText,
      sourceId: 'windfall-1',
    });

    expect(outcome.handled).toBe(true);
    expect(state.zones[playerId].hand.length).toBe(5);
    expect(state.zones[player2Id].hand.length).toBe(5);
    expect(state.zones[playerId].graveyard.length).toBe(3);
    expect(state.zones[player2Id].graveyard.length).toBe(5);
  });

  it('Big Score draw-plus-treasure is fully IR-wired under primary', () => {
    const oracleText = 'Draw three cards, then create two Treasure tokens.';
    expect(isSpellEffectFullyIrWired(oracleText, 'Big Score')).toBe(true);

    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(shouldSkipLegacySpellRegexHandlers(oracleText, 'Big Score')).toBe(true);
  });

  it('resolves Big Score draw-plus-treasure under IR primary without legacy regex', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const playerId = 'p1' as PlayerID;
    const ctx = createBaseCtx(playerId);
    const state = (ctx as any).state;
    const oracleText = 'Draw three cards, then create two Treasure tokens.';

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: playerId,
      spellName: 'Big Score',
      oracleText,
      sourceId: 'big-score-1',
    });

    expect(outcome.handled).toBe(true);
    expect(state.zones[playerId].hand.length).toBe(3);
    const treasureTokens = (state.battlefield || []).filter(
      (entry: any) => String(entry?.name || entry?.card?.name || '').includes('Treasure'),
    );
    expect(treasureTokens.length).toBe(2);

    applyLegacySpellRegexDrawHandlers(ctx, {
      controller: playerId,
      effectiveCard: { name: 'Big Score' },
      oracleTextLower: oracleText.toLowerCase(),
    });

    expect(state.zones[playerId].hand.length).toBe(3);
    expect(treasureTokens.length).toBe(2);
  });

  it('Celestial Reunion is fully IR-wired under primary', () => {
    const oracleText =
      'As an additional cost to cast this spell, you may choose a creature type and behold two creatures of that type.\n'
      + "Search your library for a creature card with mana value X or less, reveal it, put it into your hand, then shuffle. If this spell's additional cost was paid and the revealed card is the chosen type, put that card onto the battlefield instead of putting it into your hand.";
    expect(isSpellEffectFullyIrWired(oracleText, 'Celestial Reunion')).toBe(true);

    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(shouldSkipLegacySpellRegexHandlers(oracleText, 'Celestial Reunion')).toBe(true);
  });

  it('queues Celestial Reunion X creature search under IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const playerId = 'p1' as PlayerID;
    const ctx = createBaseCtx(playerId);
    const state = (ctx as any).state;
    const gameId = String((ctx as any).gameId);
    ResolutionQueueManager.removeQueue(gameId);

    const creatureLibrary = [
      { id: 'elf_1', name: 'Elvish Mystic', type_line: 'Creature — Elf Druid', cmc: 1, zone: 'library' },
      { id: 'gob_1', name: 'Goblin Guide', type_line: 'Creature — Goblin Scout', cmc: 1, zone: 'library' },
    ];
    state.players[0].library = creatureLibrary;
    state.zones[playerId].library = [...creatureLibrary];
    state.zones[playerId].libraryCount = creatureLibrary.length;
    ctx.libraries.set(playerId, creatureLibrary.map((card) => ({ ...card })));

    const oracleText =
      'As an additional cost to cast this spell, you may choose a creature type and behold two creatures of that type.\n'
      + "Search your library for a creature card with mana value X or less, reveal it, put it into your hand, then shuffle. If this spell's additional cost was paid and the revealed card is the chosen type, put that card onto the battlefield instead of putting it into your hand.";

    const sourceItem = {
      id: 'spell-celestial',
      xValue: 3,
      additionalCostPaid: true,
      chosenCreatureType: 'Elf',
      card: { chosenCreatureType: 'Elf', additionalCostPaid: true },
    };

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: playerId,
      spellName: 'Celestial Reunion',
      oracleText,
      sourceId: 'spell-celestial',
      xValue: 3,
      chosenCreatureType: 'Elf',
      sourceItem,
    });

    expect(outcome.handled).toBe(true);

    const searchStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchStep).toBeTruthy();
    expect((searchStep as any).filter?.types).toEqual(['creature']);
    expect((searchStep as any).filter?.maxCmc).toBe(3);
    expect((searchStep as any).chosenTypeBattlefieldIfPaid).toEqual({
      chosenType: 'Elf',
      additionalCostPaid: true,
    });
  });
});

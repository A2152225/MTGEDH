import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import {
  buildEvenDamageDivision,
  parseDividedAsYouChooseTotal,
  shouldPromptDamageDivision,
  validateDamageDivision,
} from '../src/state/modules/dividedDamageDivision.js';
import { maybeQueueDamageDivisionAfterSpellTargets } from '../src/socket/resolution-handlers/queueDamageDivisionAfterSpellTargets.js';
import { handleDamageDivisionResponse } from '../src/socket/resolution-handlers/damageDivisionResponseHandlers.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const FIRE_COVENANT =
  'As an additional cost to cast this spell, pay X life.\nFire Covenant deals X damage divided as you choose among any number of target creatures.';
const ARC_LIGHTNING =
  'Arc Lightning deals 3 damage divided as you choose among one, two, or three targets.';

function creature(id: string, controller: string, power: string, toughness: string, name = id) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    damageMarked: 0,
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Creature — Bear',
      power,
      toughness,
      oracle_text: '',
    },
  };
}

function emptyZone() {
  return {
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

function startGame(gameId: string) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);
  const state: any = game.state;
  state.zones = { [p1]: emptyZone(), [p2]: emptyZone() };
  state.life = { [p1]: 40, [p2]: 40 };
  state.battlefield = [
    creature('giant', p2, '3', '5', 'Hill Giant'),
    creature('wurm', p2, '6', '4', 'Craw Wurm'),
  ];
  (game as any).gameId = state.id || gameId;
  return { game, state, p1, p2 };
}

function damageOf(state: any, id: string): number {
  const perm = (state.battlefield || []).find((entry: any) => entry.id === id);
  return Number(perm?.damageMarked ?? perm?.damage ?? 0);
}

describe('divided damage division helpers', () => {
  it('parses a fixed total and announced X, and even-splits with remainder on earlier targets', () => {
    expect(parseDividedAsYouChooseTotal(ARC_LIGHTNING)).toBe(3);
    expect(parseDividedAsYouChooseTotal(FIRE_COVENANT, 5)).toBe(5);
    expect(parseDividedAsYouChooseTotal(FIRE_COVENANT)).toBeNull();
    expect(buildEvenDamageDivision(['a', 'b'], 3)).toEqual({ a: 2, b: 1 });
    expect(buildEvenDamageDivision(['a', 'b', 'c'], 4)).toEqual({ a: 2, b: 1, c: 1 });
  });

  it('rejects a split that skips a target or does not consume the total (CR 601.2d)', () => {
    const skipped = validateDamageDivision({
      distribution: { a: 3, b: 0 },
      targetIds: ['a', 'b'],
      total: 3,
    });
    expect(skipped.ok).toBe(false);
    const short = validateDamageDivision({
      distribution: { a: 2, b: 1 },
      targetIds: ['a', 'b'],
      total: 5,
    });
    expect(short.ok).toBe(false);
    const ok = validateDamageDivision({
      distribution: { a: 4, b: 1 },
      targetIds: ['a', 'b'],
      total: 5,
    });
    expect(ok).toEqual({ ok: true, division: { a: 4, b: 1 } });
  });

  it('does not prompt for a single target or when only 1 damage each is legal', () => {
    expect(shouldPromptDamageDivision({
      oracleText: ARC_LIGHTNING,
      targetIds: ['only'],
    })).toMatchObject({ prompt: false, autoDivision: { only: 3 } });
    expect(shouldPromptDamageDivision({
      oracleText: ARC_LIGHTNING,
      targetIds: ['a', 'b', 'c'],
    })).toMatchObject({ prompt: false, autoDivision: { a: 1, b: 1, c: 1 } });
    expect(shouldPromptDamageDivision({
      oracleText: ARC_LIGHTNING,
      targetIds: ['a', 'b'],
    })).toMatchObject({ prompt: true, total: 3 });
  });
});

describe('divided damage chooser and live resolution', () => {
  const previousSpellPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  beforeEach(() => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
  });

  afterEach(() => {
    if (previousSpellPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousSpellPrimary;
  });

  it('queues DAMAGE_DIVISION after targets and stores an uneven Fire Covenant split on the pending cast', () => {
    const { game, p1 } = startGame('divided_damage_pending_cast');
    const effectId = 'cast_fire_covenant';
    (game.state as any).pendingSpellCasts = {
      [effectId]: {
        effectId,
        cardId: 'covenant_card',
        cardName: 'Fire Covenant',
        xValue: 5,
        targets: ['giant', 'wurm'],
        card: {
          id: 'covenant_card',
          name: 'Fire Covenant',
          type_line: 'Instant',
          mana_cost: '{1}{B}{R}',
          oracle_text: FIRE_COVENANT,
        },
      },
    };
    ResolutionQueueManager.removeQueue((game as any).gameId);

    const queued = maybeQueueDamageDivisionAfterSpellTargets({
      game,
      gameId: (game as any).gameId,
      playerId: p1,
      pendingCast: (game.state as any).pendingSpellCasts[effectId],
      spellCastContext: {
        cardId: 'covenant_card',
        cardName: 'Fire Covenant',
        effectId,
        oracleText: FIRE_COVENANT,
      },
      finalTargets: ['giant', 'wurm'],
    });
    expect(queued).toBe(true);

    const step = ResolutionQueueManager.getStepsForPlayer((game as any).gameId, p1)
      .find((entry) => entry.type === ResolutionStepType.DAMAGE_DIVISION);
    expect(step).toBeTruthy();
    expect((step as any).totalAmount).toBe(5);

    const completed = ResolutionQueueManager.completeStep((game as any).gameId, String(step!.id), {
      stepId: String(step!.id),
      playerId: p1,
      selections: { giant: 4, wurm: 1 } as any,
      cancelled: false,
      timestamp: Date.now(),
    });

    const fakeIo = { to: () => ({ emit: () => undefined }) } as any;
    handleDamageDivisionResponse(fakeIo, game, (game as any).gameId, completed as any, completed!.response!);

    expect((game.state as any).pendingSpellCasts[effectId].damageDivisionByTargetId).toEqual({
      giant: 4,
      wurm: 1,
    });
    const payment = ResolutionQueueManager.getStepsForPlayer((game as any).gameId, p1)
      .find((entry) => entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE);
    expect(payment).toBeTruthy();
  });

  it('applies an uneven Fire Covenant split through the live stack-resolution path', () => {
    const { game, state, p1 } = startGame('divided_damage_fire_covenant_live');
    state.stack = [{
      id: 'covenant_stack',
      type: 'spell',
      controller: p1,
      xValue: 5,
      targets: ['giant', 'wurm'],
      damageDivisionByTargetId: { giant: 4, wurm: 1 },
      card: {
        id: 'covenant_card',
        name: 'Fire Covenant',
        type_line: 'Instant',
        mana_cost: '{1}{B}{R}',
        oracle_text: FIRE_COVENANT,
        colors: ['B', 'R'],
      },
    }];

    resolveTopOfStack(game as any);

    expect(damageOf(state, 'giant')).toBe(4);
    expect(damageOf(state, 'wurm')).toBe(1);
  });

  it('applies an uneven Arc Lightning split through the live stack-resolution path', () => {
    const { game, state, p1, p2 } = startGame('divided_damage_arc_lightning_live');
    state.stack = [{
      id: 'arc_stack',
      type: 'spell',
      controller: p1,
      targets: [p2, 'giant'],
      damageDivisionByTargetId: { [p2]: 2, giant: 1 },
      card: {
        id: 'arc_card',
        name: 'Arc Lightning',
        type_line: 'Sorcery',
        mana_cost: '{3}{R}',
        oracle_text: ARC_LIGHTNING,
        colors: ['R'],
      },
    }];

    resolveTopOfStack(game as any);

    expect(state.life[p2]).toBe(38);
    expect(damageOf(state, 'giant')).toBe(1);
    expect(damageOf(state, 'wurm')).toBe(0);
  });
});

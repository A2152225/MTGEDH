import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { isOracleIrSpellPrimaryEnabled } from '../src/state/modules/oracleIrFeatureFlags.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';

// Exercises Whip's activated ability through the Oracle IR path (not legacy regex).
// Parser + direct IR apply + full socket activation with production-default primary flags.

const WHIP_ORACLE_TEXT =
  "Creatures you control have lifelink.\n{2}{B}{B}, {T}: Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else. Activate only as a sorcery.";

const WHIP_ACTIVATED_EFFECT =
  'Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.';

const GY_BEAR = {
  id: 'whip_target_1',
  name: 'Grizzly Bears',
  type_line: 'Creature - Bear',
  oracle_text: '',
  mana_cost: '{1}{G}',
  power: '2',
  toughness: '2',
  zone: 'graveyard',
} as const;

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedWhipGame(gameId: string, playerId: PlayerID) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).turnNumber = 5;
  (game.state as any).phase = 'main';
  (game.state as any).step = 'MAIN1';
  (game.state as any).stack = [];
  (game.state as any).pendingExileAtNextEndStep = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 2, red: 0, green: 0, colorless: 2 },
  };
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [{ ...GY_BEAR }],
      graveyardCount: 1,
      exile: [],
      exileCount: 0,
    },
  };
  (game.state as any).battlefield = [
    {
      id: 'whip_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: {
        id: 'whip_card_1',
        name: 'Whip of Erebos',
        type_line: 'Legendary Enchantment Artifact',
        oracle_text: WHIP_ORACLE_TEXT,
      },
    },
  ];

  return game;
}

async function activateWhipAndResolveTarget(game: any, gameId: string, playerId: PlayerID, handlers: Record<string, Function>) {
  await handlers['activateBattlefieldAbility']({
    gameId,
    permanentId: 'whip_1',
    abilityId: 'whip_1-ability-0',
  });

  const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find(
    (queuedStep: any) => (queuedStep as any).battlefieldAbilityTargetSelection === true,
  );
  expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((targetStep as any).id),
      selections: ['whip_target_1'],
      cancelled: false,
    });

    const stackBeforeResolve = (game.state as any).stack || [];
    expect(String(stackBeforeResolve[0]?.activatedAbilityText || '')).toContain('gains haste');
    expect(String(stackBeforeResolve[0]?.description || '')).toContain('gains haste');

    game.resolveTopOfStack();
}

function findReturnedBear(game: any) {
  return ((game.state as any).battlefield || []).find(
    (perm: any) => String(perm?.card?.id || '') === GY_BEAR.id,
  );
}

describe('Whip of Erebos Oracle IR (integration)', () => {
  const gameId = 'test_whip_of_erebos_oracle_ir';
  const playerId = 'p1' as PlayerID;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('parses the activated effect into move_zone + haste grant + delayed exile + leave replacement', () => {
    const ir = parseOracleTextToIR(WHIP_ACTIVATED_EFFECT, 'Whip of Erebos');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);

    expect(steps.some((step) => step.kind === 'move_zone')).toBe(true);
    expect(steps.some((step) => step.kind === 'grant_temporary_ability' || step.kind === 'grant_static_ability')).toBe(true);
    expect(steps.some((step) => step.kind === 'grant_leave_battlefield_replacement')).toBe(true);
    expect(steps.some((step) => /exile it at the beginning of the next end step/i.test(String((step as any).raw || '')))).toBe(true);
  });

  it('applies the activated effect through tryApplyOracleIRToActivatedAbility', () => {
    const game = seedWhipGame(`${gameId}_direct`, playerId);

    const result = tryApplyOracleIRToActivatedAbility(game as any, {
      controller: playerId,
      sourceName: 'Whip of Erebos',
      oracleText: WHIP_ACTIVATED_EFFECT,
      sourcePermanentId: 'whip_1',
      stackItemId: 'whip_stack_1',
      targets: [GY_BEAR.id],
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual([]);
    expect(zones?.graveyardCount).toBe(0);

    const returnedPermanent = findReturnedBear(game);
    expect(returnedPermanent).toBeTruthy();
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: playerId,
      tapped: false,
    });
    expect((returnedPermanent?.grantedAbilities || []).map((ability: any) => String(ability || '').toLowerCase())).toContain('haste');
    expect(String(returnedPermanent?.card?.zone || '')).toBe('battlefield');
  });

  describe('production-default IR primary', () => {
    const previousSpellPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
    const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

    beforeEach(() => {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    });

    afterEach(() => {
      if (previousSpellPrimary === undefined) {
        delete process.env.ORACLE_IR_SPELL_PRIMARY;
      } else {
        process.env.ORACLE_IR_SPELL_PRIMARY = previousSpellPrimary;
      }
      if (previousTriggerPrimary === undefined) {
        delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
      } else {
        process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
      }
    });

    it('runs with spell/trigger primary enabled (production default)', () => {
      expect(isOracleIrSpellPrimaryEnabled()).toBe(true);
    });

    it('returns the target with haste, schedules delayed exile, and exiles it if it leaves early', async () => {
      const game = seedWhipGame(gameId, playerId);

      const emitted: Array<{ room?: string; event: string; payload: any }> = [];
      const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
      const io = createMockIo(emitted, [socket]);

      registerResolutionHandlers(io as any, socket as any);
      registerInteractionHandlers(io as any, socket as any);

      await activateWhipAndResolveTarget(game, gameId, playerId, handlers);

      const zones = (game.state as any).zones?.[playerId];
      expect((zones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual([]);
      expect(zones?.graveyardCount).toBe(0);

      const returnedPermanent = findReturnedBear(game);
      expect(returnedPermanent).toBeTruthy();
      expect(returnedPermanent).toMatchObject({
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
      });
      expect(String(returnedPermanent?.card?.zone || '')).toBe('battlefield');
      expect((returnedPermanent?.grantedAbilities || []).map((ability: any) => String(ability || '').toLowerCase())).toContain('haste');

      const leaveReplacement =
        String(returnedPermanent?.leaveBattlefieldReplacementDestination || returnedPermanent?.leaveBattlefieldReplacement || '');
      expect(leaveReplacement).toBe('exile');
      expect(String(returnedPermanent?.card?.leaveBattlefieldReplacementDestination || returnedPermanent?.card?.leaveBattlefieldReplacement || '')).toBe('exile');

      expect(((game.state as any).pendingExileAtNextEndStep || []) as any[]).toEqual(expect.arrayContaining([
        {
          permanentId: String(returnedPermanent?.id || ''),
          fireAtTurnNumber: 5,
          sourceName: 'Whip of Erebos',
          createdBy: playerId,
        },
      ]));
      expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

      expect(movePermanentToHand(game as any, String(returnedPermanent?.id || ''))).toBe(true);
      expect(((game.state as any).battlefield || []).find((perm: any) => String(perm?.id || '') === String(returnedPermanent?.id || ''))).toBeUndefined();
      expect(zones?.handCount).toBe(0);
      expect((zones?.hand || []).map((card: any) => String(card?.id || ''))).toEqual([]);
      expect((zones?.exile || []).map((card: any) => String(card?.id || ''))).toContain(GY_BEAR.id);
    });
  });
});

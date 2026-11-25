import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { nextStep } from '../src/state/modules/turn.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import {
  detectBeginningOfCombatTriggers,
  getAttackTriggersForCreatures,
} from '../src/state/modules/triggers/combat.js';
import { enqueueSupportedExertChoiceSteps } from '../src/socket/combat-handlers/combatDeclareAttackersForceTapSupport.js';
import { handleManaColorSelectionResponse } from '../src/socket/resolution-handlers/manaColorSelectionResponseHandlers.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';

const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

const QUARTERMASTER_EFFECT =
  "add one mana of any color. Until end of turn, you don't lose this mana as steps and phases end.";
const WORF_EFFECT =
  'exile the top X cards of your library, where X is the number of opponents you attacked this turn. Until the end of your next turn, you may play those cards.';
const CELEBRANT_ORACLE =
  "If this creature hasn't been exerted this turn, you may exert it as it attacks. When you do, untap all other creatures you control and after this phase, there is an additional combat phase.";
const WORF_ORACLE =
  'When Worf enters, create a 2/1 red Klingon Warrior creature token with haste.\nBattlefront — Whenever you attack, exile the top X cards of your library, where X is the number of opponents you attacked this turn. Until the end of your next turn, you may play those cards.';

const io = { to: () => ({ emit: () => undefined }), emit: () => undefined, sockets: { sockets: new Map() } } as any;

describe('Worf precon attack issues', () => {
  beforeAll(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await initDb();
  });

  afterAll(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
  });

  it("asks for a mana color when Qo'noS Quartermaster attacks and keeps that mana until end of turn", async () => {
    const gameId = 'qonos_quartermaster_mana_color';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    (game as any).gameId = gameId;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    const state = game.state as any;
    state.turnPlayer = p1;
    state.phase = 'combat';
    state.step = 'END_COMBAT';
    state.priority = p1;
    state.manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    state.battlefield = [{
      id: 'qm_1',
      controller: p1,
      owner: p1,
      tapped: false,
      summoningSickness: false,
      card: {
        name: "Qo'noS Quartermaster",
        type_line: 'Creature — Klingon',
        oracle_text: `Menace.\nWhenever this creature attacks, ${QUARTERMASTER_EFFECT}`,
      },
    }];
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(game as any, p1, "Qo'noS Quartermaster", QUARTERMASTER_EFFECT, {
      type: 'triggered_ability',
      controller: p1,
      source: 'qm_1',
      permanentId: 'qm_1',
      sourceName: "Qo'noS Quartermaster",
      id: 'qm_trigger',
    });

    expect(state.manaPool[p1].white).toBe(0);
    expect(state.manaPool[p1].red).toBe(0);
    const manaStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MANA_COLOR_SELECTION) as any;
    expect(manaStep).toBeTruthy();
    expect(manaStep.allowedColors).toEqual(['W', 'U', 'B', 'R', 'G']);
    expect(String(manaStep.oracleIrResumeStepsJson || '')).toContain('retain_mana');

    await handleManaColorSelectionResponse(io, game, gameId, manaStep, {
      stepId: String(manaStep.id),
      playerId: p1,
      selections: 'red',
      cancelled: false,
      timestamp: Date.now(),
    });

    expect(state.manaPool[p1].red).toBe(1);
    expect(state.manaPool[p1].white).toBe(0);
    expect(state.temporaryRetainedMana?.[p1]?.untilEndTurn?.red).toBe(1);
    expect(state.battlefield[0].tapped).toBe(false);

    nextStep({ state, inactive: new Set<string>(), bumpSeq: () => undefined } as any);
    expect(state.phase).toBe('postcombatMain');
    expect(state.manaPool[p1].red).toBe(1);

    const saved = getEvents(gameId).filter((event: any) => event.type === 'activateManaAbility');
    expect(saved.length).toBeGreaterThan(0);
    const replay = createInitialGameState(`${gameId}_replay`);
    const replayState = replay.state as any;
    replay.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    replayState.battlefield = [{
      id: 'qm_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: { name: "Qo'noS Quartermaster", type_line: 'Creature — Klingon', oracle_text: '' },
    }];
    replayState.manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    replay.replay!(saved.map((event: any) => ({ type: event.type, ...(event.payload || {}) })) as any);
    expect(replayState.manaPool[p1].red).toBe(1);
    expect(replayState.temporaryRetainedMana?.[p1]?.untilEndTurn?.red).toBe(1);
    expect(replayState.battlefield[0].tapped).toBe(false);
    deleteGame(gameId);
  });

  it('exiles a Battlefront impulse for each opponent attacked and keeps it through your next turn', () => {
    const gameId = 'worf_battlefront_impulse';
    const game = createInitialGameState(gameId);
    const ids = ['p1', 'p2', 'p3', 'p4'] as PlayerID[];
    (game as any).gameId = gameId;
    for (const id of ids) game.applyEvent!({ type: 'join', playerId: id, name: id } as any);
    const state = game.state as any;
    state.turnNumber = 10;
    state.turnPlayer = 'p1';
    state.turnOrder = [...ids];
    state.attackedPlayersThisTurnByPlayer = { p1: ['p2', 'p3'] };
    const library = [
      { id: 'lib_a', name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.', zone: 'library' },
      { id: 'lib_b', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', zone: 'library' },
      { id: 'lib_c', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', zone: 'library' },
    ];
    state.zones = state.zones || {};
    state.zones.p1 = { ...(state.zones.p1 || {}), library: library.map((card) => ({ ...card })), exile: [] };
    const p1 = state.players.find((player: any) => player.id === 'p1');
    p1.library = library.map((card) => ({ ...card }));
    game.libraries.set('p1' as PlayerID, library.map((card) => ({ ...card })));
    state.battlefield = [{
      id: 'worf_1',
      controller: 'p1',
      owner: 'p1',
      card: { name: 'Worf, Defiant Commander', type_line: 'Legendary Creature — Klingon Warrior', oracle_text: WORF_ORACLE },
    }];

    const attacker = {
      id: 'bear_1',
      controller: 'p1',
      attacking: 'p2',
      card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
    };
    state.battlefield.push(attacker);
    const queued = getAttackTriggersForCreatures(
      { state, bumpSeq: () => undefined } as any,
      [attacker],
      'p1',
      'p2',
    );
    const worf = queued.find((trigger: any) => trigger.cardName === 'Worf, Defiant Commander');
    expect(worf).toBeTruthy();
    expect(worf?.mandatory).toBe(true);

    executeTriggerEffect(game as any, 'p1' as PlayerID, 'Worf, Defiant Commander', WORF_EFFECT, {
      type: 'triggered_ability',
      controller: 'p1',
      source: 'worf_1',
      permanentId: 'worf_1',
      sourceName: 'Worf, Defiant Commander',
      mandatory: true,
      id: 'worf_trigger',
    });

    const exile = state.zones.p1.exile as any[];
    expect(exile.map((card) => card.id).sort()).toEqual(['lib_a', 'lib_b']);
    expect(exile.every((card) => card.playableUntilTurn === 14)).toBe(true);
    expect(state.playableFromExile?.p1?.lib_a).toBe(14);
  });

  it('does not offer Combat Celebrant exert unless that creature is actually attacking', () => {
    const card = {
      name: 'Combat Celebrant',
      type_line: 'Creature — Human Warrior',
      oracle_text: CELEBRANT_ORACLE,
    };
    const sick = {
      id: 'celebrant_1',
      controller: 'p1',
      owner: 'p1',
      summoningSickness: true,
      tapped: false,
      card,
    };
    const beginning = detectBeginningOfCombatTriggers(card, sick, { turnPlayer: 'p1' });
    expect(beginning).toEqual([]);

    const bear = {
      id: 'bear_1',
      controller: 'p1',
      attacking: 'p2',
      card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const queued = getAttackTriggersForCreatures(
      { state: { battlefield: [sick, bear], players: [{ id: 'p1' }, { id: 'p2' }] }, bumpSeq: () => undefined } as any,
      [bear],
      'p1',
      'p2',
    );
    expect(queued.some((trigger: any) => trigger.cardName === 'Combat Celebrant')).toBe(false);

    const gameId = 'celebrant_exert_only_when_attacking';
    ResolutionQueueManager.removeQueue(gameId);
    enqueueSupportedExertChoiceSteps(gameId, [sick], 'p1', ['celebrant_1']);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as PlayerID)).toEqual([]);

    const ready = { ...sick, id: 'celebrant_ready', summoningSickness: false, enteredThisTurn: false };
    enqueueSupportedExertChoiceSteps(gameId, [ready], 'p1', ['celebrant_ready']);
    const choice = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as PlayerID)
      .find((step: any) => step.exertChoice === true);
    expect(choice).toBeTruthy();
    expect(String((choice as any)?.sourceId || '')).toBe('celebrant_ready');
  });
});

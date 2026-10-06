/**
 * Jace, Multiverse Architect combat trigger: "they may pay {2}. If they don't, creatures they
 * control can't attack Jaces you control this turn." Declining stamps a this-turn attack
 * restriction that attack legality enforces; paying does not.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { handleDeclareAttackers } from '../src/socket/combat-handlers/combatDeclareAttackersRequest.js';
import { collectThisTurnAttackProhibition } from '../src/state/modules/attackProhibitedThisTurn.js';
import { games } from '../src/socket/socket.js';

const TRIGGER_TEXT = "they may pay {2}. If they don't, creatures they control can't attack Jaces you control this turn.";
const JACE_TEXT = `At the beginning of combat on each opponent's turn, ${TRIGGER_TEXT}`;
const p1 = 'p1' as any;
const p2 = 'p2' as any;

function setup(gameId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game: any = ensureGame(gameId);
  const s = game.state;
  s.players = [{ id: p1, name: 'P1', spectator: false, life: 40 }, { id: p2, name: 'P2', spectator: false, life: 40 }];
  s.turnNumber = 6; s.turn = 6;
  s.turnPlayer = p2; s.activePlayer = p2; s.priority = p2; s.phase = 'combat'; s.step = 'BEGIN_COMBAT';
  s.manaPool = { [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 } };
  s.battlefield = [
    { id: 'jace', controller: p1, owner: p1, tapped: false, counters: { loyalty: 5 }, loyalty: 5,
      card: { id: 'jace_card', name: 'Jace, Multiverse Architect', type_line: 'Legendary Planeswalker \u2014 Jace', oracle_text: JACE_TEXT } },
    { id: 'p1_walker', controller: p1, owner: p1, tapped: false, counters: { loyalty: 3 }, loyalty: 3,
      card: { id: 'p1_walker_card', name: 'Ajani Goldmane', type_line: 'Legendary Planeswalker \u2014 Ajani', oracle_text: '' } },
    { id: 'bear', controller: p2, owner: p2, tapped: false, counters: {}, summoningSick: false, enteredThisTurn: false,
      card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2', oracle_text: '' } },
  ];
  s.zones = {
    [p1]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    [p2]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
  };
  s.stack = [{
    id: 'jace_combat_trigger', type: 'triggered_ability', controller: p1, source: 'jace', sourceName: 'Jace, Multiverse Architect',
    description: TRIGGER_TEXT, effect: TRIGGER_TEXT, triggerType: 'begin_combat', mandatory: true, triggeringPlayer: p2,
  }];
  return game;
}

function answerMayPay(game: any, gameId: string, answer: 'yes' | 'no') {
  game.resolveTopOfStack();
  const steps = ResolutionQueueManager.getQueue(gameId)?.steps || [];
  const mayChoice: any = steps.find((step: any) => step.type === ResolutionStepType.OPTION_CHOICE && /may pay \{2\}/i.test(String(step.description || '')));
  expect(mayChoice?.playerId).toBe(p2);
  const completed = ResolutionQueueManager.completeStep(gameId, String(mayChoice.id), {
    stepId: String(mayChoice.id), playerId: p2, selections: [answer], cancelled: false, timestamp: Date.now(),
  } as any);
  resumeEffectProgramResolution({ game, gameId, step: completed!, response: completed!.response!, persistPrompt: true } as any);
}

async function declare(game: any, gameId: string, attackers: any[]) {
  game.state.step = 'DECLARE_ATTACKERS';
  const errors: any[] = [];
  const socket: any = {
    data: { playerId: p2, spectator: false, gameId }, rooms: new Set([gameId]),
    emit: (event: string, payload: any) => { if (event === 'error') errors.push(payload); },
  };
  const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s0', socket]]) } };
  await handleDeclareAttackers(io, socket, { gameId, attackers });
  return errors;
}

describe('Jace, Multiverse Architect: decline-to-pay attack restriction', () => {
  const prevPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  const ids: string[] = [];
  async function reset(id: string) { ResolutionQueueManager.removeQueue(id); games.delete(id as any); await deleteGame(id); }

  beforeAll(async () => { await initDb(); });
  afterEach(async () => {
    if (prevPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = prevPrimary;
    for (const id of ids.splice(0)) await reset(id);
  });

  it('declining stops their creatures from attacking Jaces this turn, but not other targets', async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 'jace_restriction_decline';
    ids.push(gameId); await reset(gameId);
    const game = setup(gameId);

    answerMayPay(game, gameId, 'no');

    const stamps = (game.state.lastingEffects || []).filter((e: any) => e.type === 'attackProhibitedThisTurn');
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toMatchObject({ attackerController: p2, protectedController: p1, protectsPlayer: false, protectedPermanentTypes: ['jace'], duration: 'this_turn' });
    expect(game.state.manaPool[p2].colorless).toBe(3);

    const bear = game.state.battlefield.find((perm: any) => perm.id === 'bear');
    expect(collectThisTurnAttackProhibition(game.state, bear, { targetPermanentId: 'jace' })).toBe('Jace, Multiverse Architect');
    expect(collectThisTurnAttackProhibition(game.state, bear, { targetPermanentId: 'p1_walker' })).toBeNull();
    expect(collectThisTurnAttackProhibition(game.state, bear, { targetPlayerId: p1 })).toBeNull();
    expect(collectThisTurnAttackProhibition({ ...game.state, turnNumber: 7, turn: 7 }, bear, { targetPermanentId: 'jace' })).toBeNull();

    const errors = await declare(game, gameId, [{ creatureId: 'bear', targetPermanentId: 'jace' }]);
    expect(errors.map((e) => e.code)).toContain('ATTACK_PROHIBITED');
    expect(game.state.battlefield.find((perm: any) => perm.id === 'bear').attacking).toBeFalsy();

    const playerAttackErrors = await declare(game, gameId, [{ creatureId: 'bear', targetPlayerId: p1 }]);
    expect(playerAttackErrors.map((e) => e.code)).not.toContain('ATTACK_PROHIBITED');
  });

  it('paying {2} leaves attacks on Jace legal', async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 'jace_restriction_pay';
    ids.push(gameId); await reset(gameId);
    const game = setup(gameId);

    answerMayPay(game, gameId, 'yes');

    expect(game.state.manaPool[p2].colorless).toBe(1);
    expect((game.state.lastingEffects || []).some((e: any) => e.type === 'attackProhibitedThisTurn')).toBe(false);
    const bear = game.state.battlefield.find((perm: any) => perm.id === 'bear');
    expect(collectThisTurnAttackProhibition(game.state, bear, { targetPermanentId: 'jace' })).toBeNull();
  });
});
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resetIntegrationGame } from './helpers/integrationGameReset.js';
import { consumeDelayedSpellCopiesForCast } from '../src/socket/game-actions-handlers/gameActionsSpellCopyHeroicTriggers.js';
import { applyNextCastRiders, buildNextCastEntries } from '../src/state/modules/nextCastDelayedRiders.js';
import { isTriggerEffectOwnedByOracleIrPrimary, isCostGatedNextCastRiderText } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import '../src/state/modules/priority.js';

const noopIo: any = { to: () => ({ emit: () => {} }), emit: () => {} };
const NAJAL_EFFECT = 'you may pay {2}. If you do, when you next cast an instant or sorcery spell this turn, copy it. You may choose new targets for the copy.';
const THUNDERCLAP = "When you next cast an instant or sorcery spell this turn, copy it for each time you've cast your commander from the command zone this game. You may choose new targets for the copies.";

function socketFor(playerId: string) {
  const handlers: Record<string, Function> = {};
  const socket: any = { data: { playerId, spectator: false }, rooms: new Set<string>(), on: (e: string, h: Function) => { handlers[e] = h; }, emit: () => {} };
  return { socket, handlers };
}

describe('round 24 next-cast riders', () => {
  const gameId = 'test_round24_next_cast';
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(noopIo); });
  beforeEach(async () => { await resetIntegrationGame(gameId); });
  afterEach(async () => { await resetIntegrationGame(gameId); });

  it('Thunderclap Drake copies once per commander cast from the command zone', () => {
    const ctx: any = { state: { commandZone: { p1: { taxById: { cmdr: 4 } } } } };
    expect(applyNextCastRiders(ctx, THUNDERCLAP, { controllerId: 'p1', sourceName: 'Thunderclap Drake', originId: 'tc1' })).toBe(2);
    expect(ctx.state.delayedSpellCopiesThisTurn).toHaveLength(2);
    expect(buildNextCastEntries(THUNDERCLAP, { controllerId: 'p1', sourceName: 'Thunderclap Drake', commanderCastCount: 0 } as any)).toHaveLength(0);
  });

  it('records a pushTriggeredAbility replay event for next-cast effect entries', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game: any = ensureGame(gameId);
    game.state.players = [{ id: 'p1', name: 'P1', life: 40 }];
    const spell = { id: 'spell_card_1', name: 'Shock', type_line: 'Instant', cmc: 1 };
    game.state.stack = [{ id: 'stk_shock', type: 'spell', controller: 'p1', card: spell }];
    game.state.delayedSpellCopiesThisTurn = [{ controllerId: 'p1', sourceName: 'Src', spellType: 'any', effect: 'put X +1/+1 counters on up to one target creature, where X is the mana value of that spell', originId: 'o1' }];
    consumeDelayedSpellCopiesForCast(gameId, game, noopIo, 'p1', spell, 'stk_shock');
    const ev = [...getEvents(gameId)].reverse().find((e: any) => e.type === 'pushTriggeredAbility') as any;
    expect(ev?.payload?.triggeringStackItemId).toBe('stk_shock');
    expect(String(ev?.payload?.sourceName)).toBe('Src');
    expect(game.state.stack.some((s: any) => s.id === ev.payload.triggerId)).toBe(true);
  });

  it('Najal is not IR-owned and copies only after paying', async () => {
    expect(isCostGatedNextCastRiderText(NAJAL_EFFECT)).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary(NAJAL_EFFECT, 'Najal, the Storm Runner')).toBe(false);
    createGameIfNotExists(gameId, 'commander', 40);
    const game: any = ensureGame(gameId);
    game.state.players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    game.state.turnPlayer = 'p1'; game.state.priority = 'p1';
    const island = (id: string) => ({ id, controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { id: id + 'c', name: 'Island', type_line: 'Basic Land \u2014 Island', oracle_text: '({T}: Add {U}.)' } });
    game.state.battlefield = [
      { id: 'najal', controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { id: 'najalc', name: 'Najal, the Storm Runner', type_line: 'Legendary Creature \u2014 Djinn Wizard', oracle_text: 'Whenever Najal attacks, ' + NAJAL_EFFECT } },
      island('i1'), island('i2'),
    ];
    game.state.manaPool = { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
    game.state.stack = [{ id: 'trig_najal', type: 'triggered_ability', controller: 'p1', source: 'najal', sourceName: 'Najal, the Storm Runner', description: NAJAL_EFFECT, effect: NAJAL_EFFECT, triggerType: 'attacks', mandatory: false }];
    game.resolveTopOfStack();
    expect(game.state.delayedSpellCopiesThisTurn || []).toHaveLength(0);
    const step: any = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.triggeredAbilityManaPaymentChoice && s?.triggerStackItemId === 'trig_najal');
    expect(step).toBeTruthy();
    const { socket, handlers } = socketFor('p1');
    socket.rooms.add(gameId);
    const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s0', socket]]) } };
    registerResolutionHandlers(io, socket); registerInteractionHandlers(io, socket);
    await handlers.submitResolutionResponse({ gameId, stepId: step.id, selections: ['pay_mana'] });
    const list = game.state.delayedSpellCopiesThisTurn || (game as any).delayedSpellCopiesThisTurn || [];
    expect(list).toHaveLength(1);
    expect(list[0].allowRetargeting).toBe(true);
  });
});

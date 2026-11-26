import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { resolveTokenCharacteristicsFromOracleStep } from '../../rules-engine/src/tokenCreationDetection.js';
import { applyAddManaStep } from '../../rules-engine/src/oracleIRExecutorPlayerAddManaStep.js';
import { maxSquadPayments } from '../../client/src/components/SquadCostModal.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { getCurrentPowerToughnessForRules } from '../src/state/modules/currentPowerToughness.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond-handlers/canRespondCastableSpellCandidates.js';
import { buildCostAdjustmentPlan } from '../src/state/modules/cost-adjustments.js';
import { getAsEntersChoiceRequirements } from '../src/state/modules/asEntersChoiceRequirements.js';
import { detectCombatDamageTriggers } from '../src/state/modules/triggers/combat-damage-detection.js';
import { handleSpellPaymentChoiceResponse } from '../src/socket/resolution-handlers/manaPaymentSpellCastResponseHandlers.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';

const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

const RITE =
  'Battlefront — Whenever you attack, for each opponent you attacked this turn, create a tapped and attacking 2/1 red Klingon Warrior creature token with haste.';
const ANIMOSITY =
  'Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it.';
const GRILKA =
  'When Grilka enters, gain control of target creature an opponent controls until end of turn. Untap it. Until end of turn, it gains trample, haste, and "Whenever this creature deals combat damage to a player, create that many tapped Treasure tokens."';
const BEACON =
  '{T}: Add one mana of any color.\nBattlefront — {T}: Choose a color. Add an amount of mana of that color equal to the number of opponents you attacked this turn.';
const WORF_EFFECT =
  'exile the top X cards of your library, where X is the number of opponents you attacked this turn. Until the end of your next turn, you may play those cards.';
const VANQUISH =
  'This spell costs {1} less to cast for each creature on the battlefield.\nDestroy all creatures.';

describe('reported test-game issues', () => {
  beforeAll(async () => {
    await initDb();
  });

  // vitest.setup beforeEach forces PRIMARY=0 after file beforeAll, so opt in here.
  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  afterAll(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
  });

  it('creates a tapped and attacking 2/1 Klingon Warrior for Rite of Ascension', () => {
    const ir = parseOracleTextToIR(RITE, 'Rite of Ascension');
    const step = ir.abilities.flatMap((ability) => ability.steps).find((entry) => entry.kind === 'create_token') as any;
    expect(step?.token).toBe('2/1 red Klingon Warrior');
    expect(step?.entersTapped).toBe(true);
    expect(step?.attacking).toBe('defending_player');
    const chars = resolveTokenCharacteristicsFromOracleStep(String(step.token), String(step.raw));
    expect(chars).toMatchObject({
      name: 'Klingon Warrior',
      power: 2,
      toughness: 1,
      colors: ['R'],
    });
    expect(chars?.abilities?.some((ability) => /haste/i.test(ability))).toBe(true);

    const game = createInitialGameState('rite_token');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    const state = game.state as any;
    state.attackedPlayersThisTurnByPlayer = { p1: [p2] };
    state.battlefield = [{
      id: 'rite_1',
      controller: p1,
      owner: p1,
      card: { name: 'Rite of Ascension', type_line: 'Enchantment', oracle_text: RITE },
    }];
    executeTriggerEffect(game as any, p1, 'Rite of Ascension', RITE.replace(/^Battlefront — Whenever you attack,\s*/i, ''), {
      type: 'triggered_ability',
      controller: p1,
      source: 'rite_1',
      permanentId: 'rite_1',
      sourceName: 'Rite of Ascension',
      id: 'rite_trigger',
    });
    const token = (state.battlefield as any[]).find((perm) => /klingon warrior/i.test(String(perm?.card?.name || perm?.name || '')));
    expect((state.battlefield as any[]).map((perm) => perm?.card?.name || perm?.name)).toEqual(['Rite of Ascension', 'Klingon Warrior']);
    expect(token).toBeTruthy();
    expect(Number(token.basePower ?? token.power ?? token.card?.power)).toBe(2);
    expect(Number(token.baseToughness ?? token.toughness ?? token.card?.toughness)).toBe(1);
    expect(token.tapped).toBe(true);
    expect(Boolean(token.attacking)).toBe(true);
  });

  it('pumps each attacker for other attacking creatures that share a creature type', () => {
    const game = createInitialGameState('shared_animosity');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    const warrior = (id: string) => ({
      id,
      controller: p1,
      owner: p1,
      attacking: 'p2',
      basePower: 2,
      baseToughness: 1,
      card: { name: 'Klingon Warrior', type_line: 'Creature — Klingon Warrior', oracle_text: 'Haste', power: '2', toughness: '1' },
    });
    const bear = {
      id: 'bear',
      controller: p1,
      owner: p1,
      attacking: 'p2',
      basePower: 2,
      baseToughness: 2,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' },
    };
    const state = game.state as any;
    state.battlefield = [
      warrior('w1'),
      warrior('w2'),
      bear,
      {
        id: 'animosity',
        controller: p1,
        owner: p1,
        card: { name: 'Shared Animosity', type_line: 'Enchantment', oracle_text: ANIMOSITY },
      },
    ];
    const effect = ANIMOSITY.replace(/^Whenever a creature you control attacks,\s*/i, '');
    const run = (attackingCreatureId: string) => {
      executeTriggerEffect(game as any, p1, 'Shared Animosity', effect, {
        type: 'triggered_ability',
        controller: p1,
        source: 'animosity',
        permanentId: 'animosity',
        sourceName: 'Shared Animosity',
        id: `animosity_${attackingCreatureId}`,
        effect,
        effectData: { attackingCreatureId },
      });
    };
    run('w1');
    run('w2');
    run('bear');
    const powerOf = (id: string) => getCurrentPowerToughnessForRules(
      state.battlefield.find((perm: any) => perm.id === id),
      state,
    ).power;
    expect(powerOf('w1')).toBe(3);
    expect(powerOf('w2')).toBe(3);
    expect(powerOf('bear')).toBe(2);
  });

  it('grants Grilka\'s haste, trample, and treasure trigger to the stolen creature', () => {
    const effect = GRILKA.replace(/^When Grilka enters,\s*/i, '');
    const game = createInitialGameState('grilka_steal');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    const grilka = {
      id: 'grilka',
      controller: p1,
      owner: p1,
      tapped: false,
      card: { name: 'Grilka, Widowed Warrior', type_line: 'Legendary Creature — Klingon Warrior', oracle_text: GRILKA, power: '4', toughness: '3' },
    };
    const stolen = {
      id: 'opp_bear',
      controller: p2,
      owner: p2,
      tapped: true,
      summoningSickness: false,
      basePower: 2,
      baseToughness: 2,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' },
    };
    (game.state as any).battlefield = [grilka, stolen];
    executeTriggerEffect(game as any, p1, 'Grilka, Widowed Warrior', effect, {
      type: 'triggered_ability',
      controller: p1,
      source: 'grilka',
      permanentId: 'grilka',
      sourceName: 'Grilka, Widowed Warrior',
      id: 'grilka_etb',
      targets: ['opp_bear'],
      card: grilka.card,
    });
    const state = game.state as any;
    const bear = state.battlefield.find((perm: any) => perm.id === 'opp_bear');
    const grilkaAfter = state.battlefield.find((perm: any) => perm.id === 'grilka');
    expect(bear.controller).toBe(p1);
    expect(bear.tapped).toBe(false);
    const grantedText = [
      ...(bear.grantedAbilities || []),
      ...((bear.untilEndOfTurn?.grantedAbilitiesToRemove) || []),
      ...((bear.temporaryEffects || []).map((entry: any) => entry.description)),
    ].join(' ').toLowerCase();
    expect(grantedText).toMatch(/trample/);
    expect(grantedText).toMatch(/haste/);
    expect(grantedText).toMatch(/treasure/);
    const grilkaText = [
      ...(grilkaAfter.grantedAbilities || []),
      ...((grilkaAfter.temporaryEffects || []).map((entry: any) => entry.description)),
    ].join(' ').toLowerCase();
    expect(grilkaText).not.toMatch(/treasure/);
    const onBear = detectCombatDamageTriggers(bear.card, bear, state);
    expect(onBear.some((trigger) => /treasure/i.test(String(trigger.effect || '')))).toBe(true);
    const onGrilka = detectCombatDamageTriggers(grilkaAfter.card, grilkaAfter, state);
    expect(onGrilka.some((trigger) => /treasure/i.test(String(trigger.effect || '')))).toBe(false);
  });

  it('chooses a color for The Beacon of Kahless only when the second ability is activated', () => {
    expect(getAsEntersChoiceRequirements({ name: 'The Beacon of Kahless', oracle_text: BEACON })).toEqual([]);
    const ir = parseOracleTextToIR(BEACON, 'The Beacon of Kahless');
    const activated = ir.abilities.find((ability) => /choose a color/i.test(String(ability.text || '')));
    expect(activated?.type).toBe('activated');
    const addMana = activated?.steps.find((step) => step.kind === 'add_mana');
    expect(addMana).toBeTruthy();
    const game = createInitialGameState('beacon_mana');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    const state = game.state as any;
    state.attackedPlayersThisTurnByPlayer = { p1: [p2] };
    state.manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
    const result = applyAddManaStep(state, addMana as any, {
      controllerId: p1,
      sourceId: 'beacon',
      sourceName: 'The Beacon of Kahless',
      selectorContext: { chosenMana: '{R}' },
    } as any);
    expect(result.applied).toBe(true);
    expect((result.state as any).manaPool[p1].red).toBe(1);
    expect((result.state as any).manaPool[p1].white).toBe(0);
  });

  it('lets Vanquish the Horde be cast for the creature-reduced cost', () => {
    const card = {
      id: 'vanquish',
      name: 'Vanquish the Horde',
      type_line: 'Sorcery',
      mana_cost: '{6}{W}{W}',
      oracle_text: VANQUISH,
    };
    const creatures = Array.from({ length: 12 }, (_, index) => ({
      id: `c${index}`,
      controller: 'p1',
      card: { name: 'Soldier', type_line: 'Creature — Soldier', oracle_text: '' },
    }));
    const plains = Array.from({ length: 2 }, (_, index) => ({
      id: `plain-${index}`,
      controller: 'p1',
      tapped: false,
      card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '{T}: Add {W}.' },
    }));
    const ctx = {
      state: {
        priority: 'p1',
        turnPlayer: 'p1',
        phase: 'MAIN1',
        step: 'MAIN',
        stack: [],
        players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
        zones: { p1: { hand: [card], graveyard: [], exile: [], library: [] } },
        manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
        battlefield: [...creatures, ...plains],
      },
    } as any;
    const reduced = buildCostAdjustmentPlan(ctx.state, 'p1', card);
    expect(reduced.genericAdjustment).toBe(-12);
    const filtered = buildCostAdjustmentPlan(ctx.state, 'p1', card, { sourceTypes: ['battlefield'] });
    expect(filtered.genericAdjustment).toBe(0);
    const castable = getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' });
    expect(castable.some((candidate) => candidate.card?.name === 'Vanquish the Horde')).toBe(true);
    const fullCost = getCastableSpellCandidates({
      state: { ...ctx.state, battlefield: plains },
    } as any, 'p1' as PlayerID, { mode: 'main' });
    expect(fullCost.some((candidate) => candidate.card?.name === 'Vanquish the Horde')).toBe(false);
  });

  it('counts lands and Treasures toward Squad and forgets a cancelled squad choice', async () => {
    expect(maxSquadPayments(
      { white: 6, blue: 0, black: 0, red: 0, green: 0, colorless: 10 },
      { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    )).toBeGreaterThan(0);

    const gameId = 'squad_cancel_forgets_choice';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [{
          id: 'hull',
          name: 'Imperial Hullbreachers',
          squadTimesPaid: 0,
          additionalCostPaid: true,
          additionalCostMethod: 'squad',
        }],
        handCount: 1,
      },
    };
    const io = { to: () => ({ emit: () => undefined }), emit: () => undefined } as any;
    await handleSpellPaymentChoiceResponse(
      io,
      game,
      gameId,
      {
        id: 'pay1',
        type: 'mana_payment_choice',
        playerId: p1,
        cardId: 'hull',
        cardName: 'Imperial Hullbreachers',
        effectId: 'eff1',
        fromZone: 'hand',
      } as any,
      { playerId: p1, cancelled: true, selections: {} } as any,
      {
        restoreLibrarySearchStep: () => undefined,
        resumePlayerSpellCastAfterPayment: async () => false,
        emitNextPendingResolutionStep: () => undefined,
      },
    );
    const card = (game.state as any).zones[p1].hand[0];
    expect(card.squadTimesPaid).toBeUndefined();
    expect(card.additionalCostPaid).toBeUndefined();
    expect(card.additionalCostMethod).toBeUndefined();
    games.delete(gameId as any);
    await deleteGame(gameId);
  });

  it('records opponents attacked on the live declare path before Worf exiles', async () => {
    const gameId = `worf_live_declare_${Date.now()}`;
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'declareAttackers';
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    const library = [
      { id: 'lib_a', name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.' },
      { id: 'lib_b', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], library: library.map((card) => ({ ...card })), handCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0 },
    };
    const p1Player = ((game.state as any).players as any[]).find((player) => player.id === p1);
    p1Player.library = library.map((card) => ({ ...card }));
    game.libraries.set(p1 as PlayerID, library.map((card) => ({ ...card })));
    (game.state as any).battlefield = [
      {
        id: 'worf',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Worf, Defiant Commander',
          type_line: 'Legendary Creature — Klingon Warrior',
          oracle_text: 'Battlefront — Whenever you attack, exile the top X cards of your library, where X is the number of opponents you attacked this turn. Until the end of your next turn, you may play those cards.',
        },
      },
      {
        id: 'goaded',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        goaded: true,
        card: { name: 'Klingon Warrior', type_line: 'Creature — Klingon Warrior', oracle_text: 'Haste' },
      },
    ];
    const emitted: Array<{ event: string; payload: any }> = [];
    const handlers: Record<string, Function> = {};
    const socket = {
      data: { playerId: p1, spectator: false, gameId },
      rooms: new Set([gameId]),
      on: (event: string, handler: Function) => { handlers[event] = handler; },
      emit: (event: string, payload: any) => emitted.push({ event, payload }),
    };
    const io = {
      to: () => ({ emit: () => undefined }),
      emit: () => undefined,
      sockets: { sockets: new Map([['s', socket]]) },
    };
    registerCombatHandlers(io as any, socket as any);
    await handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'goaded', targetPlayerId: p2 }],
    });
    expect((game.state as any).attackedPlayersThisTurnByPlayer[p1]).toContain(p2);
    executeTriggerEffect(game as any, p1 as PlayerID, 'Worf, Defiant Commander', WORF_EFFECT, {
      type: 'triggered_ability',
      controller: p1,
      source: 'worf',
      permanentId: 'worf',
      sourceName: 'Worf, Defiant Commander',
      id: 'worf_live',
    });
    const exile = ((game.state as any).zones[p1].exile || []) as any[];
    expect(exile).toHaveLength(1);
    games.delete(gameId as any);
    await deleteGame(gameId);
  });
});

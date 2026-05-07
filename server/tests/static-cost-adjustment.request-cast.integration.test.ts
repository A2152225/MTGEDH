import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
    rooms: new Set<string>(),
    on: (eventName: string, handler: Function) => {
      handlers[eventName] = handler;
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

function setupStaticCostAdjustmentCastScenario(options: {
  gameId: string;
  spellCard: any;
  battlefield?: any[];
  emblems?: any[];
  activePlane?: any;
  activeSchemes?: any[];
}) {
  const p1 = 'p1';

  createGameIfNotExists(options.gameId, 'commander', 40, undefined, p1);
  const game = ensureGame(options.gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [p1]: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).turnPlayer = p1;
  (game.state as any).priority = p1;
  (game.state as any).battlefield = Array.isArray(options.battlefield) ? options.battlefield : [];
  (game.state as any).emblems = Array.isArray(options.emblems) ? options.emblems : [];
  (game.state as any).activePlane = options.activePlane;
  (game.state as any).activeSchemes = Array.isArray(options.activeSchemes) ? options.activeSchemes : [];
  (game.state as any).zones = {
    [p1]: {
      hand: [options.spellCard],
      handCount: 1,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };

  const emitted: Array<{ room?: string; event: string; payload: any }> = [];
  const { socket, handlers } = createMockSocket({ playerId: p1, gameId: options.gameId }, emitted);
  socket.rooms.add(options.gameId);
  const io = createNoopIo();
  (io as any).emit = (event: string, payload: any) => emitted.push({ event, payload });
  (io as any).to = (room: string) => ({
    emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
  });

  registerGameActions(io as any, socket as any);
  registerResolutionHandlers(io as any, socket as any);

  return { handlers };
}

describe('Static cost-adjustment request-cast flow (integration)', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame('test_request_cast_active_plane_colored_reduction');
    await resetGame('test_request_cast_ongoing_scheme_tax');
  });

  afterEach(async () => {
    await resetGame('test_request_cast_active_plane_colored_reduction');
    await resetGame('test_request_cast_ongoing_scheme_tax');
  });

  it('reduces a red spell by a colored mana symbol when the active plane is the only source', async () => {
    const gameId = 'test_request_cast_active_plane_colored_reduction';
    const { handlers } = setupStaticCostAdjustmentCastScenario({
      gameId,
      activePlane: {
        id: 'feeding_grounds_plane',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast. Green spells cost {G} less to cast.',
      },
      spellCard: {
        id: 'raging_goblin_1',
        name: 'Raging Goblin',
        mana_cost: '{R}',
        manaCost: '{R}',
        type_line: 'Creature — Goblin Berserker',
        oracle_text: 'Haste',
        image_uris: { small: 'https://example.com/raging-goblin.jpg' },
      },
    });

    await handlers.requestCastSpell({ gameId, cardId: 'raging_goblin_1' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);

    const paymentStep = queue.steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.cardName).toBe('Raging Goblin');
    expect(paymentStep.manaCost).toBe('{0}');
    expect(paymentStep.costAdjustment).toMatchObject({
      originalManaCost: '{R}',
      adjustedManaCost: '{0}',
      coloredReductions: { red: 1 },
      kind: 'reduction',
    });
    expect(paymentStep.costAdjustment?.reductionMessages).toContain('Feeding Grounds: -{R}');
  });

  it('adds an ongoing scheme tax to the queued mana payment step', async () => {
    const gameId = 'test_request_cast_ongoing_scheme_tax';
    const { handlers } = setupStaticCostAdjustmentCastScenario({
      gameId,
      activeSchemes: [
        {
          id: 'scheme_tax',
          name: 'The Very Soil Shall Shake',
          oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nSpells cost {1} more to cast.\nAt the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.",
        },
      ],
      spellCard: {
        id: 'raging_goblin_2',
        name: 'Raging Goblin',
        mana_cost: '{R}',
        manaCost: '{R}',
        type_line: 'Creature — Goblin Berserker',
        oracle_text: 'Haste',
        image_uris: { small: 'https://example.com/raging-goblin.jpg' },
      },
    });

    await handlers.requestCastSpell({ gameId, cardId: 'raging_goblin_2' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);

    const paymentStep = queue.steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.cardName).toBe('Raging Goblin');
    expect(paymentStep.manaCost).toBe('{1}{R}');
    expect(paymentStep.costAdjustment).toMatchObject({
      originalManaCost: '{R}',
      adjustedManaCost: '{1}{R}',
      genericTax: 1,
      kind: 'increase',
    });
    expect(paymentStep.costAdjustment?.taxMessages).toContain('The Very Soil Shall Shake: +{1}');
  });

  it('preserves non-battlefield cost adjustments on targeted pending casts before payment is queued', async () => {
    const gameId = 'test_request_cast_active_plane_colored_reduction';
    const { handlers } = setupStaticCostAdjustmentCastScenario({
      gameId,
      battlefield: [
        {
          id: 'bolt_target_creature',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            name: 'Silvercoat Lion',
            type_line: 'Creature — Cat',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
      ],
      activePlane: {
        id: 'feeding_grounds_plane',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast. Green spells cost {G} less to cast.',
      },
      activeSchemes: [
        {
          id: 'scheme_tax',
          name: 'The Very Soil Shall Shake',
          oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nSpells cost {1} more to cast.\nAt the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.",
        },
      ],
      spellCard: {
        id: 'lightning_bolt_1',
        name: 'Lightning Bolt',
        mana_cost: '{R}',
        manaCost: '{R}',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        image_uris: { small: 'https://example.com/lightning-bolt.jpg' },
      },
    });

    await handlers.requestCastSpell({ gameId, cardId: 'lightning_bolt_1' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe('target_selection');

    const game = ensureGame(gameId);
    const effectId = String((queue.steps[0] as any).sourceId || '');
    const pendingCast = (game?.state as any)?.pendingSpellCasts?.[effectId];

    expect(pendingCast).toBeTruthy();
    expect(pendingCast.externalCostTax).toBe(1);
    expect(pendingCast.costReduction).toMatchObject({
      colors: { red: 1 },
    });
    expect(pendingCast.costReduction?.messages).toContain('Feeding Grounds: -{R}');
  });

  it('queues the final mana payment step with mixed cost-adjustment metadata after target selection', async () => {
    const gameId = 'test_request_cast_active_plane_colored_reduction';
    const { handlers } = setupStaticCostAdjustmentCastScenario({
      gameId,
      battlefield: [
        {
          id: 'bolt_target_creature',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            name: 'Silvercoat Lion',
            type_line: 'Creature — Cat',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
      ],
      activePlane: {
        id: 'feeding_grounds_plane',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast. Green spells cost {G} less to cast.',
      },
      activeSchemes: [
        {
          id: 'scheme_tax',
          name: 'The Very Soil Shall Shake',
          oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nSpells cost {1} more to cast.\nAt the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.",
        },
      ],
      spellCard: {
        id: 'lightning_bolt_e2e',
        name: 'Lightning Bolt',
        mana_cost: '{R}',
        manaCost: '{R}',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        image_uris: { small: 'https://example.com/lightning-bolt.jpg' },
      },
    });

    await handlers.requestCastSpell({ gameId, cardId: 'lightning_bolt_e2e' });

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(targetStep.type).toBe('target_selection');

    const targetId = String(((targetStep.validTargets || [])[0] as any)?.id || '');
    expect(targetId).toBeTruthy();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: [targetId],
    });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.manaCost).toBe('{1}');
    expect(paymentStep.costAdjustment).toMatchObject({
      originalManaCost: '{R}',
      adjustedManaCost: '{1}',
      genericTax: 1,
      kind: 'mixed',
    });
    expect(paymentStep.costAdjustment?.reductionMessages).toContain('Feeding Grounds: -{R}');
    expect(paymentStep.costAdjustment?.taxMessages).toContain('The Very Soil Shall Shake: +{1}');
  });

  it('preserves non-battlefield cost adjustments on Aura target-selection casts from hand', async () => {
    const gameId = 'test_request_cast_ongoing_scheme_tax';
    const { handlers } = setupStaticCostAdjustmentCastScenario({
      gameId,
      battlefield: [
        {
          id: 'target_creature',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            name: 'Silvercoat Lion',
            type_line: 'Creature — Cat',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
      ],
      activePlane: {
        id: 'feeding_grounds_plane',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast. Green spells cost {G} less to cast.',
      },
      activeSchemes: [
        {
          id: 'scheme_tax',
          name: 'The Very Soil Shall Shake',
          oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nSpells cost {1} more to cast.\nAt the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.",
        },
      ],
      spellCard: {
        id: 'furor_1',
        name: 'Furor of the Bitten',
        mana_cost: '{R}',
        manaCost: '{R}',
        type_line: 'Enchantment — Aura',
        oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2 and attacks each combat if able.',
        image_uris: { small: 'https://example.com/furor.jpg' },
      },
    });

    await handlers.castSpellFromHand({ gameId, cardId: 'furor_1' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe('target_selection');

    const game = ensureGame(gameId);
    const effectId = String((queue.steps[0] as any).sourceId || '');
    const pendingCast = (game?.state as any)?.pendingSpellCasts?.[effectId];

    expect(pendingCast).toBeTruthy();
    expect(pendingCast.externalCostTax).toBe(1);
    expect(pendingCast.costReduction).toMatchObject({
      colors: { red: 1 },
    });
    expect(pendingCast.costReduction?.messages).toContain('Feeding Grounds: -{R}');
  });

  it('queues the final mana payment step with mixed cost-adjustment metadata after Aura target selection', async () => {
    const gameId = 'test_request_cast_ongoing_scheme_tax';
    const { handlers } = setupStaticCostAdjustmentCastScenario({
      gameId,
      battlefield: [
        {
          id: 'target_creature',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            name: 'Silvercoat Lion',
            type_line: 'Creature — Cat',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
      ],
      activePlane: {
        id: 'feeding_grounds_plane',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast. Green spells cost {G} less to cast.',
      },
      activeSchemes: [
        {
          id: 'scheme_tax',
          name: 'The Very Soil Shall Shake',
          oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nSpells cost {1} more to cast.\nAt the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.",
        },
      ],
      spellCard: {
        id: 'furor_e2e',
        name: 'Furor of the Bitten',
        mana_cost: '{R}',
        manaCost: '{R}',
        type_line: 'Enchantment — Aura',
        oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2 and attacks each combat if able.',
        image_uris: { small: 'https://example.com/furor.jpg' },
      },
    });

    await handlers.castSpellFromHand({ gameId, cardId: 'furor_e2e' });

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(targetStep.type).toBe('target_selection');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['target_creature'],
    });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.manaCost).toBe('{1}');
    expect(paymentStep.costAdjustment).toMatchObject({
      originalManaCost: '{R}',
      adjustedManaCost: '{1}',
      genericTax: 1,
      kind: 'mixed',
    });
    expect(paymentStep.costAdjustment?.reductionMessages).toContain('Feeding Grounds: -{R}');
    expect(paymentStep.costAdjustment?.taxMessages).toContain('The Very Soil Shall Shake: +{1}');
  });
});
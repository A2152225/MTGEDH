import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('Intervening-if upkeep triggers', () => {
  beforeEach(() => {
    // Avoid cross-test leakage (these suites interact with the Resolution Queue).
    ResolutionQueueManager.removeQueue('t_intervening_if_emeria');
    ResolutionQueueManager.removeQueue('t_intervening_if_ophiomancer');
    ResolutionQueueManager.removeQueue('t_intervening_if_upkeep_fizzle');
    ResolutionQueueManager.removeQueue('t_intervening_if_upkeep_true');
    ResolutionQueueManager.removeQueue('t_upkeep_intervening_if_that_player_handcount');
  });

  it('suppresses an opponent-upkeep trigger when "that player has two or fewer cards in hand" is false', () => {
    const g = createInitialGameState('t_upkeep_intervening_if_that_player_handcount');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Provide hand zones in state (what intervening-if reads).
    (g.state as any).zones = {
      [p1]: { hand: [] },
      [p2]: { hand: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] },
    };

    (g.state.battlefield as any).push({
      id: 'handcount_watcher_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'handcount_watcher_card',
        name: 'Handcount Watcher',
        type_line: 'Enchantment',
        oracle_text:
          "At the beginning of each opponent's upkeep, if that player has two or fewer cards in hand, you draw a card.",
      },
      tapped: false,
    });

    // It's p2's upkeep (p2 is "that player"). p2 has 3 cards => condition false => no trigger.
    const triggers = getUpkeepTriggersForPlayer(g as any, p2);
    expect(triggers.some((t) => t?.cardName === 'Handcount Watcher')).toBe(false);

    // Now p2 has 2 cards => condition true => trigger exists.
    (g.state as any).zones[p2].hand = [{ id: 'c1' }, { id: 'c2' }];
    const triggers2 = getUpkeepTriggersForPlayer(g as any, p2);
    expect(triggers2.some((t) => t?.cardName === 'Handcount Watcher')).toBe(true);
  });

  it('does not put Emeria, the Sky Ruin trigger on the stack when Plains condition is false', () => {
    const g = createInitialGameState('t_intervening_if_emeria');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Provide decks so draw step can function in other tests; not strictly needed here.
    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    // Start the game: turnPlayer becomes p2 at UNTAP.
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p2);

    // Put Emeria on the battlefield for p2.
    (g.state.battlefield as any).push({
      id: 'em_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'em_card',
        name: 'Emeria, the Sky Ruin',
        type_line: 'Land',
        oracle_text:
          'Emeria, the Sky Ruin enters tapped.\n' +
          'At the beginning of your upkeep, if you control seven or more Plains, you may return target creature card from your graveyard to the battlefield.\n' +
          '{T}: Add {W}.',
      },
      tapped: false,
    });

    // Add only 6 Plains (Emeria requires 7+ Plains).
    for (let i = 0; i < 6; i++) {
      (g.state.battlefield as any).push({
        id: `pl_${i}`,
        controller: p2,
        owner: p2,
        card: {
          id: `pl_card_${i}`,
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '{T}: Add {W}.',
        },
        tapped: false,
      });
    }

    // Advance to upkeep (enterUpkeepStep runs here).
    g.applyEvent({ type: 'nextStep' });

    const stack = (g.state.stack || []) as any[];
    const emeriaTrigger = stack.find((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Emeria, the Sky Ruin');
    expect(emeriaTrigger).toBeUndefined();
  });

  it('does not put "if you control no Snakes" each-upkeep trigger on stack when condition is false', () => {
    const g = createInitialGameState('t_intervening_if_ophiomancer');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    // Start the game: turnPlayer becomes p2 at UNTAP.
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p2);

    // Ophiomancer (triggers at beginning of each upkeep, if you control no Snakes...)
    (g.state.battlefield as any).push({
      id: 'oph_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'oph_card',
        name: 'Ophiomancer',
        type_line: 'Creature — Human Shaman',
        oracle_text:
          'At the beginning of each upkeep, if you control no Snakes, create a 1/1 black Snake creature token with deathtouch.',
      },
      tapped: false,
    });

    // Ensure p1 DOES control a Snake.
    (g.state.battlefield as any).push({
      id: 'snake_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'snake_card',
        name: 'Snake',
        type_line: 'Token Creature — Snake',
        oracle_text: 'Deathtouch',
      },
      tapped: false,
    });

    // Advance to upkeep for p2 (Ophiomancer would normally trigger here).
    g.applyEvent({ type: 'nextStep' });

    const stack = (g.state.stack || []) as any[];
    const ophiomancerTrigger = stack.find((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Ophiomancer');
    expect(ophiomancerTrigger).toBeUndefined();
  });

  it('fizzles at resolution if the intervening-if condition becomes false before resolving (upkeep sacrifice)', () => {
    const gameId = 't_intervening_if_upkeep_fizzle';
    const g = createInitialGameState(gameId);

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    // Start the game: turnPlayer becomes p2 at UNTAP.
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p2);

    // Put a synthetic upkeep trigger on the battlefield for p2.
    // The effect is something the engine *would* handle (UPKEEP_SACRIFICE step), so fizzling is observable.
    (g.state.battlefield as any).push({
      id: 'relic_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'relic_card',
        name: 'Test Relic',
        type_line: 'Artifact',
        oracle_text:
          'At the beginning of your upkeep, if you have no cards in hand, sacrifice a creature or sacrifice Test Relic.',
      },
      tapped: false,
    });

    // Ensure the condition is TRUE at trigger time (hand empty).
    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p2] = (g.state as any).zones[p2] || {};
    (g.state as any).zones[p2].hand = [];
    (g.state as any).zones[p2].handCount = 0;

    // Advance to upkeep: should create the trigger on the stack.
    g.applyEvent({ type: 'nextStep' });
    expect(((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Test Relic')).toBe(
      true
    );

    // Make the condition FALSE before resolving the trigger.
    (g.state as any).zones[p2].hand = [{ id: 'dummy', name: 'Dummy', type_line: 'Test', oracle_text: '', zone: 'hand' }];
    (g.state as any).zones[p2].handCount = 1;

    // Resolve the trigger: it should fizzle and NOT enqueue UPKEEP_SACRIFICE.
    g.resolveTopOfStack();

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p2);
    const upkeepSacSteps = steps.filter((s: any) => s?.type === ResolutionStepType.UPKEEP_SACRIFICE);
    expect(upkeepSacSteps).toHaveLength(0);
  });

  it('creates the upkeep sacrifice step when the intervening-if condition remains true', () => {
    const gameId = 't_intervening_if_upkeep_true';
    const g = createInitialGameState(gameId);

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p2);

    (g.state.battlefield as any).push({
      id: 'relic_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'relic_card',
        name: 'Test Relic',
        type_line: 'Artifact',
        oracle_text:
          'At the beginning of your upkeep, if you have no cards in hand, sacrifice a creature or sacrifice Test Relic.',
      },
      tapped: false,
    });

    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p2] = (g.state as any).zones[p2] || {};
    (g.state as any).zones[p2].hand = [];
    (g.state as any).zones[p2].handCount = 0;

    g.applyEvent({ type: 'nextStep' });
    g.resolveTopOfStack();

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p2);
    const upkeepSacSteps = steps.filter((s: any) => s?.type === ResolutionStepType.UPKEEP_SACRIFICE);
    expect(upkeepSacSteps.length).toBeGreaterThan(0);
  });
});

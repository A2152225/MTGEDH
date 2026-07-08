import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import {
  detectSagaLoreCounterTrigger,
  getSagaLoreCounterTriggers,
} from '../src/state/modules/upkeep-triggers.js';
import {
  applySagaLoreCounterFromTrigger,
  processSagaLoreCountersAtPrecombatMain,
} from '../src/state/modules/triggerSagaLoreUtils.js';

const TEST_SAGA_ORACLE =
  'I — Create a 1/1 white Soldier creature token.\n' +
  'II — Create two 1/1 white Soldier creature tokens.\n' +
  'III — You gain 5 life.';

describe('Saga lore counter at precombat main', () => {
  it('detects saga lore counter trigger when below max chapter', () => {
    const permanent = {
      id: 'saga_perm',
      controller: 'p1',
      counters: { lore: 0 },
      card: {
        name: 'Test Saga',
        type_line: 'Enchantment — Saga',
        oracle_text: TEST_SAGA_ORACLE,
      },
    };

    const trigger = detectSagaLoreCounterTrigger(permanent.card, permanent);
    expect(trigger).toBeTruthy();
    expect(trigger?.triggerType).toBe('saga_lore_counter');
    expect(trigger?.effect).toBe('add_lore_counter');
    expect(trigger?.mandatory).toBe(true);
  });

  it('does not detect saga lore counter when at final chapter', () => {
    const permanent = {
      id: 'saga_perm',
      controller: 'p1',
      counters: { lore: 3 },
      card: {
        name: 'Test Saga',
        type_line: 'Enchantment — Saga',
        oracle_text: TEST_SAGA_ORACLE,
      },
    };

    expect(detectSagaLoreCounterTrigger(permanent.card, permanent)).toBeNull();
  });

  it('adds lore counter synchronously and queues chapter ability when advancing to MAIN1', () => {
    const g = createInitialGameState('saga_precombat_main');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.importDeckResolved(p1, [{ id: 'c1', name: 'Plains', type_line: 'Basic Land — Plains' } as any]);

    (g.state as any).turnPlayer = p1;
    (g.state as any).activePlayer = p1;
    (g.state as any).phase = 'beginning';
    (g.state as any).step = 'DRAW';

    (g.state as any).battlefield = [
      {
        id: 'saga_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: { lore: 0 },
        card: {
          id: 'saga_card',
          name: 'Test Saga',
          type_line: 'Enchantment — Saga',
          oracle_text: TEST_SAGA_ORACLE,
        },
      },
    ];

    const detected = getSagaLoreCounterTriggers(g as any, p1);
    expect(detected).toHaveLength(1);

    g.applyEvent({ type: 'nextStep' });

    const saga = (g.state as any).battlefield.find((p: any) => p.id === 'saga_perm');
    expect(saga?.counters?.lore).toBe(1);

    const stackTrigger = ((g.state as any).stack || []).find(
      (item: any) => item?.type === 'triggered_ability' && item?.source === 'saga_perm',
    );
    expect(stackTrigger).toBeTruthy();
    expect(stackTrigger?.triggerType).toBe('saga_chapter');
    expect(String(stackTrigger?.effect || '')).toMatch(/create a 1\/1 white soldier creature token/i);
  });

  it('processes saga lore counters synchronously at precombat main', () => {
    const g = createInitialGameState('saga_sync_precombat_main');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    (g.state as any).battlefield = [
      {
        id: 'saga_perm',
        controller: p1,
        owner: p1,
        counters: { lore: 0 },
        card: {
          name: 'Test Saga',
          type_line: 'Enchantment — Saga',
          oracle_text: TEST_SAGA_ORACLE,
        },
      },
    ];

    const result = processSagaLoreCountersAtPrecombatMain(g as any, p1);
    expect(result.loreCountersAdded).toBe(1);
    expect(result.chapterTriggers).toHaveLength(1);

    const saga = (g.state as any).battlefield.find((p: any) => p.id === 'saga_perm');
    expect(saga?.counters?.lore).toBe(1);
    expect(((g.state as any).stack || []).length).toBe(0);
  });

  it('adds lore counter and queues chapter ability when saga trigger resolves', () => {
    const g = createInitialGameState('saga_lore_resolve');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    (g.state as any).battlefield = [
      {
        id: 'saga_perm',
        controller: p1,
        owner: p1,
        counters: { lore: 0 },
        card: {
          name: 'Test Saga',
          type_line: 'Enchantment — Saga',
          oracle_text: TEST_SAGA_ORACLE,
        },
      },
    ];

    const handled = applySagaLoreCounterFromTrigger({
      ctx: g as any,
      controller: p1,
      sourceName: 'Test Saga',
      triggerItem: {
        permanentId: 'saga_perm',
        triggerType: 'saga_lore_counter',
        effect: 'add_lore_counter',
      },
    });

    expect(handled).toBe(true);

    const saga = (g.state as any).battlefield.find((p: any) => p.id === 'saga_perm');
    expect(saga?.counters?.lore).toBe(1);

    const chapterTrigger = ((g.state as any).stack || []).find(
      (item: any) => item?.triggerType === 'saga_chapter',
    );
    expect(chapterTrigger).toBeTruthy();
    expect(String(chapterTrigger?.effect || '')).toMatch(/create a 1\/1 white soldier creature token/i);
  });
});

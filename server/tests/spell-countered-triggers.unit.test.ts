import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { detectSpellCounteredTriggers } from '../src/state/modules/triggered-abilities.js';
import { processSpellCounteredTriggers } from '../src/state/modules/spellCounteredTriggerUtils.js';
import { applyCostAdjustmentToParsedCost, buildCostAdjustmentPlan } from '../src/state/modules/cost-adjustments.js';
import { parseManaCost } from '../src/state/modules/mana-check.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('spell countered triggers + generic cost reduction', () => {
  afterEach(() => {
    ResolutionQueueManager.removeQueue('baral_counter_trigger');
  });

  it('detects Baral-style you-countered-spell triggers', () => {
    const permanent = {
      id: 'baral',
      controller: 'p1',
      card: {
        name: 'Baral, Chief of Compliance',
        oracle_text:
          'Instant and sorcery spells you cast cost {1} less to cast.\nWhenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.',
      },
    };
    const triggers = detectSpellCounteredTriggers(permanent.card, permanent);
    expect(triggers.length).toBeGreaterThanOrEqual(1);
    expect((triggers[0] as any).counterPerspective).toBe('you_countered_spell');
    expect(String(triggers[0].effect || '').toLowerCase()).toContain('draw');
    expect(String(triggers[0].effect || '').toLowerCase()).toContain('discard');
    expect(triggers[0].mandatory).toBe(false);
  });

  it('does not let generic {1} reduction erase a monocolored {U} cost', () => {
    const forceSpike = {
      id: 'force_spike',
      name: 'Force Spike',
      type_line: 'Instant',
      mana_cost: '{U}',
      colors: ['U'],
    };
    const state = {
      battlefield: [{
        id: 'baral',
        controller: 'p1',
        card: {
          name: 'Baral, Chief of Compliance',
          type_line: 'Legendary Creature — Human Wizard',
          oracle_text: 'Instant and sorcery spells you cast cost {1} less to cast.',
        },
      }],
    };
    const plan = buildCostAdjustmentPlan(state as any, 'p1', forceSpike);
    expect(plan.genericAdjustment).toBe(-1);
    const adjusted = applyCostAdjustmentToParsedCost(parseManaCost('{U}'), plan);
    expect(adjusted.generic).toBe(0);
    expect(adjusted.colors.U || adjusted.colors.u || 0).toBe(1);
  });

  it('pushes Baral trigger when you counter a spell', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 'baral_counter_trigger';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    (g as any).gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    (g.state as any).battlefield = [{
      id: 'baral',
      controller: p1,
      owner: p1,
      card: {
        id: 'baral_card',
        name: 'Baral, Chief of Compliance',
        type_line: 'Legendary Creature — Human Wizard',
        oracle_text:
          'Instant and sorcery spells you cast cost {1} less to cast.\nWhenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.',
      },
    }];

    processSpellCounteredTriggers(g as any, {
      counteringControllerId: p1,
      counteredControllerId: p2,
      counteredStackItemId: 'stack_bolt',
      counteredCardName: 'Lightning Bolt',
      counteringSourceName: 'Force Spike',
      counteredWasSpell: true,
    });

    const trigger = ((g.state as any).stack || []).find((item: any) =>
      item?.type === 'triggered_ability'
      && String(item?.card?.name || '') === 'Baral, Chief of Compliance'
    );
    expect(trigger).toBeTruthy();
    expect(String(trigger?.sourceName || '')).toContain('Baral');
    expect(String(trigger?.effect || trigger?.description || '').toLowerCase()).toContain('draw');
  });
});

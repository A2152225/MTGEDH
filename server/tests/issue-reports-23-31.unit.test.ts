import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import { detectEndStepTriggers, detectCombatDamageTriggers } from '../src/state/modules/triggered-abilities.js';
import { canAIActivateBattlefieldAbilityNow } from '../src/socket/ai-handlers/aiActionCandidateHandlers.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import {
  snapshotBattlefieldCounters,
  syncCounterReplacementEffectsAfterOracleIR,
} from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerMillCounterPreparedSync.js';

const EMERIA_ORACLE =
  'Flying\nLandfall — Whenever a land you control enters, you may return target nonland permanent card from your graveyard to your hand. If that land is a Plains, you may return that nonland permanent card to the battlefield instead.';

const EXEMPLAR_ORACLE =
  'Flying\nWhenever you gain life, put a +1/+1 counter on this creature.\nWhenever you put one or more +1/+1 counters on this creature, draw a card. This ability triggers only once each turn.';

const EDRIC_ORACLE =
  'Whenever a creature deals combat damage to one of your opponents, its controller may draw a card.';

describe('open issue reports 23-31', () => {
  it('does not queue Edric at the end step, and the combat trigger is optional', () => {
    const permanent = { id: 'edric', controller: 'p1' };
    const card = { name: 'Edric, Spymaster of Trest', oracle_text: EDRIC_ORACLE };
    expect(detectEndStepTriggers(card, permanent)).toEqual([]);
    const combat = detectCombatDamageTriggers(card, permanent);
    const draw = combat.find((trigger) => /draw a card/i.test(String(trigger.effect || trigger.description || '')));
    expect(draw).toBeTruthy();
    expect(draw?.mandatory).toBe(false);
  });

  it('does not treat Emeria Shepherd entering as a land you control entering', () => {
    const g = createInitialGameState('t_emeria_self_etb');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    const emeria = {
      id: 'emeria',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: {
        id: 'emeria_card',
        name: 'Emeria Shepherd',
        type_line: 'Creature — Angel',
        oracle_text: EMERIA_ORACLE,
      },
    };
    (g.state.battlefield as any).push(emeria);
    queueSelfETBTriggersForPermanent(g as any, emeria, p1);
    const stacked = ((g.state.stack || []) as any[]).filter((item) => item?.sourceName === 'Emeria Shepherd');
    expect(stacked.some((item) => item.triggerType === 'land_you_control_etb')).toBe(false);
  });

  it('queues Exemplar of Light\'s draw when Oracle IR places a +1/+1 counter', () => {
    const g = createInitialGameState('t_exemplar_counter');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    const exemplar = {
      id: 'exemplar',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: {
        id: 'exemplar_card',
        name: 'Exemplar of Light',
        type_line: 'Creature — Angel',
        oracle_text: EXEMPLAR_ORACLE,
      },
    };
    (g.state.battlefield as any).push(exemplar);
    const before = snapshotBattlefieldCounters(g.state);
    exemplar.counters = { '+1/+1': 1 };
    syncCounterReplacementEffectsAfterOracleIR(g as any, g.state, before);
    const draws = ((g.state.stack || []) as any[]).filter(
      (item) => item?.sourceName === 'Exemplar of Light' && /draw a card/i.test(String(item.effect || '')),
    );
    expect(draws).toHaveLength(1);
  });

  it('does not repeat a single-card graveyard exile while the commander is still in the command zone', () => {
    const action = {
      activate: true,
      permanentId: 'curator',
      cardName: 'Keen-Eyed Curator',
      abilityText: '{1}: Exile target card from a graveyard.',
    };
    const game = (activatedThisTurn: boolean, commanderInZone: boolean) => ({
      state: {
        turnPlayer: 'ai',
        phase: 'precombatMain',
        step: 'MAIN1',
        stack: [],
        manaPool: { ai: { white: 0, blue: 0, black: 0, red: 0, green: 4, colorless: 0 } },
        commandZone: commanderInZone ? { ai: { inCommandZone: ['omnath'] } } : { ai: { inCommandZone: [] } },
        battlefield: [{
          id: 'curator',
          controller: 'ai',
          tapped: false,
          activatedThisTurn,
          card: {
            name: 'Keen-Eyed Curator',
            type_line: 'Creature — Raccoon Scout',
            oracle_text: '{1}: Exile target card from a graveyard.',
          },
        }],
      },
    });

    expect(canAIActivateBattlefieldAbilityNow(game(false, true), 'ai' as PlayerID, action, 'main')).toBe(true);
    expect(canAIActivateBattlefieldAbilityNow(game(true, true), 'ai' as PlayerID, action, 'main')).toBe(false);
    expect(canAIActivateBattlefieldAbilityNow(game(true, false), 'ai' as PlayerID, action, 'main')).toBe(true);
  });
});

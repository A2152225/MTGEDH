import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-detection.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

// Oracle from mtg_data.db (Monstrous Vortex)
const VORTEX_ORACLE =
  "Whenever you cast a creature spell with power 5 or greater, discover X, where X is that spell's mana value. (Exile cards from the top of your library until you exile a nonland card with that mana value or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)";

function vortexPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Monstrous Vortex',
      type_line: 'Enchantment',
      oracle_text: VORTEX_ORACLE,
    },
  };
}

describe('Monstrous Vortex discover X = that spell mana value', () => {
  it('detects creature-spell power-threshold discover from oracle', () => {
    const triggers = detectSpellCastTriggers(
      {
        name: 'Monstrous Vortex',
        type_line: 'Enchantment',
        oracle_text: VORTEX_ORACLE,
      },
      { id: 'vortex_1', controller: 'p1' },
    );
    const named = triggers.find((t) => t.spellCondition === 'creature' && t.minSpellPower === 5);
    expect(named).toBeDefined();
    expect(String(named?.effect || '')).toMatch(/discover x/i);
    expect(String(named?.effect || '')).toMatch(/that spell's mana value/i);
  });

  it('binds discover X from the triggering stack spell mana value, not power', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 't_vortex_discover_execute';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    ResolutionQueueManager.removeQueue(gameId);
    (g as any).gameId = gameId;

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 },
      { id: 'mv7-1', name: 'Seven Drop', type_line: 'Creature — Dragon', cmc: 7, mana_value: 7, power: '5', toughness: '5' },
      { id: 'mv6-1', name: 'Six Drop', type_line: 'Creature — Dinosaur', cmc: 6, mana_value: 6 },
      { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, mana_value: 1 },
    ];
    player.exile = [];
    player.hand = [];
    (g as any).libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const vortex = vortexPermanent('vortex_1', p1);
    (g.state.battlefield as any).push(vortex);
    (g.state.stack as any).push({
      id: 'stack_titan',
      type: 'spell',
      controller: p1,
      card: {
        id: 'titan_1',
        name: 'Test Titan',
        type_line: 'Creature — Giant',
        power: '5',
        toughness: '5',
        cmc: 8,
        mana_value: 8,
      },
    });

    executeTriggerEffect(
      g as any,
      p1,
      'Monstrous Vortex',
      "discover X, where X is that spell's mana value",
      {
        id: 'vortex_cast',
        source: vortex.id,
        permanentId: vortex.id,
        sourceId: vortex.id,
        triggerType: 'cast_creature_type',
        triggeringStackItemId: 'stack_titan',
        effect: "discover X, where X is that spell's mana value",
        description: "Whenever you cast a creature spell with power 5 or greater, discover X, where X is that spell's mana value",
        effectData: {
          triggeringSpell: {
            id: 'titan_1',
            name: 'Test Titan',
            type_line: 'Creature — Giant',
            power: '5',
            toughness: '5',
            cmc: 8,
            mana_value: 8,
          },
        },
        mandatory: true,
        card: vortex.card,
      },
    );

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    const exileNames = (playerAfter?.exile || []).map((card: any) => String(card?.name || ''));
    // Threshold is the spell's MV 8, not power 5: Forest + Seven Drop (7 <= 8).
    expect(exileNames).toContain('Seven Drop');
    expect(exileNames).not.toContain('Six Drop');
    expect(exileNames).not.toContain('Lightning Bolt');

    const prompt = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (step: any) =>
        step?.type === ResolutionStepType.OPTION_CHOICE &&
        String(step?.castFromExileCardId || '') === 'mv7-1',
    );
    expect(prompt).toBeTruthy();

    ResolutionQueueManager.removeQueue(gameId);
  });
});

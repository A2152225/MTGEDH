import { describe, expect, it } from 'vitest';

import { AIEngine, AIStrategy, AIDecisionType, type AIPlayerConfig } from '../src/AIEngine';
import { isManaRockSelfUntapAbility, shouldAIPayToUntapManaRock } from '../src/aiEngineActivatedAbilitySupport';
import type { GameState, PlayerID } from '../../shared/src';

describe('AIEngine activated ability decisions', () => {
  it('does not crash when evaluating activated abilities during priority', async () => {
    const engine = new AIEngine();
    const playerId = 'p1' as PlayerID;
    const config: AIPlayerConfig = {
      playerId,
      strategy: AIStrategy.BASIC,
      difficulty: 0.5,
      thinkTime: 0,
    };
    engine.registerAI(config);

    const gameState = {
      id: 'g1',
      turnPlayer: playerId,
      phase: 'postcombatMain',
      step: 'main2',
      players: [{
        id: playerId,
        name: 'AI',
        life: 40,
        hand: [],
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      }],
      life: { p1: 40 },
      battlefield: [{
        id: 'perm1',
        controller: playerId,
        tapped: false,
        card: {
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
        },
      }],
      stack: [],
    } as unknown as GameState;

    const decision = await engine.makeDecision({
      gameState,
      playerId,
      decisionType: AIDecisionType.ACTIVATE_ABILITY,
      options: [],
    });

    expect(decision.type).toBe(AIDecisionType.ACTIVATE_ABILITY);
    expect(decision.playerId).toBe(playerId);
  });

  it('does not activate a battlefield "Discard this card" ability (Kogla and Yidaro)', async () => {
    const engine = new AIEngine();
    const playerId = 'p1' as PlayerID;
    const config: AIPlayerConfig = {
      playerId,
      strategy: AIStrategy.BASIC,
      difficulty: 0.5,
      thinkTime: 0,
    };
    engine.registerAI(config);

    const koglaOracle =
      'When Kogla and Yidaro enters, choose one —\n' +
      '\u2022 It gains trample and haste until end of turn.\n' +
      '\u2022 It fights target creature you don\'t control.\n' +
      '{2}{R}{G}, Discard this card: Destroy up to one target artifact or enchantment. Shuffle this card into your library from your graveyard, then draw a card.';

    const gameState = {
      id: 'g1',
      turnPlayer: playerId,
      phase: 'precombatMain',
      step: 'MAIN1',
      players: [{
        id: playerId,
        name: 'AI',
        life: 40,
        hand: [],
        manaPool: { white: 1, blue: 1, black: 1, red: 1, green: 14, colorless: 1 },
      }],
      life: { p1: 40 },
      battlefield: [{
        id: 'stack_htqnsr3f',
        controller: playerId,
        tapped: false,
        card: {
          id: 'b760ebdf-bea6-4c43-a187-4a02ebf95ebf',
          name: 'Kogla and Yidaro',
          type_line: 'Legendary Creature — Ape Dinosaur Turtle',
          oracle_text: koglaOracle,
        },
      }],
      stack: [{
        id: 'trig_kogla_etb',
        type: 'triggered_ability',
        description: 'When Kogla and Yidaro enters, choose one —',
      }],
    } as unknown as GameState;

    const decision = await engine.makeDecision({
      gameState,
      playerId,
      decisionType: AIDecisionType.ACTIVATE_ABILITY,
      options: [],
    });

    expect(decision.type).toBe(AIDecisionType.ACTIVATE_ABILITY);
    expect(decision.action?.activate).toBe(false);
  });

  it('does not activate a mana-rock self-untap during the main phase, tapped or not', async () => {
    const basalt =
      "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{3}: Untap this artifact.";
    const grim =
      "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{4}: Untap this artifact.";
    const untapsForFree =
      '{T}: Add {C}{C}{C}.\n{3}: Untap this artifact.';
    expect(isManaRockSelfUntapAbility('{3}: Untap this artifact.', basalt, 'Basalt Monolith')).toBe(true);
    expect(isManaRockSelfUntapAbility('{4}: Untap this artifact.', grim, 'Grim Monolith')).toBe(true);
    expect(shouldAIPayToUntapManaRock({
      abilityText: '{3}: Untap this artifact.',
      oracleText: basalt,
      cardName: 'Basalt Monolith',
      tapped: false,
    })).toBe(false);
    expect(shouldAIPayToUntapManaRock({
      abilityText: '{3}: Untap this artifact.',
      oracleText: basalt,
      cardName: 'Basalt Monolith',
      tapped: true,
    })).toBe(true);
    expect(shouldAIPayToUntapManaRock({
      abilityText: '{3}: Untap this artifact.',
      oracleText: untapsForFree,
      cardName: 'Mana Rock',
      tapped: true,
    })).toBe(false);
    expect(isManaRockSelfUntapAbility(
      '{1}, {T}: Untap target artifact.',
      '{1}, {T}: Untap target artifact.',
      'Voltaic Key',
    )).toBe(false);
    expect(isManaRockSelfUntapAbility(
      '{1}: Untap this artifact.',
      '{1}: Untap this artifact.\n{2}, {T}: You gain 1 life.\n{3}, {T}: Untap target creature.\n{4}, {T}: Tap target creature.\n{5}, {T}: Draw a card.',
      'Staff of Domination',
    )).toBe(false);

    const engine = new AIEngine();
    const playerId = 'p1' as PlayerID;
    engine.registerAI({
      playerId,
      strategy: AIStrategy.BASIC,
      difficulty: 0.5,
      thinkTime: 0,
    });

    const monolithDecision = await engine.makeDecision({
      gameState: {
        id: 'g-monolith',
        turnPlayer: playerId,
        phase: 'precombatMain',
        step: 'MAIN1',
        players: [{ id: playerId, name: 'Chaos', life: 40, hand: [] }],
        life: { p1: 40 },
        battlefield: [
          {
            id: 'basalt',
            controller: playerId,
            tapped: false,
            card: {
              id: 'basalt-card',
              name: 'Basalt Monolith',
              type_line: 'Artifact',
              oracle_text: basalt,
            },
          },
          {
            id: 'grim',
            controller: playerId,
            tapped: true,
            card: {
              id: 'grim-card',
              name: 'Grim Monolith',
              type_line: 'Artifact',
              oracle_text: grim,
            },
          },
        ],
        stack: [],
      } as unknown as GameState,
      playerId,
      decisionType: AIDecisionType.ACTIVATE_ABILITY,
      options: [],
    });

    expect(monolithDecision.action?.activate).toBe(false);

    const untappedOnly = await engine.makeDecision({
      gameState: {
        id: 'g-untapped',
        turnPlayer: playerId,
        phase: 'precombatMain',
        step: 'MAIN1',
        players: [{ id: playerId, name: 'Chaos', life: 40, hand: [] }],
        life: { p1: 40 },
        battlefield: [{
          id: 'basalt',
          controller: playerId,
          tapped: false,
          card: {
            id: 'basalt-card',
            name: 'Basalt Monolith',
            type_line: 'Artifact',
            oracle_text: basalt,
          },
        }],
        stack: [],
      } as unknown as GameState,
      playerId,
      decisionType: AIDecisionType.ACTIVATE_ABILITY,
      options: [],
    });
    expect(untappedOnly.action?.activate).toBe(false);

    const usefulUntap = await engine.makeDecision({
      gameState: {
        id: 'g-key',
        turnPlayer: playerId,
        phase: 'precombatMain',
        step: 'MAIN1',
        players: [{ id: playerId, name: 'Chaos', life: 40, hand: [] }],
        life: { p1: 40 },
        battlefield: [{
          id: 'key',
          controller: playerId,
          tapped: false,
          card: {
            id: 'key-card',
            name: 'Voltaic Key',
            type_line: 'Artifact',
            oracle_text: '{1}, {T}: Untap target artifact.',
          },
        }],
        stack: [],
      } as unknown as GameState,
      playerId,
      decisionType: AIDecisionType.ACTIVATE_ABILITY,
      options: [],
    });

    expect(usefulUntap.action?.activate).toBe(true);
    expect(String(usefulUntap.action?.abilityText || '')).toMatch(/untap target artifact/i);
  });
});

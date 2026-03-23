import type { BattlefieldPermanent } from '../../shared/src';
import { getLegalAttackers } from './actions/combat';
import { AIDecisionType, type AIDecision, type AIDecisionContext, type AIPlayerConfig } from './AIEngine';

export function makeAggressiveDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    selectAttackTarget: (gameState: AIDecisionContext['gameState'], playerId: string) => string;
    makeBasicDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
  }
): AIDecision {
  if (context.decisionType === AIDecisionType.DECLARE_ATTACKERS) {
    const legalAttackerIds = getLegalAttackers(context.gameState, context.playerId);
    const targetPlayerId = deps.selectAttackTarget(context.gameState, context.playerId);
    const attackers = legalAttackerIds.map(id => ({
      creatureId: id,
      defendingPlayerId: targetPlayerId,
    }));

    return {
      type: AIDecisionType.DECLARE_ATTACKERS,
      playerId: context.playerId,
      action: { attackers },
      reasoning: `Aggressive: attack with all ${attackers.length} legal creatures`,
      confidence: 0.9,
    };
  }

  return deps.makeBasicDecision(context, config);
}

export function makeDefensiveDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    selectAttackTarget: (gameState: AIDecisionContext['gameState'], playerId: string) => string;
    makeBasicDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
  }
): AIDecision {
  if (context.decisionType === AIDecisionType.DECLARE_ATTACKERS) {
    const player = context.gameState.players.find(p => p.id === context.playerId);
    const life = player?.life || 0;
    const opponents = context.gameState.players.filter(p => p.id !== context.playerId);
    const lowestOpponentLife = Math.min(...opponents.map(p => p.life || 40));

    if (life > 20 || lowestOpponentLife < 15) {
      const legalAttackerIds = getLegalAttackers(context.gameState, context.playerId);
      const attackRatio = life > 30 ? 0.66 : 0.5;
      const attackerCount = Math.floor(legalAttackerIds.length * attackRatio);
      const attackerIds = legalAttackerIds.slice(0, Math.max(1, attackerCount));
      const targetPlayerId = deps.selectAttackTarget(context.gameState, context.playerId);
      const attackers = attackerIds.map(id => ({
        creatureId: id,
        defendingPlayerId: targetPlayerId,
      }));

      return {
        type: AIDecisionType.DECLARE_ATTACKERS,
        playerId: context.playerId,
        action: { attackers },
        reasoning: `Defensive: cautious attack with ${attackers.length}/${legalAttackerIds.length} legal creatures`,
        confidence: 0.6,
      };
    }

    return {
      type: AIDecisionType.DECLARE_ATTACKERS,
      playerId: context.playerId,
      action: { attackers: [] },
      reasoning: 'Defensive: preserve life, no attack',
      confidence: 0.8,
    };
  }

  return deps.makeBasicDecision(context, config);
}

export function makeControlDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    selectAttackTarget: (gameState: AIDecisionContext['gameState'], playerId: string) => string;
    getProcessedBattlefield: (gameState: AIDecisionContext['gameState']) => BattlefieldPermanent[];
    hasPermanentType: (perm: BattlefieldPermanent, type: string) => boolean;
    makeBasicCastDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeBasicDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
  }
): AIDecision {
  const { gameState, playerId, decisionType } = context;

  switch (decisionType) {
    case AIDecisionType.DECLARE_ATTACKERS: {
      const opponents = gameState.players.filter(p => p.id !== playerId);
      const battlefield = deps.getProcessedBattlefield(gameState);
      const myCreatureCount = battlefield.filter((p: any) => p.controller === playerId && deps.hasPermanentType(p, 'creature')).length;
      const opponentCreatureCount = opponents.reduce(
        (sum, opp) =>
          sum + battlefield.filter((p: any) => p.controller === opp.id && deps.hasPermanentType(p, 'creature')).length,
        0
      );
      const lowestOpponentLife = Math.min(...opponents.map(p => p.life || 40));

      if (myCreatureCount >= opponentCreatureCount || lowestOpponentLife < 20) {
        const legalAttackerIds = getLegalAttackers(gameState, playerId);
        const attackRatio = myCreatureCount > opponentCreatureCount + 2 ? 0.75 : 0.5;
        const attackerCount = Math.ceil(legalAttackerIds.length * attackRatio);
        const attackerIds = legalAttackerIds.slice(0, attackerCount);
        const targetPlayerId = deps.selectAttackTarget(gameState, playerId);
        const attackers = attackerIds.map(id => ({
          creatureId: id,
          defendingPlayerId: targetPlayerId,
        }));

        return {
          type: AIDecisionType.DECLARE_ATTACKERS,
          playerId,
          action: { attackers },
          reasoning: `Control: attacking with ${attackers.length}/${legalAttackerIds.length} creatures`,
          confidence: 0.7,
        };
      }

      return {
        type: AIDecisionType.DECLARE_ATTACKERS,
        playerId,
        action: { attackers: [] },
        reasoning: 'Control: holding back, need more board presence',
        confidence: 0.8,
      };
    }

    case AIDecisionType.CAST_SPELL: {
      const player = gameState.players.find(p => p.id === playerId);
      const hand = player?.hand || [];
      const hasCounterInHand = hand.some((card: any) => (card.oracle_text || '').toLowerCase().includes('counter target'));
      const opponentHasMana = gameState.players.some(p => {
        if (p.id === playerId) return false;
        const pool = p.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
        return pool.white + pool.blue + pool.black + pool.red + pool.green + pool.colorless > 0;
      });

      if (hasCounterInHand && opponentHasMana && (gameState.stack || []).length === 0) {
        return {
          type: AIDecisionType.CAST_SPELL,
          playerId,
          action: { spell: null },
          reasoning: 'Control: holding counter spell mana',
          confidence: 0.8,
        };
      }

      const prioritizedSpells = hand
        .filter((card: any) => {
          const text = (card.oracle_text || '').toLowerCase();
          return text.includes('destroy target') || text.includes('exile target') || text.includes('draw') || text.includes('counter target');
        })
        .sort((a: any, b: any) => {
          const aText = (a.oracle_text || '').toLowerCase();
          const bText = (b.oracle_text || '').toLowerCase();
          let aScore = 0;
          let bScore = 0;
          if (aText.includes('destroy') || aText.includes('exile')) aScore += 10;
          if (bText.includes('destroy') || bText.includes('exile')) bScore += 10;
          if (aText.includes('draw')) aScore += 5;
          if (bText.includes('draw')) bScore += 5;
          return bScore - aScore;
        });

      if (prioritizedSpells.length > 0) {
        return {
          type: AIDecisionType.CAST_SPELL,
          playerId,
          action: { spell: prioritizedSpells[0] },
          reasoning: `Control: casting high-value spell ${prioritizedSpells[0].name}`,
          confidence: 0.7,
        };
      }

      return deps.makeBasicCastDecision(context, config);
    }

    default:
      return deps.makeBasicDecision(context, config);
  }
}

export function makeComboDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    selectAttackTarget: (gameState: AIDecisionContext['gameState'], playerId: string) => string;
    getProcessedBattlefield: (gameState: AIDecisionContext['gameState']) => BattlefieldPermanent[];
    hasPermanentType: (perm: BattlefieldPermanent, type: string) => boolean;
    makeBasicDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
  }
): AIDecision {
  const { gameState, playerId, decisionType } = context;

  switch (decisionType) {
    case AIDecisionType.DECLARE_ATTACKERS: {
      const player = gameState.players.find(p => p.id === playerId);
      const life = player?.life || 0;
      const opponents = gameState.players.filter(p => p.id !== playerId);
      const battlefield = deps.getProcessedBattlefield(gameState);
      const myCreatureCount = battlefield.filter((p: any) => p.controller === playerId && deps.hasPermanentType(p, 'creature')).length;
      const maxOpponentCreatures = Math.max(
        ...opponents.map(opp => battlefield.filter((p: any) => p.controller === opp.id && deps.hasPermanentType(p, 'creature')).length)
      );

      if (life > 15 || myCreatureCount > maxOpponentCreatures + 3) {
        const legalAttackerIds = getLegalAttackers(gameState, playerId);
        const vanillaAttackers = legalAttackerIds.filter(id => {
          const perm = battlefield.find((p: any) => p.id === id);
          const text = (perm?.card?.oracle_text || '').toLowerCase();
          return !text.includes(':') && !text.includes('whenever') && !text.includes('when');
        });
        const attackerIds =
          vanillaAttackers.length > 0
            ? vanillaAttackers
            : legalAttackerIds.slice(0, Math.max(1, Math.floor(legalAttackerIds.length * 0.3)));
        const targetPlayerId = deps.selectAttackTarget(gameState, playerId);
        const attackers = attackerIds.map(id => ({
          creatureId: id,
          defendingPlayerId: targetPlayerId,
        }));

        return {
          type: AIDecisionType.DECLARE_ATTACKERS,
          playerId,
          action: { attackers },
          reasoning: `Combo: attacking with ${attackers.length} non-essential creatures`,
          confidence: 0.6,
        };
      }

      return {
        type: AIDecisionType.DECLARE_ATTACKERS,
        playerId,
        action: { attackers: [] },
        reasoning: 'Combo: preserving creatures (low life or need blockers)',
        confidence: 0.9,
      };
    }

    case AIDecisionType.CAST_SPELL: {
      const player = gameState.players.find(p => p.id === playerId);
      const hand = player?.hand || [];
      const prioritizedSpells = [...hand].sort((a: any, b: any) => {
        const aText = (a.oracle_text || '').toLowerCase();
        const bText = (b.oracle_text || '').toLowerCase();
        let aScore = 0;
        let bScore = 0;
        if (aText.includes('search your library')) aScore += 20;
        if (bText.includes('search your library')) bScore += 20;
        if (aText.includes('draw')) {
          const match = aText.match(/draw (\d+)/);
          aScore += match ? parseInt(match[1], 10) * 4 : 4;
        }
        if (bText.includes('draw')) {
          const match = bText.match(/draw (\d+)/);
          bScore += match ? parseInt(match[1], 10) * 4 : 4;
        }
        if (aText.includes('add') && aText.includes('mana')) aScore += 8;
        if (bText.includes('add') && bText.includes('mana')) bScore += 8;
        if (aText.includes('untap') || aText.includes('copy')) aScore += 6;
        if (bText.includes('untap') || bText.includes('copy')) bScore += 6;
        return bScore - aScore;
      });

      const manaPool = player?.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      const totalMana = manaPool.white + manaPool.blue + manaPool.black + manaPool.red + manaPool.green + manaPool.colorless;
      const castable = prioritizedSpells.filter((card: any) => (card.cmc || card.mana_value || 0) <= totalMana);

      if (castable.length > 0) {
        return {
          type: AIDecisionType.CAST_SPELL,
          playerId,
          action: { spell: castable[0] },
          reasoning: `Combo: advancing game plan with ${castable[0].name}`,
          confidence: 0.8,
        };
      }

      return {
        type: AIDecisionType.CAST_SPELL,
        playerId,
        action: { spell: null },
        reasoning: 'Combo: saving resources for combo turn',
        confidence: 0.6,
      };
    }

    case AIDecisionType.SACRIFICE: {
      const battlefield = deps.getProcessedBattlefield(gameState);
      const playerPermanents = battlefield.filter((p: any) => p.controller === playerId);
      const sorted = [...playerPermanents].sort((a: any, b: any) => {
        const aText = (a.card?.oracle_text || '').toLowerCase();
        const bText = (b.card?.oracle_text || '').toLowerCase();
        let aValue = 0;
        let bValue = 0;
        if (aText.includes(':')) aValue += 10;
        if (bText.includes(':')) bValue += 10;
        if (aText.includes('whenever') || aText.includes('when')) aValue += 5;
        if (bText.includes('whenever') || bText.includes('when')) bValue += 5;
        if (aText.includes('untap')) aValue += 8;
        if (bText.includes('untap')) bValue += 8;
        return aValue - bValue;
      });

      const sacrificeCount = context.constraints?.count || 1;
      const sacrificed = sorted.slice(0, sacrificeCount).map((p: any) => p.id);

      return {
        type: AIDecisionType.SACRIFICE,
        playerId,
        action: { sacrificed },
        reasoning: `Combo: sacrificing ${sacrificed.length} non-essential permanent(s)`,
        confidence: 0.7,
      };
    }

    default:
      return deps.makeBasicDecision(context, config);
  }
}

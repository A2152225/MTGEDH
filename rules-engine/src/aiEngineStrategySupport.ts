import type { BattlefieldPermanent } from '../../shared/src';
import { AIDecisionType, type AIDecision, type AIDecisionContext, type AIPlayerConfig } from './AIEngine';

function listActiveOpponentPlayers(gameState: AIDecisionContext['gameState'], playerId: string) {
  return gameState.players.filter((player: any) =>
    player?.id
    && player.id !== playerId
    && !player?.hasLost
    && !player?.eliminated
    && !player?.conceded
    && !player?.spectator
    && !player?.isSpectator,
  );
}

function emptyAttackersDecision(playerId: string, reasoning: string, confidence = 0.8): AIDecision {
  return {
    type: AIDecisionType.DECLARE_ATTACKERS,
    playerId,
    action: { attackers: [] },
    reasoning,
    confidence,
  };
}

function shouldDefensiveStrategyAttack(context: AIDecisionContext): boolean {
  const player = context.gameState.players.find((entry) => entry.id === context.playerId);
  const life = player?.life || 0;
  const opponents = listActiveOpponentPlayers(context.gameState, context.playerId);
  if (opponents.length === 0) return false;
  const lowestOpponentLife = Math.min(...opponents.map((opp) => opp.life || 40));
  return life > 20 || lowestOpponentLife < 15;
}

function shouldControlStrategyAttack(
  context: AIDecisionContext,
  battlefield: BattlefieldPermanent[],
  hasPermanentType: (perm: BattlefieldPermanent, type: string) => boolean,
): boolean {
  const { gameState, playerId } = context;
  const opponents = listActiveOpponentPlayers(gameState, playerId);
  const myCreatureCount = battlefield.filter(
    (perm: any) => perm.controller === playerId && hasPermanentType(perm, 'creature'),
  ).length;
  const opponentCreatureCount = opponents.reduce(
    (sum, opp) =>
      sum + battlefield.filter(
        (perm: any) => perm.controller === opp.id && hasPermanentType(perm, 'creature'),
      ).length,
    0,
  );
  const lowestOpponentLife = Math.min(...opponents.map((opp) => opp.life || 40));
  return myCreatureCount >= opponentCreatureCount || lowestOpponentLife < 20;
}

function shouldComboStrategyAttack(
  context: AIDecisionContext,
  battlefield: BattlefieldPermanent[],
  hasPermanentType: (perm: BattlefieldPermanent, type: string) => boolean,
): boolean {
  const player = context.gameState.players.find((entry) => entry.id === context.playerId);
  const life = player?.life || 0;
  const opponents = listActiveOpponentPlayers(context.gameState, context.playerId);
  const myCreatureCount = battlefield.filter(
    (perm: any) => perm.controller === context.playerId && hasPermanentType(perm, 'creature'),
  ).length;
  const maxOpponentCreatures = opponents.length > 0
    ? Math.max(
      ...opponents.map((opp) =>
        battlefield.filter(
          (perm: any) => perm.controller === opp.id && hasPermanentType(perm, 'creature'),
        ).length,
      ),
    )
    : 0;
  return life > 15 || myCreatureCount > maxOpponentCreatures + 3;
}

/** All strategies share one attack builder with universal combat sanity checks. */
function makeStrategyAttackDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    makeBasicDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    getProcessedBattlefield?: (gameState: AIDecisionContext['gameState']) => BattlefieldPermanent[];
    hasPermanentType?: (perm: BattlefieldPermanent, type: string) => boolean;
    shouldAttack?: (context: AIDecisionContext) => boolean;
    holdReason?: string;
  },
): AIDecision {
  if (deps.shouldAttack && !deps.shouldAttack(context)) {
    return emptyAttackersDecision(
      context.playerId,
      deps.holdReason || 'Strategy: holding attackers',
    );
  }
  return deps.makeBasicDecision(context, config);
}

export function makeAggressiveDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    makeBasicDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
  },
): AIDecision {
  if (context.decisionType === AIDecisionType.DECLARE_ATTACKERS) {
    return deps.makeBasicDecision(context, config);
  }
  return deps.makeBasicDecision(context, config);
}

export function makeDefensiveDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    makeBasicDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
  },
): AIDecision {
  if (context.decisionType === AIDecisionType.DECLARE_ATTACKERS) {
    return makeStrategyAttackDecision(context, config, {
      ...deps,
      shouldAttack: shouldDefensiveStrategyAttack,
      holdReason: 'Defensive: preserve life, no attack',
    });
  }
  return deps.makeBasicDecision(context, config);
}

export function makeControlDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    getProcessedBattlefield: (gameState: AIDecisionContext['gameState']) => BattlefieldPermanent[];
    hasPermanentType: (perm: BattlefieldPermanent, type: string) => boolean;
    makeBasicCastDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeBasicDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
  },
): AIDecision {
  const { gameState, playerId, decisionType } = context;

  switch (decisionType) {
    case AIDecisionType.DECLARE_ATTACKERS: {
      const battlefield = deps.getProcessedBattlefield(gameState);
      return makeStrategyAttackDecision(context, config, {
        ...deps,
        shouldAttack: (ctx) => shouldControlStrategyAttack(ctx, battlefield, deps.hasPermanentType),
        holdReason: 'Control: holding back, need more board presence',
      });
    }

    case AIDecisionType.CAST_SPELL: {
      const player = gameState.players.find((entry) => entry.id === playerId);
      const hand = player?.hand || [];
      const hasCounterInHand = hand.some((card: any) => (card.oracle_text || '').toLowerCase().includes('counter target'));
      const opponentHasMana = gameState.players.some((entry) => {
        if (entry.id === playerId) return false;
        const pool = entry.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
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
    getProcessedBattlefield: (gameState: AIDecisionContext['gameState']) => BattlefieldPermanent[];
    hasPermanentType: (perm: BattlefieldPermanent, type: string) => boolean;
    makeBasicDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
  },
): AIDecision {
  const { gameState, playerId, decisionType } = context;

  switch (decisionType) {
    case AIDecisionType.DECLARE_ATTACKERS: {
      const battlefield = deps.getProcessedBattlefield(gameState);
      return makeStrategyAttackDecision(context, config, {
        ...deps,
        shouldAttack: (ctx) => shouldComboStrategyAttack(ctx, battlefield, deps.hasPermanentType),
        holdReason: 'Combo: preserving creatures (low life or need blockers)',
      });
    }

    case AIDecisionType.CAST_SPELL: {
      const player = gameState.players.find((entry) => entry.id === playerId);
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
      const playerPermanents = battlefield.filter((perm: any) => perm.controller === playerId);
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
      const sacrificed = sorted.slice(0, sacrificeCount).map((perm: any) => perm.id);

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

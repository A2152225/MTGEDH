import { getLegalAttackers } from './actions/combat';
import { AIDecisionType, type AIDecision, type AIDecisionContext, type AIPlayerConfig } from './AIEngine';

export function makeRandomDecision(
  context: AIDecisionContext,
  deps: {
    selectAttackTarget: (gameState: AIDecisionContext['gameState'], playerId: string) => string;
  }
): AIDecision {
  const { decisionType, playerId } = context;

  switch (decisionType) {
    case AIDecisionType.MULLIGAN:
      return {
        type: decisionType,
        playerId,
        action: { keep: Math.random() > 0.5 },
        reasoning: 'Random decision',
        confidence: 0.5,
      };

    case AIDecisionType.DECLARE_ATTACKERS: {
      const legalAttackerIds = getLegalAttackers(context.gameState, playerId);
      const randomAttackerIds = legalAttackerIds.filter(() => Math.random() > 0.3);
      const targetPlayerId = deps.selectAttackTarget(context.gameState, playerId);
      const randomAttackers = randomAttackerIds.map(id => ({
        creatureId: id,
        defendingPlayerId: targetPlayerId,
      }));

      return {
        type: decisionType,
        playerId,
        action: { attackers: randomAttackers },
        reasoning: `Random attackers (${randomAttackers.length}/${legalAttackerIds.length} legal)`,
        confidence: 0.3,
      };
    }

    case AIDecisionType.PASS_PRIORITY:
      return {
        type: decisionType,
        playerId,
        action: { pass: true },
        reasoning: 'Random pass',
        confidence: 0.5,
      };

    default:
      return {
        type: decisionType,
        playerId,
        action: {},
        reasoning: 'No action available',
        confidence: 0,
      };
  }
}

export function makeBasicMulliganDecision(context: AIDecisionContext): AIDecision {
  const player = context.gameState.players.find(p => p.id === context.playerId);
  if (!player || !player.hand) {
    return {
      type: AIDecisionType.MULLIGAN,
      playerId: context.playerId,
      action: { keep: false },
      reasoning: 'No hand found',
      confidence: 0,
    };
  }

  const landCount = player.hand.filter(card => card.types?.includes('Land')).length;
  const keep = landCount >= 2 && landCount <= 5;

  return {
    type: AIDecisionType.MULLIGAN,
    playerId: context.playerId,
    action: { keep },
    reasoning: `Hand has ${landCount} lands (want 2-5)`,
    confidence: keep ? 0.7 : 0.3,
  };
}

export function makeBasicDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    makeBasicMulliganDecision: (context: AIDecisionContext) => AIDecision;
    makeBasicAttackDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeBasicBlockDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeBasicCastDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeSacrificeDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeTargetDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeTriggeredAbilityDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeDamageAssignmentDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeBlockerOrderDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeTokenCreationDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeModeChoiceDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeDiscardDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeActivatedAbilityDecision: (context: AIDecisionContext, config: AIPlayerConfig) => AIDecision;
    makeRandomDecision: (context: AIDecisionContext) => AIDecision;
  }
): AIDecision {
  switch (context.decisionType) {
    case AIDecisionType.MULLIGAN:
      return deps.makeBasicMulliganDecision(context);
    case AIDecisionType.DECLARE_ATTACKERS:
      return deps.makeBasicAttackDecision(context, config);
    case AIDecisionType.DECLARE_BLOCKERS:
      return deps.makeBasicBlockDecision(context, config);
    case AIDecisionType.CAST_SPELL:
      return deps.makeBasicCastDecision(context, config);
    case AIDecisionType.SACRIFICE:
      return deps.makeSacrificeDecision(context, config);
    case AIDecisionType.SELECT_TARGET:
      return deps.makeTargetDecision(context, config);
    case AIDecisionType.TRIGGERED_ABILITY:
      return deps.makeTriggeredAbilityDecision(context, config);
    case AIDecisionType.ASSIGN_DAMAGE:
      return deps.makeDamageAssignmentDecision(context, config);
    case AIDecisionType.ORDER_BLOCKERS:
      return deps.makeBlockerOrderDecision(context, config);
    case AIDecisionType.CREATE_TOKEN:
      return deps.makeTokenCreationDecision(context, config);
    case AIDecisionType.CHOOSE_MODE:
      return deps.makeModeChoiceDecision(context, config);
    case AIDecisionType.DISCARD:
      return deps.makeDiscardDecision(context, config);
    case AIDecisionType.ACTIVATE_ABILITY:
      return deps.makeActivatedAbilityDecision(context, config);
    default:
      return deps.makeRandomDecision(context);
  }
}

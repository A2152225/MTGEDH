import type { BattlefieldPermanent } from '../../shared/src';
import { AIDecisionType, type AIDecision, type AIDecisionContext, type AIPlayerConfig } from './AIEngine';

export function makeSacrificeDecision(
  context: AIDecisionContext,
  _config: AIPlayerConfig,
  deps: {
    getProcessedBattlefield: (gameState: AIDecisionContext['gameState']) => BattlefieldPermanent[];
    hasPermanentType: (perm: BattlefieldPermanent, type: string) => boolean;
    selectSacrificeTarget: (
      candidates: BattlefieldPermanent[],
      gameState: AIDecisionContext['gameState'],
      playerId: string,
      preferDeathTriggers?: boolean
    ) => { creature: BattlefieldPermanent | null; reason: string; priority: number };
  }
): AIDecision {
  const { playerId, constraints, gameState } = context;
  const sacrificeCount = constraints?.count || 1;
  const permanentType = constraints?.type || 'permanent';
  const globalBattlefield = deps.getProcessedBattlefield(context.gameState);
  const playerPermanents = globalBattlefield.filter((p: any) => p.controller === playerId);

  if (playerPermanents.length === 0) {
    return {
      type: AIDecisionType.SACRIFICE,
      playerId,
      action: { sacrificed: [] },
      reasoning: 'No permanents to sacrifice',
      confidence: 0,
    };
  }

  const validTargets = playerPermanents.filter((perm: BattlefieldPermanent) => {
    if (permanentType === 'creature') return deps.hasPermanentType(perm, 'creature');
    if (permanentType === 'artifact') return deps.hasPermanentType(perm, 'artifact');
    if (permanentType === 'enchantment') return deps.hasPermanentType(perm, 'enchantment');
    if (permanentType === 'land') return deps.hasPermanentType(perm, 'land');
    return true;
  });

  const sacrificeResults: { id: string; reason: string; priority: number }[] = [];
  let remainingTargets = [...validTargets];

  for (let i = 0; i < sacrificeCount && remainingTargets.length > 0; i++) {
    const result = deps.selectSacrificeTarget(remainingTargets, gameState, playerId, true);
    if (!result.creature) continue;

    sacrificeResults.push({
      id: result.creature.id,
      reason: result.reason,
      priority: result.priority,
    });
    const selectedId = result.creature.id;
    remainingTargets = remainingTargets.filter(t => t.id !== selectedId);
  }

  const sacrificed = sacrificeResults.map(r => r.id);
  const withDeathTriggers = sacrificeResults.filter(
    r => r.reason.toLowerCase().includes('death') || r.reason.toLowerCase().includes('trigger')
  ).length;

  let reasoning = `Sacrificing ${sacrificed.length} ${permanentType}(s)`;
  if (withDeathTriggers > 0) {
    reasoning += ` (${withDeathTriggers} with beneficial death triggers!)`;
  }
  if (sacrificeResults.length > 0 && sacrificeResults[0].reason) {
    reasoning += ` - ${sacrificeResults[0].reason}`;
  }

  return {
    type: AIDecisionType.SACRIFICE,
    playerId,
    action: { sacrificed },
    reasoning,
    confidence: 0.8,
  };
}

import type { BattlefieldPermanent } from '../../shared/src';
import { cardAnalyzer } from './CardAnalyzer';
import { AIDecisionType, type AIDecision, type AIDecisionContext } from './AIEngine';

export function makeTargetDecision(
  context: AIDecisionContext,
  selectRemovalTarget: (
    candidates: BattlefieldPermanent[],
    gameState: any,
    playerId: string,
    spellType: 'destroy' | 'exile' | 'bounce'
  ) => { target: BattlefieldPermanent | null; reason: string; priority: number }
): AIDecision {
  const { playerId, options, constraints, gameState } = context;
  const targetCount = constraints?.count || 1;
  const targetType = constraints?.type || 'any';
  const spellType = constraints?.spellType as 'destroy' | 'exile' | 'bounce' | undefined;

  if (!options || options.length === 0) {
    return {
      type: AIDecisionType.SELECT_TARGET,
      playerId,
      action: { targets: [] },
      reasoning: 'No valid targets',
      confidence: 0,
    };
  }

  let selectedTargets: string[] = [];
  let reasoning = '';

  if (targetType === 'creature' || targetType === 'permanent') {
    const permanents = options.filter((opt: any) => typeof opt === 'object' && opt.id) as BattlefieldPermanent[];

    if (spellType && permanents.length > 0) {
      const results: { target: BattlefieldPermanent; reason: string; priority: number }[] = [];
      let availablePermanents = permanents;

      for (let i = 0; i < targetCount && availablePermanents.length > 0; i++) {
        const result = selectRemovalTarget(availablePermanents, gameState, playerId, spellType);
        if (result.target) {
          results.push(result as { target: BattlefieldPermanent; reason: string; priority: number });
          const selectedId = result.target.id;
          availablePermanents = availablePermanents.filter(p => p.id !== selectedId);
        }
      }

      if (results.length > 0) {
        selectedTargets = results.map(r => r.target.id);
        reasoning = results.map(r => r.reason).join('; ');
      }
    }

    if (selectedTargets.length === 0) {
      const sorted = [...options].sort((a: any, b: any) => {
        if (typeof a !== 'object' || typeof b !== 'object') return 0;

        const aAnalysis = cardAnalyzer.analyzeCard(a);
        const bAnalysis = cardAnalyzer.analyzeCard(b);
        const aIsOpponent = a.controller !== playerId;
        const bIsOpponent = b.controller !== playerId;
        if (aIsOpponent !== bIsOpponent) {
          return aIsOpponent ? -1 : 1;
        }

        return bAnalysis.removalTargetPriority - aAnalysis.removalTargetPriority;
      });

      selectedTargets = sorted.slice(0, targetCount).map((t: any) => (typeof t === 'string' ? t : t.id));
      reasoning = `Selected ${selectedTargets.length} highest-threat target(s)`;
    }
  } else if (targetType === 'player') {
    const playerOptions = options.filter((opt: any) => {
      const optId = typeof opt === 'string' ? opt : opt.id;
      return gameState.players.some((p: any) => p.id === optId && p.id !== playerId);
    });

    playerOptions.sort((a: any, b: any) => {
      const aId = typeof a === 'string' ? a : a.id;
      const bId = typeof b === 'string' ? b : b.id;
      const aPlayer = gameState.players.find((p: any) => p.id === aId);
      const bPlayer = gameState.players.find((p: any) => p.id === bId);
      return (aPlayer?.life || 0) - (bPlayer?.life || 0);
    });

    selectedTargets = playerOptions.slice(0, targetCount).map((p: any) => (typeof p === 'string' ? p : p.id));
    reasoning = 'Targeting opponent with lowest life';
  } else {
    const shuffled = [...options].sort(() => Math.random() - 0.5);
    selectedTargets = shuffled.slice(0, targetCount).map((t: any) => (typeof t === 'string' ? t : t.id));
    reasoning = 'Random target selection';
  }

  return {
    type: AIDecisionType.SELECT_TARGET,
    playerId,
    action: { targets: selectedTargets },
    reasoning: reasoning || `Selected ${selectedTargets.length} target(s)`,
    confidence: 0.8,
  };
}

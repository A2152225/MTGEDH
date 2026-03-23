import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import {
  cardAnalyzer,
  CardCategory,
  ThreatLevel,
  type BattlefieldAnalysis,
  type CardAnalysis,
} from './CardAnalyzer';

type HasPermanentType = (perm: BattlefieldPermanent, type: string) => boolean;
type GetProcessedBattlefield = (gameState: GameState) => BattlefieldPermanent[];

export function getRemovalReason(analysis: CardAnalysis): string {
  if (analysis.comboPotential >= 8) return 'Combo piece - must remove immediately';
  if (analysis.threatLevel >= ThreatLevel.CRITICAL) return 'Critical threat - will win if left unchecked';
  if (analysis.threatLevel >= ThreatLevel.HIGH) return 'High threat - significant board presence';
  if (analysis.categories.includes(CardCategory.ARISTOCRAT)) return 'Aristocrat payoff - drains life';
  if (analysis.categories.includes(CardCategory.SACRIFICE_OUTLET)) return 'Sacrifice outlet - enables combos';
  if (analysis.details.drawsCards) return 'Card advantage engine';
  if (analysis.details.producesMana) return 'Mana acceleration';
  return 'Threat';
}

export function assessBattlefieldThreats(args: {
  gameState: GameState;
  playerId: PlayerID;
  getProcessedBattlefield: GetProcessedBattlefield;
}): {
  playerAnalyses: Map<PlayerID, BattlefieldAnalysis>;
  highestThreatPlayer: PlayerID | null;
  criticalThreats: { permanentId: string; playerId: PlayerID; analysis: CardAnalysis }[];
  comboDetected: boolean;
  recommendedTargets: { permanentId: string; playerId: PlayerID; priority: number; reason: string }[];
} {
  const { gameState, playerId, getProcessedBattlefield } = args;
  const battlefield = getProcessedBattlefield(gameState);
  const playerAnalyses = new Map<PlayerID, BattlefieldAnalysis>();
  const criticalThreats: { permanentId: string; playerId: PlayerID; analysis: CardAnalysis }[] = [];
  const recommendedTargets: { permanentId: string; playerId: PlayerID; priority: number; reason: string }[] = [];
  let comboDetected = false;
  let highestThreat = 0;
  let highestThreatPlayer: PlayerID | null = null;

  for (const player of gameState.players) {
    if (player.id === playerId) continue;

    const analysis = cardAnalyzer.analyzeBattlefield(battlefield, player.id, playerId);
    playerAnalyses.set(player.id, analysis);

    if (analysis.totalThreatLevel > highestThreat) {
      highestThreat = analysis.totalThreatLevel;
      highestThreatPlayer = player.id;
    }

    if (analysis.comboPiecesOnBoard.length >= 2) {
      comboDetected = true;
    }

    for (const { permanentId, priority } of analysis.removalPriorities) {
      if (priority < 6) continue;
      const perm = battlefield.find(p => p.id === permanentId);
      if (!perm) continue;

      const cardAnalysis = cardAnalyzer.analyzeCard(perm);
      criticalThreats.push({
        permanentId,
        playerId: player.id,
        analysis: cardAnalysis,
      });
      recommendedTargets.push({
        permanentId,
        playerId: player.id,
        priority,
        reason: getRemovalReason(cardAnalysis),
      });
    }
  }

  recommendedTargets.sort((a, b) => b.priority - a.priority);

  return {
    playerAnalyses,
    highestThreatPlayer,
    criticalThreats,
    comboDetected,
    recommendedTargets,
  };
}

export function selectAttackTarget(args: {
  gameState: GameState;
  playerId: PlayerID;
  getProcessedBattlefield: GetProcessedBattlefield;
  hasPermanentType: HasPermanentType;
}): PlayerID {
  const { gameState, playerId, getProcessedBattlefield, hasPermanentType } = args;
  const opponents = gameState.players.filter(p => p.id !== playerId);
  if (opponents.length === 0) return playerId;
  if (opponents.length === 1) return opponents[0].id;

  const threatAssessment = assessBattlefieldThreats({ gameState, playerId, getProcessedBattlefield });
  const battlefield = getProcessedBattlefield(gameState);
  const opponentScores = opponents.map(opp => {
    const playerAnalysis = threatAssessment.playerAnalyses.get(opp.id);
    const life = opp.life || 40;
    let score = 0;

    if (playerAnalysis) {
      score += playerAnalysis.totalThreatLevel * 100;
      if (playerAnalysis.comboPiecesOnBoard.length >= 2) {
        score += 300;
      }
    }

    if (life <= 10) {
      score += 200;
    } else if (life <= 20) {
      score += 100;
    } else if (life <= 30) {
      score += 50;
    }

    const creatureCount = battlefield.filter((p: any) => p.controller === opp.id && hasPermanentType(p, 'creature')).length;
    score += creatureCount * 10;

    return { playerId: opp.id, score };
  });

  opponentScores.sort((a, b) => b.score - a.score);
  return opponentScores[0].playerId;
}

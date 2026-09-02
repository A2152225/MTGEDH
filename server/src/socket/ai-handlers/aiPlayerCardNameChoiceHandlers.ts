/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: chooseAIPlayerChoiceId, scoreVisibleCardNameCandidate,
 * chooseAICardNameSelection.
 *
 * Public entry symbols: chooseAIPlayerChoiceId, chooseAICardNameSelection.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { CardCategory, cardAnalyzer } from "../../../../rules-engine/src/CardAnalyzer.js";
import { aiEngine } from "./aiScheduler.js";

export function chooseAIPlayerChoiceId(game: any, playerId: PlayerID, step: any): string | undefined {
  const listedPlayers = Array.isArray(step?.players) ? step.players : [];
  const candidateIds = listedPlayers.length > 0
    ? listedPlayers
        .map((player: any) => String(player?.id || '').trim())
        .filter(Boolean)
    : (game?.state?.players || [])
        .map((player: any) => String(player?.id || '').trim())
        .filter(Boolean);

  if (candidateIds.length === 0) return undefined;

  const opponentOnly = step?.opponentOnly === true;
  const comboWarning = aiEngine.detectOpponentCombo(game.state as any, playerId);
  const threatAssessment = aiEngine.assessBattlefieldThreats(game.state as any, playerId);
  const battlefield = game?.state?.battlefield || [];

  const ranked = candidateIds
    .filter((candidateId) => !opponentOnly || candidateId !== String(playerId))
    .map((candidateId) => {
      let score = candidateId === String(playerId) ? -50 : 25;
      if (threatAssessment.highestThreatPlayer === candidateId) score += 20;
      if (comboWarning.comboPlayers.includes(candidateId)) {
        score += comboWarning.comboThreat === 'imminent' ? 30 : 15;
      }

      const battlefieldPressure = battlefield
        .filter((permanent: any) => String(permanent?.controller || '') === candidateId)
        .reduce((total: number, permanent: any) => {
          const analysis = cardAnalyzer.analyzeCard(permanent?.card);
          let permanentScore = analysis.comboPotential * 12;

          if (analysis.categories.includes(CardCategory.TUTOR)) permanentScore += 8;
          if (analysis.categories.includes(CardCategory.REMOVAL)) permanentScore += 6;
          if (analysis.categories.includes(CardCategory.DRAW)) permanentScore += 4;
          if (analysis.categories.includes(CardCategory.FINISHER)) permanentScore += 6;

          const power = Number(permanent?.card?.power || 0);
          if (Number.isFinite(power)) permanentScore += Math.max(0, power) * 2;

          return total + permanentScore;
        }, 0);

      score += battlefieldPressure;
      return { candidateId, score };
    })
    .sort((left, right) => right.score - left.score);

  if (ranked.length > 0) {
    return ranked[0].candidateId;
  }

  return opponentOnly
    ? candidateIds.find((candidateId) => candidateId !== String(playerId))
    : candidateIds[0];
}

function scoreVisibleCardNameCandidate(game: any, playerId: PlayerID, candidateName: string): number {
  const normalizedCandidate = String(candidateName || '').trim().toLowerCase();
  if (!normalizedCandidate) return -9999;

  const battlefield = game?.state?.battlefield || [];
  const stack = game?.state?.stack || [];
  const threatAssessment = aiEngine.assessBattlefieldThreats(game.state as any, playerId);

  let score = 0;

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    if (String(permanent?.card?.name || '').trim().toLowerCase() !== normalizedCandidate) continue;

    const analysis = cardAnalyzer.analyzeCard(permanent.card);
    let permanentScore = permanent.controller === playerId ? -20 : 35;
    permanentScore += analysis.comboPotential * 12;
    if (analysis.categories.includes(CardCategory.TUTOR)) permanentScore += 10;
    if (analysis.categories.includes(CardCategory.REMOVAL)) permanentScore += 8;
    if (analysis.categories.includes(CardCategory.DRAW)) permanentScore += 5;
    if (analysis.categories.includes(CardCategory.FINISHER)) permanentScore += 8;

    const power = Number(permanent?.card?.power || 0);
    if (Number.isFinite(power)) permanentScore += Math.max(0, power) * 2;
    if (threatAssessment.highestThreatPlayer === permanent.controller) permanentScore += 12;

    score += permanentScore;
  }

  for (const stackItem of stack) {
    if (!stackItem?.card) continue;
    if (String(stackItem?.card?.name || '').trim().toLowerCase() !== normalizedCandidate) continue;

    const analysis = cardAnalyzer.analyzeCard(stackItem.card);
    let stackScore = stackItem.controller === playerId ? -25 : 40;
    stackScore += analysis.comboPotential * 10;
    if (analysis.categories.includes(CardCategory.TUTOR)) stackScore += 10;
    if (analysis.categories.includes(CardCategory.REMOVAL)) stackScore += 8;
    if (analysis.categories.includes(CardCategory.DRAW)) stackScore += 5;
    if (analysis.categories.includes(CardCategory.FINISHER)) stackScore += 8;

    score += stackScore;
  }

  return score;
}

export function chooseAICardNameSelection(game: any, playerId: PlayerID, step: any): string {
  const candidateNames = Array.isArray(step?.candidateNames)
    ? step.candidateNames
        .map((candidate: any) => String(candidate || '').trim())
        .filter(Boolean)
    : [];

  if (candidateNames.length > 0) {
    return candidateNames
      .map((candidateName: string) => ({
        candidateName,
        score: scoreVisibleCardNameCandidate(game, playerId, candidateName),
      }))
      .sort((left, right) => right.score - left.score)[0]?.candidateName || candidateNames[0];
  }

  const visibleOpponentNames = [
    ...((game?.state?.battlefield || []) as any[])
      .filter((permanent: any) => permanent?.controller !== playerId && permanent?.card?.name)
      .map((permanent: any) => String(permanent.card.name || '').trim()),
    ...((game?.state?.stack || []) as any[])
      .filter((stackItem: any) => stackItem?.controller !== playerId && stackItem?.card?.name)
      .map((stackItem: any) => String(stackItem.card.name || '').trim()),
  ].filter(Boolean);

  if (visibleOpponentNames.length > 0) {
    return visibleOpponentNames
      .map((candidateName: string) => ({
        candidateName,
        score: scoreVisibleCardNameCandidate(game, playerId, candidateName),
      }))
      .sort((left, right) => right.score - left.score)[0]?.candidateName || visibleOpponentNames[0];
  }

  const restrictionText = String(step?.restrictionText || '').toLowerCase();
  if (restrictionText.includes('land')) return 'Forest';
  return 'Sol Ring';
}


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
import { lookupLocalCardByNameSync } from "../../services/localCardLookup.js";
import { normalizeCardName } from "../../state/modules/chosen-name-restrictions.js";

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

/** A real card name and its type line, or undefined when the name is not a card (tokens, test names). */
export type CardNameRecordResolver = (name: string) => { name: string; typeLine: string } | undefined;

/** Well-known real names used when nothing visible qualifies; the first one the restriction allows wins. */
const FALLBACK_CARD_NAMES: ReadonlyArray<{ name: string; typeLine: string }> = [
  { name: 'Sol Ring', typeLine: 'Artifact' },
  { name: 'Counterspell', typeLine: 'Instant' },
  { name: 'Demonic Tutor', typeLine: 'Sorcery' },
  { name: 'Llanowar Elves', typeLine: 'Creature — Elf Druid' },
  { name: 'Rhystic Study', typeLine: 'Enchantment' },
  { name: 'Jace, the Mind Sculptor', typeLine: 'Legendary Planeswalker — Jace' },
  { name: 'Command Tower', typeLine: 'Land' },
  { name: 'Forest', typeLine: 'Basic Land — Forest' },
];

const CARD_TYPE_WORDS = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery'];

/**
 * Whether a card with this type line satisfies a "choose a [restriction] card name" phrase:
 * "nonland" / "non-X" exclude X, "other than a basic land" excludes basic lands, and any plain
 * card-type words ("creature", "artifact or enchantment") require at least one of them.
 */
export function cardNameRestrictionAllows(typeLine: string, restrictionText: string): boolean {
  const type = String(typeLine || '').toLowerCase();
  let text = String(restrictionText || '').toLowerCase();
  const basicLandExcluded = /other than (?:a |an )?basic land/.test(text);
  text = text.replace(/other than (?:a |an )?basic land(?: card)?(?: name)?/g, ' ');
  if (basicLandExcluded && /\bbasic\b/.test(type) && /\bland\b/.test(type)) return false;
  for (const match of text.matchAll(/\bnon-?([a-z]{3,})/g)) {
    if (new RegExp(`\\b${match[1]}\\b`).test(type)) return false;
  }
  const required = CARD_TYPE_WORDS.filter((word) => new RegExp(`(?:^|[^a-z-])${word}\\b`).test(text));
  return required.length === 0 || required.some((word) => new RegExp(`\\b${word}\\b`).test(type));
}

/** Resolves through the local card database the same way the step validator does (exact normalized name). */
export function resolveRealCardNameRecord(name: string): { name: string; typeLine: string } | undefined {
  const trimmed = String(name || '').trim();
  if (!trimmed) return undefined;
  try {
    const record: any = lookupLocalCardByNameSync(trimmed);
    const canonical = String(record?.name || '').trim();
    if (!canonical || normalizeCardName(canonical) !== normalizeCardName(trimmed)) return undefined;
    const typeLine = String(record?.type_line || record?.card_faces?.[0]?.type_line || '');
    return { name: canonical, typeLine };
  } catch {
    return undefined;
  }
}

/**
 * First ranked visible name that is a real card allowed by the restriction; otherwise the first
 * allowed fallback name. Never returns a token/test name the step validator would reject.
 */
export function pickCardNameForChoice(
  rankedVisibleNames: readonly string[],
  restrictionText: string,
  resolve: CardNameRecordResolver = resolveRealCardNameRecord,
): string {
  for (const candidate of rankedVisibleNames) {
    const record = resolve(candidate);
    if (record && cardNameRestrictionAllows(record.typeLine, restrictionText)) return record.name;
  }
  const allowed = FALLBACK_CARD_NAMES.filter((entry) => cardNameRestrictionAllows(entry.typeLine, restrictionText));
  const verified = allowed.find((entry) => resolve(entry.name));
  return (verified || allowed[0] || FALLBACK_CARD_NAMES[0]).name;
}

/** Restriction phrase from the step, or the "choose a ... card name" phrase of its description. */
function cardNameRestrictionTextForStep(step: any): string {
  const explicit = String(step?.restrictionText || '').trim();
  if (explicit) return explicit;
  const description = String(step?.description || step?.reason || '').toLowerCase();
  const match = /(?:name|choose)\s+(?:a|an)\s+(.*?)card name/.exec(description);
  return match ? match[1] : '';
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

  const rankedVisibleNames = Array.from(new Set(visibleOpponentNames))
    .map((candidateName: string) => ({
      candidateName,
      score: scoreVisibleCardNameCandidate(game, playerId, candidateName),
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.candidateName);

  return pickCardNameForChoice(rankedVisibleNames, cardNameRestrictionTextForStep(step));
}


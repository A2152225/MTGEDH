/**
 * Targeted activated abilities: do not activate with an empty target set.
 * The AI only chooses an opponent's permanent for destroy/exile. Your own
 * permanent stays legal (Path to Exile on your token, a bounce to save something);
 * the AI does not take those lines.
 *
 * Public: reviewActivatedAbilityTargets, scoreActivatedAbilityTargets.
 */

import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { cardAnalyzer } from './CardAnalyzer';

/** removalTargetPriority is threatLevel * 2. MODERATE and up is a real threat. */
const MIN_THREAT_PRIORITY = 4;

const PERMANENT_TARGET =
  /\btarget\s+(?:(?:non-?creature|another|attacking|blocking|tapped|untapped)\s+)*(?:creature|artifact|enchantment|land|planeswalker|permanent)s?\b/i;

export interface ActivatedAbilityTargetReview {
  readonly requiresTarget: boolean;
  readonly removal: boolean;
  readonly youControl: boolean;
  readonly legal: readonly BattlefieldPermanent[];
  readonly bestThreat: { readonly permanent: BattlefieldPermanent; readonly priority: number } | null;
}

function effectText(abilityText: string): string {
  const raw = String(abilityText || '');
  const splitAt = raw.indexOf(':');
  return (splitAt >= 0 ? raw.slice(splitAt + 1) : raw).toLowerCase();
}

function typeLine(perm: BattlefieldPermanent): string {
  return String((perm as { card?: { type_line?: string } }).card?.type_line || '').toLowerCase();
}

function isCreature(perm: BattlefieldPermanent): boolean {
  return /\bcreature\b/.test(typeLine(perm));
}

function hasHexproofOrShroud(perm: BattlefieldPermanent): boolean {
  const card = perm.card as { oracle_text?: unknown; keywords?: unknown } | undefined;
  const keywords = Array.isArray(card?.keywords) ? card.keywords.join(' ') : String(card?.keywords || '');
  const text = `${String(card?.oracle_text || '')} ${keywords}`.toLowerCase();
  return /\b(?:hexproof|shroud)\b/.test(text);
}

function wantedTypes(effect: string): string[] {
  const types: string[] = [];
  for (const type of ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'permanent'] as const) {
    if (new RegExp(`\\b${type}s?\\b`).test(effect)) types.push(type);
  }
  if (types.includes('permanent') && types.length > 1) {
    return types.filter((type) => type !== 'permanent');
  }
  return types;
}

function matchesTypeClause(perm: BattlefieldPermanent, effect: string): boolean {
  if (/\bnon-?creature\b/.test(effect) && isCreature(perm)) return false;
  const types = wantedTypes(effect);
  if (types.length === 0 || types.includes('permanent')) return true;
  const line = typeLine(perm);
  return types.some((type) => line.includes(type));
}

export function reviewActivatedAbilityTargets(
  gameState: GameState,
  playerId: PlayerID,
  abilityText: string,
  battlefield?: readonly BattlefieldPermanent[],
  sourceId?: string,
): ActivatedAbilityTargetReview {
  const effect = effectText(abilityText);
  const requiresTarget = PERMANENT_TARGET.test(effect);
  const removal = /\b(?:exile|destroy)\s+target\b/.test(effect);
  const youControl = /\byou control\b/.test(effect);
  const opponentControls = /\ban opponent controls\b/.test(effect) || /\bopponents? control\b/.test(effect);
  const empty = { requiresTarget, removal, youControl, legal: [], bestThreat: null };
  if (!requiresTarget) return empty;

  const board = battlefield || ((gameState.battlefield || []) as BattlefieldPermanent[]);
  const legal = board.filter((perm) => {
    if (!perm?.card) return false;
    const controller = String(perm.controller || '');
    const mine = controller === String(playerId);
    if (youControl && !mine) return false;
    if (opponentControls && mine) return false;
    if (!mine && hasHexproofOrShroud(perm)) return false;
    if (sourceId && /\banother\b/.test(effect) && String(perm.id || '') === sourceId) return false;
    return matchesTypeClause(perm, effect);
  });

  let bestThreat: ActivatedAbilityTargetReview['bestThreat'] = null;
  if (removal && !youControl) {
    for (const permanent of legal) {
      if (String(permanent.controller || '') === String(playerId)) continue;
      const priority = cardAnalyzer.analyzeCard(permanent).removalTargetPriority;
      if (priority < MIN_THREAT_PRIORITY) continue;
      if (!bestThreat || priority > bestThreat.priority) bestThreat = { permanent, priority };
    }
  }
  return { requiresTarget, removal, youControl, legal, bestThreat };
}

export function scoreActivatedAbilityTargets(
  gameState: GameState,
  playerId: PlayerID,
  abilityText: string,
  battlefield?: readonly BattlefieldPermanent[],
): number | null {
  const review = reviewActivatedAbilityTargets(gameState, playerId, abilityText, battlefield);
  if (!review.requiresTarget) return null;
  if (review.legal.length === 0) return 0;
  if (!review.removal) return null;
  if (!review.bestThreat) return 0;
  return 14 + review.bestThreat.priority * 3;
}

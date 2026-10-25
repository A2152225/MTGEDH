/**
 * socket/interaction-handlers/interactionGraveyardCastCostAndTimingRules.ts
 *
 * Origin parent: server/src/socket/interaction.ts
 * Cluster moved: cost parsing and legality guards for casting/activating cards
 *   from the graveyard (flashback, jump-start, retrace, escape, disturb,
 *   granted permissions) plus the sorcery-speed / activation-timing windows and
 *   the live-graveyard bookkeeping helpers those flows call.
 * Public entry symbols: getCastFromGraveyardActivationCost,
 *   getDirectGraveyardCastReplayMetadata, getCastFromGraveyardDiscardCost,
 *   getCastFromGraveyardExileCost, getCastFromGraveyardSacrificeCost,
 *   getEligiblePermanentsForSacrificeCost,
 *   getCastFromGraveyardResourceValidationError,
 *   getKeywordGraveyardActivationManaCost, getExplicitGraveyardActivationCost,
 *   markCardLeftGraveyardLive, markCastFromGraveyardLive,
 *   enforceSorcerySpeedGraveyardAbility, enforceGraveyardSpellCastTiming,
 *   isBattlefieldSorcerySpeedWindow,
 *   getBattlefieldActivationTimingRestrictionError,
 *   queueSelfEtbForLiveGraveyardEntry.
 */

import { isCastingLimitedToSorceryTiming } from "../../state/modules/opponentSorceryTimingLock.js"; // B31
import { calculateTotalAvailableMana, getOrInitManaPool, parseManaCost, validateManaPayment } from "../util";
import { parseSacrificeCost, type SacrificeType } from "../../../../shared/src/textUtils";
import {
  buildGraveyardCastingPermissionId,
  getGrantedCastFromGraveyardKeywordInfo,
  getGrantedFlashbackInfo,
  getPrintedSelfCastPermissionInfo,
} from "../../state/modules/graveyard-permissions.js";
import { recordCardLeftGraveyardThisTurn } from "../../state/modules/turn-tracking.js";
import { queueSelfETBTriggersForPermanent, triggerETBEffectsForToken } from "../../state/modules/triggerEtbEntryEffects.js";
import { triggerETBEffectsForPermanent } from "../../state/modules/triggerEtbPermanentEffects.js";
import { parseWordNumber } from "../../state/utils";
import { detectAdditionalCost } from "../land-helpers.js";

export function getCastFromGraveyardActivationCost(card: any, abilityId: string, context?: { game?: any; playerId?: string }): { manaCost?: string; lifeCost?: number; hasAbility?: boolean } {
  const oracleText = String(card?.oracle_text || '');
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();
  const printedManaCost = String(card?.mana_cost || card?.manaCost || '').trim();

  if (normalizedAbilityId === 'graveyard-cast') {
    const printedSelfCastInfo = context?.game && context.playerId
      ? getPrintedSelfCastPermissionInfo((context.game as any)?.state || context.game, context.playerId as any, card, 'graveyard')
      : { hasIt: false };
    return printedSelfCastInfo.hasIt
      ? { manaCost: printedSelfCastInfo.cost || printedManaCost || undefined, hasAbility: true }
      : { hasAbility: false };
  }

  if (normalizedAbilityId === 'retrace') {
    if (/\bretrace\b/i.test(oracleText)) {
      return printedManaCost ? { manaCost: printedManaCost, hasAbility: true } : { hasAbility: true };
    }

    const grantedRetraceInfo = context?.game && context.playerId
      ? getGrantedCastFromGraveyardKeywordInfo(context.game as any, context.playerId as any, card, 'retrace')
      : { hasIt: false };
    return grantedRetraceInfo.hasIt
      ? { manaCost: grantedRetraceInfo.cost || printedManaCost || undefined, hasAbility: true }
      : { hasAbility: false };
  }

  if (normalizedAbilityId === 'jump-start') {
    if (/\bjump-start\b/i.test(oracleText)) {
      const explicitJumpStartCost = oracleText.match(/jump-start\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i)?.[1]?.trim();
      const jumpStartCost = explicitJumpStartCost || printedManaCost;
      return jumpStartCost ? { manaCost: jumpStartCost, hasAbility: true } : { hasAbility: true };
    }

    const grantedJumpStartInfo = context?.game && context.playerId
      ? getGrantedCastFromGraveyardKeywordInfo(context.game as any, context.playerId as any, card, 'jump-start')
      : { hasIt: false };
    return grantedJumpStartInfo.hasIt
      ? { manaCost: grantedJumpStartInfo.cost || printedManaCost || undefined, hasAbility: true }
      : { hasAbility: false };
  }

  const keywordPatterns: Record<string, RegExp> = {
    flashback: /flashback\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i,
    'jump-start': /jump-start\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i,
    escape: /escape\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i,
    disturb: /disturb\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i,
  };

  const manaMatch = keywordPatterns[normalizedAbilityId]?.exec(oracleText);
  const manaCost = manaMatch?.[1]?.trim();

  if (normalizedAbilityId === 'flashback' && !manaCost) {
    if (/\bflashback\b/i.test(oracleText)) {
      return { hasAbility: true };
    }

    const grantedFlashbackInfo = context?.game && context.playerId
      ? getGrantedFlashbackInfo(context.game as any, context.playerId as any, card)
      : { hasIt: false };
    if (grantedFlashbackInfo.hasIt) {
      return {
        manaCost: grantedFlashbackInfo.cost,
        hasAbility: true,
      };
    }

    return { hasAbility: false };
  }

  if (normalizedAbilityId === 'escape' && !manaCost && !/\bescape\b/i.test(oracleText)) {
    const grantedEscapeInfo = context?.game && context.playerId
      ? getGrantedCastFromGraveyardKeywordInfo(context.game as any, context.playerId as any, card, 'escape')
      : { hasIt: false };
    if (grantedEscapeInfo.hasIt) {
      return {
        manaCost: grantedEscapeInfo.cost || printedManaCost || undefined,
        hasAbility: true,
      };
    }

    return { hasAbility: false };
  }

  const keywordLine = oracleText
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().includes(normalizedAbilityId.replace('-', '')) || line.toLowerCase().includes(normalizedAbilityId));
  const lifeMatch = keywordLine?.match(/pay\s+(\d+)\s+life/i);
  const lifeCost = lifeMatch ? parseInt(lifeMatch[1], 10) : undefined;

  return {
    ...(manaCost ? { manaCost } : {}),
    ...(Number.isFinite(lifeCost) ? { lifeCost } : {}),
    hasAbility: Boolean(manaCost) || Boolean(keywordPatterns[normalizedAbilityId] && normalizedAbilityId && oracleText.toLowerCase().includes(normalizedAbilityId)),
  };
}

export function getDirectGraveyardCastReplayMetadata(
  game: any,
  playerId: string,
  card: any,
  abilityId: string,
): {
  fromZone?: 'graveyard';
  graveyardPermissionId?: string;
  graveyardPermissionSourceName?: string;
  graveyardPermissionCostMode?: 'normal' | 'without_paying_mana_cost';
  castWithoutPayingManaCost?: true;
  alternateCostId?: 'free';
} {
  if (String(abilityId || '').trim().toLowerCase() !== 'graveyard-cast') {
    return {};
  }

  const printedSelfCastInfo = getPrintedSelfCastPermissionInfo(game?.state || game, playerId as any, card, 'graveyard');
  if (!printedSelfCastInfo.hasIt) {
    return {};
  }

  const costMode: 'normal' | 'without_paying_mana_cost' = /\bwithout paying (?:its|their|that spell's) mana cost\b/i.test(String(card?.oracle_text || ''))
    ? 'without_paying_mana_cost'
    : 'normal';
  const cardId = String(card?.id || '').trim();
  const sourceName = String(card?.name || '').trim();
  const permissionId = buildGraveyardCastingPermissionId({
    playerId: String(playerId || ''),
    permission: 'cast',
    sourceZone: 'graveyard',
    cardFilter: {
      ...(cardId ? { cardIds: [cardId] } : {}),
      qualifier: 'this card',
    },
    costMode,
    duration: 'static',
    sourceId: cardId || sourceName || 'graveyard_source',
    ...(sourceName ? { sourceName } : {}),
  });

  return {
    fromZone: 'graveyard',
    graveyardPermissionId: permissionId,
    ...(sourceName ? { graveyardPermissionSourceName: sourceName } : {}),
    graveyardPermissionCostMode: costMode,
    ...(costMode === 'without_paying_mana_cost'
      ? { castWithoutPayingManaCost: true as const, alternateCostId: 'free' as const }
      : {}),
  };
}

export function getCastFromGraveyardDiscardCost(card: any, abilityId: string): { discardCount: number; discardTypeRestriction?: string } | undefined {
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();
  if (normalizedAbilityId === 'jump-start') {
    return { discardCount: 1 };
  }
  if (normalizedAbilityId === 'retrace') {
    return { discardCount: 1, discardTypeRestriction: 'land' };
  }

  const additionalCost = detectAdditionalCost(String(card?.oracle_text || ''));
  if (additionalCost?.type === 'discard' && Number(additionalCost.amount || 0) > 0) {
    return { discardCount: Math.max(1, Number(additionalCost.amount || 1)) };
  }

  return undefined;
}

type CastFromGraveyardExileCost = {
  exileCount: number;
  exileCountIsX?: boolean;
};

export function getCastFromGraveyardExileCost(card: any, abilityId: string, context?: { game?: any; playerId?: string }): CastFromGraveyardExileCost | undefined {
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();
  const oracleText = String(card?.oracle_text || '');

  if (normalizedAbilityId === 'flashback') {
    const flashbackLine = oracleText
      .split(/\r?\n/)
      .find((line) => /\bflashback\b/i.test(line));
    if (flashbackLine && /\bexile\s+x\s+cards?\s+from\s+your\s+graveyard\b/i.test(flashbackLine)) {
      return { exileCount: 0, exileCountIsX: true };
    }
  }

  if (normalizedAbilityId !== 'escape') return undefined;

  const exileMatch = oracleText.match(/exile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+other\s+cards?\s+from\s+your\s+graveyard/i);
  if (!exileMatch) {
    const grantedEscapeInfo = context?.game && context.playerId
      ? getGrantedCastFromGraveyardKeywordInfo(context.game as any, context.playerId as any, card, 'escape')
      : { hasIt: false };
    const grantedExileCount = Number((grantedEscapeInfo as any).additionalExileCount || 0);
    return grantedEscapeInfo.hasIt && grantedExileCount > 0 ? { exileCount: grantedExileCount } : undefined;
  }

  const exileCount = parseWordNumber(String(exileMatch[1] || ''), 0);
  return exileCount > 0 ? { exileCount } : undefined;
}

export function getCastFromGraveyardSacrificeCost(
  card: any,
  abilityId: string,
): {
  sacrificeType: Exclude<SacrificeType, 'self'>;
  sacrificeCount: number;
  sacrificeSubtype?: string;
  mustBeOther?: boolean;
} | undefined {
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();
  if (!normalizedAbilityId) return undefined;

  const lines = String(card?.oracle_text || '').split(/\r?\n/);
  const keywordLine = lines
    .find((line) => line.toLowerCase().includes(normalizedAbilityId.replace('-', '')) || line.toLowerCase().includes(normalizedAbilityId));
  const additionalCostLine = lines.find((line) => /\bas an additional cost to cast this spell\b/i.test(line) && /\bsacrifice\b/i.test(line));
  const sacrificeLine = /\bsacrifice\b/i.test(String(keywordLine || '')) ? keywordLine : additionalCostLine;
  if (!sacrificeLine) return undefined;

  const sacrificeInfo = parseSacrificeCost(sacrificeLine);
  if (!sacrificeInfo.requiresSacrifice || !sacrificeInfo.sacrificeType || sacrificeInfo.sacrificeType === 'self') {
    return undefined;
  }

  return {
    sacrificeType: sacrificeInfo.sacrificeType,
    sacrificeCount: Math.max(1, Number(sacrificeInfo.sacrificeCount || 1)),
    ...(sacrificeInfo.creatureSubtype ? { sacrificeSubtype: sacrificeInfo.creatureSubtype } : {}),
    ...(sacrificeInfo.mustBeOther ? { mustBeOther: true } : {}),
  };
}

export function getEligiblePermanentsForSacrificeCost(
  battlefield: any[],
  controllerId: string,
  sacrificeType: Exclude<SacrificeType, 'self'>,
  sacrificeSubtype?: string,
  mustBeOther?: boolean,
  excludedPermanentId?: string,
): any[] {
  return battlefield.filter((perm: any) => {
    if (!perm) return false;
    if (String(perm.controller || '') !== String(controllerId)) return false;
    if (mustBeOther && excludedPermanentId && String(perm.id || '') === String(excludedPermanentId)) return false;

    const typeLine = String(perm.card?.type_line || '').toLowerCase();
    let okType = false;
    switch (sacrificeType) {
      case 'creature':
        okType = typeLine.includes('creature');
        break;
      case 'artifact':
        okType = typeLine.includes('artifact');
        break;
      case 'enchantment':
        okType = typeLine.includes('enchantment');
        break;
      case 'land':
        okType = typeLine.includes('land');
        break;
      case 'nonland_permanent':
        okType = !typeLine.includes('land');
        break;
      case 'artifact_or_creature':
        okType = typeLine.includes('artifact') || typeLine.includes('creature');
        break;
      case 'permanent':
        okType = true;
        break;
      default:
        okType = false;
        break;
    }

    if (!okType) return false;
    if (sacrificeSubtype) {
      return typeLine.includes(String(sacrificeSubtype).toLowerCase());
    }
    return true;
  });
}

export function getCastFromGraveyardResourceValidationError(
  game: any,
  playerId: string,
  manaCost?: string,
  lifeCost?: number,
): { code: string; message: string } | undefined {
  if (manaCost) {
    const parsedCost = parseManaCost(manaCost);
    const pool = getOrInitManaPool(game.state, playerId);
    const totalAvailable = calculateTotalAvailableMana(pool, []);
    const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
    if (validationError) {
      return { code: 'INSUFFICIENT_MANA', message: `Cannot pay ${manaCost}: ${validationError}` };
    }
  }

  if (Number.isFinite(lifeCost) && Number(lifeCost) > 0) {
    const currentLife = Number(game.state.life?.[playerId] ?? game.state.startingLife ?? 40);
    if (!Number.isFinite(currentLife) || currentLife <= Number(lifeCost)) {
      return {
        code: 'INSUFFICIENT_LIFE',
        message: `Cannot pay ${Number(lifeCost)} life (you have ${Number.isFinite(currentLife) ? currentLife : 0} life)`,
      };
    }
  }

  return undefined;
}

export function getKeywordGraveyardActivationManaCost(card: any, abilityId: string): string | undefined {
  const oracleText = String(card?.oracle_text || '');
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();
  if (!normalizedAbilityId) return undefined;

  const escapedAbilityId = normalizedAbilityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keywordMatch = oracleText.match(new RegExp(`${escapedAbilityId}\\s*[—-]?\\s*(\\{[^}]+\\}(?:\\{[^}]+\\})*)`, 'i'));
  return keywordMatch?.[1]?.trim() || undefined;
}

export function getExplicitGraveyardActivationCost(card: any): { manaCost?: string; exileSourceFromGraveyard?: boolean } {
  const oracleText = String(card?.oracle_text || '');
  const lines = oracleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const activationMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (!activationMatch) continue;
    if (!/from\s+(?:your\s+)?graveyard/i.test(line)) continue;

    const costText = activationMatch[1].trim();
    const manaMatch = costText.match(/(\{[^}]+\}(?:\{[^}]+\})*)/);
    const exileSourceFromGraveyard = /exile\s+(?:this card|this|~|it)\s+from\s+(?:your\s+)?graveyard/i.test(costText);

    if (manaMatch || exileSourceFromGraveyard) {
      return {
        ...(manaMatch?.[1] ? { manaCost: manaMatch[1].trim() } : {}),
        ...(exileSourceFromGraveyard ? { exileSourceFromGraveyard: true } : {}),
      };
    }
  }

  return {};
}

export function markCardLeftGraveyardLive(game: any, playerId: string, card: any): void {
  try {
    recordCardLeftGraveyardThisTurn({ state: game.state } as any, String(playerId), card);
  } catch {
    // best-effort only
  }
}

export function markCastFromGraveyardLive(game: any, playerId: string): void {
  try {
    const stateAny = game.state as any;
    stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
    stateAny.castFromGraveyardThisTurn[String(playerId)] = true;
  } catch {
    // best-effort only
  }
}

export function enforceSorcerySpeedGraveyardAbility(socket: any, game: any, playerId: string, abilityName: string): boolean {
  const phase = String((game.state as any).phase || '');
  const isMainPhase = phase.toLowerCase().includes('main');
  const stack = Array.isArray(game.state?.stack) ? game.state.stack : [];
  const activePlayer = (game.state as any).turnPlayer || (game.state as any).activePlayer;

  if (activePlayer !== playerId) {
    socket.emit('error', {
      code: 'NOT_YOUR_TURN',
      message: `${abilityName} can only be activated on your turn (sorcery speed)`,
    });
    return false;
  }

  if (!isMainPhase || stack.length > 0) {
    socket.emit('error', {
      code: 'SORCERY_SPEED_ONLY',
      message: `${abilityName} can only be activated at sorcery speed (main phase, empty stack)`,
    });
    return false;
  }

  return true;
}

/**
 * Flashback / jump-start / etc. use the card's normal cast timing (CR 702.34a).
 * "Flashback" must not be treated as the Flash keyword.
 * Kept local to avoid a can-respond ↔ game-actions ↔ interaction import cycle.
 */
function cardHasFlashOrInstantForGraveyardCast(card: any): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (typeLine.includes('instant')) return true;
  const oracleText = String(card?.oracle_text || card?.oracleText || '');
  return /\bflash\b/i.test(oracleText);
}

export function enforceGraveyardSpellCastTiming(params: {
  game: any;
  playerId: string;
  card: any;
  abilityId: string;
  emitError: (payload: { code: string; message: string }) => void;
}): boolean {
  if (cardHasFlashOrInstantForGraveyardCast(params.card) && !isCastingLimitedToSorceryTiming(params.game?.state, String(params.playerId))) { // B31 Teferi
    return true;
  }

  const phase = String((params.game.state as any)?.phase || '');
  const step = String((params.game.state as any)?.step || '');
  const isMainPhase = phase.toLowerCase().includes('main') || step.toUpperCase().includes('MAIN');
  const stack = Array.isArray(params.game.state?.stack) ? params.game.state.stack : [];
  const activePlayer = (params.game.state as any)?.turnPlayer || (params.game.state as any)?.activePlayer;
  const abilityLabel = String(params.abilityId || 'graveyard cast');
  const cardName = String(params.card?.name || 'This spell');

  if (activePlayer !== params.playerId) {
    params.emitError({
      code: 'SORCERY_TIMING',
      message: `${cardName} (${abilityLabel}) can only be cast during your turn.`,
    });
    return false;
  }

  if (!isMainPhase) {
    params.emitError({
      code: 'SORCERY_TIMING',
      message: `${cardName} (${abilityLabel}) can only be cast during a main phase (it doesn't have flash).`,
    });
    return false;
  }

  if (stack.length > 0) {
    params.emitError({
      code: 'SORCERY_TIMING',
      message: `${cardName} (${abilityLabel}) can only be cast when the stack is empty (it doesn't have flash).`,
    });
    return false;
  }

  return true;
}

export function isBattlefieldSorcerySpeedWindow(game: any, playerId: string): boolean {
  const state = game?.state || {};
  if (String(state.turnPlayer || '') !== String(playerId || '')) return false;
  if (Array.isArray(state.stack) && state.stack.length > 0) return false;
  const step = String(state.step || state.phase || '').toLowerCase();
  return !step || step.includes('main');
}

export function getBattlefieldActivationTimingRestrictionError(game: any, playerId: string, abilityText: string, cardName: string): { code: string; message: string } | null {
  const text = String(abilityText || '').toLowerCase();
  if (/\bactivate(?:\s+(?:this ability|these abilities))?\s+only\s+(?:as a sorcery|any time you could cast a sorcery)\b/i.test(text)) {
    if (!isBattlefieldSorcerySpeedWindow(game, playerId)) {
      return {
        code: 'SORCERY_SPEED_ONLY',
        message: `${cardName} can only be activated at sorcery speed (your main phase with an empty stack).`,
      };
    }
  }

  if (/\bactivate(?:\s+(?:this ability|these abilities))?\s+only\s+during\s+your\s+turn\b/i.test(text)
    && String(game?.state?.turnPlayer || '') !== String(playerId || '')) {
    return {
      code: 'WRONG_TIMING',
      message: `${cardName} can only be activated during your turn.`,
    };
  }

  return null;
}

export function queueSelfEtbForLiveGraveyardEntry(game: any, gameId: string, playerId: string, permanent: any): void {
  const ctx = {
    state: game.state,
    gameId,
    inactive: new Set(),
    libraries: (game as any).libraries,
    players: game.state?.players,
  };
  queueSelfETBTriggersForPermanent(ctx as any, permanent, playerId as any);
  if (permanent?.isToken === true) {
    triggerETBEffectsForToken(ctx as any, permanent, playerId as any);
    return;
  }
  triggerETBEffectsForPermanent(ctx as any, permanent, playerId as any, false);
}

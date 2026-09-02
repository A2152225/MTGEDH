/**
 * Origin parent: oracleIRExecutorDamageStepHandlers.ts
 * Cluster: reference damage amounts from controlled-permanent counts
 *   ("the number of lands that player controls", nonbasic / untapped / snow,
 *    Islands, twice/triple, that creature's controller).
 * Public: resolveControlledPermanentCountDamageAmount
 */

import type { GameState, PlayerID } from '../../../shared/src';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import {
  getExecutorTypeLineLower,
  hasExecutorClass,
} from '../oracleIRExecutorPermanentUtils';

function normalizeCountText(raw: string): string {
  return String(raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function readControllerId(permanent: any): string {
  return String(permanent?.controller || permanent?.controllerId || '').trim();
}

function permanentIsTapped(permanent: any): boolean {
  return Boolean(permanent?.tapped || permanent?.isTapped);
}

function permanentMatchesCountType(permanent: any, typeText: string): boolean {
  let rest = normalizeCountText(typeText);
  if (!rest) return false;

  let requireTapped: boolean | null = null;
  if (/^untapped\s+/.test(rest)) {
    requireTapped = false;
    rest = rest.replace(/^untapped\s+/, '');
  } else if (/^tapped\s+/.test(rest)) {
    requireTapped = true;
    rest = rest.replace(/^tapped\s+/, '');
  }

  if (requireTapped === true && !permanentIsTapped(permanent)) return false;
  if (requireTapped === false && permanentIsTapped(permanent)) return false;

  const typeLine = getExecutorTypeLineLower(permanent);
  if (/^nonbasic lands?$/.test(rest)) {
    return hasExecutorClass(permanent, 'land') && !/\bbasic\b/.test(typeLine);
  }
  if (/^basic lands?$/.test(rest)) {
    return hasExecutorClass(permanent, 'land') && /\bbasic\b/.test(typeLine);
  }
  if (/^snow lands?$/.test(rest)) {
    return hasExecutorClass(permanent, 'land') && /\bsnow\b/.test(typeLine);
  }
  if (/^lands?$/.test(rest)) return hasExecutorClass(permanent, 'land');

  const klass = rest.endsWith('s') && rest.length > 2 ? rest.slice(0, -1) : rest;
  return hasExecutorClass(permanent, klass);
}

function resolveCountedPlayerId(
  rawController: string,
  ctx: OracleIRExecutionContext,
): PlayerID | null {
  const clause = normalizeCountText(rawController);
  const controllerId = String(ctx.controllerId || '').trim();
  const targetPlayerId = String(
    ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || '',
  ).trim();

  if (clause === 'you control') return (controllerId || null) as PlayerID | null;
  if (
    clause === 'that player controls' ||
    clause === 'they control' ||
    clause === "that creature's controller controls" ||
    clause === 'that creatures controller controls'
  ) {
    return (targetPlayerId || null) as PlayerID | null;
  }
  if (clause === 'defending player controls' || clause === 'the defending player controls') {
    const defendingId = String(
      ctx.selectorContext?.targetOpponentId || targetPlayerId || '',
    ).trim();
    return (defendingId || null) as PlayerID | null;
  }
  return null;
}

export function resolveControlledPermanentCountDamageAmount(
  state: GameState,
  rawAmount: string,
  ctx: OracleIRExecutionContext,
): number | null {
  const raw = normalizeCountText(rawAmount);
  if (!raw) return null;

  const match = raw.match(
    /^(twice |triple )?the number of (.+?) (you control|that player controls|they control|(?:that|the) creature(?:'s|s) controller controls|defending player controls|the defending player controls)$/i,
  );
  if (!match) return null;

  const multiplierText = String(match[1] || '').trim().toLowerCase();
  const multiplier = multiplierText === 'twice' ? 2 : multiplierText === 'triple' ? 3 : 1;
  const playerId = resolveCountedPlayerId(String(match[3] || ''), ctx);
  if (!playerId) return null;

  const typeText = String(match[2] || '').trim();
  const count = ((state.battlefield || []) as any[]).filter((permanent) => (
    readControllerId(permanent) === playerId && permanentMatchesCountType(permanent, typeText)
  )).length;
  return Math.max(0, count * multiplier);
}

/**
 * Extracted from loopShortcuts.ts: battlefield target-match primitives.
 * Cluster moved: getBattlefieldPermanent through scoreCandidateAgainstProfile.
 * Public: getBattlefieldPermanent, buildTargetMatchProfile, isTokenPermanent,
 * isExplicitNonTokenPermanent, isCommanderPermanent, isControlledBy,
 * typeLineOverlapScore, scoreCandidateAgainstProfile
 *
 * Leaf must not import loopShortcuts.ts or loopShortcuts-handlers/index.ts.
 */

import type { ClientGameView } from '../../../../shared/src';
import type { LoopShortcutIdTemplate, LoopShortcutTargetMatchProfile } from './loopShortcutsTypes';
import { normalizeText } from './loopShortcutsTextUtils';

export function getBattlefieldPermanent(view: ClientGameView | null | undefined, id: string): any | undefined {
  const battlefield = Array.isArray(view?.battlefield) ? view?.battlefield : [];
  const targetId = String(id || '');
  if (!targetId) return undefined;

  const direct = battlefield.find((permanent: any) => String(permanent?.id || '') === targetId);
  if (direct) return direct;

  // Server broadcast collapses identical tokens into one group entry (`group_<id>`).
  // Sacrifice / target prompts still use the real member IDs in groupedTokenIds.
  for (const permanent of battlefield) {
    if (permanent?.isGroupedTokens !== true) continue;
    const groupedIds = Array.isArray(permanent?.groupedTokenIds) ? permanent.groupedTokenIds : [];
    if (!groupedIds.some((entry: unknown) => String(entry || '') === targetId)) continue;

    return {
      ...permanent,
      id: targetId,
      isToken: true,
      isGroupedTokens: false,
      tokenCount: 1,
      groupedTokenIds: undefined,
    };
  }

  return undefined;
}

function getValidTargetEntry(step: any, id: string): any | undefined {
  const validTargets = Array.isArray(step?.validTargets) ? step.validTargets : [];
  return validTargets.find((entry: any) => String(entry?.id || '') === String(id || ''));
}

function resolveOptionalBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (value === true) return true;
    if (value === false) return false;
  }
  return undefined;
}

function looksLikeTokenId(id: string): boolean {
  return /^(tok|token|copytok|group_)/i.test(String(id || '').trim());
}

function getPermanentDisplayName(permanent: any, validTarget?: any): string {
  return String(
    permanent?.card?.name
    || permanent?.name
    || validTarget?.label
    || validTarget?.name
    || ''
  ).trim();
}

function getPermanentTypeLineValue(permanent: any, validTarget?: any): string {
  return String(
    permanent?.type_line
    || permanent?.card?.type_line
    || validTarget?.typeLine
    || validTarget?.description
    || ''
  ).trim();
}

export function buildTargetMatchProfile(
  step: any,
  view: ClientGameView | null | undefined,
  id: string
): LoopShortcutTargetMatchProfile {
  const permanent = getBattlefieldPermanent(view, id);
  const validTarget = getValidTargetEntry(step, id);
  const name = getPermanentDisplayName(permanent, validTarget);
  const typeLine = getPermanentTypeLineValue(permanent, validTarget);
  const isToken = resolveOptionalBoolean(
    permanent?.isToken,
    permanent?.isCopyToken,
    permanent?.card?.isToken,
    validTarget?.isToken,
    // Fallback: token ids from createToken / grouped members.
    looksLikeTokenId(id) || looksLikeTokenId(String(permanent?.id || '')) ? true : undefined,
  );
  const tapped = resolveOptionalBoolean(permanent?.tapped, validTarget?.tapped);
  const isCommander = resolveOptionalBoolean(
    permanent?.isCommander,
    permanent?.card?.isCommander,
    validTarget?.isCommander
  );

  return {
    ...(name ? { name } : {}),
    ...(typeLine ? { typeLine } : {}),
    ...(typeof isToken === 'boolean' ? { isToken } : {}),
    ...(typeof tapped === 'boolean' ? { tapped } : {}),
    ...(typeof isCommander === 'boolean' ? { isCommander } : {}),
  };
}

export function isTokenPermanent(
  view: ClientGameView | null | undefined,
  id: string,
  step?: any
): boolean {
  const profile = buildTargetMatchProfile(step, view, id);
  return profile.isToken === true;
}

export function isExplicitNonTokenPermanent(
  view: ClientGameView | null | undefined,
  id: string,
  step?: any
): boolean {
  const profile = buildTargetMatchProfile(step, view, id);
  return profile.isToken === false;
}

export function isCommanderPermanent(
  view: ClientGameView | null | undefined,
  id: string,
  step?: any
): boolean {
  return buildTargetMatchProfile(step, view, id).isCommander === true;
}

export function isControlledBy(
  view: ClientGameView | null | undefined,
  id: string,
  playerId: string | null | undefined,
  step?: any
): boolean {
  if (!playerId) return false;
  const permanent = getBattlefieldPermanent(view, id);
  if (permanent) {
    return String(permanent?.controller || '') === String(playerId || '');
  }
  const validTarget = getValidTargetEntry(step, id);
  if (validTarget?.controller) {
    return String(validTarget.controller) === String(playerId || '');
  }
  return false;
}

export function typeLineOverlapScore(left: string, right: string): number {
  const leftNorm = normalizeText(left);
  const rightNorm = normalizeText(right);
  if (!leftNorm || !rightNorm) return 0;
  if (leftNorm === rightNorm) return 60;

  const ignore = new Set(['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle', 'kindred', 'tribal']);
  const leftParts = leftNorm.split(/[^a-z0-9]+/).filter((part) => part && !ignore.has(part));
  const rightParts = new Set(rightNorm.split(/[^a-z0-9]+/).filter((part) => part && !ignore.has(part)));
  let overlap = 0;
  for (const part of leftParts) {
    if (rightParts.has(part)) overlap += 1;
  }
  return overlap * 20;
}

export function scoreCandidateAgainstProfile(
  candidate: LoopShortcutTargetMatchProfile & { controllerMatched: boolean },
  profile: LoopShortcutTargetMatchProfile | undefined,
  template: Extract<LoopShortcutIdTemplate, { kind: 'select_valid_targets' }>
): number {
  let score = 0;

  if (template.preferTokens && candidate.isToken === true) score += 100;
  if (template.preferNonTokens && candidate.isToken === false) score += 100;
  if (template.requireSelfControlled && candidate.controllerMatched) score += 50;
  if (template.preferTapped && candidate.tapped === true) score += 80;
  if (template.preferUntapped && candidate.tapped === false) score += 80;
  if (template.avoidCommanders && candidate.isCommander === true) score -= 500;

  if (!profile) return score;

  if (profile.name && candidate.name && normalizeText(profile.name) === normalizeText(candidate.name)) {
    score += 200;
  }

  if (typeof profile.isToken === 'boolean') {
    if (candidate.isToken === profile.isToken) score += 100;
    else score -= 80;
  }

  if (typeof profile.tapped === 'boolean') {
    if (candidate.tapped === profile.tapped) score += 120;
    else score -= 60;
  }

  if (typeof profile.isCommander === 'boolean') {
    if (candidate.isCommander === profile.isCommander) score += 40;
    else if (profile.isCommander === false && candidate.isCommander === true) score -= 500;
  }

  if (profile.typeLine && candidate.typeLine) {
    score += typeLineOverlapScore(profile.typeLine, candidate.typeLine);
  }

  return score;
}


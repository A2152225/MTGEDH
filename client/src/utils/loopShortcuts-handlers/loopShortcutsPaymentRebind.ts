/**
 * Extracted from loopShortcuts.ts: payment permanent rebind helpers.
 * Cluster moved: scorePaymentPermanentCandidate, rebindPaymentPermanentId, rebindProfileIds.
 * Public: rebindPaymentPermanentId, rebindProfileIds
 *
 * Leaf must not import loopShortcuts.ts or loopShortcuts-handlers/index.ts.
 */

import type { ClientGameView } from '../../../../shared/src';
import type { LoopShortcutTargetMatchProfile, RankedTarget } from './loopShortcutsTypes';
import { normalizeText } from './loopShortcutsTextUtils';
import {
  buildTargetMatchProfile,
  getBattlefieldPermanent,
  isControlledBy,
  typeLineOverlapScore,
} from './loopShortcutsTargetMatchUtils';

function scorePaymentPermanentCandidate(
  candidate: LoopShortcutTargetMatchProfile & { controllerMatched: boolean; id: string },
  profile: LoopShortcutTargetMatchProfile | undefined
): number {
  let score = 0;
  if (candidate.controllerMatched) score += 50;
  if (!profile) return score;

  if (profile.name && candidate.name && normalizeText(profile.name) === normalizeText(candidate.name)) {
    score += 200;
  }
  if (typeof profile.isToken === 'boolean') {
    if (candidate.isToken === profile.isToken) score += 100;
    else score -= 80;
  }
  if (typeof profile.tapped === 'boolean') {
    // Prefer matching tapped state, but do not hard-require it — payment sources are usually untapped.
    if (candidate.tapped === profile.tapped) score += 40;
  } else if (candidate.tapped === false) {
    score += 30;
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

export function rebindPaymentPermanentId(
  profile: LoopShortcutTargetMatchProfile | undefined,
  stickyId: string | undefined,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined,
  usedIds: Set<string>
): string | null {
  if (stickyId && !usedIds.has(stickyId) && getBattlefieldPermanent(view, stickyId)) {
    usedIds.add(stickyId);
    return stickyId;
  }

  const battlefield = Array.isArray(view?.battlefield) ? view!.battlefield : [];
  const ranked = battlefield
    .map((permanent: any, index: number) => {
      const id = String(permanent?.id || '');
      if (!id || usedIds.has(id)) return null;
      const candidateProfile = buildTargetMatchProfile(null, view, id);
      const score = scorePaymentPermanentCandidate(
        {
          ...candidateProfile,
          id,
          controllerMatched: isControlledBy(view, id, playerId),
        },
        profile
      );
      return { id, index, score };
    })
    .filter((entry): entry is RankedTarget => Boolean(entry))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    });

  const best = ranked[0];
  // Require a name/type match signal so we do not grab an arbitrary permanent.
  if (!best || best.score < 150) return null;
  usedIds.add(best.id);
  return best.id;
}

export function rebindProfileIds(
  profiles: LoopShortcutTargetMatchProfile[] | undefined,
  stickyIds: string[] | undefined,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined,
  usedIds: Set<string>
): string[] {
  const count = Math.max(profiles?.length || 0, stickyIds?.length || 0);
  const selected: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const rebound = rebindPaymentPermanentId(
      profiles?.[i],
      stickyIds?.[i],
      view,
      playerId,
      usedIds
    );
    if (!rebound) continue;
    selected.push(rebound);
  }
  return selected;
}


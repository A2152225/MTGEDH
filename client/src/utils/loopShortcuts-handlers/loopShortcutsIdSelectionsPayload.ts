/**
 * Extracted from loopShortcuts.ts: dynamic target id selection payload.
 * Cluster moved: filterDynamicCandidateIds, buildIdSelectionsPayload.
 * Public: buildIdSelectionsPayload
 *
 * Leaf must not import loopShortcuts.ts or loopShortcuts-handlers/index.ts.
 */

import type { ClientGameView } from '../../../../shared/src';
import type { LoopShortcutIdTemplate, LoopShortcutTargetMatchProfile, RankedTarget } from './loopShortcutsTypes';
import { getPromptValidTargetIds } from './loopShortcutsPromptValidTargets';
import {
  buildTargetMatchProfile,
  isCommanderPermanent,
  isControlledBy,
  isTokenPermanent,
  scoreCandidateAgainstProfile,
} from './loopShortcutsTargetMatchUtils';

function filterDynamicCandidateIds(
  validTargetIds: string[],
  template: Extract<LoopShortcutIdTemplate, { kind: 'select_valid_targets' }>,
  profile: LoopShortcutTargetMatchProfile | undefined,
  step: any,
  view: ClientGameView | null | undefined
): string[] {
  let candidates = [...validTargetIds];

  const wantsTokens =
    template.preferTokens === true
    || profile?.isToken === true;
  if (wantsTokens) {
    const tokenIds = candidates.filter((id) => isTokenPermanent(view, id, step));
    if (tokenIds.length > 0) {
      candidates = tokenIds;
    }
  }

  const avoidCommanders =
    template.avoidCommanders === true
    || profile?.isCommander === false;
  if (avoidCommanders) {
    const nonCommanders = candidates.filter((id) => !isCommanderPermanent(view, id, step));
    if (nonCommanders.length > 0) {
      candidates = nonCommanders;
    }
  }

  if (template.preferTapped === true || profile?.tapped === true) {
    const tappedIds = candidates.filter((id) => buildTargetMatchProfile(step, view, id).tapped === true);
    if (tappedIds.length > 0) {
      candidates = tappedIds;
    }
  } else if (template.preferUntapped === true || profile?.tapped === false) {
    const untappedIds = candidates.filter((id) => buildTargetMatchProfile(step, view, id).tapped === false);
    if (untappedIds.length > 0) {
      candidates = untappedIds;
    }
  }

  return candidates;
}

export function buildIdSelectionsPayload(
  template: LoopShortcutIdTemplate,
  step: any,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined
): string[] | null {
  if (template.kind === 'specific_ids') {
    const validIds = new Set(getPromptValidTargetIds(step, view, playerId));
    if (validIds.size === 0) {
      return [...template.ids];
    }

    const selected = template.ids.filter(id => validIds.has(String(id)));
    if (selected.length !== template.ids.length) return null;
    return selected;
  }

  const validTargetIds = getPromptValidTargetIds(step, view, playerId);
  if (validTargetIds.length === 0) return null;

  const profiles: Array<LoopShortcutTargetMatchProfile | undefined> =
    Array.isArray(template.matchProfiles) && template.matchProfiles.length > 0
      ? template.matchProfiles.slice(0, Math.max(0, template.count))
      : Array.from({ length: Math.max(0, template.count) }, () => undefined);

  // Pad profiles when an older saved loop only stored aggregate preferences.
  while (profiles.length < Math.max(0, template.count)) {
    profiles.push(undefined);
  }

  const usedIds = new Set<string>();
  const selected: string[] = [];

  for (const profile of profiles) {
    const candidateIds = filterDynamicCandidateIds(
      validTargetIds.filter((id: string) => !usedIds.has(id)),
      template,
      profile,
      step,
      view
    );

    const rankedTargets: RankedTarget[] = candidateIds
      .map((id: string, index: number) => {
        const candidateProfile = buildTargetMatchProfile(step, view, id);
        const score = scoreCandidateAgainstProfile(
          {
            ...candidateProfile,
            controllerMatched: isControlledBy(view, id, playerId, step),
          },
          profile,
          template
        );

        return {
          id,
          index,
          score,
        };
      })
      .sort((left: RankedTarget, right: RankedTarget) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.index - right.index;
      });

    const best = rankedTargets[0];
    if (!best) return null;
    usedIds.add(best.id);
    selected.push(best.id);
  }

  if (selected.length !== Math.max(0, template.count)) {
    return null;
  }

  return selected;
}


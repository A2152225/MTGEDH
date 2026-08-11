/**
 * Keyword-action "again / twice" replacements (not stack trigger doublers):
 * - Tekuthal: If you would proliferate, proliferate twice instead.
 * - Topography Tracker: If a creature you control would explore, instead it explores, then it explores again.
 */

function permanentOracleText(permanent: any): string {
  return String(permanent?.card?.oracle_text || '');
}

export function controllerWouldProliferateTwiceInstead(
  battlefield: any[] | undefined | null,
  controllerId: string,
): boolean {
  const ctrl = String(controllerId || '');
  if (!ctrl) return false;
  for (const permanent of Array.isArray(battlefield) ? battlefield : []) {
    if (!permanent || String(permanent.controller || '') !== ctrl) continue;
    if (/if you would proliferate,\s*proliferate twice instead/i.test(permanentOracleText(permanent))) {
      return true;
    }
  }
  return false;
}

export function controllerWouldExploreAgainInstead(
  battlefield: any[] | undefined | null,
  controllerId: string,
): boolean {
  const ctrl = String(controllerId || '');
  if (!ctrl) return false;
  for (const permanent of Array.isArray(battlefield) ? battlefield : []) {
    if (!permanent || String(permanent.controller || '') !== ctrl) continue;
    if (
      /if a creature you control would explore,\s*instead it explores,\s*then it explores again/i.test(
        permanentOracleText(permanent),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** How many proliferate actions to perform for one would-proliferate event. */
export function getProliferateActionCount(
  battlefield: any[] | undefined | null,
  controllerId: string,
  options?: { skipReplacement?: boolean },
): number {
  if (options?.skipReplacement) return 1;
  return controllerWouldProliferateTwiceInstead(battlefield, controllerId) ? 2 : 1;
}

/** How many explore actions to perform for one would-explore event. */
export function getExploreActionCount(
  battlefield: any[] | undefined | null,
  controllerId: string,
  options?: { skipReplacement?: boolean },
): number {
  if (options?.skipReplacement) return 1;
  return controllerWouldExploreAgainInstead(battlefield, controllerId) ? 2 : 1;
}

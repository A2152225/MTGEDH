import {
  controllerWouldProliferateTwiceInstead,
  controllerWouldExploreAgainInstead,
  getProliferateActionCount as getNameTableProliferateActionCount,
  getExploreActionCount,
} from '../../../../rules-engine/src/keywordActionRepetition.js';
import { getOracleProliferateActionCount } from './replacementBatch91ProliferateReplacements.js';

export {
  controllerWouldProliferateTwiceInstead,
  controllerWouldExploreAgainInstead,
  getExploreActionCount,
};

/** How many proliferate actions to perform for one would-proliferate event. */
export function getProliferateActionCount(
  battlefield: any[] | undefined | null,
  controllerId: string,
  options?: { skipReplacement?: boolean },
): number {
  if (options?.skipReplacement) return 1;
  const oracleCount = getOracleProliferateActionCount({ battlefield }, controllerId);
  if (oracleCount > 1) return oracleCount;
  return getNameTableProliferateActionCount(battlefield, controllerId, options);
}

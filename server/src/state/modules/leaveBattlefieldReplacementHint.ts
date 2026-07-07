import { evaluateReplacementEvent, type ReplacementZone } from './replacement-effects.js';

export interface LeaveBattlefieldReplacementHint {
  leaveBattlefieldReplacementDestination?: 'exile';
  leaveBattlefieldReplacementSourceName?: string;
  leaveBattlefieldReplacementLifeGain?: number;
}

/** Read-only replacement preview for target prompts (sacrifice / bounce / return land). */
export function getDeclarativeLeaveBattlefieldReplacementHint(
  permanent: any,
  intendedDestination: ReplacementZone,
  state?: unknown,
): LeaveBattlefieldReplacementHint {
  const result = evaluateReplacementEvent({
    type: 'zone-change',
    state,
    object: permanent,
    objectId: String(permanent?.id || permanent?.card?.id || ''),
    sourceZone: 'battlefield',
    destinationZone: intendedDestination,
    controller: permanent?.controller,
    owner: permanent?.owner,
  });

  if (!result.applied || result.replacementDestination !== 'exile') {
    return {};
  }

  const sourceName = String(
    result.sourceName
    || permanent?.leaveBattlefieldReplacementSourceName
    || permanent?.card?.leaveBattlefieldReplacementSourceName
    || '',
  ).trim();
  const lifeGain = Number(
    result.lifeGain
    ?? permanent?.leaveBattlefieldReplacementLifeGain
    ?? permanent?.card?.leaveBattlefieldReplacementLifeGain
    ?? 0,
  );

  return {
    leaveBattlefieldReplacementDestination: 'exile',
    ...(sourceName ? { leaveBattlefieldReplacementSourceName: sourceName } : {}),
    ...(lifeGain > 0 ? { leaveBattlefieldReplacementLifeGain: lifeGain } : {}),
  };
}

// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: resolveSubtypeOrCompoundBattlefieldPermanents, filterIllegalDirectTargetPermanents.
// Public entries: those two resolvers.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import { canTargetPermanent } from './permanentTargeting';

export function resolveSubtypeOrCompoundBattlefieldPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] | null {
  if (!target || target.kind !== 'raw') return null;
  const text = String((target as any).text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  if (/^each of those\b/i.test(text)) return null;

  const controllerId = String(ctx.controllerId || '').trim();
  const controllerMatches = (permanent: BattlefieldPermanent, controllerFilter: 'any' | 'you' | 'opponents'): boolean => {
    if (controllerFilter === 'any') return true;
    const permanentController = String((permanent as any)?.controller || '').trim();
    if (!permanentController || !controllerId) return false;
    return controllerFilter === 'you' ? permanentController === controllerId : permanentController !== controllerId;
  };

  const allSubtypeTokensMatch = text.match(/^all ([a-z][a-z -]+) tokens(?: you control)?$/i);
  if (allSubtypeTokensMatch) {
    const rawSubtype = String(allSubtypeTokensMatch[1] || '').trim();
    const controllerFilter = /you control$/i.test(text) ? 'you' : 'any';
    return battlefield.filter(perm => {
      if (!(perm as any)?.isToken) return false;
      if (!controllerMatches(perm, controllerFilter)) return false;
      return typeLineHasSubtype(perm, rawSubtype);
    });
  }

  const noncreatureArtifactMatch = text.match(/^each noncreature artifacts?(?: you control)?$/i);
  if (noncreatureArtifactMatch) {
    const controllerFilter = /you control$/i.test(text) ? 'you' : 'any';
    return battlefield.filter(perm =>
      controllerMatches(perm, controllerFilter) &&
      permanentMatchesType(perm, 'artifact') &&
      !permanentMatchesType(perm, 'creature')
    );
  }

  const artifactCreatureMatch = text.match(/^(?:all\s+|each\s+)?artifact\s+creatures(?:\s+(you\s+control|your\s+opponents\s+control))?$/i);
  if (artifactCreatureMatch) {
    const filterText = String(artifactCreatureMatch[1] || '').trim().toLowerCase();
    const controllerFilter = filterText === 'you control' ? 'you' : filterText === 'your opponents control' ? 'opponents' : 'any';
    return battlefield.filter(perm =>
      controllerMatches(perm, controllerFilter) &&
      permanentMatchesType(perm, 'artifact') &&
      permanentMatchesType(perm, 'creature')
    );
  }

  const subtypeCreatureMatch = text.match(/^(?:all\s+|each\s+)([a-z][a-z -]+?)(?:\s+creatures?)?(?:\s+(you\s+control|your\s+opponents\s+control))?$/i);
  if (!subtypeCreatureMatch) return null;

  const rawSubtype = String(subtypeCreatureMatch[1] || '').trim();
  if (!rawSubtype || /^(?:creature|artifact|enchantment|land|permanent|nonland|target|another target)$/i.test(rawSubtype)) return null;
  const filterText = String(subtypeCreatureMatch[2] || '').trim().toLowerCase();
  const controllerFilter = filterText === 'you control' ? 'you' : filterText === 'your opponents control' ? 'opponents' : 'any';

  return battlefield.filter(perm =>
    controllerMatches(perm, controllerFilter) &&
    permanentMatchesType(perm, 'creature') &&
    typeLineHasSubtype(perm, rawSubtype)
  );
}

export function filterIllegalDirectTargetPermanents(
  permanents: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext,
  state?: GameState
): BattlefieldPermanent[] {
  return permanents.filter((perm: any) =>
    canTargetPermanent(perm, {
      controllerId: ctx.controllerId,
      colors: ctx.sourceColors,
      objectType: ctx.sourceObjectType,
    }, state).canTarget
  );
}

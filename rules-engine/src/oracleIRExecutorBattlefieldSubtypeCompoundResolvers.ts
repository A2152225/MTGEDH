// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: resolveSubtypeOrCompoundBattlefieldPermanents, filterIllegalDirectTargetPermanents.
// Public entries: those two resolvers.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { normalizeCreatureTypeWord } from '../../shared/src/creatureTypes.js';
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

  const sourceId = String(ctx.sourceId || '').trim();
  const permanentIdOf = (perm: BattlefieldPermanent): string => String((perm as any)?.id || '').trim();

  // "each creature you control that's an Ape or a Monkey"
  const thatsAnMatch = text.match(
    /^(?:all\s+|each\s+)creatures?\s+(you\s+control|your\s+opponents\s+control)\s+that(?:'s| is| are)\s+(?:an?\s+)?(.+)$/i
  );
  if (thatsAnMatch) {
    const subtypes = splitSubtypeUnion(String(thatsAnMatch[2] || ''));
    if (subtypes.length === 0) return null;
    const controllerFilter = /^you/i.test(String(thatsAnMatch[1])) ? 'you' : 'opponents';
    return battlefield.filter(perm =>
      controllerMatches(perm, controllerFilter) &&
      permanentMatchesType(perm, 'creature') &&
      subtypes.some(subtype => typeLineHasSubtype(perm, subtype))
    );
  }

  // "each other Dragon creature you control", "each other Merfolk and/or Knight you control"
  const subtypeCreatureMatch = text.match(
    /^(?:all\s+|each\s+)(?:(other|another)\s+)?([a-z][a-z /-]+?)(?:\s+creatures?)?(?:\s+(you\s+control|your\s+opponents\s+control))?$/i
  );
  if (!subtypeCreatureMatch) return resolveBareSubtypeTeamPermanents(battlefield, text, ctx, controllerMatches);

  const excludeSource = Boolean(subtypeCreatureMatch[1]);
  const rawSubtype = String(subtypeCreatureMatch[2] || '').trim();
  if (!rawSubtype || /^(?:creature|artifact|enchantment|land|permanent|nonland|target|another target)$/i.test(rawSubtype)) return null;
  const subtypes = splitSubtypeUnion(rawSubtype);
  if (subtypes.length === 0) return null;
  const filterText = String(subtypeCreatureMatch[3] || '').trim().toLowerCase();
  const controllerFilter = filterText === 'you control' ? 'you' : filterText === 'your opponents control' ? 'opponents' : 'any';

  return battlefield.filter(perm =>
    controllerMatches(perm, controllerFilter) &&
    (!excludeSource || !sourceId || permanentIdOf(perm) !== sourceId) &&
    permanentMatchesType(perm, 'creature') &&
    subtypes.some(subtype => typeLineHasSubtype(perm, subtype))
  );
}

/** "merfolk and/or knight", "ape or a monkey" → ['merfolk', 'knight'] (single subtype stays one entry). */
function splitSubtypeUnion(raw: string): string[] {
  const parts = String(raw || '')
    .split(/\s+(?:and\/or|or)\s+(?:an?\s+)?/i)
    .map(part => part.trim());
  const valid = parts.every(
    part => /^[a-z][a-z-]*(?: [a-z][a-z-]*)?$/i.test(part) && !/^(?:creature|artifact|enchantment|land|permanent|nonland|planeswalker)s?$/i.test(part)
  );
  return valid ? parts : [];
}

/**
 * Bare plural subtype teams without each/all: "other Humans you control", "Elf creatures",
 * "Goblin creatures", "Dinosaurs you control other than this creature".
 * Only fires when the subtype word is a real creature type (normalizeCreatureTypeWord).
 */
function resolveBareSubtypeTeamPermanents(
  battlefield: readonly BattlefieldPermanent[],
  text: string,
  ctx: OracleIRExecutionContext,
  controllerMatches: (permanent: BattlefieldPermanent, controllerFilter: 'any' | 'you' | 'opponents') => boolean
): BattlefieldPermanent[] | null {
  const match = text.match(
    /^(other\s+|another\s+)?([a-z][a-z-]*)(?:\s+creatures?)?(?:\s+(you\s+control|your\s+opponents\s+control))?(\s+other\s+than\s+(?:this\s+creature|~|this\s+permanent))?$/i
  );
  if (!match) return null;
  const subtype = normalizeCreatureTypeWord(String(match[2] || ''));
  if (!subtype) return null;
  const hasCreatureWord = /\bcreatures?\b/i.test(text);
  const hasControl = Boolean(match[3]);
  if (!hasCreatureWord && !hasControl) return null;
  const excludeSource = Boolean(match[1] || match[4]);
  const filterText = String(match[3] || '').trim().toLowerCase();
  const controllerFilter = filterText === 'you control' ? 'you' : filterText === 'your opponents control' ? 'opponents' : 'any';
  const sourceId = String(ctx.sourceId || '').trim();
  return battlefield.filter(perm =>
    controllerMatches(perm, controllerFilter) &&
    (!excludeSource || !sourceId || String((perm as any)?.id || '').trim() !== sourceId) &&
    permanentMatchesType(perm, 'creature') &&
    typeLineHasSubtype(perm, subtype)
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

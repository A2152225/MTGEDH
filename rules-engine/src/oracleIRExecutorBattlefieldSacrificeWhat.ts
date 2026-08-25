// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: exported sacrifice what parsers plus private helpers they close over.
// Public entries: parseSacrificeWhat, extractSacrificeWhatText, sacrificeSelectorRequiresPlayerChoice, buildSacrificeTargetSelectionOptions.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  parseSimplePermanentTypeFromText,
  type SimplePermanentType,
} from './oracleIRExecutorBattlefieldParser';
import { parseQuantity } from './oracleIRParserUtils';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';

export type SacrificeAttachmentReference =
  | {
      readonly mode: 'attached_to_source';
      readonly type: 'artifact' | 'enchantment' | 'creature' | 'permanent';
      readonly relation: 'source_is_attached_to_target' | 'target_is_attached_to_source';
      readonly subtype?: string;
    }
  | {
      readonly mode: 'attached_to_named';
      readonly type: 'artifact' | 'enchantment' | 'permanent';
      readonly subtype?: string;
      readonly attachedToName: string;
    };

function normalizeSelfReferenceText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNameReferenceAliases(value: string): readonly string[] {
  const normalized = normalizeSelfReferenceText(value);
  if (!normalized) return [];

  const aliases = new Set<string>();
  aliases.add(normalized);
  for (const face of normalized.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    aliases.add(face);
    const commaHead = String(face.split(',')[0] || '').trim();
    if (commaHead.length >= 4) aliases.add(commaHead);
  }

  return [...aliases];
}

export function sacrificeRequiresAttackingCreature(sacrificeWhatText: string): boolean {
  return /\battacking\s+creatures?\b/i.test(String(sacrificeWhatText || ''));
}

export function isPermanentAttackingForSacrifice(permanent: any): boolean {
  return Boolean(
    permanent?.attacking ||
      permanent?.attackingPlayerId ||
      permanent?.isAttacking,
  );
}

export function resolveAttachmentReferencePermanents(
  battlefield: readonly BattlefieldPermanent[],
  parsed: SacrificeAttachmentReference,
  players: readonly PlayerID[],
  ctx: OracleIRExecutionContext
): { readonly permanents: readonly BattlefieldPermanent[]; readonly requiresChoice: boolean } {
  const sourceId = String(ctx.sourceId || '').trim();
  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const contextualTargetIds = [
    ...chosenObjectIds,
    String(ctx.targetPermanentId || '').trim(),
    String(ctx.targetCreatureId || '').trim(),
  ].filter(Boolean);

  if (parsed.mode === 'attached_to_source' && parsed.relation === 'source_is_attached_to_target') {
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const attachedToId = String(
      (sourcePermanent as any)?.attachedTo ||
      (sourcePermanent as any)?.enchanting ||
      contextualTargetIds[0] ||
      ''
    ).trim();
    if (!attachedToId) return { permanents: [], requiresChoice: false };

    const attachedPermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === attachedToId);
    if (!attachedPermanent) return { permanents: [], requiresChoice: false };
    if (!players.includes(attachedPermanent.controller)) return { permanents: [], requiresChoice: false };
    if (!permanentMatchesType(attachedPermanent, parsed.type)) return { permanents: [], requiresChoice: false };
    return { permanents: [attachedPermanent], requiresChoice: false };
  }

  if (parsed.mode === 'attached_to_source') {
    if (!sourceId) return { permanents: [], requiresChoice: false };
    const candidates = battlefield.filter((perm: any) => {
      if (!players.includes(perm.controller)) return false;
      if (!permanentMatchesType(perm, parsed.type)) return false;
      const attachedToId = String((perm as any)?.attachedTo || '').trim();
      if (attachedToId !== sourceId) return false;
      if (parsed.subtype) {
        const typeLineLower = getExecutorTypeLineLower(perm);
        if (!new RegExp(`(^|[^a-z])${parsed.subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
          return false;
        }
      }
      return true;
    });

    if (candidates.length > 1) return { permanents: [], requiresChoice: true };
    return { permanents: candidates, requiresChoice: false };
  }

  const wantedNames = new Set(buildNameReferenceAliases(parsed.attachedToName));
  const anchors = battlefield.filter((perm: any) => {
    const permNames = buildNameReferenceAliases(String((perm as any)?.card?.name || (perm as any)?.name || ''));
    return permNames.some(name => wantedNames.has(name));
  });
  if (anchors.length !== 1) {
    return { permanents: [], requiresChoice: anchors.length > 1 };
  }

  const anchorId = String((anchors[0] as any)?.id || '').trim();
  if (!anchorId) return { permanents: [], requiresChoice: false };

  const candidates = battlefield.filter((perm: any) => {
    if (!players.includes(perm.controller)) return false;
    if (!permanentMatchesType(perm, parsed.type)) return false;
    const attachedToId = String((perm as any)?.attachedTo || '').trim();
    if (attachedToId !== anchorId) return false;
    if (parsed.subtype) {
      const typeLineLower = getExecutorTypeLineLower(perm);
      if (!new RegExp(`(^|[^a-z])${parsed.subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
        return false;
      }
    }
    return true;
  });

  if (candidates.length > 1) return { permanents: [], requiresChoice: true };
  return { permanents: candidates, requiresChoice: false };
}

export function parseSacrificeWhat(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly mode: 'self' }
  | {
      readonly mode: 'contextual';
      readonly type: ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never;
      readonly tokenOnly?: boolean;
      readonly plural?: boolean;
    }
  | {
      readonly mode: 'all';
      readonly type: ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never;
      readonly types?: readonly (ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never)[];
      readonly subtype?: string;
      readonly tokenOnly?: boolean;
      readonly excludeSource?: boolean;
    }
  | {
      readonly mode: 'count';
      readonly count: number;
      readonly type: ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never;
      readonly types?: readonly (ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never)[];
      readonly subtype?: string;
      readonly excludeSubtype?: string;
      readonly tokenOnly?: boolean;
      readonly excludeSource?: boolean;
      readonly usesVariableCount?: boolean;
      readonly greatestPowerAmongControlled?: boolean;
    }
  | SacrificeAttachmentReference
  | { readonly mode: 'created_with_source'; readonly plural?: boolean }
  | { readonly mode: 'choice_required' }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase();
  const normalized = cleaned.replace(/\u2019/g, "'");
  const normalizeSubtypeWord = (value: string): string => {
    const trimmed = String(value || '').trim().toLowerCase();
    if (!trimmed) return '';
    return trimmed.endsWith('s') ? trimmed.slice(0, -1) : trimmed;
  };

  if (
    /\bof (?:their|his or her|that player's|that opponent's) choice\b/i.test(normalized) ||
    /\bchosen\b/i.test(normalized) ||
    /\bat random\b/i.test(normalized) ||
    /\bunless\b/i.test(normalized) ||
    /\s+or\s+pay\b/i.test(normalized) ||
    /\s+and\s+pay\b/i.test(normalized) ||
    /^any number of\b/i.test(normalized) ||
    /^one or more\b/i.test(normalized) ||
    /^up to\b/i.test(normalized) ||
    /^one of them\b/i.test(normalized) ||
    /^that many\b/i.test(normalized)
  ) {
    return { mode: 'choice_required' };
  }

  if (
    /^(?:it|this creature|this artifact|this enchantment|this aura|this equipment|this land|this planeswalker|this battle|this vehicle|this permanent|this attraction)$/i.test(
      normalized
    )
  ) {
    return { mode: 'self' };
  }

  if (/^(?:that creature|the creature|the creature dealt damage)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^(?:that vehicle|the vehicle)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'vehicle' };
  }

  if (/^(?:that land|the land)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'land' };
  }

  if (/^those creatures$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature', plural: true };
  }

  if (/^that permanent$/i.test(normalized)) {
    return { mode: 'contextual', type: 'permanent' };
  }

  if (/^(?:that token|the token)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'permanent', tokenOnly: true };
  }

  if (/^(?:those tokens|them)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'permanent', tokenOnly: /^those tokens$/i.test(normalized), plural: true };
  }

  if (/^(?:each\s+)?tokens?\s+created\s+with\s+it$/i.test(normalized)) {
    return { mode: 'created_with_source', plural: true };
  }

  if (/^enchanted creature$/i.test(normalized)) {
    return { mode: 'attached_to_source', type: 'creature', relation: 'source_is_attached_to_target' };
  }

  {
    const mAttachedNamed = cleaned.match(/^an?\s+([a-z][a-z'-]*)\s+attached\s+to\s+(.+)$/i);
    if (mAttachedNamed) {
      const subtypeOrType = String(mAttachedNamed[1] || '').trim().toLowerCase();
      const attachedToName = normalizeSelfReferenceText(String(mAttachedNamed[2] || ''));
      const attachedToSelf = /^(?:it|this creature|this artifact|this enchantment|this aura|this equipment|this land|this planeswalker|this battle|this vehicle|this permanent)$/i.test(
        attachedToName
      );
      if (subtypeOrType === 'equipment') {
        if (attachedToSelf) return { mode: 'attached_to_source', type: 'artifact', relation: 'target_is_attached_to_source', subtype: 'equipment' };
        return {
          mode: 'attached_to_named',
          type: 'artifact',
          subtype: 'equipment',
          attachedToName,
        };
      }
      if (subtypeOrType === 'aura') {
        if (attachedToSelf) return { mode: 'attached_to_source', type: 'enchantment', relation: 'target_is_attached_to_source', subtype: 'aura' };
        return {
          mode: 'attached_to_named',
          type: 'enchantment',
          subtype: 'aura',
          attachedToName,
        };
      }
      if (subtypeOrType === 'permanent') {
        if (attachedToSelf) return { mode: 'attached_to_source', type: 'permanent', relation: 'target_is_attached_to_source' };
        return { mode: 'attached_to_named', type: 'permanent', attachedToName };
      }
    }
  }

  {
    const mentionsOpponentControl =
      /^(?:your\s+)?opponents?['â€™]s?\s+/i.test(normalized) ||
      /^opponent['â€™]s?\s+/i.test(normalized) ||
      /\b(?:your opponents|opponents)\s+control\b/i.test(normalized) ||
      /\b(?:an opponent|each opponent)\s+controls\b/i.test(normalized) ||
      /\byou\s+(?:don'?t|do not)\s+control\b/i.test(normalized);

    if (!mentionsOpponentControl && (/^your\s+/i.test(normalized) || /\b(?:you control|under your control)\b/i.test(normalized))) {
      const stripped = normalized
        .replace(/^your\s+/i, '')
        .replace(/\s+you\s+control\b/gi, '')
        .replace(/\s+under\s+your\s+control\b/gi, '')
        .trim();
      const type = parseSimplePermanentTypeFromText(stripped);
      if (type) return { mode: 'all', type };
      if (/^[a-z][a-z'-]*$/i.test(stripped)) {
        return { mode: 'all', type: 'permanent', subtype: normalizeSubtypeWord(stripped) };
      }
    }
  }

  if (/^all\b/i.test(lower)) {
    const type = parseSimplePermanentTypeFromText(cleaned);
    if (type) return { mode: 'all', type };
    const allSubtype = cleaned.match(/^all\s+([a-z][a-z'-]*)s?\b/i);
    if (allSubtype) {
      return { mode: 'all', type: 'permanent', subtype: normalizeSubtypeWord(String(allSubtype[1] || '')) };
    }
    return null;
  }

  const parseMixedTypes = (text: string):
    | readonly (ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never)[]
    | null => {
    const parts = text.split(/\s+(?:or|and\/or)\s+/i).map(part => part.trim()).filter(Boolean);
    if (parts.length <= 1) return null;

    const types: (ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never)[] = [];
    for (const part of parts) {
      const parsed = parseSimplePermanentTypeFromText(part);
      if (!parsed) return null;
      if (!types.includes(parsed)) types.push(parsed);
    }

    return types.length > 1 ? types : null;
  };

  const mAnother = cleaned.match(/^another\s+(.+)$/i);
  if (mAnother) {
    const rest = String(mAnother[1] || '').trim();
    const mixedTypes = parseMixedTypes(rest);
    if (mixedTypes) {
      return { mode: 'count', count: 1, type: mixedTypes[0], types: mixedTypes, excludeSource: true };
    }
    if (rest) {
      const type = parseSimplePermanentTypeFromText(rest);
      if (type) return { mode: 'count', count: 1, type, excludeSource: true };
      const tokenSubtypeMatch = rest.match(/^([a-z][a-z'-]*)\s+tokens?$/i);
      if (tokenSubtypeMatch) {
        return {
          mode: 'count',
          count: 1,
          type: 'permanent',
          subtype: normalizeSubtypeWord(String(tokenSubtypeMatch[1] || '')),
          tokenOnly: true,
          excludeSource: true,
        };
      }
      if (/^[a-z][a-z'-]*$/i.test(rest)) {
        if (/^token$/i.test(rest)) return { mode: 'count', count: 1, type: 'permanent', tokenOnly: true, excludeSource: true };
        return { mode: 'count', count: 1, type: 'permanent', subtype: normalizeSubtypeWord(rest), excludeSource: true };
      }
    }
  }

  const mCount = cleaned.match(/^([a-z0-9-]+)\s+(.+)$/i);
  if (!mCount) return null;
  const countRaw = String(mCount[1] || '').toLowerCase();
  const rest = String(mCount[2] || '').trim();

  {
    const greatestPowerControlledMatch = rest.match(
      /^creatures? with the greatest power among creatures (?:they|he or she) control$/i
    );
    if (greatestPowerControlledMatch) {
      const parsedLeadingCount = parseQuantity(countRaw);
      if (parsedLeadingCount.kind === 'number' && parsedLeadingCount.value === 1) {
        return { mode: 'count', count: 1, type: 'creature', greatestPowerAmongControlled: true };
      }
    }
  }

  const parsedCount = parseQuantity(countRaw);
  if (parsedCount.kind === 'x') {
    const mixedTypes = parseMixedTypes(rest);
    if (mixedTypes) {
      return { mode: 'count', count: 0, type: mixedTypes[0], types: mixedTypes, usesVariableCount: true };
    }
    const type = parseSimplePermanentTypeFromText(rest);
    if (type) return { mode: 'count', count: 0, type, usesVariableCount: true };
    const tokenSubtypeMatch = rest.match(/^([a-z][a-z'-]*)\s+tokens?$/i);
    if (tokenSubtypeMatch) {
      return {
        mode: 'count',
        count: 0,
        type: 'permanent',
        subtype: normalizeSubtypeWord(String(tokenSubtypeMatch[1] || '')),
        tokenOnly: true,
        usesVariableCount: true,
      };
    }
    return { mode: 'choice_required' };
  }
  if (parsedCount.kind !== 'number') return null;
  const count = parsedCount.value;
  if (!Number.isFinite(count) || count <= 0) return null;

  const nonSubtypeMatch = rest.match(/^non-([a-z][a-z'-]*)\s+(.+)$/i);
  if (nonSubtypeMatch) {
    const excludedSubtype = normalizeSubtypeWord(String(nonSubtypeMatch[1] || ''));
    const typeRest = String(nonSubtypeMatch[2] || '').trim();
    const mixedTypes = parseMixedTypes(typeRest);
    if (mixedTypes) {
      return {
        mode: 'count',
        count: Math.max(1, count | 0),
        type: mixedTypes[0],
        types: mixedTypes,
        excludeSubtype: excludedSubtype,
        excludeSource: true,
      };
    }
    const type = parseSimplePermanentTypeFromText(typeRest);
    if (type) {
      return {
        mode: 'count',
        count: Math.max(1, count | 0),
        type,
        excludeSubtype: excludedSubtype,
        excludeSource: true,
      };
    }
  }

  const mixedTypes = parseMixedTypes(rest);
  if (mixedTypes) {
    return { mode: 'count', count: Math.max(1, count | 0), type: mixedTypes[0], types: mixedTypes };
  }

  const type = parseSimplePermanentTypeFromText(rest);
  if (type) {
    return { mode: 'count', count: Math.max(1, count | 0), type };
  }

  const tokenSubtypeMatch = rest.match(/^([a-z][a-z'-]*)\s+tokens?$/i);
  if (tokenSubtypeMatch) {
    return {
      mode: 'count',
      count: Math.max(1, count | 0),
      type: 'permanent',
      subtype: normalizeSubtypeWord(String(tokenSubtypeMatch[1] || '')),
      tokenOnly: true,
    };
  }

  if (/^[a-z][a-z'-]*$/i.test(rest)) {
    if (/^token$/i.test(rest)) return { mode: 'count', count: Math.max(1, count | 0), type: 'permanent', tokenOnly: true };
    const subtypeWord = normalizeSubtypeWord(rest);
    if (/^(?:plains|island|swamp|mountain|forest)$/i.test(subtypeWord)) {
      return { mode: 'count', count: Math.max(1, count | 0), type: 'land', subtype: subtypeWord };
    }
    return { mode: 'count', count: Math.max(1, count | 0), type: 'permanent', subtype: subtypeWord };
  }

  return null;
}

export function extractSacrificeWhatText(step: Extract<OracleEffectStep, { kind: 'sacrifice' }>): string {
  const direct = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
  if (direct) return direct;
  const rawMatch = String(step.raw || '').match(/(?:^then\s+)?sacrifice\s+(.+?)[.!?\s]*$/i);
  return rawMatch ? String(rawMatch[1] || '').trim() : '';
}

export function sacrificeSelectorRequiresPlayerChoice(
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>
): boolean {
  const parsed = parseSacrificeWhat({ kind: 'raw', text: extractSacrificeWhatText(step) });
  if (!parsed) return false;
  return parsed.mode !== 'self' && parsed.mode !== 'contextual' && parsed.mode !== 'created_with_source';
}

function inferSacrificeChoiceBounds(
  sacrificeWhatText: string,
  parsed: NonNullable<ReturnType<typeof parseSacrificeWhat>>,
  candidateCount: number
): { readonly minTargets: number; readonly maxTargets: number } {
  const lower = sacrificeWhatText.toLowerCase();
  if (parsed.mode === 'count') {
    const count = Math.max(1, parsed.count | 0);
    return { minTargets: count, maxTargets: count };
  }
  if (parsed.mode === 'all') {
    return { minTargets: candidateCount, maxTargets: candidateCount };
  }
  if (/^any number of\b/.test(lower)) {
    return { minTargets: 0, maxTargets: candidateCount };
  }
  if (/^one or more\b/.test(lower)) {
    return { minTargets: 1, maxTargets: candidateCount };
  }
  const upToMatch = lower.match(/^up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
  if (upToMatch) {
    const max = parseQuantity(String(upToMatch[1] || '1'));
    const maxTargets = max.kind === 'number' ? Math.min(max.value, candidateCount) : candidateCount;
    return { minTargets: 0, maxTargets };
  }
  const countMatch = lower.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
  if (countMatch) {
    const parsedCount = parseQuantity(String(countMatch[1] || '1'));
    if (parsedCount.kind === 'number') {
      const count = Math.min(parsedCount.value, candidateCount);
      return { minTargets: count, maxTargets: count };
    }
  }
  return { minTargets: 1, maxTargets: 1 };
}

export function buildSacrificeTargetSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): {
  readonly minTargets: number;
  readonly maxTargets: number;
  readonly options: readonly { id: string; label: string; description?: string }[];
} | null {
  const sacrificeWhatText = extractSacrificeWhatText(step);
  const parsed = parseSacrificeWhat({ kind: 'raw', text: sacrificeWhatText });
  if (!parsed || parsed.mode === 'self' || parsed.mode === 'contextual' || parsed.mode === 'created_with_source') {
    return null;
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) return null;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const sourceId = String(ctx.sourceId || '').trim();
  const candidates: BattlefieldPermanent[] = [];

  const pushCandidateMatches = (
    filter: {
      readonly types: readonly SimplePermanentType[];
      readonly subtype?: string;
      readonly tokenOnly?: boolean;
      readonly excludeSource?: boolean;
    }
  ) => {
    for (const playerId of players) {
      for (const permanent of battlefield) {
        if (String((permanent as any)?.controller || '').trim() !== playerId) continue;
        if (filter.excludeSource && sourceId && String((permanent as any)?.id || '').trim() === sourceId) continue;
        if (!filter.types.some(type => permanentMatchesType(permanent, type))) continue;
        if (filter.tokenOnly && !(permanent as any)?.isToken) continue;
        if (filter.subtype) {
          const typeLineLower = getExecutorTypeLineLower(permanent);
          const subtypePattern = filter.subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (!new RegExp(`(^|[^a-z])${subtypePattern}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) continue;
        }
        if (sacrificeRequiresAttackingCreature(sacrificeWhatText) && !isPermanentAttackingForSacrifice(permanent)) {
          continue;
        }
        candidates.push(permanent);
      }
    }
  };

  if (parsed.mode === 'choice_required') {
    const stripped = sacrificeWhatText
      .replace(/\s+of (?:their|his or her|that player(?:'s)?|that opponent(?:'s)?) choice.*$/i, '')
      .replace(/^any number of\s+/i, '')
      .replace(/^one or more\s+/i, '')
      .replace(/^up to (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+/i, '')
      .replace(/^(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+/i, '')
      .replace(/^an?\s+/i, '')
      .trim();
    const mixedTypes = stripped
      .split(/\s+(?:or|and\/or)\s+/i)
      .map(part => parseSimplePermanentTypeFromText(part.trim()))
      .filter((type): type is SimplePermanentType => type !== null);
    if (mixedTypes.length > 1) {
      pushCandidateMatches({ types: mixedTypes });
    } else {
      const type = parseSimplePermanentTypeFromText(stripped) || 'permanent';
      const tokenOnly = /\btokens?\b/i.test(stripped);
      pushCandidateMatches({ types: [type], tokenOnly });
    }
  } else if (parsed.mode === 'all' || parsed.mode === 'count') {
    const allowedTypes = Array.isArray(parsed.types) && parsed.types.length > 0 ? parsed.types : [parsed.type];
    pushCandidateMatches({
      types: allowedTypes,
      subtype: parsed.subtype,
      tokenOnly: parsed.tokenOnly,
      excludeSource: parsed.excludeSource,
    });
  } else if (parsed.mode === 'attached_to_source' || parsed.mode === 'attached_to_named') {
    const attachmentResolution = resolveAttachmentReferencePermanents(battlefield, parsed, players, ctx);
    candidates.push(...attachmentResolution.permanents);
  } else {
    return null;
  }

  const uniqueCandidates = Array.from(
    new Map(candidates.map(permanent => [String((permanent as any)?.id || '').trim(), permanent])).values()
  ).filter(permanent => String((permanent as any)?.id || '').trim());

  const bounds = inferSacrificeChoiceBounds(sacrificeWhatText, parsed, uniqueCandidates.length);
  const maxTargets = Math.min(bounds.maxTargets, uniqueCandidates.length);

  return {
    minTargets: Math.min(bounds.minTargets, maxTargets),
    maxTargets,
    options: uniqueCandidates.map(permanent => {
      const id = String((permanent as any)?.id || '').trim();
      const name = String((permanent as any)?.card?.name || (permanent as any)?.name || id);
      return {
        id,
        label: name,
        description: String((permanent as any)?.card?.type_line || (permanent as any)?.type_line || 'Permanent'),
      };
    }),
  };
}

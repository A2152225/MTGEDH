import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleBattlefieldObjectCondition, OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseSimpleBattlefieldSelector, parseSimplePermanentTypeFromText } from './oracleIRExecutorBattlefieldParser';
import { parseQuantity } from './oracleIRParserUtils';
import {
  applyTapOrUntapToBattlefield,
  permanentMatchesSelector,
  finalizeBattlefieldRemoval,
  moveMatchingBattlefieldPermanents,
  permanentMatchesType,
  resolveTapOrUntapTargetIds,
} from './oracleIRExecutorBattlefieldOps';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';
import { createLastKnownPermanentSnapshot, type LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { getCardManaValue, resolvePlayers } from './oracleIRExecutorPlayerUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastSacrificedCreaturesPowerTotal?: number;
  readonly lastSacrificedPermanents?: readonly LastKnownPermanentSnapshot[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'no_deterministic_target'
    | 'unsupported_target'
    | 'unsupported_player_selector'
    | 'unsupported_object_selector'
    | 'player_choice_required'
    | 'impossible_action'
    | 'unsupported_condition'
    | 'condition_false';
  readonly options?: {
    readonly classification?: 'player_choice';
    readonly persist?: boolean;
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

export type BattlefieldStepHandlerResult = StepApplyResult | StepSkipResult;

type ContextualBattlefieldReference =
  | { readonly mode: 'self' }
  | {
      readonly mode: 'contextual';
      readonly type: ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never;
      readonly tokenOnly?: boolean;
      readonly plural?: boolean;
    };

type SacrificeAttachmentReference =
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

function parseSacrificeWhat(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
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
      readonly tokenOnly?: boolean;
      readonly excludeSource?: boolean;
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

  if (/^(?:that creature|the creature)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^(?:that vehicle|the vehicle)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'vehicle' };
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

  const parsedCount = parseQuantity(countRaw);
  if (parsedCount.kind === 'x') return { mode: 'choice_required' };
  if (parsedCount.kind !== 'number') return null;
  const count = parsedCount.value;
  if (!Number.isFinite(count) || count <= 0) return null;

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
    return { mode: 'count', count: Math.max(1, count | 0), type: 'permanent', subtype: normalizeSubtypeWord(rest) };
  }

  return null;
}

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

function isNamedSelfSacrificeReference(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  ctx: OracleIRExecutionContext
): boolean {
  if (what.kind !== 'raw') return false;
  const normalizedWhat = normalizeSelfReferenceText(String((what as any).text || ''));
  if (!normalizedWhat) return false;

  const sourceCandidates = [
    String(ctx.sourceName || ''),
    String((ctx as any).cardName || ''),
  ]
    .map(normalizeSelfReferenceText)
    .filter(Boolean);

  return sourceCandidates.includes(normalizedWhat);
}

function parseContextualBattlefieldReference(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string }
): ContextualBattlefieldReference | null {
  if (target.kind !== 'raw') return null;
  const raw = String((target as any).text || '').trim();
  if (!raw) return null;

  const normalized = raw.replace(/[.\s]+$/g, '').replace(/\u2019/g, "'").trim();

  if (
    /^(?:it|this creature|this artifact|this enchantment|this aura|this land|this planeswalker|this battle|this vehicle|this permanent|this token)$/i.test(
      normalized
    )
  ) {
    return { mode: 'self' };
  }

  if (/^(?:that creature|the creature)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^(?:that vehicle|the vehicle)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'vehicle' };
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
    return {
      mode: 'contextual',
      type: 'permanent',
      tokenOnly: /^those tokens$/i.test(normalized),
      plural: true,
    };
  }

  return null;
}

function resolveContextualBattlefieldPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target:
    | { readonly kind: string; readonly text?: string; readonly raw?: string }
    | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  if (!target) return [];

  const parsed = parseContextualBattlefieldReference(target);
  if (!parsed) return [];

  const sourceId = String(ctx.sourceId || '').trim();
  if (parsed.mode === 'self') {
    if (!sourceId) return [];
    const selfPermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId);
    return selfPermanent ? [selfPermanent] : [];
  }

  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const contextualTargetIds = (() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [
      ...chosenObjectIds,
      String(ctx.targetPermanentId || '').trim(),
      String(ctx.targetCreatureId || '').trim(),
    ]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      ids.push(candidate);
    }
    return parsed.plural ? ids : ids.slice(0, 1);
  })();

  if (contextualTargetIds.length === 0) return [];

  return battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!contextualTargetIds.includes(permanentId)) return false;
    if (!permanentMatchesType(perm, parsed.type)) return false;
    if (parsed.tokenOnly && !(perm as any)?.isToken) return false;
    return true;
  });
}

function resolveAttachmentReferencePermanents(
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

function resolveDirectBattlefieldPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target:
    | { readonly kind: string; readonly text?: string; readonly raw?: string }
    | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  if (!target) return [];
  const selector = parseSimpleBattlefieldSelector(target as any);
  if (selector) {
    return battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
  }
  return resolveContextualBattlefieldPermanents(battlefield, target, ctx);
}

function buildDelayedCleanupReference(permanents: readonly BattlefieldPermanent[]): string {
  if (permanents.length <= 0) return 'that permanent';
  if (permanents.length === 1) {
    const perm = permanents[0];
    if ((perm as any)?.isToken) return 'that token';
    if (permanentMatchesType(perm, 'creature')) return 'that creature';
    return 'that permanent';
  }

  if (permanents.every(perm => Boolean((perm as any)?.isToken))) {
    return 'those tokens';
  }

  if (permanents.every(perm => permanentMatchesType(perm, 'creature'))) {
    return 'those creatures';
  }

  return 'them';
}

function renderBattlefieldObjectCondition(condition?: OracleBattlefieldObjectCondition): string {
  if (!condition) return '';
  if (condition.kind === 'mana_value_compare') {
    return ` if it has mana value ${condition.value} or ${condition.comparator === 'lte' ? 'less' : 'greater'}`;
  }
  if (condition.comparator === 'eq' && condition.value === 0) {
    return ` if there are no ${condition.counter} counters on it`;
  }
  return ` if it has ${condition.value} or ${condition.comparator === 'lte' ? 'less' : 'more'} ${condition.counter} counters on it`;
}

function evaluateBattlefieldObjectCondition(
  permanent: BattlefieldPermanent,
  condition?: OracleBattlefieldObjectCondition
): boolean | null {
  if (!condition) return true;

  if (condition.kind === 'mana_value_compare') {
    const manaValue = getCardManaValue((permanent as any)?.card || permanent);
    if (manaValue === null) return null;
    return condition.comparator === 'lte' ? manaValue <= condition.value : manaValue >= condition.value;
  }

  const counters = (permanent as any)?.counters;
  const count = Number(counters?.[condition.counter] ?? 0);
  const normalizedCount = Number.isFinite(count) ? count : 0;
  if (condition.comparator === 'lte') return normalizedCount <= condition.value;
  if (condition.comparator === 'gte') return normalizedCount >= condition.value;
  return normalizedCount === condition.value;
}

function registerDelayedBattlefieldAction(
  state: GameState,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  timing: DelayedTriggerTiming,
  action: 'sacrifice' | 'exile',
  permanents: readonly BattlefieldPermanent[],
  condition?: OracleBattlefieldObjectCondition,
  whoText?: string,
  watchingPermanentId?: string
): { state: GameState; log: string[] } {
  const chosenObjectIds = Array.from(
    new Set(permanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean))
  );
  if (chosenObjectIds.length === 0) return { state, log: [] };

  const reference = buildDelayedCleanupReference(permanents);
  const trimmedWhoText = String(whoText || '').trim();
  const effect = (() => {
    if (action === 'exile') return `Exile ${reference}.`;
    if (!trimmedWhoText) return `Sacrifice ${reference}${renderBattlefieldObjectCondition(condition)}.`;

    const subject = trimmedWhoText;
    const lowerSubject = subject.toLowerCase();
    const verb =
      lowerSubject === 'you' || lowerSubject === 'they'
        ? 'sacrifice'
        : 'sacrifices';
    return `${subject} ${verb} ${reference}${renderBattlefieldObjectCondition(condition)}.`;
  })();

  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const delayedTrigger = createDelayedTrigger(
    String(ctx.sourceId || ctx.sourceName || 'oracle-ir'),
    String(ctx.sourceName || 'Delayed cleanup'),
    controllerId,
    timing,
    effect,
    currentTurn,
    {
      ...(watchingPermanentId ? { watchingPermanentId } : {}),
      targets: [...chosenObjectIds],
      eventDataSnapshot: {
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceControllerId: String(controllerId || '').trim() || undefined,
        targetPermanentId: chosenObjectIds.length === 1 ? chosenObjectIds[0] : undefined,
        chosenObjectIds,
      },
    }
  );

  const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
  return {
    state: {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState,
    log: [`Scheduled delayed ${action} for ${chosenObjectIds.length} permanent(s) at ${timing.replace(/_/g, ' ')}`],
  };
}

export function applyTapOrUntapStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'tap_or_untap' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const targetIds = resolveTapOrUntapTargetIds(state, step.target as any, ctx);
  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped tap/untap (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const currentTargets = ((state.battlefield || []) as any[]).filter((perm: any) =>
    targetIds.includes(String(perm?.id || '').trim())
  );
  const choice: 'tap' | 'untap' =
    ctx.tapOrUntapChoice ?? (currentTargets.some((perm: any) => Boolean(perm?.tapped)) ? 'untap' : 'tap');

  return {
    applied: true,
    state: applyTapOrUntapToBattlefield(state, targetIds, choice),
    log: [`${choice === 'tap' ? 'Tapped' : 'Untapped'} ${targetIds.length} permanent(s)`],
  };
}

export function applyRemoveCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const amountValue = step.amount.kind === 'number' ? step.amount.value : null;
  if (amountValue === null || amountValue <= 0) {
    return {
      applied: false,
      message: `Skipped remove counter (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const targets = resolveDirectBattlefieldPermanents((state.battlefield || []) as BattlefieldPermanent[], step.target as any, ctx);
  if (targets.length !== 1) {
    return {
      applied: false,
      message: `Skipped remove counter (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const target = targets[0] as any;
  const counterName = String(step.counter || '').trim();
  if (!counterName) {
    return {
      applied: false,
      message: `Skipped remove counter (unsupported counter): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const currentCount = Number(target?.counters?.[counterName] ?? 0);
  const normalizedCount = Number.isFinite(currentCount) ? currentCount : 0;
  if (normalizedCount < amountValue) {
    return {
      applied: false,
      message: `Skipped remove counter (not enough counters): ${step.raw}`,
      reason: 'impossible_action',
      options: {
        persist: false,
        metadata: {
          counter: counterName,
          availableCount: normalizedCount,
          requiredCount: amountValue,
          targetId: String(target?.id || '').trim() || null,
        },
      },
    };
  }

  const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    if (String(perm?.id || '').trim() !== String(target?.id || '').trim()) return perm;
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    const nextCount = normalizedCount - amountValue;
    if (nextCount > 0) {
      counters[counterName] = nextCount;
    } else {
      delete counters[counterName];
    }
    return {
      ...perm,
      counters,
    };
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield,
    } as GameState,
    log: [`Removed ${amountValue} ${counterName} counter(s)`],
  };
}

export function applyDestroyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const selector = parseSimpleBattlefieldSelector(step.target as any);
  if (selector) {
    const result = moveMatchingBattlefieldPermanents(state, selector, ctx, 'graveyard');
    return { applied: true, state: result.state, log: result.log };
  }

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const toRemove = resolveContextualBattlefieldPermanents(battlefield, step.target as any, ctx);
  if (toRemove.length === 0) {
    return {
      applied: false,
      message: `Skipped destroy (unsupported target): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const removedIds = new Set<string>(toRemove.map(perm => perm.id));
  const kept = battlefield.filter(perm => !removedIds.has(perm.id));
  const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'graveyard', 'destroyed');
  return { applied: true, state: result.state, log: result.log };
}

export function applyExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const selector = parseSimpleBattlefieldSelector(step.target as any);
  if (selector) {
    const result = moveMatchingBattlefieldPermanents(state, selector, ctx, 'exile');
    return { applied: true, state: result.state, log: result.log };
  }

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const toRemove = resolveContextualBattlefieldPermanents(battlefield, step.target as any, ctx);
  if (toRemove.length === 0) {
    return {
      applied: false,
      message: `Skipped exile (unsupported target): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const removedIds = new Set<string>(toRemove.map(perm => perm.id));
  const kept = battlefield.filter(perm => !removedIds.has(perm.id));
  const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled');
  return { applied: true, state: result.state, log: result.log };
}

export function applyScheduleDelayedBattlefieldActionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_battlefield_action' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const timing =
    step.timing === 'your_next_end_step'
      ? DelayedTriggerTiming.YOUR_NEXT_END_STEP
      : step.timing === 'next_upkeep'
        ? DelayedTriggerTiming.NEXT_UPKEEP
        : step.timing === 'your_next_upkeep'
          ? DelayedTriggerTiming.YOUR_NEXT_UPKEEP
        : step.timing === 'when_control_lost'
          ? DelayedTriggerTiming.WHEN_CONTROL_LOST
        : step.timing === 'next_cleanup_step'
          ? DelayedTriggerTiming.NEXT_CLEANUP
          : step.timing === 'when_leaves_battlefield'
          ? DelayedTriggerTiming.WHEN_LEAVES
      : step.timing === 'end_of_combat'
        ? DelayedTriggerTiming.END_OF_COMBAT
        : DelayedTriggerTiming.NEXT_END_STEP;

  if (step.action === 'exile') {
    const permanents = resolveDirectBattlefieldPermanents(battlefield, step.object as any, ctx);
    if (permanents.length === 0) {
      return {
        applied: false,
        message: `Skipped delayed exile scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    let watchingPermanentId: string | undefined;
    if (timing === DelayedTriggerTiming.WHEN_LEAVES || timing === DelayedTriggerTiming.WHEN_CONTROL_LOST) {
      const watched = resolveDirectBattlefieldPermanents(battlefield, step.watch as any, ctx);
      if (watched.length !== 1) {
        return {
          applied: false,
          message: `Skipped delayed exile scheduling (no deterministic watched object): ${step.raw}`,
          reason: watched.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
          ...(watched.length > 1 ? { options: { classification: 'player_choice' as const } } : {}),
        };
      }
      watchingPermanentId = String((watched[0] as any)?.id || '').trim() || undefined;
      if (!watchingPermanentId) {
        return {
          applied: false,
          message: `Skipped delayed exile scheduling (no deterministic watched object): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }
    }

    const scheduled = registerDelayedBattlefieldAction(
      state,
      ctx,
      (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID,
      timing,
      'exile',
      permanents,
      undefined,
      undefined,
      watchingPermanentId
    );
    return { applied: true, state: scheduled.state, log: scheduled.log };
  }

  const players = resolvePlayers(state, step.who || ({ kind: 'you' } as any), ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const parsed = parseSacrificeWhat(step.object as any);
  const namedSelfReference = isNamedSelfSacrificeReference(step.object as any, ctx);
  if (!parsed && !namedSelfReference) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (unsupported object selector): ${step.raw}`,
      reason: 'unsupported_object_selector',
    };
  }

  const toSchedule: BattlefieldPermanent[] = [];
  let needsChoice = false;
  let watchingPermanentId: string | undefined;
  const sourceId = String(ctx.sourceId || '').trim();
  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const contextualTargetIds = (() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [
      ...chosenObjectIds,
      String(ctx.targetPermanentId || '').trim(),
      String(ctx.targetCreatureId || '').trim(),
    ]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      ids.push(candidate);
    }
    return ids;
  })();

  const resolveContextualPermanents = (
    contextual: Extract<NonNullable<typeof parsed>, { readonly mode: 'contextual' }>
  ): BattlefieldPermanent[] => {
    const ids = contextual.plural ? contextualTargetIds : contextualTargetIds.slice(0, 1);
    if (ids.length === 0) return [];

    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!ids.includes(permanentId)) return false;
      if (!players.includes(perm.controller)) return false;
      if (!permanentMatchesType(perm, contextual.type)) return false;
      if (contextual.tokenOnly && !(perm as any)?.isToken) return false;
      return true;
    });
  };

  if (namedSelfReference || parsed?.mode === 'self') {
    const selfPermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    if (!selfPermanent || !players.includes(selfPermanent.controller)) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    toSchedule.push(selfPermanent);
  }

  if (parsed?.mode === 'choice_required') {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (parsed?.mode === 'contextual') {
    const contextualPermanents = resolveContextualPermanents(parsed);
    if (contextualPermanents.length === 0) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    toSchedule.push(...contextualPermanents);
  }

  if (parsed?.mode === 'attached_to_source' || parsed?.mode === 'attached_to_named') {
    const attachmentResolution = resolveAttachmentReferencePermanents(battlefield, parsed, players, ctx);
    if (attachmentResolution.requiresChoice) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (attachmentResolution.permanents.length === 0) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    toSchedule.push(...attachmentResolution.permanents);
  }

  if (parsed?.mode === 'created_with_source') {
    if (!sourceId) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const createdTokens = battlefield.filter((perm: any) => {
      if (!(perm as any)?.isToken) return false;
      if (!players.includes(perm.controller)) return false;
      return String((perm as any)?.createdBySourceId || '').trim() === sourceId;
    });
    toSchedule.push(...createdTokens);
  }

  if (
    !namedSelfReference &&
    parsed &&
    parsed.mode !== 'self' &&
    parsed.mode !== 'contextual' &&
    parsed.mode !== 'attached_to_source' &&
    parsed.mode !== 'attached_to_named' &&
    parsed.mode !== 'created_with_source'
  ) {
    for (const playerId of players) {
      const excludeSource = Boolean((parsed as any).excludeSource);
      const allowedTypes = Array.isArray((parsed as any).types) && (parsed as any).types.length > 0
        ? (parsed as any).types
        : [parsed.type];
      const subtype = String((parsed as any).subtype || '').trim().toLowerCase();
      const tokenOnly = Boolean((parsed as any).tokenOnly);
      const candidates = battlefield.filter(p => {
        if (p.controller !== playerId) return false;
        if (!allowedTypes.some(type => permanentMatchesType(p, type))) return false;
        if (tokenOnly && !(p as any)?.isToken) return false;
        if (subtype) {
          const typeLineLower = getExecutorTypeLineLower(p);
          if (!new RegExp(`(^|[^a-z])${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
            return false;
          }
        }
        if (excludeSource && sourceId && String((p as any)?.id || '').trim() === sourceId) return false;
        return true;
      });

      if (parsed.mode === 'all') {
        toSchedule.push(...candidates);
        continue;
      }

      if (candidates.length > parsed.count) {
        needsChoice = true;
        break;
      }
      toSchedule.push(...candidates);
    }
  }

  if (needsChoice) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (toSchedule.length === 0) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (step.condition && toSchedule.length !== 1) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (unsupported condition target shape): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  if (timing === DelayedTriggerTiming.WHEN_LEAVES || timing === DelayedTriggerTiming.WHEN_CONTROL_LOST) {
    const watched = resolveDirectBattlefieldPermanents(battlefield, step.watch as any, ctx);
    if (watched.length !== 1) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic watched object): ${step.raw}`,
        reason: watched.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
        ...(watched.length > 1 ? { options: { classification: 'player_choice' as const } } : {}),
      };
    }
    watchingPermanentId = String((watched[0] as any)?.id || '').trim() || undefined;
    if (!watchingPermanentId) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic watched object): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
  }

  const whoText = (() => {
    const whoKind = String((step.who as any)?.kind || 'you').trim();
    switch (whoKind) {
      case 'you':
        return 'You';
      case 'each_player':
        return 'Each player';
      case 'each_opponent':
        return 'Each opponent';
      case 'each_of_those_opponents':
        return 'Each of those opponents';
      case 'target_player':
        return 'That player';
      case 'target_opponent':
        return 'That opponent';
      default:
        return undefined;
    }
  })();

  const scheduled = registerDelayedBattlefieldAction(
    state,
    ctx,
    (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID,
    timing,
    'sacrifice',
    toSchedule,
    step.condition,
    whoText,
    watchingPermanentId
  );
  return { applied: true, state: scheduled.state, log: scheduled.log };
}

export function applySacrificeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped sacrifice (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const parsed = parseSacrificeWhat(step.what as any);
  const namedSelfReference = isNamedSelfSacrificeReference(step.what as any, ctx);
  if (!parsed && !namedSelfReference) {
    return {
      applied: false,
      message: `Skipped sacrifice (unsupported object selector): ${step.raw}`,
      reason: 'unsupported_object_selector',
    };
  }

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const toRemove: BattlefieldPermanent[] = [];
  let needsChoice = false;
  const sourceId = String(ctx.sourceId || '').trim();
  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const contextualTargetIds = (() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [
      ...chosenObjectIds,
      String(ctx.targetPermanentId || '').trim(),
      String(ctx.targetCreatureId || '').trim(),
    ]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      ids.push(candidate);
    }
    return ids;
  })();

  const resolveContextualPermanents = (
    contextual: Extract<NonNullable<typeof parsed>, { readonly mode: 'contextual' }>
  ): BattlefieldPermanent[] => {
    const ids = contextual.plural ? contextualTargetIds : contextualTargetIds.slice(0, 1);
    if (ids.length === 0) return [];

    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!ids.includes(permanentId)) return false;
      if (!players.includes(perm.controller)) return false;
      if (!permanentMatchesType(perm, contextual.type)) return false;
      if (contextual.tokenOnly && !(perm as any)?.isToken) return false;
      return true;
    });
  };

  if (namedSelfReference || parsed?.mode === 'self') {
    const selfPermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;

    if (!selfPermanent || !players.includes(selfPermanent.controller)) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    toRemove.push(selfPermanent);
  }

  if (parsed?.mode === 'choice_required') {
    return {
      applied: false,
      message: `Skipped sacrifice (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (parsed?.mode === 'contextual') {
    const contextualPermanents = resolveContextualPermanents(parsed);
    if (contextualPermanents.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    toRemove.push(...contextualPermanents);
  }

  if (parsed?.mode === 'attached_to_source' || parsed?.mode === 'attached_to_named') {
    const attachmentResolution = resolveAttachmentReferencePermanents(battlefield, parsed, players, ctx);
    if (attachmentResolution.requiresChoice) {
      return {
        applied: false,
        message: `Skipped sacrifice (requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (attachmentResolution.permanents.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    toRemove.push(...attachmentResolution.permanents);
  }

  if (parsed?.mode === 'created_with_source') {
    if (!sourceId) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const createdTokens = battlefield.filter((perm: any) => {
      if (!(perm as any)?.isToken) return false;
      if (!players.includes(perm.controller)) return false;
      return String((perm as any)?.createdBySourceId || '').trim() === sourceId;
    });

    toRemove.push(...createdTokens);
  }

  if (
    !namedSelfReference &&
    parsed &&
    parsed.mode !== 'self' &&
    parsed.mode !== 'contextual' &&
    parsed.mode !== 'attached_to_source' &&
    parsed.mode !== 'attached_to_named' &&
    parsed.mode !== 'created_with_source'
  ) {
    for (const playerId of players) {
      const excludeSource = Boolean((parsed as any).excludeSource);
      const allowedTypes = Array.isArray((parsed as any).types) && (parsed as any).types.length > 0
        ? (parsed as any).types
        : [parsed.type];
      const subtype = String((parsed as any).subtype || '').trim().toLowerCase();
      const tokenOnly = Boolean((parsed as any).tokenOnly);
      const candidates = battlefield.filter(p => {
        if (p.controller !== playerId) return false;
        if (!allowedTypes.some(type => permanentMatchesType(p, type))) return false;
        if (tokenOnly && !(p as any)?.isToken) return false;
        if (subtype) {
          const typeLineLower = getExecutorTypeLineLower(p);
          if (!new RegExp(`(^|[^a-z])${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
            return false;
          }
        }
        if (excludeSource && sourceId && String((p as any)?.id || '').trim() === sourceId) return false;
        return true;
      });

      if (parsed.mode === 'all') {
        toRemove.push(...candidates);
        continue;
      }

      if (candidates.length > parsed.count) {
        needsChoice = true;
        break;
      }
      toRemove.push(...candidates);
    }
  }

  if (needsChoice) {
    return {
      applied: false,
      message: `Skipped sacrifice (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (step.condition) {
    if (toRemove.length !== 1) {
      return {
        applied: false,
        message: `Skipped sacrifice (unsupported condition target shape): ${step.raw}`,
        reason: 'unsupported_condition',
      };
    }

    const conditionResult = evaluateBattlefieldObjectCondition(toRemove[0], step.condition);
    if (conditionResult === null) {
      return {
        applied: false,
        message: `Skipped sacrifice (unsupported condition evaluation): ${step.raw}`,
        reason: 'unsupported_condition',
      };
    }

    if (!conditionResult) {
      return {
        applied: false,
        message: `Skipped sacrifice (condition false): ${step.raw}`,
        reason: 'condition_false',
        options: { persist: false },
      };
    }
  }

  const lastSacrificedPermanents = toRemove.map(permanent => createLastKnownPermanentSnapshot(permanent));
  const sacrificedCreaturesPowerTotal = lastSacrificedPermanents.reduce((sum, permanent) => {
    if (!permanent.typeLine.includes('creature')) return sum;
    return sum + (permanent.power ?? 0);
  }, 0);

  const removedIds = new Set<string>(toRemove.map(p => p.id));
  const kept = battlefield.filter(p => !removedIds.has(p.id));
  const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'graveyard', 'sacrificed');

  return {
    applied: true,
    state: result.state,
    log: result.log,
    lastSacrificedCreaturesPowerTotal: Math.max(0, sacrificedCreaturesPowerTotal),
    lastSacrificedPermanents,
  };
}

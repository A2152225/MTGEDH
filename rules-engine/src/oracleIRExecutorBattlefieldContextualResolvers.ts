// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: parseContextualBattlefieldReference, resolveContextualBattlefieldPermanents,
// resolveBoundSelectorMatches.
// Public entries: those three resolvers.

import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  parseSimplePermanentTypeFromText,
  type SimpleBattlefieldSelector,
} from './oracleIRExecutorBattlefieldParser';
import { permanentMatchesSelector, permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { filterIllegalDirectTargetPermanents } from './oracleIRExecutorBattlefieldSubtypeCompoundResolvers';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import {
  resolveBolsterTargetCreatureIdFromBattlefield,
  resolveMentorTargetCreatureIdFromBattlefield,
} from './oracleIRExecutorCreatureStepUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';
import { canTargetPermanent } from './permanentTargeting';

type ContextualBattlefieldReference =
  | { readonly mode: 'self' }
  | {
      readonly mode: 'contextual';
      readonly type: ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never;
      readonly tokenOnly?: boolean;
      readonly plural?: boolean;
      readonly subtype?: string;
    };

export function parseContextualBattlefieldReference(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string }
): ContextualBattlefieldReference | null {
  if (target.kind !== 'raw') return null;
  const raw = String((target as any).text || '').trim();
  if (!raw) return null;

  const normalized = normalizeBattlefieldTargetReferenceText(raw);

  if (
    /^(?:it|he|him|her|this creature|this artifact|this enchantment|this aura|this land|this planet|this spacecraft|this planeswalker|this battle|this vehicle|this permanent|this token|this card|this saga)$/i.test(
      normalized
    )
  ) {
    return { mode: 'self' };
  }

  if (/^that artifact$/i.test(normalized)) {
    return { mode: 'contextual', type: 'artifact' };
  }

  if (/^that wolf$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature', subtype: 'wolf' };
  }

  if (/^the chosen creature$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^the creature that attacked$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^that mount or vehicle$/i.test(normalized)) {
    return { mode: 'contextual', type: 'vehicle' };
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

  if (/^(?:that planeswalker|the planeswalker)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'planeswalker' };
  }

  if (/^both creatures$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature', plural: true };
  }

  if (/^the other creature$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^(?:they|them)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature', plural: true };
  }

  if (/^(?:the exiled card|that card)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'permanent' };
  }

  if (/^(?:each of )?those creatures$/i.test(normalized)) {
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

  if (/^those auras$/i.test(normalized)) {
    return { mode: 'contextual', type: 'enchantment', subtype: 'aura', plural: true };
  }

  const contextualSubtypeMatch = normalized.match(/^(?:each of )?those\s+([a-z][a-z' -]+)$/i);
  if (contextualSubtypeMatch) {
    const rawSubtype = String(contextualSubtypeMatch[1] || '').trim().toLowerCase();
    if (rawSubtype && !/^(?:creatures|permanents|tokens)$/i.test(rawSubtype)) {
      const subtype = rawSubtype.endsWith('s') ? rawSubtype.slice(0, -1) : rawSubtype;
      if (subtype) {
        return {
          mode: 'contextual',
          type: 'creature',
          plural: true,
          subtype,
        };
      }
    }
  }

  return null;
}

export function resolveContextualBattlefieldPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target:
    | { readonly kind: string; readonly text?: string; readonly raw?: string }
    | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  if (!target) return [];

  const mentorTargetId = resolveMentorTargetCreatureIdFromBattlefield(battlefield, target as any, ctx);
  if (mentorTargetId) {
    const mentorTarget = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === mentorTargetId);
    return mentorTarget ? [mentorTarget] : [];
  }

  const bolsterTargetId = resolveBolsterTargetCreatureIdFromBattlefield(battlefield, target as any, ctx);
  if (bolsterTargetId) {
    const bolsterTarget = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === bolsterTargetId);
    return bolsterTarget ? [bolsterTarget] : [];
  }

  if (target.kind === 'raw') {
    const rawText = normalizeBattlefieldTargetReferenceText(String((target as any).text || ''));
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId && rawText) {
      const sourcePermanent = battlefield.find(
        (perm: any) => String((perm as any)?.id || '').trim() === sourceId,
      ) as any;
      const sourceNames = [
        String(sourcePermanent?.card?.name || '').trim(),
        String(sourcePermanent?.name || '').trim(),
        String(ctx.sourceName || '').trim(),
      ]
        .map((name) => normalizeOracleText(name).toLowerCase())
        .filter(Boolean);
      if (sourceNames.includes(normalizeOracleText(rawText).toLowerCase())) {
        return sourcePermanent ? [sourcePermanent] : [];
      }
    }
    const directTargetMatch = rawText.match(
      /^(?:each of\s+)?(?:up to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?(?:(?:another|other)\s+)?target\s+(.+)$/i
    );
    if (directTargetMatch) {
      const parsedType = parseSimplePermanentTypeFromText(String(directTargetMatch[1] || '').trim()) || 'permanent';
      const excludeSource = /(?:^|\s)(?:another|other)\s+target\s+/i.test(rawText);
      const sourceId = String(ctx.sourceId || '').trim();
      const directTargetIds = [
        String(ctx.targetPermanentId || '').trim(),
        String(ctx.targetCreatureId || '').trim(),
        ...(
          Array.isArray(ctx.selectorContext?.chosenObjectIds)
            ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
            : []
        ),
      ].filter(Boolean);

      if (directTargetIds.length > 0) {
        const wantedIds = new Set(directTargetIds);
        return filterIllegalDirectTargetPermanents(battlefield.filter((perm: any) => {
          const permanentId = String((perm as any)?.id || '').trim();
          if (!wantedIds.has(permanentId)) return false;
          if (excludeSource && sourceId && permanentId === sourceId) return false;
          return permanentMatchesType(perm, parsedType);
        }), ctx);
      }
    }
  }

  const parsed = parseContextualBattlefieldReference(target);
  if (!parsed) return [];

  const sourceId = String(ctx.sourceId || '').trim();
  if (parsed.mode === 'self') {
    const lastReferencedId = String((ctx as any).lastReferencedPermanentId || '').trim();
    const boundTargetId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    const chosenId = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? String(ctx.selectorContext.chosenObjectIds[0] || '').trim()
      : '';
    const resolvedId = lastReferencedId || boundTargetId || chosenId || sourceId;
    if (!resolvedId) return [];
    const selfPermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === resolvedId);
    return selfPermanent ? [selfPermanent] : [];
  }

  const resolvedContextualTargetIds = buildContextualBattlefieldTargetIds(
    battlefield,
    ctx,
    parsed.plural,
    parsed.mode === 'contextual' ? parsed.type : undefined
  );

  if (resolvedContextualTargetIds.length === 0) return [];

  const matches = battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!resolvedContextualTargetIds.includes(permanentId)) return false;
    if (!permanentMatchesType(perm, parsed.type)) return false;
    if (parsed.tokenOnly && !(perm as any)?.isToken) return false;
    if (parsed.subtype) {
      const typeLineLower = getExecutorTypeLineLower(perm);
      if (!new RegExp(`(^|[^a-z])${parsed.subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
        return false;
      }
    }
    return true;
  });

  if (matches.length > 0 || !parsed.tokenOnly) {
    const directTargetIds = new Set(
      [String(ctx.targetPermanentId || '').trim(), String(ctx.targetCreatureId || '').trim()].filter(Boolean)
    );
    if (directTargetIds.size <= 0) return matches;

    return matches.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!directTargetIds.has(permanentId)) return true;
      return canTargetPermanent(perm, {
        controllerId: ctx.controllerId,
        colors: ctx.sourceColors,
        objectType: ctx.sourceObjectType,
      }).canTarget;
    });
  }

  return battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!resolvedContextualTargetIds.includes(permanentId)) return false;
    if (!permanentMatchesType(perm, parsed.type)) return false;
    if (parsed.subtype) {
      const typeLineLower = getExecutorTypeLineLower(perm);
      if (!new RegExp(`(^|[^a-z])${parsed.subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
        return false;
      }
    }
    return true;
  });
}

export function resolveBoundSelectorMatches(
  battlefield: readonly BattlefieldPermanent[],
  selector: SimpleBattlefieldSelector,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  const boundIds = collectBoundBattlefieldIds(ctx);
  return battlefield.filter(perm => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!boundIds.includes(permanentId)) return false;
    return permanentMatchesSelector(perm, selector, ctx);
  });
}

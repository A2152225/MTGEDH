// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts (lines 602-821 and 932-977 before extraction)
// Cluster moved: battlefield-permanent predicates used by move_zone selectors (creature types,
// toughness, damage-dealt, tapped-this-way), the "this card / this permanent" self reference,
// aura/equipment attachment-host resolution, and the post-entry granted type/color patch.
// Public entry symbols: resolveTappedThisWayPermanentIds, getPermanentCreatureTypes,
// handCardSharesCreatureTypeWithEachPermanent, permanentDealtDamageThisTurn,
// getPermanentToughnessValue, permanentHasAnyListedCreatureType, isSelfBattlefieldReference,
// resolveSelfBattlefieldPermanentId, resolveBattlefieldAttachment, BattlefieldAttachmentResolution,
// applyBattlefieldEntryCharacteristicsToState.

import type { GameState } from '../../shared/src';
import { cardHasCreatureType, isValidCreatureType } from '../../shared/src/creatureTypes';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import type { MoveZoneRuntime } from './oracleIRExecutorMoveZoneStepTypes';
import {
  buildNameReferenceAliases,
  getChosenObjectIds,
  getControllerId,
  resolveEnchantedCreaturePermanentId,
} from './oracleIRExecutorMoveZoneReferenceResolvers';

export function resolveTappedThisWayPermanentIds(
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): string[] {
  return Array.from(
    new Set(
      [
        ...(Array.isArray(runtime?.lastTappedMatchingPermanentIds) ? runtime.lastTappedMatchingPermanentIds : []),
        ...(Array.isArray((ctx as any).lastTappedMatchingPermanentIds)
          ? (ctx as any).lastTappedMatchingPermanentIds
          : []),
      ]
        .map(id => String(id || '').trim())
        .filter(Boolean)
    )
  );
}

export function getPermanentCreatureTypes(perm: any): string[] {
  const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
  const oracleText = String(perm?.oracle_text || perm?.card?.oracle_text || '');
  const match = typeLine.match(/\bcreature\b[^—-]*[—-]\s*(.+)$/i);
  if (!match) return [];
  return String(match[1] || '')
    .split(/\s+/)
    .map(type => type.trim())
    .filter(type => type && isValidCreatureType(type))
    .filter(type => cardHasCreatureType(typeLine, oracleText, type));
}

export function handCardSharesCreatureTypeWithEachPermanent(handCard: any, permanents: readonly any[]): boolean {
  if (permanents.length === 0) return false;
  const typeLine = String(handCard?.type_line || '');
  const oracleText = String(handCard?.oracle_text || '');
  if (!typeLine.toLowerCase().includes('creature')) return false;
  for (const perm of permanents) {
    const types = getPermanentCreatureTypes(perm);
    if (types.length === 0) return false;
    if (!types.some(creatureType => cardHasCreatureType(typeLine, oracleText, creatureType))) return false;
  }
  return true;
}

export function permanentDealtDamageThisTurn(perm: any): boolean {
  return (perm as any)?.dealtDamageThisTurn === true;
}

export function getPermanentToughnessValue(perm: any): number | null {
  if (typeof perm?.effectiveToughness === 'number' && Number.isFinite(perm.effectiveToughness)) {
    return perm.effectiveToughness;
  }
  let toughness =
    typeof perm?.baseToughness === 'number' && Number.isFinite(perm.baseToughness)
      ? perm.baseToughness
      : Number.parseInt(String(perm?.toughness ?? perm?.card?.toughness ?? ''), 10);
  if (!Number.isFinite(toughness)) return null;
  const counters = perm?.counters || {};
  toughness += Number(counters['+1/+1'] || 0);
  toughness -= Number(counters['-1/-1'] || 0);
  return toughness;
}

export function permanentHasAnyListedCreatureType(perm: any, types: readonly string[]): boolean {
  const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
  const oracleText = String(perm?.oracle_text || perm?.card?.oracle_text || '');
  return types.some(type => cardHasCreatureType(typeLine, oracleText, type));
}

export function isSelfBattlefieldReference(text: string): boolean {
  return /^(?:this card|this permanent|this aura|this equipment|this enchantment|this artifact|this creature|this land)$/i.test(
    String(text || '').trim()
  );
}

export function resolveSelfBattlefieldPermanentId(
  state: GameState,
  whatText: string,
  ctx: OracleIRExecutionContext
): string {
  if (!isSelfBattlefieldReference(whatText)) return '';

  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return '';

  const battlefield = (state.battlefield || []) as any[];
  const sourcePermanent = battlefield.find(perm => String((perm as any)?.id || '').trim() === sourceId);
  if (!sourcePermanent) return '';

  const normalized = String(whatText || '').trim().toLowerCase();
  if (normalized === 'this creature' && !hasExecutorClass(sourcePermanent as any, 'creature')) return '';
  if (normalized === 'this land' && !hasExecutorClass(sourcePermanent as any, 'land')) return '';
  if (normalized === 'this enchantment' && !hasExecutorClass(sourcePermanent as any, 'enchantment')) return '';
  if (normalized === 'this artifact' && !hasExecutorClass(sourcePermanent as any, 'artifact')) return '';
  if (normalized === 'this equipment' && !hasExecutorClass(sourcePermanent as any, 'equipment')) return '';

  return sourceId;
}

export type BattlefieldAttachmentResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'resolved'; readonly permanentId: string }
  | { readonly kind: 'player_choice_required'; readonly selector: string }
  | { readonly kind: 'impossible'; readonly selector: string }
  | { readonly kind: 'unsupported'; readonly selector: string };

export function resolveBattlefieldAttachment(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext
): BattlefieldAttachmentResolution {
  if (step.to !== 'battlefield' || !step.battlefieldAttachedTo) return { kind: 'none' };
  if ((step.battlefieldAttachedTo as any)?.kind !== 'raw') {
    return { kind: 'unsupported', selector: String((step.battlefieldAttachedTo as any)?.raw || '') };
  }

  const selectorText = String((step.battlefieldAttachedTo as any)?.text || '').trim();
  const normalized = selectorText.replace(/\u2019/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  const battlefield = (state.battlefield || []) as any[];
  const chosenObjectIds = getChosenObjectIds(ctx);
  const contextualPermanentIds = Array.from(
    new Set(
      [String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim(), ...chosenObjectIds].filter(Boolean)
    )
  );

  if (isSelfBattlefieldReference(normalized) || isSelfBattlefieldReference(selectorText)) {
    const sourceId = resolveSelfBattlefieldPermanentId(state, selectorText || normalized, ctx);
    if (!sourceId) {
      return { kind: 'impossible', selector: selectorText || normalized };
    }
    return { kind: 'resolved', permanentId: sourceId };
  }

  {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find(perm => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const sourceNameAliases = new Set([
      ...buildNameReferenceAliases(ctx.sourceName),
      ...buildNameReferenceAliases((sourcePermanent as any)?.card?.name),
    ]);
    const hostNameAliases = new Set(buildNameReferenceAliases(selectorText));
    const namesSource = [...hostNameAliases].some((alias) => sourceNameAliases.has(alias));
    if (namesSource) {
      if (!sourcePermanent) {
        return { kind: 'impossible', selector: selectorText || normalized };
      }
      return { kind: 'resolved', permanentId: sourceId };
    }
  }

  if (normalized === 'a creature you control') {
    const controllerId = getControllerId(ctx);
    const controlledCreatures = battlefield.filter(
      perm => perm?.controller === controllerId && hasExecutorClass(perm as any, 'creature')
    );
    if (controlledCreatures.length === 0) return { kind: 'impossible', selector: selectorText || normalized };
    if (controlledCreatures.length > 1) {
      return { kind: 'player_choice_required', selector: selectorText || normalized };
    }
    return { kind: 'resolved', permanentId: String((controlledCreatures[0] as any)?.id || '').trim() };
  }

  if (normalized === 'that creature' || normalized === 'that land' || normalized === 'that permanent'
    || normalized === 'that token' || normalized === 'the token') {
    const expectedType = normalized === 'that land'
      ? 'land'
      : normalized === 'that creature'
        ? 'creature'
        : undefined;
    const preferTokens = normalized === 'that token' || normalized === 'the token';
    const createdTokenIds = Array.isArray((ctx as any)?.lastCreatedTokenIds)
      ? (ctx as any).lastCreatedTokenIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    const candidateIds = preferTokens
      ? Array.from(new Set([...createdTokenIds, ...contextualPermanentIds]))
      : contextualPermanentIds;
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!candidateIds.includes(permanentId)) return false;
      if (preferTokens && (perm as any)?.isToken !== true && createdTokenIds.length > 0 && !createdTokenIds.includes(permanentId)) {
        return false;
      }
      if (preferTokens && (perm as any)?.isToken !== true && createdTokenIds.length === 0) {
        if (!hasExecutorClass(perm as any, 'creature')) return false;
      }
      if (expectedType && !hasExecutorClass(perm as any, expectedType)) return false;
      return true;
    });
    if (matches.length === 0) return { kind: 'impossible', selector: selectorText || normalized };
    if (matches.length > 1 && !preferTokens) return { kind: 'player_choice_required', selector: selectorText || normalized };
    if (matches.length > 1 && preferTokens) {
      const tokenMatches = matches.filter((perm: any) => perm?.isToken === true);
      if (tokenMatches.length === 1) {
        return { kind: 'resolved', permanentId: String((tokenMatches[0] as any)?.id || '').trim() };
      }
      if (createdTokenIds.length === 1) {
        const created = matches.find((perm: any) => String((perm as any)?.id || '').trim() === createdTokenIds[0]);
        if (created) return { kind: 'resolved', permanentId: createdTokenIds[0] };
      }
      return { kind: 'player_choice_required', selector: selectorText || normalized };
    }
    return { kind: 'resolved', permanentId: String((matches[0] as any)?.id || '').trim() };
  }

  if (normalized === 'enchanted creature') {
    const enchantedPermanentId = resolveEnchantedCreaturePermanentId(state, ctx);
    if (!enchantedPermanentId) return { kind: 'impossible', selector: selectorText || normalized };
    return { kind: 'resolved', permanentId: enchantedPermanentId };
  }

  // Named host that is not the source (or a known pronoun): still move the Aura,
  // but do not invent an attachment. "attached to Other Permanent" stays unattached.
  if (selectorText) {
    return { kind: 'none' };
  }

  return { kind: 'unsupported', selector: selectorText || normalized };
}

export function applyBattlefieldEntryCharacteristicsToState(
  state: GameState,
  permanentIds: readonly string[] | undefined,
  addTypes: readonly string[] | undefined,
  addColors: readonly string[] | undefined
): GameState {
  const ids = new Set((permanentIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (ids.size === 0) return state;

  const normalizedTypes = (addTypes || []).map(type => String(type || '').trim()).filter(Boolean);
  const normalizedColors = (addColors || []).map(color => String(color || '').trim().toUpperCase()).filter(Boolean);
  if (normalizedTypes.length === 0 && normalizedColors.length === 0) return state;

  const battlefield = (state.battlefield || []) as any[];
  let changed = false;
  const nextBattlefield = battlefield.map((permanent: any) => {
    const permanentId = String(permanent?.id || '').trim();
    if (!ids.has(permanentId)) return permanent;

    const nextPermanent: any = { ...permanent };

    if (normalizedTypes.length > 0) {
      const grantedTypes = Array.isArray(nextPermanent.grantedTypes) ? [...nextPermanent.grantedTypes] : [];
      for (const typeName of normalizedTypes) {
        if (!grantedTypes.includes(typeName)) grantedTypes.push(typeName);
      }
      nextPermanent.grantedTypes = grantedTypes;
      changed = true;
    }

    if (normalizedColors.length > 0) {
      const colors = Array.isArray(nextPermanent.colors)
        ? [...nextPermanent.colors]
        : (Array.isArray(nextPermanent.card?.colors) ? [...nextPermanent.card.colors] : []);
      for (const color of normalizedColors) {
        if (!colors.includes(color)) colors.push(color);
      }
      nextPermanent.colors = colors;
      changed = true;
    }

    return nextPermanent;
  });

  return changed ? ({ ...state, battlefield: nextBattlefield as any } as any) : state;
}

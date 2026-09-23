// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: normalizeArmyCreatureSelectorText, resolveDeterministicArmyCreatureSelection,
//   plus generic named permanent/token "you control" selectors (Amass Army / Empower Jace).
// Public entries: normalizeArmyCreatureSelectorText, resolveDeterministicArmyCreatureSelection,
//   resolveDeterministicNamedControlSelection.

import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';

const CARD_TYPES = [
  'creature',
  'planeswalker',
  'artifact',
  'enchantment',
  'land',
  'battle',
  'vehicle',
  'permanent',
] as const;

function isTokenPermanent(perm: any): boolean {
  if (perm?.isToken === true || perm?.token === true || perm?.card?.isToken === true) return true;
  return /\btoken\b/i.test(String(perm?.type_line || perm?.card?.type_line || ''));
}

function typeLineHasWord(perm: any, word: string): boolean {
  const needle = String(word || '').trim().toLowerCase();
  if (!needle) return false;
  return new RegExp(`(^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`, 'i').test(
    getExecutorTypeLineLower(perm),
  );
}

function permanentNameMatches(perm: any, word: string): boolean {
  const needle = String(word || '').trim().toLowerCase();
  if (!needle) return false;
  const name = String(perm?.name || perm?.card?.name || '').trim().toLowerCase();
  if (!name) return false;
  return name === needle || new RegExp(`(^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`).test(name);
}

/**
 * Match descriptors like:
 * - "Army creature"
 * - "Jace planeswalker token"
 * - "Zombie Army creature token"
 */
export function permanentMatchesNamedControlDescriptor(perm: any, descriptor: string): boolean {
  let rest = String(descriptor || '')
    .trim()
    .toLowerCase()
    .replace(/^an?\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!rest) return false;

  const requiresToken = /\btoken\b/.test(rest);
  if (requiresToken) {
    if (!isTokenPermanent(perm)) return false;
    rest = rest.replace(/\btoken\b/g, ' ').replace(/\s+/g, ' ').trim();
  }

  for (const cardType of CARD_TYPES) {
    const re = new RegExp(`\\b${cardType}\\b`, 'i');
    if (!re.test(rest)) continue;
    if (cardType !== 'permanent' && !permanentMatchesType(perm, cardType) && !typeLineHasWord(perm, cardType)) {
      return false;
    }
    rest = rest.replace(re, ' ').replace(/\s+/g, ' ').trim();
  }

  if (!rest) return true;

  const words = rest.split(/\s+/).filter(Boolean);
  return words.every(
    (word) => typeLineHasWord(perm, word) || permanentNameMatches(perm, word),
  );
}

function normalizeNamedControlSelectorText(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
): string | null {
  if (!target || target.kind !== 'raw') return null;
  const normalized = normalizeSelfReferenceText(String((target as any).text || ''));
  if (!normalized) return null;
  const match = normalized.match(/^(?:target |an |a )?(.+?) you control$/i);
  if (!match) return null;
  const descriptor = String(match[1] || '').trim();
  if (!descriptor) return null;

  const lowered = descriptor.toLowerCase();
  // Empower Jace / token phrases: "Jace planeswalker token"
  if (/\btoken\b/.test(lowered)) {
    const withoutToken = lowered.replace(/\btoken\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!withoutToken) return null;
    return descriptor;
  }

  // Named type phrases: "Army creature", "Jace planeswalker" (no bare plurals like "Clues").
  const typed = lowered.match(
    /^([a-z][a-z' -]*?)\s+(creature|planeswalker|artifact|enchantment|land|battle|vehicle|permanent)s?$/i,
  );
  if (!typed) return null;
  const nameOrSubtype = String(typed[1] || '').trim();
  if (!nameOrSubtype) return null;
  if (/^(?:another|target|nonland|other|each|all|any)$/i.test(nameOrSubtype)) return null;
  return descriptor;
}

export function normalizeArmyCreatureSelectorText(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
): string | null {
  if (!target || target.kind !== 'raw') return null;
  const normalized = normalizeSelfReferenceText(String((target as any).text || ''));
  if (!normalized) return null;
  return /^(?:target |an |a )?army creature you control$/i.test(normalized) ? normalized : null;
}

export function resolveDeterministicNamedControlSelection(
  battlefield: readonly BattlefieldPermanent[],
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
  ctx: OracleIRExecutionContext,
): BattlefieldPermanent[] | null {
  const descriptor = normalizeNamedControlSelectorText(target);
  if (!descriptor) return null;

  const controllerId = String(ctx.controllerId || '').trim();
  if (!controllerId) return [];

  const matches = battlefield.filter((perm: any) => {
    if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
    return permanentMatchesNamedControlDescriptor(perm, descriptor);
  });

  // Deterministic auto-pick only when exactly one legal permanent exists
  // (mirrors Amass Army selection). Multiple matches defer to player choice.
  return matches.length === 1 ? matches : [];
}

export function resolveDeterministicArmyCreatureSelection(
  battlefield: readonly BattlefieldPermanent[],
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
  ctx: OracleIRExecutionContext,
): BattlefieldPermanent[] | null {
  if (!normalizeArmyCreatureSelectorText(target)) {
    // Fall through to the generic named-control selector for non-Army phrases.
    return resolveDeterministicNamedControlSelection(battlefield, target, ctx);
  }

  const controllerId = String(ctx.controllerId || '').trim();
  if (!controllerId) return [];

  const matches = battlefield.filter((perm: any) => {
    if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
    if (!permanentMatchesType(perm, 'creature')) return false;
    return typeLineHasWord(perm, 'army');
  });

  return matches.length === 1 ? matches : [];
}

// server/src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamageMatchBatch89.ts
// B89 overlay match extras kept out of replacementEffectSpecDamageOracleTemplates.ts (size).
// Public: matchesBatch89DamageExtras, readDamageSourceManaValue.
// Leaf: must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { damageSourceIsAnySpell } from '../replacementBatch64DamageReplacements.js';

function battlefield(state: unknown): any[] {
  return Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: any[] }).battlefield
    : [];
}

function findPermanent(state: unknown, id: string): any | undefined {
  const wanted = String(id || '').trim();
  if (!wanted) return undefined;
  return battlefield(state).find((perm) => perm && String(perm.id || '').trim() === wanted);
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function isCreaturePermanent(perm: any): boolean {
  if (!perm) return false;
  return (/\bcreature\b/.test(typeLineOf(perm)) && perm.notCreature !== true) || perm.isCreature === true;
}

function attachedToId(perm: any): string {
  return String(perm?.attachedTo || perm?.attachedToId || '').trim();
}

function readCardManaValue(card: any): number {
  const raw = card?.cmc ?? card?.mana_value ?? card?.manaValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export function readDamageSourceManaValue(state: unknown, damageSourceId: string): number {
  const id = String(damageSourceId || '').trim();
  if (!id || !state) return NaN;
  const perm = findPermanent(state, id);
  if (perm) return readCardManaValue(perm.card || perm);
  const stack: any[] = Array.isArray((state as any)?.stack) ? (state as any).stack : [];
  const stacked = stack.find((item) => item && (String(item.id || '') === id || String(item.cardId || '') === id));
  if (stacked) return readCardManaValue(stacked.card || stacked);
  const resolving = (state as any)?.resolvingSpellSource || (state as any)?.resolvingSpell;
  if (resolving && (String(resolving.id || '') === id || String(resolving.cardId || '') === id)) {
    return readCardManaValue(resolving.card || resolving);
  }
  return NaN;
}

function sourceIsNoncreature(state: unknown, damageSourceId: string): boolean {
  const id = String(damageSourceId || '').trim();
  if (!id || !state) return false;
  if (damageSourceIsAnySpell(state, id)) {
    const stack: any[] = Array.isArray((state as any)?.stack) ? (state as any).stack : [];
    const stacked = stack.find((item) => item && (String(item.id || '') === id || String(item.cardId || '') === id));
    const resolving = (state as any)?.resolvingSpellSource || (state as any)?.resolvingSpell;
    const card = stacked?.card || stacked || ((resolving && (String(resolving.id || '') === id || String(resolving.cardId || '') === id)) ? (resolving.card || resolving) : undefined);
    const tl = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
    return !/\bcreature\b/.test(tl);
  }
  const perm = findPermanent(state, id);
  if (!perm) return false;
  return !isCreaturePermanent(perm);
}

function hasCreatureType(perm: any, wanted: string): boolean {
  const type = String(wanted || '').toLowerCase();
  if (!type || !perm) return false;
  const tl = typeLineOf(perm);
  return tl.split(/[^a-z0-9/-]+/).includes(type);
}

export function matchesBatch89DamageExtras(
  spec: ReplacementEffectSpec,
  input: {
    damageDealer: string;
    damageReceiver: string;
    damageSourcePermanentId?: string;
    isCombatDamage?: boolean;
    targetPermanentId?: string;
  },
  state?: unknown,
): boolean {
  const match = spec.match || {};
  const sourceController = String(spec.sourceController || '');
  const receiver = String(input.damageReceiver || '');
  const damageSourceId = String(input.damageSourcePermanentId || '').trim();
  const sourceId = String(spec.sourcePermanentId || '').trim();

  if (match.damageSourceIsNoncreature === true) {
    if (!sourceIsNoncreature(state, damageSourceId)) return false;
  }
  if (match.damageSourceHasOddManaValue === true) {
    const mv = readDamageSourceManaValue(state, damageSourceId);
    if (!Number.isFinite(mv) || Math.abs(Math.trunc(mv)) % 2 !== 1) return false;
  }
  if (Array.isArray(match.damageSourceHasCreatureTypeIn) && match.damageSourceHasCreatureTypeIn.length > 0) {
    if (!damageSourceId || !state) return false;
    const dmgSource = findPermanent(state, damageSourceId);
    if (!dmgSource) return false;
    const wanted = match.damageSourceHasCreatureTypeIn.map((t) => String(t).toLowerCase());
    if (!wanted.some((t) => hasCreatureType(dmgSource, t))) return false;
  }
  if (match.damageSourceIsEquippedBySource === true) {
    if (!damageSourceId || !sourceId || !state) return false;
    const equipment = findPermanent(state, sourceId);
    if (!equipment || attachedToId(equipment) !== damageSourceId) return false;
  }
  if (match.receivingPermanentIsEquippedBySource === true) {
    const targetId = String(input.targetPermanentId || '').trim();
    if (!targetId || !sourceId || !state) return false;
    const equipment = findPermanent(state, sourceId);
    if (!equipment || attachedToId(equipment) !== targetId) return false;
  }
  if (match.receivingIsCreatureBattleOrOpponent === true) {
    const targetId = String(input.targetPermanentId || '').trim();
    if (!targetId) {
      if (!sourceController || !receiver || receiver === sourceController) return false;
    } else {
      if (!state) return false;
      const target = findPermanent(state, targetId);
      if (!target) return false;
      const tl = typeLineOf(target);
      if (!/\bcreature\b/.test(tl) && !/\bbattle\b/.test(tl)) return false;
    }
  }
  return true;
}

// server/src/state/modules/replacementBatch95DamageReplacements.ts
// B95: Vigor (prevent to another creature you control, +1/+1 equal to prevented),
// Gratuitous Violence (your creatures deal double), Lashknife Barrier (minus N
// to creatures you control), Sphere of Purity (prevent N from artifacts to you),
// Callous Giant (prevent damage <= N to self), Panther Habit (prevent to
// equipped, put that many +1/+1), Weathered Bodyguards (redirect unblocked
// combat damage from you while untapped).
// Public: parseBatch95DamageSentence, collectBatch95DamageReplacementSpecs,
// collectBatch95DamageReplacementSpecsFromState, applyBatch95DamageSideEffects.

import type { GameContext } from '../context.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

const VIGOR_RE = /if damage would be dealt to another creature you control, prevent that damage(?:\.|,)?(?:\s*put (?:a \+1\/\+1 counter on that creature for each 1 damage prevented this way|that many \+1\/\+1 counters on that creature))?/i;
const PANTHER_RE = /if equipped creature would be dealt damage, prevent that damage and put that many (?:[-+]1\/[-+]1|\u00b1n\/\u00b1n) counters on it/i;
const DOUBLE_YOURS_RE = /if a creature you control would deal damage(?: to a permanent or player)?, it deals double that damage instead/i;
const MINUS_TO_YOURS_RE = /if a source would deal damage to a creature you control, it deals that much damage minus (one|two|three|\d+|n) to that creature instead/i;
const ARTIFACT_PREVENT_YOU_RE = /if an artifact would deal damage to you, prevent (one|two|three|\d+|n) of that damage/i;
const SELF_LEQ_PREVENT_RE = /if a source would deal (\d+|one|two|three|four|five|n) or less damage to (?:this creature|~), prevent that damage/i;
const WEATHERED_RE = /as long as (?:this creature|~) is untapped, all combat damage that would be dealt to you by unblocked creatures is dealt to (?:this creature|~) instead/i;

function num(raw: string | undefined, fallback = 1): number {
  const s = String(raw || '').toLowerCase();
  return WORD[s] ?? (parseInt(s, 10) || fallback);
}

export type Batch95DamageParse =
  | { kind: 'prevent-and-p1p1-other-you-control' }
  | { kind: 'prevent-and-p1p1-equipped' }
  | { kind: 'controlled-creatures-double' }
  | { kind: 'minus-n-to-controlled-creatures'; minus: number }
  | { kind: 'prevent-n-from-artifacts-to-you'; prevent: number }
  | { kind: 'prevent-if-amount-leq'; leq: number }
  | { kind: 'redirect-unblocked-combat-to-self-while-untapped' };

export function parseBatch95DamageSentence(oracle: string): Batch95DamageParse[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const out: Batch95DamageParse[] = [];
  if (VIGOR_RE.test(text)) out.push({ kind: 'prevent-and-p1p1-other-you-control' });
  if (PANTHER_RE.test(text)) out.push({ kind: 'prevent-and-p1p1-equipped' });
  if (DOUBLE_YOURS_RE.test(text)) out.push({ kind: 'controlled-creatures-double' });
  const minus = text.match(MINUS_TO_YOURS_RE);
  if (minus) out.push({ kind: 'minus-n-to-controlled-creatures', minus: num(minus[1]) });
  const art = text.match(ARTIFACT_PREVENT_YOU_RE);
  if (art) out.push({ kind: 'prevent-n-from-artifacts-to-you', prevent: num(art[1]) });
  const leq = text.match(SELF_LEQ_PREVENT_RE);
  if (leq) out.push({ kind: 'prevent-if-amount-leq', leq: num(leq[1], 3) });
  if (WEATHERED_RE.test(text)) out.push({ kind: 'redirect-unblocked-combat-to-self-while-untapped' });
  return out;
}

const EFFECT_ID: Record<Batch95DamageParse['kind'], string> = {
  'prevent-and-p1p1-other-you-control': 'prevent-and-p1p1-other-you-control',
  'prevent-and-p1p1-equipped': 'prevent-and-p1p1-equipped',
  'controlled-creatures-double': 'controlled-creatures-double-damage',
  'minus-n-to-controlled-creatures': 'minus-n-to-controlled-creatures',
  'prevent-n-from-artifacts-to-you': 'prevent-n-from-artifacts-to-you',
  'prevent-if-amount-leq': 'prevent-if-amount-leq',
  'redirect-unblocked-combat-to-self-while-untapped': 'redirect-unblocked-combat-to-self-while-untapped',
};

export function collectBatch95DamageReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch95DamageSentence(oracle).map((entry, i) => {
    const effectId = EFFECT_ID[entry.kind];
    const modify = entry.kind === 'controlled-creatures-double'
      ? { modify: 'double' as const, value: 2 }
      : entry.kind === 'minus-n-to-controlled-creatures'
        ? { modify: 'add_flat' as const, value: -entry.minus }
        : entry.kind === 'prevent-n-from-artifacts-to-you'
          ? { modify: 'add_flat' as const, value: -entry.prevent }
          : entry.kind === 'prevent-if-amount-leq' || entry.kind === 'prevent-and-p1p1-other-you-control' || entry.kind === 'prevent-and-p1p1-equipped'
            ? { modify: 'cap' as const, value: 0 }
            : undefined;
    return {
      id: `${source.sourcePermanentId}:${effectId}${i ? `-${i}` : ''}`,
      event: entry.kind === 'redirect-unblocked-combat-to-self-while-untapped' ? 'damage-redirect' as const : 'damage-prevention-cost' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: {},
      instead: modify || {},
      effectId,
      reason: effectId.replace(/-/g, '_'),
      metadata: { ...entry },
    } as ReplacementEffectSpec;
  });
}

export function collectBatch95DamageReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield: any[] = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || (perm as any).phasedOut === true || !(perm as any).card) continue;
    const sourcePermanentId = String((perm as any).id || '').trim();
    const sourceController = String((perm as any).controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch95DamageReplacementSpecs(readCardOracleText((perm as any).card), {
      sourcePermanentId, sourceController, sourceName: String((perm as any).card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

function isCreature(obj: any): boolean {
  return /\bcreature\b/i.test(String(obj?.card?.type_line || obj?.type_line || ''));
}

function isArtifact(obj: any): boolean {
  return /\bartifact\b/i.test(String(obj?.card?.type_line || obj?.type_line || ''));
}

function findEquippedBy(state: any, equipmentId: string): any | undefined {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const eq = battlefield.find((p: any) => String(p?.id || '') === String(equipmentId));
  const attachedTo = String(eq?.attachedTo || eq?.attachedToId || eq?.equippedCreatureId || '').trim();
  if (attachedTo) return battlefield.find((p: any) => String(p?.id || '') === attachedTo);
  return battlefield.find((p: any) => {
    const atts = p?.attachments || p?.attachedEquipment || [];
    return Array.isArray(atts) && atts.some((a: any) => String(a?.id || a) === String(equipmentId));
  });
}

function addP1P1(perm: any, n: number): void {
  if (!perm || !(n > 0)) return;
  perm.counters = perm.counters || {};
  perm.counters['+1/+1'] = Math.max(0, Number(perm.counters['+1/+1']) || 0) + n;
}

export function applyBatch95DamageSideEffects(
  ctx: GameContext,
  damageAmount: number,
  _damageDealer: string,
  damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
  isCombatDamage?: boolean,
): { amount: number; modifiers: string[] } | null {
  if (!(Number(damageAmount) > 0)) return null;
  const state: any = (ctx as any)?.state || ctx;
  const specs = collectBatch95DamageReplacementSpecsFromState(state);
  if (!specs.length) return null;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const source = battlefield.find((p: any) => String(p?.id || '') === String(damageSourcePermanentId || ''))
    || (state?.stack || []).find((s: any) => String(s?.id || s?.card?.id || '') === String(damageSourcePermanentId || ''));
  const target = battlefield.find((p: any) => String(p?.id || '') === String(targetPermanentId || ''));
  let amount = Math.max(0, Math.floor(Number(damageAmount) || 0));
  const modifiers: string[] = [];

  for (const spec of specs) {
    if (spec.effectId === 'controlled-creatures-double-damage') {
      if (!source || !isCreature(source)) continue;
      if (String(source.controller || '') !== String(spec.sourceController)) continue;
      amount *= 2;
      modifiers.push(`${spec.sourceName}: double damage`);
    }
    if (spec.effectId === 'minus-n-to-controlled-creatures') {
      const minus = Number((spec.metadata as any)?.minus || 0);
      if (!target || !isCreature(target) || minus <= 0) continue;
      if (String(target.controller || '') !== String(spec.sourceController)) continue;
      const before = amount;
      amount = Math.max(0, amount - minus);
      if (amount !== before) modifiers.push(`${spec.sourceName}: -${before - amount} damage`);
    }
    if (spec.effectId === 'prevent-n-from-artifacts-to-you') {
      const prevent = Number((spec.metadata as any)?.prevent || 0);
      if (prevent <= 0 || String(damageReceiver) !== String(spec.sourceController)) continue;
      if (!source || !isArtifact(source)) continue;
      const before = amount;
      amount = Math.max(0, amount - prevent);
      if (amount !== before) modifiers.push(`${spec.sourceName}: prevent ${before - amount}`);
    }
    if (spec.effectId === 'prevent-if-amount-leq') {
      const leq = Number((spec.metadata as any)?.leq || 0);
      if (!target || String(target.id) !== String(spec.sourcePermanentId)) continue;
      if (leq > 0 && amount <= leq) {
        modifiers.push(`${spec.sourceName}: prevented ${amount} (source dealt ${amount} or less)`);
        amount = 0;
      }
    }
    if (spec.effectId === 'prevent-and-p1p1-other-you-control') {
      if (!target || !isCreature(target)) continue;
      if (String(target.controller || '') !== String(spec.sourceController)) continue;
      if (String(target.id) === String(spec.sourcePermanentId)) continue;
      addP1P1(target, amount);
      modifiers.push(`${spec.sourceName}: prevented ${amount} and put ${amount} +1/+1 counter(s)`);
      amount = 0;
    }
    if (spec.effectId === 'prevent-and-p1p1-equipped') {
      const equipped = findEquippedBy(state, String(spec.sourcePermanentId));
      if (!equipped || String(equipped.id) !== String(target?.id || '')) continue;
      addP1P1(equipped, amount);
      modifiers.push(`${spec.sourceName}: prevented ${amount} and put ${amount} +1/+1 counter(s)`);
      amount = 0;
    }
    if (spec.effectId === 'redirect-unblocked-combat-to-self-while-untapped') {
      if (isCombatDamage !== true) continue;
      if (String(damageReceiver) !== String(spec.sourceController)) continue;
      const guard = battlefield.find((p: any) => String(p?.id || '') === String(spec.sourcePermanentId));
      if (!guard || guard.tapped === true || guard.phasedOut === true) continue;
      const unblocked = source && (source.blocked === false || source.unblocked === true || (source.attacking && !source.blockedBy?.length && source.blocked !== true));
      if (source && unblocked === false) continue;
      guard.markedDamage = (Number(guard.markedDamage) || 0) + amount;
      guard.damageThisTurn = (Number(guard.damageThisTurn) || 0) + amount;
      guard.tookDamageThisTurn = true;
      modifiers.push(`${spec.sourceName}: redirected ${amount} combat damage`);
      amount = 0;
    }
  }
  void _damageDealer;
  if (!modifiers.length) return null;
  return { amount, modifiers };
}

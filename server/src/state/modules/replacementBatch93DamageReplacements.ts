// server/src/state/modules/replacementBatch93DamageReplacements.ts
// B93: Valley Flamecaller (typed creatures you control deal +N), Force Bubble
// (damage to you becomes depletion counters on the source), Phyrexian Unlife
// (damage to you is dealt as though the source had infect while you have 0 or
// less life).
// Public: parseBatch93DamageSentence, collectBatch93DamageReplacementSpecs,
// collectBatch93DamageReplacementSpecsFromState, applyBatch93DamageSideEffects,
// damageToPlayerIsDealtAsInfect.

import type { GameContext } from '../context.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const PLUS_RE =
  /if an? ([a-z]+(?:, [a-z]+)*)(?:,? or ([a-z]+))? you control would deal damage to a permanent or player, it deals that much damage plus (\d+) instead/i;
const BUBBLE_RE = /if damage would be dealt to you, put that many depletion counters on (?:this enchantment|this permanent|~|[^.]+?) instead/i;
const INFECT_AS_RE = /as long as you have 0 or less life, all damage is dealt to you as though its source had infect/i;

function splitTypes(left: string, right?: string): string[] {
  const raw = `${left || ''}${right ? `, ${right}` : ''}`;
  return raw.split(/,| or /i).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function parseBatch93DamageSentence(oracle: string): Array<
  | { kind: 'typed-source-plus'; types: string[]; plus: number }
  | { kind: 'damage-to-you-becomes-depletion' }
  | { kind: 'damage-to-you-as-infect-at-zero-life' }
> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<any> = [];
  const p = text.match(PLUS_RE);
  if (p) {
    const plus = parseInt(String(p[3] || '1'), 10);
    const types = splitTypes(p[1] || '', p[2]);
    if (plus > 0 && types.length) out.push({ kind: 'typed-source-plus', types, plus });
  }
  if (BUBBLE_RE.test(text)) out.push({ kind: 'damage-to-you-becomes-depletion' });
  if (INFECT_AS_RE.test(text)) out.push({ kind: 'damage-to-you-as-infect-at-zero-life' });
  return out;
}

export function collectBatch93DamageReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch93DamageSentence(oracle).map((entry, i) => {
    if (entry.kind === 'typed-source-plus') {
      return {
        id: `${source.sourcePermanentId}:typed-source-damage-plus-${entry.plus}${i ? `-${i}` : ''}`,
        event: 'damage-prevention-cost' as const,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: {},
        instead: { modify: 'add_flat' as const, value: entry.plus },
        effectId: 'typed-source-damage-plus-n',
        reason: 'typed_source_damage_plus_n',
        metadata: { types: entry.types, plus: entry.plus },
      } as ReplacementEffectSpec;
    }
    if (entry.kind === 'damage-to-you-becomes-depletion') {
      return {
        id: `${source.sourcePermanentId}:damage-to-you-becomes-depletion`,
        event: 'damage-prevention-cost' as const,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: {},
        instead: {},
        effectId: 'damage-to-you-becomes-depletion',
        reason: 'damage_to_you_becomes_depletion',
        metadata: { putDepletionOnSource: true },
      } as ReplacementEffectSpec;
    }
    return {
      id: `${source.sourcePermanentId}:damage-to-you-as-infect-at-zero-life`,
      event: 'damage-prevention-cost' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: {},
      instead: {},
      effectId: 'damage-to-you-as-infect-at-zero-life',
      reason: 'damage_to_you_as_infect_at_zero_life',
      metadata: { asInfectWhileLifeZeroOrLess: true },
    } as ReplacementEffectSpec;
  });
}

export function collectBatch93DamageReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch93DamageReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String((rec.card as any)?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

function typeLineOf(obj: any): string {
  return String(obj?.card?.type_line || obj?.type_line || '').toLowerCase();
}

function sourceHasListedType(source: any, types: string[]): boolean {
  const tl = typeLineOf(source);
  return types.some((t) => new RegExp(`\\b${t.replace(/s$/, '')}s?\\b`, 'i').test(tl));
}

function lifeOf(state: any, playerId: string): number {
  const player = Array.isArray(state?.players) ? state.players.find((p: any) => String(p?.id) === playerId) : undefined;
  return Number(state?.life?.[playerId] ?? player?.life ?? 40);
}

export function damageToPlayerIsDealtAsInfect(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  if (!pid) return false;
  const has = collectBatch93DamageReplacementSpecsFromState(state).some((s) =>
    s.effectId === 'damage-to-you-as-infect-at-zero-life' && String(s.sourceController) === pid,
  );
  return has && lifeOf(state, pid) <= 0;
}

export function applyBatch93DamageSideEffects(
  ctx: GameContext,
  damageAmount: number,
  _damageDealer: string,
  damageReceiver: string,
  damageSourcePermanentId?: string,
  _targetPermanentId?: string,
  _isCombatDamage?: boolean,
): { amount: number; modifiers: string[]; asInfect?: boolean } | null {
  if (!(Number(damageAmount) > 0)) return null;
  const state: any = (ctx as any)?.state || ctx;
  const specs = collectBatch93DamageReplacementSpecsFromState(state);
  if (!specs.length) return null;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const source = battlefield.find((p: any) => String(p?.id || '') === String(damageSourcePermanentId || ''));
  let amount = Math.max(0, Math.floor(Number(damageAmount) || 0));
  const modifiers: string[] = [];

  for (const spec of specs) {
    if (spec.effectId === 'typed-source-damage-plus-n') {
      const types = ((spec.metadata as any)?.types || []) as string[];
      const plus = Number((spec.metadata as any)?.plus || 0);
      if (!source || String(source.controller || '') !== String(spec.sourceController)) continue;
      if (!sourceHasListedType(source, types)) continue;
      amount += plus;
      modifiers.push(`${spec.sourceName}: +${plus} damage`);
    }
  }

  const bubble = specs.find((s) => s.effectId === 'damage-to-you-becomes-depletion' && String(s.sourceController) === String(damageReceiver));
  if (bubble) {
    const perm = battlefield.find((p: any) => String(p?.id || '') === String(bubble.sourcePermanentId));
    if (perm) {
      perm.counters = perm.counters || {};
      perm.counters.depletion = (Number(perm.counters.depletion) || 0) + amount;
      modifiers.push(`${bubble.sourceName}: ${amount} damage becomes depletion counters`);
      return { amount: 0, modifiers };
    }
  }

  if (damageToPlayerIsDealtAsInfect(state, String(damageReceiver))) {
    modifiers.push('Damage is dealt as though the source had infect');
    return { amount, modifiers, asInfect: true };
  }

  if (!modifiers.length) return null;
  return { amount, modifiers };
}

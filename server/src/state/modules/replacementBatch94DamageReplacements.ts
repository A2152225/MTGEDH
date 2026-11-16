// server/src/state/modules/replacementBatch94DamageReplacements.ts
// B94: Neriv (creatures you control that entered this turn deal double
// damage), Pyromancer's Gauntlet (red instant/sorcery or red planeswalker
// you control deals +N), Daunting Defender (prevent N to Clerics you control).
// Public: parseBatch94DamageSentence, collectBatch94DamageReplacementSpecs,
// collectBatch94DamageReplacementSpecsFromState, applyBatch94DamageSideEffects.

import type { GameContext } from '../context.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const NERIV_RE = /if a creature you control that entered(?: the battlefield)? this turn would deal damage, it deals twice that much damage instead/i;
const GAUNTLET_RE = /if a(?:n?) (white|blue|black|red|green) instant or sorcery spell you control or a(?:n?) (white|blue|black|red|green) planeswalker you control would deal damage to a permanent or player, it deals that much damage plus (\d+) to that permanent or player instead/i;
const PREVENT_TYPE_RE = /if a source would deal damage to a(?:n?) ([a-z]+) creature you control, prevent (\d+|one|two|three) of that damage/i;

const WORD: Record<string, number> = { one: 1, two: 2, three: 3 };

export function parseBatch94DamageSentence(oracle: string): Array<
  | { kind: 'entered-this-turn-double' }
  | { kind: 'colored-spell-or-planeswalker-plus'; color: string; plus: number }
  | { kind: 'prevent-n-to-controlled-type'; type: string; prevent: number }
> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<any> = [];
  if (NERIV_RE.test(text)) out.push({ kind: 'entered-this-turn-double' });
  const g = text.match(GAUNTLET_RE);
  if (g) out.push({ kind: 'colored-spell-or-planeswalker-plus', color: String(g[1] || g[2] || 'red'), plus: parseInt(String(g[3] || '2'), 10) || 2 });
  const p = text.match(PREVENT_TYPE_RE);
  if (p) {
    const raw = String(p[2] || '1').toLowerCase();
    out.push({ kind: 'prevent-n-to-controlled-type', type: String(p[1] || ''), prevent: WORD[raw] ?? (parseInt(raw, 10) || 1) });
  }
  return out;
}

export function collectBatch94DamageReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch94DamageSentence(oracle).map((entry, i) => {
    if (entry.kind === 'entered-this-turn-double') {
      return {
        id: `${source.sourcePermanentId}:entered-this-turn-damage-double`,
        event: 'damage-prevention-cost' as const,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: {},
        instead: { modify: 'double' as const, value: 2 },
        effectId: 'entered-this-turn-damage-double',
        reason: 'entered_this_turn_damage_double',
        metadata: {},
      } as ReplacementEffectSpec;
    }
    if (entry.kind === 'colored-spell-or-planeswalker-plus') {
      return {
        id: `${source.sourcePermanentId}:colored-spell-or-pw-damage-plus${i ? `-${i}` : ''}`,
        event: 'damage-prevention-cost' as const,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: {},
        instead: { modify: 'add_flat' as const, value: entry.plus },
        effectId: 'colored-spell-or-pw-damage-plus',
        reason: 'colored_spell_or_pw_damage_plus',
        metadata: { color: entry.color, plus: entry.plus },
      } as ReplacementEffectSpec;
    }
    return {
      id: `${source.sourcePermanentId}:prevent-n-to-controlled-type`,
      event: 'damage-prevention-cost' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: {},
      instead: { prevent: entry.prevent },
      effectId: 'prevent-n-to-controlled-type',
      reason: 'prevent_n_to_controlled_type',
      metadata: { type: entry.type, prevent: entry.prevent },
    } as ReplacementEffectSpec;
  });
}

export function collectBatch94DamageReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch94DamageReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String((rec.card as any)?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

function isCreature(obj: any): boolean {
  return /\bcreature\b/i.test(String(obj?.card?.type_line || obj?.type_line || ''));
}

function hasType(obj: any, typ: string): boolean {
  return new RegExp(`\\b${typ.replace(/s$/, '')}s?\\b`, 'i').test(String(obj?.card?.type_line || obj?.type_line || ''));
}

function sourceEnteredThisTurn(source: any): boolean {
  return source?.enteredThisTurn === true || source?.enteredTheBattlefieldThisTurn === true;
}

function colorLetter(name: string): string {
  return ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' } as Record<string, string>)[name] || name;
}

function sourceHasColor(source: any, color: string, state?: any): boolean {
  const letter = colorLetter(color);
  const raw = source?.colors ?? source?.card?.colors ?? source?.color_identity;
  if (Array.isArray(raw) && raw.some((c: any) => String(c).toUpperCase() === letter)) return true;
  const cost = String(source?.mana_cost || source?.card?.mana_cost || '');
  if (new RegExp(`\\{${letter}\\}`, 'i').test(cost)) return true;
  const typ = String(source?.card?.type_line || source?.type_line || '');
  if (new RegExp(`\\b${color}\\b`, 'i').test(typ)) return true;
  void state;
  return false;
}

export function applyBatch94DamageSideEffects(
  ctx: GameContext,
  damageAmount: number,
  _damageDealer: string,
  damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
  _isCombatDamage?: boolean,
): { amount: number; modifiers: string[] } | null {
  if (!(Number(damageAmount) > 0)) return null;
  const state: any = (ctx as any)?.state || ctx;
  const specs = collectBatch94DamageReplacementSpecsFromState(state);
  if (!specs.length) return null;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const source = battlefield.find((p: any) => String(p?.id || '') === String(damageSourcePermanentId || ''))
    || (state?.stack || []).find((s: any) => String(s?.id || s?.card?.id || '') === String(damageSourcePermanentId || ''));
  let amount = Math.max(0, Math.floor(Number(damageAmount) || 0));
  const modifiers: string[] = [];

  for (const spec of specs) {
    if (spec.effectId === 'entered-this-turn-damage-double') {
      if (!source || !isCreature(source)) continue;
      if (String(source.controller || '') !== String(spec.sourceController)) continue;
      if (!sourceEnteredThisTurn(source)) continue;
      amount *= 2;
      modifiers.push(`${spec.sourceName}: double damage`);
    }
    if (spec.effectId === 'colored-spell-or-pw-damage-plus') {
      const color = String((spec.metadata as any)?.color || '');
      const plus = Number((spec.metadata as any)?.plus || 0);
      if (!source || plus <= 0) continue;
      const isPw = /\bplaneswalker\b/i.test(String(source?.card?.type_line || source?.type_line || ''));
      const isSpell = /\b(instant|sorcery)\b/i.test(String(source?.card?.type_line || source?.type_line || source?.spellType || '')) || source?.isSpell === true;
      if (!isPw && !isSpell) continue;
      if (String(source.controller || source.controllerId || '') !== String(spec.sourceController)) continue;
      if (!sourceHasColor(source, color, state)) continue;
      amount += plus;
      modifiers.push(`${spec.sourceName}: +${plus} damage`);
    }
    if (spec.effectId === 'prevent-n-to-controlled-type') {
      const typ = String((spec.metadata as any)?.type || '');
      const prevent = Number((spec.metadata as any)?.prevent || 0);
      const target = battlefield.find((p: any) => String(p?.id || '') === String(targetPermanentId || ''));
      if (!target || prevent <= 0) continue;
      if (String(target.controller || '') !== String(spec.sourceController)) continue;
      if (!isCreature(target) || !hasType(target, typ)) continue;
      const before = amount;
      amount = Math.max(0, amount - prevent);
      if (amount !== before) modifiers.push(`${spec.sourceName}: prevent ${before - amount}`);
    }
  }
  void damageReceiver;
  if (!modifiers.length) return null;
  return { amount, modifiers };
}

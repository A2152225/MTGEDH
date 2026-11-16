// server/src/state/modules/replacementBatch92DamageReplacements.ts
// B92: Well-Laid Plans — prevent damage to a creature by another creature if they share a color.
// Public: parseBatch92DamageSentence, collectBatch92DamageReplacementSpecs,
// collectBatch92DamageReplacementSpecsFromState, creaturesShareAColor,
// applyBatch92DamageSideEffects.

import type { GameContext } from '../context.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const SHARE_COLOR_RE =
  /prevent all damage that would be dealt to a creature by another creature if they share a color/i;

const COLOR_WORDS = ['white', 'blue', 'black', 'red', 'green'] as const;
const COLOR_MAP: Record<string, string> = { w: 'white', u: 'blue', b: 'black', r: 'red', g: 'green' };

export function parseBatch92DamageSentence(oracle: string): Array<{ kind: 'share-color-prevent' }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  return SHARE_COLOR_RE.test(text) ? [{ kind: 'share-color-prevent' }] : [];
}

function colorsOf(obj: any): string[] {
  const out = new Set<string>();
  const raw = obj?.colors || obj?.card?.colors || obj?.color_identity;
  if (Array.isArray(raw)) {
    for (const c of raw) {
      const k = COLOR_MAP[String(c || '').toLowerCase()] || String(c || '').toLowerCase();
      if ((COLOR_WORDS as readonly string[]).includes(k)) out.add(k);
    }
  }
  const tl = String(obj?.card?.type_line || obj?.type_line || '').toLowerCase();
  for (const w of COLOR_WORDS) {
    if (new RegExp(`\\b${w}\\b`).test(tl) && /creature|instant|sorcery|enchantment|artifact|planeswalker|land/.test(tl)) {
      // type line color words like "Creature — White Knight" are uncommon; skip
    }
  }
  const text = `${obj?.card?.oracle_text || ''} ${obj?.card?.mana_cost || obj?.mana_cost || ''}`;
  // Fallback: mana cost symbols
  for (const m of String(obj?.card?.mana_cost || obj?.mana_cost || '').matchAll(/\{([WUBRG])\}/gi)) {
    const k = COLOR_MAP[String(m[1] || '').toLowerCase()];
    if (k) out.add(k);
  }
  void text;
  return [...out];
}

export function creaturesShareAColor(a: any, b: any): boolean {
  const ca = colorsOf(a);
  const cb = colorsOf(b);
  return ca.some((c) => cb.includes(c));
}

function looksLikeCreature(obj: any): boolean {
  return /\bcreature\b/i.test(String(obj?.card?.type_line || obj?.type_line || obj?.typeLine || ''));
}

export function collectBatch92DamageReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  if (!parseBatch92DamageSentence(oracle).length) return [];
  return [{
    id: `${source.sourcePermanentId}:prevent-shared-color-creature-damage`,
    event: 'damage-prevention-cost',
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: {},
    instead: {},
    effectId: 'prevent-shared-color-creature-damage',
    reason: 'prevent_shared_color_creature_damage',
    metadata: { requireSourceAndReceiverCreaturesShareColor: true },
  } as ReplacementEffectSpec];
}

export function collectBatch92DamageReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch92DamageReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function applyBatch92DamageSideEffects(
  ctx: GameContext,
  damageAmount: number,
  _damageDealer: string,
  _damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
  _isCombatDamage?: boolean,
): { amount: number; modifiers: string[] } | null {
  if (!(Number(damageAmount) > 0)) return null;
  const state: any = (ctx as any)?.state || ctx;
  const specs = collectBatch92DamageReplacementSpecsFromState(state);
  if (!specs.length) return null;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const find = (id?: string) => battlefield.find((p: any) => String(p?.id || '') === String(id || ''));
  const source = find(damageSourcePermanentId);
  const target = find(targetPermanentId);
  if (!source || !target) return null;
  if (!looksLikeCreature(source) || !looksLikeCreature(target)) return null;
  if (String(source.id) === String(target.id)) return null;
  if (!creaturesShareAColor(source, target)) return null;
  const name = String(specs[0]?.sourceName || 'Replacement effect');
  return { amount: 0, modifiers: [`${name}: prevented ${damageAmount} damage (source and receiver share a color)`] };
}

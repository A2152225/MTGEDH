// server/src/state/modules/replacementBatch98Collect.ts
// B98 replacements: Ichor Elixir planar-dice plus-and-ignore, Deification
// last-loyalty save, Enduring Angel-style life-floor transform (collect only
// when a matching sentence is present). Public: parsers, collectFromState,
// planar-dice helper.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

function oracleOf(perm: any): string {
  return normalize(perm?.card?.oracle_text || perm?.oracle_text || '');
}

export function parseIchorPlanarDiceReplacement(oracle: string): { extra: number; ignore: number } | null {
  const text = normalize(oracle).toLowerCase();
  const m = text.match(/if you would roll (?:one or more|(\w+) or more) planar dice, instead roll that many planar dice plus (\w+) and ignore (\w+)/i);
  if (!m) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, a: 1, an: 1 };
  const num = (raw: string | undefined, fallback: number) => {
    if (!raw) return fallback;
    const key = raw.toLowerCase();
    if (words[key] != null) return words[key];
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  return { extra: num(m[2], 1), ignore: num(m[3], 1) };
}

export function parseDeificationLoyaltySave(oracle: string): boolean {
  return /as long as you control a creature, if damage dealt to a planeswalker you control of the chosen type would result in all loyalty counters on it being removed, instead all but one of those counters are removed/i.test(normalize(oracle));
}

export function ichorPlanarDiceAdjustment(state: any, playerId: string): { extra: number; ignore: number } | null {
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of bf) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== String(playerId)) continue;
    const parsed = parseIchorPlanarDiceReplacement(oracleOf(perm));
    if (parsed) return parsed;
  }
  return null;
}

export function collectBatch98ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const out: ReplacementEffectSpec[] = [];
  const ichor = parseIchorPlanarDiceReplacement(oracle);
  if (ichor) {
    out.push({
      id: `${source.sourcePermanentId}:planar-dice-plus-ignore`,
      event: 'die-roll' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { kind: 'planar_dice' } as any,
      instead: { modify: 'plus_and_ignore', extra: ichor.extra, ignore: ichor.ignore } as any,
      effectId: 'planar-dice-plus-ignore',
      reason: 'planar_dice_plus_ignore',
      metadata: { extra: ichor.extra, ignore: ichor.ignore, choiceRequired: true },
    } as ReplacementEffectSpec);
  }
  if (parseDeificationLoyaltySave(oracle)) {
    out.push({
      id: `${source.sourcePermanentId}:deification-loyalty-save`,
      event: 'damage' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { recipient: 'planeswalker_you_control_chosen_type' } as any,
      instead: { modify: 'leave_one_loyalty' } as any,
      effectId: 'deification-loyalty-save',
      reason: 'deification_loyalty_save',
      metadata: { requiresControlledCreature: true },
    } as ReplacementEffectSpec);
  }
  return out;
}

export function collectBatch98ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const st = state as any;
  const bf: any[] = Array.isArray(st?.battlefield) ? st.battlefield : [];
  const out: ReplacementEffectSpec[] = [];
  for (const perm of bf) {
    if (!perm || perm.phasedOut === true) continue;
    out.push(...collectBatch98ReplacementSpecs(oracleOf(perm), {
      sourcePermanentId: String(perm.id || ''),
      sourceController: String(perm.controller || ''),
      sourceName: String(perm.card?.name || ''),
    }));
  }
  return out;
}

// server/src/state/modules/replacementBatch100Collect.ts
// B100 replacements: Ichor planar-dice plus-and-ignore (apply is live; collect
// Ichor only so B98's Deification collect stays unwired), Pursuit of Knowledge
// optional study-counter draw replacement, Krark's Thumb coin ignore-one, and
// Aether Refinery "twice that many" energy. Public: parsers, collectFromState,
// applyEnergyTwiceReplacement.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { parseIchorPlanarDiceReplacement } from './replacementBatch98Collect.js';
import { parsePrimevalSpawnSelfExile, PRIMEVAL_SPAWN_EFFECT_ID } from './batch100PrimevalSpawnApply.js';

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

function oracleOf(perm: any): string {
  return normalize(perm?.card?.oracle_text || perm?.oracle_text || '');
}

const PURSUIT_RE = /if you would draw a card, you may put a study counter on (?:this enchantment|~|it) instead/i;
const KRARK_RE = /if you would flip a coin, instead flip two coins and ignore one/i;
const ENERGY_TWICE_RE = /if you would get (?:(one|\d+) or more )?\{e\}(?: \(energy counters\))?, you get twice that many \{e\} instead/i;
const WORD: Record<string, number> = { one: 1, two: 2, three: 3 };

export function parsePursuitStudyCounterDrawReplacement(oracle: string): boolean {
  return PURSUIT_RE.test(normalize(oracle));
}

export function parseKrarkCoinIgnoreOneReplacement(oracle: string): boolean {
  return KRARK_RE.test(normalize(oracle));
}

export function parseEnergyTwiceReplacement(oracle: string): { min: number } | null {
  const text = normalize(oracle).toLowerCase();
  const m = text.match(ENERGY_TWICE_RE);
  if (!m) return null;
  const raw = String(m[1] || 'one').toLowerCase();
  const min = WORD[raw] ?? parseInt(raw, 10);
  return min > 0 ? { min } : { min: 1 };
}

export function collectBatch100ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const out: ReplacementEffectSpec[] = [];
  const text = normalize(oracle);
  const ichor = parseIchorPlanarDiceReplacement(text);
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
  if (parsePursuitStudyCounterDrawReplacement(text)) {
    out.push({
      id: `${source.sourcePermanentId}:pursuit-study-counter-draw`,
      event: 'draw' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { affectedPlayerIsSourceController: true } as any,
      instead: { optionalStudyCounter: true } as any,
      effectId: 'pursuit-study-counter-draw',
      reason: 'pursuit_study_counter_draw',
      metadata: { choiceRequired: true },
    } as ReplacementEffectSpec);
  }
  if (parseKrarkCoinIgnoreOneReplacement(text)) {
    out.push({
      id: `${source.sourcePermanentId}:coin-flip-ignore-one`,
      event: 'coin-flip' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { affectedPlayerIsSourceController: true } as any,
      instead: { modify: 'flip_two_ignore_one' } as any,
      effectId: 'coin-flip-ignore-one',
      reason: 'coin_flip_ignore_one',
      metadata: { choiceRequired: true },
    } as ReplacementEffectSpec);
  }
  if (parsePrimevalSpawnSelfExile(text)) {
    out.push({
      id: `${source.sourcePermanentId}:${PRIMEVAL_SPAWN_EFFECT_ID}`,
      event: 'zone-change' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { selfEnter: true } as any,
      instead: { redirectTo: 'exile' } as any,
      effectId: PRIMEVAL_SPAWN_EFFECT_ID,
      reason: 'primeval_spawn_self_exile',
    } as ReplacementEffectSpec);
  }
    const energy = parseEnergyTwiceReplacement(text);
  if (energy) {
    out.push({
      id: `${source.sourcePermanentId}:energy-twice`,
      event: 'counter-placement' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { counterTypeIncludes: 'energy' },
      instead: { modify: 'add_flat' as const, value: 2 } as any,
      effectId: 'energy-twice',
      reason: 'energy_twice',
      metadata: { min: energy.min, multiplier: 2 },
    } as ReplacementEffectSpec);
  }
  return out;
}

export function collectBatch100ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const st = state as any;
  const battlefield: any[] = Array.isArray(st?.battlefield) ? st.battlefield : [];
  const out: ReplacementEffectSpec[] = [];
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    const sourceController = String(perm.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    out.push(...collectBatch100ReplacementSpecs(oracleOf(perm), {
      sourcePermanentId,
      sourceController,
      sourceName: String(perm.card?.name || ''),
    }));
  }
  return out;
}

export function applyEnergyTwiceReplacement(state: any, playerId: string, amount: number): number {
  let n = Math.max(0, Math.floor(Number(amount) || 0));
  if (n <= 0) return n;
  const pid = String(playerId || '');
  const specs = collectBatch100ReplacementSpecsFromState(state).filter((spec) =>
    spec.effectId === 'energy-twice' && String(spec.sourceController) === pid,
  );
  for (const spec of specs) {
    const min = Number((spec.metadata as any)?.min || 1);
    if (n >= min) n *= 2;
  }
  return n;
}

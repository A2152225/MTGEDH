// server/src/state/modules/replacementBatch93TokenReplacements.ts
// B93: "If you would create one or more tokens, you may instead create that
// many A tokens or that many B tokens." (Jinnie Fay). Apply helper only —
// the player-facing choice prompt is described, not wired here.
// Public: parseBatch93TokenChoiceSentence, collectBatch93TokenReplacementSpecs,
// collectBatch93TokenReplacementSpecsFromState, applyJinnieFayTokenChoice.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const CHOICE_RE =
  /if you would create one or more tokens, you may instead create that many (\d+)\s*\/\s*(\d+) ([a-z]+) ([a-z]+) creature tokens(?: with ([a-z]+))? or that many (\d+)\s*\/\s*(\d+) ([a-z]+) ([a-z]+) creature tokens(?: with ([a-z]+))?/i;

export type TokenChoiceFace = { power: number; toughness: number; color: string; name: string; typeLine: string; keyword?: string };

export function parseBatch93TokenChoiceSentence(oracle: string): { faces: TokenChoiceFace[] } | null {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(CHOICE_RE);
  if (!m) return null;
  const face = (p: string, t: string, color: string, name: string, kw?: string): TokenChoiceFace => ({
    power: parseInt(p, 10),
    toughness: parseInt(t, 10),
    color,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    typeLine: `Creature — ${name.charAt(0).toUpperCase() + name.slice(1)}`,
    keyword: kw || undefined,
  });
  return {
    faces: [
      face(m[1], m[2], m[3], m[4], m[5]),
      face(m[6], m[7], m[8], m[9], m[10]),
    ],
  };
}

export function collectBatch93TokenReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const parsed = parseBatch93TokenChoiceSentence(oracle);
  if (!parsed) return [];
  return [{
    id: `${source.sourcePermanentId}:optional-token-identity-choice`,
    event: 'token-creation' as const,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: {},
    instead: { choiceRequired: true },
    effectId: 'optional-token-identity-choice',
    reason: 'optional_token_identity_choice',
    metadata: { faces: parsed.faces },
  } as ReplacementEffectSpec];
}

export function collectBatch93TokenReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch93TokenReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String((rec.card as any)?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function applyJinnieFayTokenChoice(specFaces: TokenChoiceFace[], choiceIndex: number, count: number): { name: string; power: number; toughness: number; typeLine: string; colors: string[]; keywords: string[]; count: number } | null {
  const face = specFaces[choiceIndex] || specFaces[0];
  if (!face) return null;
  const colorLetter: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  return {
    name: face.name,
    power: face.power,
    toughness: face.toughness,
    typeLine: face.typeLine,
    colors: [colorLetter[face.color] || face.color],
    keywords: face.keyword ? [face.keyword] : [],
    count: Math.max(0, Math.floor(Number(count) || 0)),
  };
}

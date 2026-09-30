// Parser for "<subject> gets +X/+Y for as long as <source-linked condition>" pumps
// (Thran Weaponry, Flowstone Armor, Zelyon Sword, Endoskeleton, Spirit Shield, Ashnod's Battle Gear,
// Tawnos's Weaponry, "for as long as this Equipment remains attached to it", "as long as you control X").
// The result is a grant_static_ability step that keeps duration 'static' (so older consumers still count it)
// and carries a structured `linkCondition`; the server counts the pump only while the condition holds
// and removes it when the condition stops (server/src/state/modules/sourceLinkedPtModifiers.ts).
// Public entry symbols: parseForAsLongAsLinkCondition, tryParseForAsLongAsPtStep.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';

export type OraclePtLinkCondition =
  | { readonly kind: 'source_tapped' }
  | { readonly kind: 'source_attached' }
  | { readonly kind: 'controller_controls_source' }
  | { readonly kind: 'controller_controls_matching'; readonly matching: string };

const SOURCE_NOUN = String.raw`(?:artifact|creature|permanent|equipment|enchantment|aura|vehicle|land|planeswalker)`;

/** Maps the text after "for as long as" to a structured, source-linked condition (null when unsupported). */
export function parseForAsLongAsLinkCondition(conditionText: string): OraclePtLinkCondition | null {
  const text = String(conditionText || '').trim().replace(/\.$/, '').toLowerCase();
  if (new RegExp(`^this ${SOURCE_NOUN} remains tapped$`).test(text)) return { kind: 'source_tapped' };
  if (new RegExp(`^this ${SOURCE_NOUN} remains attached to (?:it|that creature|the creature)$`).test(text)) {
    return { kind: 'source_attached' };
  }
  if (new RegExp(`^you control this ${SOURCE_NOUN}$`).test(text)) return { kind: 'controller_controls_source' };
  const controlsMatching = text.match(/^you control (?:a|an|another) ([a-z][a-z -]*[a-z])$/);
  if (controlsMatching) return { kind: 'controller_controls_matching', matching: String(controlsMatching[1]).trim() };
  return null;
}

/** "Target creature gets +1/-1 for as long as this artifact remains tapped" -> grant_static_ability with linkCondition. */
export function tryParseForAsLongAsPtStep(clause: string, rawClause: string): OracleEffectStep | null {
  const match = String(clause || '').trim().match(
    /^(.+?)\s+gets?\s+([+-]\d+)\s*\/\s*([+-]\d+)\s+for\s+as\s+long\s+as\s+(.+?)\.?$/i,
  );
  if (!match) return null;
  const subject = String(match[1] || '').trim();
  if (/\b(?:and|or|until|where)\b/i.test(subject) && !/^(?:up to|any number of|one or two)/i.test(subject)) return null;
  const linkCondition = parseForAsLongAsLinkCondition(String(match[4] || ''));
  if (!linkCondition) return null;
  return {
    kind: 'grant_static_ability',
    target: parseObjectSelector(subject),
    power: Number.parseInt(String(match[2]), 10),
    toughness: Number.parseInt(String(match[3]), 10),
    effectText: [`for as long as ${String(match[4] || '').trim().replace(/\.$/, '')}`],
    duration: 'static',
    linkCondition,
    raw: rawClause,
  } as unknown as OracleEffectStep;
}
/**
 * socket/interaction-handlers/activationCostXAndDiscardClauses.ts
 *
 * Generic activation-cost helpers shared by the cost prompts, the discard response and the
 * activation resume paths.
 *
 * - X (CR 601.2b / 602.2b): X is announced with the activation, so cost steps carry it as
 *   `xValue` and every later stage substitutes it into the cost and effect text before mana is
 *   validated or paid (Alexi, Zephyr Mage; Fiend Artisan; Knollspine Invocation).
 * - Discard clauses beyond "Discard N [type] card(s)": "Discard N card(s) with mana value X|N"
 *   and "Discard your hand" (Bomat Courier, Connecting the Dots).
 *
 * Public entry symbols: readActivationStepXValue, substituteActivationX, applyStepActivationX,
 * stripExtendedDiscardCostClauses, parseExtendedDiscardCost, ExtendedDiscardCost.
 */

export function readActivationStepXValue(stepAny: any): number | undefined {
  const raw = stepAny?.xValue;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/** Replace {X} and a bare X in cost or effect text with the announced value. */
export function substituteActivationX(text: string, xValue: number | undefined): string {
  const s = String(text || '');
  if (xValue === undefined) return s;
  return s
    .replace(/\{X\}/gi, `{${xValue}}`)
    .replace(/\bX\b/g, String(xValue))
    .replace(/\bx\b/g, String(xValue));
}

export function applyStepActivationX(stepAny: any, text: string): string {
  return substituteActivationX(text, readActivationStepXValue(stepAny));
}

const COUNT_WORD = '(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)';
const TYPE_WORD = '(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)';
const DISCARD_HAND_RE = /\bdiscard\s+your\s+hand\b/gi;
const DISCARD_MANA_VALUE_RE = new RegExp(
  `\\bdiscard\\s+${COUNT_WORD}\\s+(?:${TYPE_WORD}\\s+)?cards?\\s+with\\s+mana\\s+value\\s+(?:x|\\d+)\\b`,
  'gi',
);

/**
 * Strip the discard clauses the base "discard N [type] card(s)" regexes do not cover. Call it
 * before those regexes so "with mana value X" is not left behind as an unsupported remainder.
 */
export function stripExtendedDiscardCostClauses(text: string): string {
  return String(text || '').replace(DISCARD_MANA_VALUE_RE, ' ').replace(DISCARD_HAND_RE, ' ');
}

export type ExtendedDiscardCost =
  | { kind: 'hand' }
  | { kind: 'manaValue'; countWord: string; typed?: string; manaValue: 'x' | number };

export function parseExtendedDiscardCost(costText: string): ExtendedDiscardCost | null {
  const lower = String(costText || '').toLowerCase();
  if (/\bdiscard\s+your\s+hand\b/.test(lower)) return { kind: 'hand' };
  const m = lower.match(new RegExp(
    `\\bdiscard\\s+(${COUNT_WORD})\\s+(?:(${TYPE_WORD})\\s+)?cards?\\s+with\\s+mana\\s+value\\s+(x|\\d+)\\b`,
  ));
  if (!m) return null;
  return {
    kind: 'manaValue',
    countWord: m[1],
    typed: m[2] || undefined,
    manaValue: m[3] === 'x' ? 'x' : Number(m[3]),
  };
}

/**
 * "Tap X untapped tokens you control": once the player picks the permanents, X is that count.
 * Rewrites the step's cost/effect text and records xValue (no-op for fixed-count tap costs).
 */
export function applyVariableTapXToStep(stepAny: any, tappedCount: number): void {
  if (!stepAny || stepAny.tapCostVariableX !== true) return;
  const x = Math.max(0, Math.floor(Number(tappedCount) || 0));
  for (const key of ['abilityText', 'activatedAbilityText', 'manaCost', 'description']) {
    if (typeof stepAny[key] === 'string') stepAny[key] = substituteActivationX(stepAny[key], x);
  }
  stepAny.xValue = x;
  delete stepAny.tapCostVariableX;
}

/**
 * Extracted from oracleIRParserTokenSimpleClauses.ts.
 * Cluster: except-copy modifiers on create_token (haste + quoted end-step sacrifice/exile).
 * Public: parseCreateTokenExceptCopyModifiers, applyExceptCopyModifiersToCreateTokenStep.
 */

import type { OracleEffectStep } from './oracleIR';

export type CreateTokenExceptCopyModifiers = {
  readonly grantsHaste?: 'permanent';
  readonly atNextEndStep?: 'sacrifice' | 'exile';
};

function normalizeExceptCopyText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function detectQuotedEndStepCleanup(text: string): 'sacrifice' | 'exile' | undefined {
  const quoted = Array.from(String(text || '').matchAll(/"([^"]+)"/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
  const combined = [text, ...quoted].join('\n');
  const sacrifice = /\bat\s+the\s+beginning\s+of\s+(?:the\s+)?(?:next\s+)?end\s+step,?\s*sacrifice\s+this\s+(?:token|permanent)\b/i.test(combined)
    || /\bsacrifice\s+this\s+(?:token|permanent)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?(?:next\s+)?end\s+step\b/i.test(combined);
  const exile = /\bat\s+the\s+beginning\s+of\s+(?:the\s+)?(?:next\s+)?end\s+step,?\s*exile\s+this\s+(?:token|permanent)\b/i.test(combined)
    || /\bexile\s+this\s+(?:token|permanent)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?(?:next\s+)?end\s+step\b/i.test(combined);
  if (sacrifice) return 'sacrifice';
  if (exile) return 'exile';
  return undefined;
}

export function parseCreateTokenExceptCopyModifiers(text: string): CreateTokenExceptCopyModifiers {
  const raw = normalizeExceptCopyText(text);
  if (!raw) return {};

  const grantsHaste = /\bexcept\b[\s\S]*\b(?:it has|they have|has|have|gains?)\s+haste\b/i.test(raw)
    ? ('permanent' as const)
    : undefined;
  const atNextEndStep = detectQuotedEndStepCleanup(raw);

  if (!grantsHaste && !atNextEndStep) return {};
  return {
    ...(grantsHaste ? { grantsHaste } : {}),
    ...(atNextEndStep ? { atNextEndStep } : {}),
  };
}

export function applyExceptCopyModifiersToCreateTokenStep<T extends OracleEffectStep>(step: T): T {
  if (!step || step.kind !== 'create_token') return step;
  const current = step as Extract<OracleEffectStep, { kind: 'create_token' }>;
  const modifiers = parseCreateTokenExceptCopyModifiers(
    [String(current.token || ''), String(current.raw || '')].filter(Boolean).join(' '),
  );
  if (!modifiers.grantsHaste && !modifiers.atNextEndStep) return step;
  return {
    ...current,
    ...(!current.grantsHaste && modifiers.grantsHaste ? { grantsHaste: modifiers.grantsHaste } : {}),
    ...(!current.atNextEndStep && modifiers.atNextEndStep ? { atNextEndStep: modifiers.atNextEndStep } : {}),
  } as T;
}

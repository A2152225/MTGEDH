/**
 * Copy-spell tail helpers for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 23892-24170 of the
 * pre-split file).
 * Cluster moved: unknown-step text normalization, artifact-token reminder detection, and the
 * "may choose new targets" / "you may cast it" copy-spell tail parsers plus the helpers that
 * fold those tails back onto an already-parsed copy step.
 * Public entry symbols: re-exported at the foot of this file; consumed by the postprocess
 * parent and by oracleIRParserPostprocessCopySpellUnknownSteps.
 */
import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

function normalizeUnknownStepText(step: OracleEffectStep | undefined): string {
  if (step?.kind !== 'unknown') return '';
  return normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
}

function isArtifactTokenReminderLeadUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^(?:(?:it(?:'|’)s|it is)|(?:an?\s+[a-z0-9 ,.'’-]+?\s+token\s+is))\s+an artifact with\s+"[^"]*$/i.test(normalized) ||
    /^(?:they(?:'|’)re|they are)\s+artifacts with\s+"[^"]*$/i.test(normalized)
  );
}

function isArtifactTokenReminderTailUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s"']+/, '')
    .replace(/[.)\s"']+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^activate only as a sorcery$/i.test(normalized) ||
    /^this mana can(?:'|’)t be spent to cast a nonartifact spell$/i.test(normalized) ||
    /^shuffle$/i.test(normalized)
  );
}

function stripInlineCopyRetargetTail(text: string): { readonly body: string; readonly allowNewTargets: boolean } {
  let body = normalizeOracleText(String(text || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.;)\s]+$/g, '')
    .trim();
  if (!body) return { body: '', allowNewTargets: false };

  let allowNewTargets = false;
  const nextBody = body
    .replace(
      /(?:\.\s*|,?\s+and\s+)(?:(?:you|they|that player|the player|its controller|that spell's controller|that spell['’]s controller|each of those players|each other player)\s+)?may choose\s+(?:a new target|new targets)\s+for\s+(?:the|that|their)\s+cop(?:y|ies)(?:\s+they\s+control)?$/i,
      () => {
        allowNewTargets = true;
        return '';
      }
    )
    .trim();

  body = nextBody || body;
  return {
    body: body.replace(/[.;)\s]+$/g, '').trim(),
    allowNewTargets,
  };
}

function parseCopySpellRetargetTail(step: OracleEffectStep | undefined): string | null {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return null;
  return /^(?:(?:you|they|that player|the player|its controller|that spell's controller|that spell['’]s controller|each of those players|each other player)\s+)?may choose\s+(?:a new target|new targets)\s+for\s+(?:the|that|their)\s+cop(?:y|ies)(?:\s+they\s+control)?$/i.test(normalized.replace(/[.)\s]+$/g, '').trim())
    ? normalized
    : null;
}

type CopySpellCastTail = {
  readonly raw: string;
  readonly castCost?: 'mana_cost' | string;
  readonly withoutPayingManaCost?: boolean;
  readonly optional?: boolean;
};

function parseCopySpellCastTail(step: OracleEffectStep | undefined): CopySpellCastTail | null {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return null;
  const normalizedTail = normalized.replace(/^if you do,\s*/i, '').trim();

  if (/^you may cast the copy$/i.test(normalizedTail)) {
    return {
      raw: String((step as any)?.raw || '').trim() || 'You may cast the copy',
      castCost: 'mana_cost',
      optional: true,
    };
  }

  const alternateCostMatch = normalizedTail.match(
    /^you may cast the copy by paying (\{[^}]+\}(?:\{[^}]+\})*) rather than paying its mana cost$/i
  );
  if (alternateCostMatch) {
    return {
      raw: String((step as any)?.raw || '').trim() || normalizedTail,
      castCost: String(alternateCostMatch[1] || '').trim(),
      optional: true,
    };
  }

  if (/^you may cast the copy without paying its mana cost$/i.test(normalizedTail)) {
    return {
      raw: String((step as any)?.raw || '').trim() || normalizedTail,
      withoutPayingManaCost: true,
      optional: true,
    };
  }

  if (/^you may cast any number of the copies without paying their mana costs$/i.test(normalizedTail)) {
    return {
      raw: String((step as any)?.raw || '').trim() || normalizedTail,
      withoutPayingManaCost: true,
      optional: true,
    };
  }

  if (/^cast the copies if able without paying their mana costs$/i.test(normalizedTail)) {
    return {
      raw: String((step as any)?.raw || '').trim() || normalizedTail,
      withoutPayingManaCost: true,
    };
  }

  return null;
}

function appendFollowupSentence(base: string | undefined, followup: string | null): string {
  const trimmedBase = String(base || '')
    .trim()
    .replace(/[.\s]+$/g, '');
  const trimmedFollowup = String(followup || '')
    .trim()
    .replace(/^[.\s]+/g, '');

  if (!trimmedBase) return trimmedFollowup;
  if (!trimmedFollowup) return trimmedBase;
  return `${trimmedBase}. ${trimmedFollowup}`;
}

function applyCopySpellRetargetTailToSteps(
  steps: readonly OracleEffectStep[],
  retargetTail: string
): {
  readonly steps: readonly OracleEffectStep[];
  readonly changed: boolean;
  readonly applied: boolean;
} {
  let changed = false;
  let applied = false;

  const nextSteps = steps.map((step) => {
    if (step.kind === 'copy_spell') {
      applied = true;
      const nextRaw = copySpellRawMentionsRetarget(step.raw)
        ? step.raw
        : appendFollowupSentence(step.raw, retargetTail);
      const nextStep = {
        ...step,
        allowNewTargets: true,
        raw: nextRaw,
      } as unknown as OracleEffectStep;
      if (!step.allowNewTargets || nextRaw !== step.raw) {
        changed = true;
      }
      return nextStep;
    }

    if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
      const nested = applyCopySpellRetargetTailToSteps(step.steps, retargetTail);
      if (!nested.applied) return step;
      applied = true;
      if (nested.changed) {
        changed = true;
        return {
          ...step,
          steps: nested.steps,
        } as unknown as OracleEffectStep;
      }
      return step;
    }

    if (step.kind === 'choose_mode') {
      let modeChanged = false;
      let modeApplied = false;
      const nextModes = step.modes.map((mode) => {
        const nested = applyCopySpellRetargetTailToSteps(mode.steps, retargetTail);
        if (!nested.applied) return mode;
        modeApplied = true;
        if (!nested.changed) return mode;
        modeChanged = true;
        return {
          ...mode,
          steps: nested.steps,
        };
      });

      if (!modeApplied) return step;
      applied = true;
      if (modeChanged) {
        changed = true;
        return {
          ...step,
          modes: nextModes,
        } as unknown as OracleEffectStep;
      }
      return step;
    }

    return step;
  });

  return {
    steps: changed ? nextSteps : steps,
    changed,
    applied,
  };
}

function applyCopySpellCastTail(
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
  castTail: CopySpellCastTail
): Extract<OracleEffectStep, { kind: 'copy_spell' }> {
  return {
    ...step,
    ...(castTail.castCost ? { castCost: castTail.castCost } : {}),
    ...(castTail.withoutPayingManaCost ? { withoutPayingManaCost: true } : {}),
    ...((step.optional || castTail.optional) ? { optional: true } : {}),
    raw: appendFollowupSentence(step.raw, castTail.raw),
  };
}

function copySpellRawMentionsRetarget(raw: string | undefined): boolean {
  return /choose\s+(?:a new target|new targets)\s+for\s+the\s+cop(?:y|ies)/i.test(
    normalizeOracleText(String(raw || ''))
  );
}

function normalizeCopyAbilityUnknownStepText(step: OracleEffectStep | undefined): string {
  if (step?.kind !== 'unknown') return '';

  const stripped = stripInlineCopyRetargetTail(String(step.raw || ''));
  let normalized = stripped.body.replace(/^[•·●◦▪▫►➤\uFFFD]+\s*/u, '').trim();

  while (normalized) {
    const nextNormalized = normalized
      .replace(/^then\b\s*/i, '')
      .replace(/^(?:raid|spell mastery)\s*[-�]\s*/i, '')
      .replace(/^(?:[ivxlcdm]+|\d+(?:-\d+)?|\+\s*\{[^}]+\}|-\d+)\s*[|�-]\s*/i, '')
      .trim();

    if (nextNormalized === normalized) break;
    normalized = nextNormalized;
  }

  return normalized;
}

function isCopyAbilityUnknownStep(step: OracleEffectStep | undefined): boolean {
  if (step?.kind !== 'unknown') return false;

  const normalized = normalizeCopyAbilityUnknownStepText(step);
  if (!normalized) return false;

  const prefixedCopyPattern = /^(?:until end of turn,\s+)?(?:(?:if|when|whenever)\s+.+?,\s+)*(?:you may\s+)?copy\s+(?:that ability|the ability|that spell|the spell|that spell or ability|it|target\s+.+)$/i;

  return /^(?:you may\s+)?copy\s+(?:that ability|the ability|target triggered ability(?: you control)?|target activated or triggered ability(?: you control)?(?: from .+)?)$/i.test(
    normalized
  ) ||
    /^(?:you may\s+)?copy that spell or ability$/i.test(normalized) ||
    /^(?:you may\s+)?copy the next .+ spell you cast this turn when you cast it$/i.test(normalized) ||
    /^(?:if you do,\s+)?when you next cast .+?,\s+copy it$/i.test(normalized) ||
    /^(?:when you cast this spell,\s+)?copy\b.+$/i.test(normalized) ||
    prefixedCopyPattern.test(normalized);
}

export {
  appendFollowupSentence,
  applyCopySpellCastTail,
  applyCopySpellRetargetTailToSteps,
  copySpellRawMentionsRetarget,
  isArtifactTokenReminderLeadUnknownStep,
  isArtifactTokenReminderTailUnknownStep,
  isCopyAbilityUnknownStep,
  normalizeUnknownStepText,
  parseCopySpellCastTail,
  parseCopySpellRetargetTail,
  stripInlineCopyRetargetTail,
};

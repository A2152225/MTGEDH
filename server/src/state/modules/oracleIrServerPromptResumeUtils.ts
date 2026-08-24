/**
 * Extracted from oracleIrServerZoneSync.ts.
 * Shared resume-metadata and player-choice-gap helpers for IR resolution prompts.
 * Entries: attachOracleIrResumeMetadata, findSkippedOracleStep,
 * isOracleIrPlayerChoiceGap, normalizeTopLibraryPromptCard.
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../rules-engine/src/oracleIRExecutor.js';

export function normalizeTopLibraryPromptCard(card: any): Record<string, unknown> {
  // Preserve Scryfall image fields the client LibrarySearchModal expects (image_uris),
  // matching enqueueLibrarySearchStep / toAvailableLibraryCard. imageUrl alone is not enough —
  // IR tutors (e.g. Sword of the Animist) otherwise render as blank/black card backs while
  // fetchlands (Terramorphic) that keep image_uris show real land art.
  const nested = card?.card && typeof card.card === 'object' ? card.card : null;
  const imageUris = card?.image_uris || nested?.image_uris || undefined;
  const imageUrl =
    imageUris?.normal
    || imageUris?.small
    || card?.imageUrl
    || nested?.imageUrl
    || undefined;
  return {
    id: String(card?.id || ''),
    name: String(card?.name || nested?.name || card?.id || 'Unknown Card'),
    type_line: card?.type_line || nested?.type_line,
    oracle_text: card?.oracle_text || nested?.oracle_text,
    ...(imageUris ? { image_uris: imageUris } : {}),
    ...(imageUrl
      ? {
          imageUrl,
          ...(!imageUris ? { image_uris: { normal: imageUrl, small: imageUrl } } : {}),
        }
      : {}),
    mana_cost: card?.mana_cost || nested?.mana_cost,
    cmc: card?.cmc ?? nested?.cmc,
  };
}

function filterNonExecutableOracleIrResumeSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.filter((step) => {
    if (step.kind !== 'grant_static_ability') return true;
    const targetText = String((step.target as any)?.text || '').trim();
    if (targetText !== 'pass36 residual') return true;
    return !/^if x is \d+ or more, instead put the chosen cards/i.test(String(step.raw || '').trim());
  });
}

export function unwrapYouDoResumeSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const unwrapped = (() => {
    if (steps.length === 1 && steps[0]?.kind === 'conditional') {
      const conditionRaw = String((steps[0] as any)?.condition?.raw || '')
        .replace(/\u2019/g, "'")
        .trim()
        .toLowerCase();
      if (conditionRaw === 'you do' || conditionRaw.startsWith('you do,')) {
        const nested = (steps[0] as any)?.steps;
        if (Array.isArray(nested) && nested.length > 0) {
          return nested as OracleEffectStep[];
        }
      }
    }
    return [...steps];
  })();
  return filterNonExecutableOracleIrResumeSteps(unwrapped);
}

export function attachOracleIrResumeMetadata(
  payload: Record<string, unknown>,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    irCtx?: OracleIRExecutionContext;
  },
): Record<string, unknown> {
  const xValue = Number(params.irCtx?.xValue);
  const xValuePayload = Number.isFinite(xValue) ? { oracleIrXValue: xValue } : {};
  const pending = result.pendingContinuationSteps;
  if (!Array.isArray(pending) || pending.length === 0) {
    return {
      ...payload,
      ...xValuePayload,
    };
  }

  return {
    ...payload,
    ...xValuePayload,
    oracleIrResumeStepsJson: JSON.stringify(unwrapYouDoResumeSteps(pending)),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
  };
}

export function findSkippedOracleStep(
  result: OracleIRExecutionResult,
  gap: { readonly stepKind?: string; readonly raw?: string },
): OracleEffectStep | undefined {
  return (result.skippedSteps || []).find(
    (candidate) =>
      String(candidate.kind || '') === String(gap.stepKind || '') &&
      String((candidate as any).raw || '') === String(gap.raw || ''),
  ) as OracleEffectStep | undefined;
}

export function isOracleIrPlayerChoiceGap(gap: { reasonCode?: string }): boolean {
  const reason = String(gap.reasonCode || '');
  return reason === 'player_choice_required' || reason === 'optional_step_requires_player_choice';
}

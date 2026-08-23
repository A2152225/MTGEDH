/**
 * socket/resolutionLibrarySearchOracleIrResumeUtils.ts
 *
 * Oracle-IR resume helpers used by library search / scry / surveil resolution
 * handlers. Extracted from resolution.ts.
 */

export function oracleIrResumeStepIncludesDraw(step: unknown): boolean {
  if (!step || typeof step !== 'object') return false;
  const kind = String((step as { kind?: string }).kind || '');
  if (kind === 'draw' || kind === 'draw_cards') return true;
  if (kind === 'conditional' || kind === 'if') {
    const thenSteps = (step as { thenSteps?: unknown; steps?: unknown }).thenSteps
      ?? (step as { thenSteps?: unknown; steps?: unknown }).steps;
    if (Array.isArray(thenSteps) && thenSteps.some(oracleIrResumeStepIncludesDraw)) {
      return true;
    }
  }
  return false;
}

export function oracleIrCompoundResumeIncludesDraw(searchStep: unknown): boolean {
  const resumeJson = String((searchStep as any)?.oracleIrResumeStepsJson || '').trim();
  if (!resumeJson) return false;
  try {
    const steps = JSON.parse(resumeJson);
    return Array.isArray(steps) && steps.some(oracleIrResumeStepIncludesDraw);
  } catch {
    return false;
  }
}

export function readShuffledLibraryIdsFromReplayMutations(
  result: { readonly replayMutations?: readonly { readonly kind: string; readonly playerId?: string; readonly shuffledLibraryIds?: readonly string[] }[] } | null,
  playerId: string,
): readonly string[] | null {
  if (!result?.replayMutations?.length) return null;
  const mutation = result.replayMutations.find(
    (entry) => entry.kind === 'shuffleLibrary' && String(entry.playerId || '').trim() === playerId,
  );
  if (!mutation || !Array.isArray(mutation.shuffledLibraryIds) || mutation.shuffledLibraryIds.length === 0) {
    return null;
  }
  return mutation.shuffledLibraryIds
    .map((id) => String(id || '').trim())
    .filter(Boolean);
}

export function oracleIrLibrarySearchResumeApplied(resumed: unknown): boolean {
  if (!resumed || typeof resumed !== 'object') return false;
  const appliedSteps = (resumed as { appliedSteps?: unknown }).appliedSteps;
  if (!Array.isArray(appliedSteps) || appliedSteps.length === 0) return false;
  return appliedSteps.some((step) => {
    const kind = String((step as { kind?: string })?.kind || '');
    // Among-them reveal/player_choice steps queue as LIBRARY_SEARCH but resume as player_choice.
    return kind === 'search_library'
      || kind === 'player_choice'
      || kind === 'look_choose_from_top'
      || kind === 'look_select_top';
  });
}

export function oracleIrTopLibraryChoiceResumeApplied(
  resumed: unknown,
  expectedKind: 'scry' | 'surveil',
): boolean {
  if (!resumed || typeof resumed !== 'object') return false;
  const appliedSteps = (resumed as { appliedSteps?: unknown }).appliedSteps;
  if (!Array.isArray(appliedSteps) || appliedSteps.length === 0) return false;
  return appliedSteps.some((step) => String((step as { kind?: string })?.kind || '') === expectedKind);
}

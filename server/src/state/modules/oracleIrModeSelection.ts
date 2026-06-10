import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';

export {
  extractModalModesForSpellCast,
  matchModalModeOptions,
} from '../../utils/oraclePromptContext.js';

/**
 * Cast-time modal UI stores `mode_1`, `mode_2`, … while choose_mode execution
 * keys modes by their IR labels (e.g. "Mode 1"). Normalize before IR / EP runs.
 */
export function normalizeOracleIrSelectedModeIds(
  steps: readonly OracleEffectStep[],
  selectedModeIds?: readonly string[],
): readonly string[] | undefined {
  if (!Array.isArray(selectedModeIds) || selectedModeIds.length === 0) {
    return selectedModeIds;
  }

  const chooseModeStep = steps.find((step) => step?.kind === 'choose_mode');
  if (!chooseModeStep) return selectedModeIds;

  const modes = Array.isArray((chooseModeStep as { modes?: readonly unknown[] }).modes)
    ? (chooseModeStep as { modes: readonly { label?: string }[] }).modes
    : [];

  return selectedModeIds
    .map((rawId) => {
      const id = String(rawId || '').trim();
      if (!id) return '';

      const modeIndexMatch = /^mode[_-]?(\d+)$/i.exec(id);
      if (modeIndexMatch) {
        const mode = modes[parseInt(modeIndexMatch[1], 10) - 1];
        return String(mode?.label || id).trim();
      }

      return id;
    })
    .filter(Boolean);
}

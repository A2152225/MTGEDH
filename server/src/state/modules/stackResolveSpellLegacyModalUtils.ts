import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { categorizeSpell } from '../../rules-engine/targeting.js';
import { debug } from '../../utils/debug.js';
import {
  extractModalModesFromOracleText,
  matchModalModeOptions,
} from '../../utils/oraclePromptContext.js';
import { spellOracleUsesTeamworkChooseBoth } from './marvelMechanicsHelpers.js';
import { isOracleIrSpellPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { applyOracleIRUncategorizedSpellFallback } from './oracleIrUncategorizedSpellFallback.js';
import { executeInstantSorceryLegacyCategorizedSpell } from './stackResolveSpellLegacySpecUtils.js';
import { wasSpellCastFromGraveyard } from './stackResolveSpellCopyChoiceUtils.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { ResolutionQueueManager, ResolutionStepType, type ResolutionStep, type ResolutionStepResponse } from '../resolution/index.js';

export const LEGACY_MODAL_SPELL_RESOLVE_PURPOSE = 'modalSpellResolve';

export type LegacyInstantSorceryModalOptions = {
  controller: PlayerID;
  card: any;
  effectiveCard: any;
  item: any;
  targets: any[];
  spellXValue: unknown;
  oracleText: string;
};

export type LegacyInstantSorceryModalOutcome = false | 'queued' | 'applied';

function resolveStackSpellId(item: any, card: any, effectiveCard: any): string {
  return String(item?.id || item?.cardId || card?.id || effectiveCard?.id || '').trim();
}

function readSelectedModeIds(item: any): string[] {
  return Array.isArray(item?.selectedModes)
    ? item.selectedModes.map((mode: unknown) => String(mode || '').trim()).filter(Boolean)
    : [];
}

function applySelectedModeMetadata(
  stackItem: any,
  oracleText: string,
  selectedModes: readonly string[],
): void {
  stackItem.selectedModes = [...selectedModes];
  const modalInfo = extractModalModesFromOracleText(oracleText);
  if (!modalInfo) {
    return;
  }
  const matchedOptions = matchModalModeOptions(modalInfo, selectedModes);
  if (matchedOptions.length > 0) {
    stackItem.selectedModeDescriptions = matchedOptions.map((option) => String(option.raw || option.description || '').trim());
  }
}

/**
 * When spell IR primary is off and no mode is pre-selected, queue legacy mode_1/mode_2
 * selection at resolve time (Effect Program is disabled under legacy forced).
 */
export function tryQueueInstantSorceryLegacyModalModeSelection(
  ctx: GameContext,
  options: LegacyInstantSorceryModalOptions,
): boolean {
  if (isOracleIrSpellPrimaryEnabled() || !!(ctx as any).isReplaying) {
    return false;
  }

  if (readSelectedModeIds(options.item).length > 0) {
    return false;
  }

  const oracleText = String(options.oracleText || '').trim();
  const modalInfo = extractModalModesFromOracleText(oracleText);
  if (!modalInfo || modalInfo.options.length < 2) {
    return false;
  }

  const spellId = resolveStackSpellId(options.item, options.card, options.effectiveCard);
  if (!spellId) {
    return false;
  }

  const gameId = String((ctx as any).gameId || 'unknown');
  if (gameId !== 'unknown') {
    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, options.controller)
      .find((step) =>
        step.type === ResolutionStepType.MODE_SELECTION
        && String((step as any)?.modeSelectionPurpose || '') === LEGACY_MODAL_SPELL_RESOLVE_PURPOSE
        && String((step as any)?.spellId || '') === spellId);
    if (existing) {
      return true;
    }
  }

  const teamworkChooseBoth = spellOracleUsesTeamworkChooseBoth(oracleText);
  const teamworkWasPaid = Boolean(options.item?.teamworkWasPaid ?? options.item?.card?.teamworkWasPaid);
  const resolvedMaxModes = teamworkChooseBoth && teamworkWasPaid
    ? Math.min(2, modalInfo.options.length)
    : modalInfo.maxModes;

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.MODE_SELECTION,
    playerId: options.controller,
    sourceId: spellId,
    sourceName: String(options.effectiveCard?.name || options.card?.name || 'Spell'),
    sourceImage: options.effectiveCard?.image_uris?.small || options.effectiveCard?.image_uris?.normal,
    spellId,
    cardName: String(options.effectiveCard?.name || options.card?.name || 'Spell'),
    description: oracleText,
    mandatory: true,
    modes: modalInfo.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
    })),
    minModes: modalInfo.minModes,
    maxModes: resolvedMaxModes,
    normalMinModes: modalInfo.normalMinModes,
    normalMaxModes: modalInfo.normalMaxModes,
    entwineCost: modalInfo.entwineCost,
    allowDuplicates: false,
    modeSelectionPurpose: LEGACY_MODAL_SPELL_RESOLVE_PURPOSE,
    ...(teamworkChooseBoth
      ? {
          teamworkChooseBoth: true,
          teamworkWasPaid,
        }
      : {}),
  } as any);

  debug(
    2,
    `[tryQueueInstantSorceryLegacyModalModeSelection] ${options.effectiveCard?.name || 'Spell'}: queued legacy modal mode selection`,
  );
  return true;
}

/**
 * When spell IR primary is off, pre-selected modal modes (mode_1, mode_2, …) do not
 * route through Effect Program. Resolve each selected mode's oracle fragment via
 * legacy categorizeSpell or uncategorized IR fallback.
 */
export function tryApplyInstantSorceryLegacySelectedModalEffects(
  ctx: GameContext,
  options: LegacyInstantSorceryModalOptions,
): boolean {
  if (isOracleIrSpellPrimaryEnabled()) {
    return false;
  }

  const selectedModes = readSelectedModeIds(options.item);
  if (selectedModes.length === 0) {
    return false;
  }

  const oracleText = String(options.oracleText || '').trim();
  const modalInfo = extractModalModesFromOracleText(oracleText);
  if (!modalInfo || modalInfo.options.length < 2) {
    return false;
  }

  const matchedOptions = matchModalModeOptions(modalInfo, selectedModes);
  if (matchedOptions.length === 0) {
    return false;
  }

  const spellName = String(options.effectiveCard?.name || options.card?.name || 'spell');
  let applied = 0;

  for (const option of matchedOptions) {
    const modeText = String(option.raw || option.description || '').trim();
    if (!modeText) continue;

    const spellSpec = categorizeSpell(spellName, modeText);
    if (spellSpec) {
      executeInstantSorceryLegacyCategorizedSpell(ctx, {
        controller: options.controller,
        card: options.card,
        effectiveCard: options.effectiveCard,
        item: options.item,
        oracleText: modeText,
        targets: options.targets,
        spellSpec,
        spellXValue: options.spellXValue,
        targetSpellControllerForSupplemental: null,
        targetSpellNameForSupplemental: '',
        targetControllerForTokenCreation: null,
      });
      applied += 1;
      continue;
    }

    const fallbackApplied = applyOracleIRUncategorizedSpellFallback(
      ctx,
      modeText,
      options.controller,
      spellName,
      typeof options.spellXValue === 'number' && Number.isFinite(options.spellXValue)
        ? options.spellXValue
        : undefined,
      String(options.item?.source || options.item?.permanentId || ''),
      String(options.item?.id || options.card?.id || ''),
      wasSpellCastFromGraveyard(options.item),
    );
    if (fallbackApplied > 0) {
      applied += 1;
    }
  }

  if (applied > 0) {
    debug(
      2,
      `[tryApplyInstantSorceryLegacySelectedModalEffects] ${spellName}: applied ${applied} pre-selected modal mode(s) via legacy path`,
    );
  }

  return applied > 0;
}

export function tryHandleInstantSorceryLegacyModalResolution(
  ctx: GameContext,
  options: LegacyInstantSorceryModalOptions,
): LegacyInstantSorceryModalOutcome {
  if (tryApplyInstantSorceryLegacySelectedModalEffects(ctx, options)) {
    return 'applied';
  }
  if (tryQueueInstantSorceryLegacyModalModeSelection(ctx, options)) {
    return 'queued';
  }
  return false;
}

export function resumeLegacyModalSpellModeSelection(
  ctx: GameContext,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): boolean {
  const stepData = step as any;
  if (String(stepData?.modeSelectionPurpose || '') !== LEGACY_MODAL_SPELL_RESOLVE_PURPOSE) {
    return false;
  }
  if (response.cancelled) {
    return false;
  }

  const spellId = String(stepData?.spellId || '').trim();
  const selectedRaw = response.selections as unknown;
  const selectedModes = (Array.isArray(selectedRaw) ? selectedRaw : [selectedRaw])
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
  if (!spellId || selectedModes.length === 0) {
    return false;
  }

  const state = (ctx as any).state;
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const spellOnStack = stack.find((stackItem: any) =>
    stackItem
    && (String(stackItem.id || '') === spellId || String(stackItem.cardId || '') === spellId));
  if (!spellOnStack) {
    debug(1, `[resumeLegacyModalSpellModeSelection] spell ${spellId} not found on stack`);
    return false;
  }

  const oracleText = String(
    spellOnStack?.card?.oracle_text
    || spellOnStack?.oracle_text
    || stepData?.description
    || '',
  ).trim();
  applySelectedModeMetadata(spellOnStack, oracleText, selectedModes);

  if (typeof (ctx as any).resolveTopOfStack === 'function') {
    (ctx as any).resolveTopOfStack();
    debug(
      2,
      `[resumeLegacyModalSpellModeSelection] resumed stack resolution for ${stepData?.sourceName || spellId} with modes ${selectedModes.join(', ')}`,
    );
  }

  return true;
}

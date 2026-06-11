import type { GameContext } from '../context.js';import { debug } from '../../utils/debug.js';
import { categorizeSpell } from '../../rules-engine/targeting.js';
import { isOracleIrSpellPrimaryEnabled, tryResolveSpellViaOracleIR } from './oracleIrSpellExecution.js';
import { shouldSkipLegacySpellCategorizeExecution } from './oracleIrSpellLegacyRouting.js';
import { legacyCategorizeSpecMissesZoneIntent } from './stackResolveSpellUncategorizedUtils.js';
import { wasSpellCastFromGraveyard } from './stackResolveSpellCopyChoiceUtils.js';
import type { InstantSorceryOracleIrSpellOptions, InstantSorceryOracleIrSpellOutcome } from './stackResolveSharedTypes.js';

export type { InstantSorceryOracleIrSpellOutcome } from './stackResolveSharedTypes.js';

export function tryResolveInstantSorceryOracleIrSpell(
  ctx: GameContext,
  options: InstantSorceryOracleIrSpellOptions,
): InstantSorceryOracleIrSpellOutcome {
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleText = options.oracleText;
  const targets = Array.isArray(options.targets) ? options.targets : [];
  const selectedModes = Array.isArray(options.selectedModes) ? options.selectedModes : [];

  if (options.skipLegacySpellCategorization) {
    return { oracleIrSpellHandled: false, spellSpec: null };
  }

  const irSpellOutcome = tryResolveSpellViaOracleIR(ctx, {
    controller,
    spellName: String(effectiveCard?.name || 'spell'),
    oracleText,
    sourceId: String(item?.id || card?.id || ''),
    sourcePermanentId: String(item?.source || item?.permanentId || ''),
    targets: targets
      .map((targetRef: any) => (typeof targetRef === 'string' ? targetRef : String(targetRef?.id || '')))
      .filter(Boolean),
    xValue: typeof options.spellXValue === 'number' && Number.isFinite(options.spellXValue) ? options.spellXValue : undefined,
    selectedModeIds: selectedModes.map((mode: any) => String(mode || '')).filter(Boolean),
    castFromGraveyard: wasSpellCastFromGraveyard(item),
    giftPromised: Boolean(item?.giftPromised ?? item?.card?.giftPromised),
    teamworkWasPaid: Boolean(item?.teamworkWasPaid ?? item?.card?.teamworkWasPaid),
    chosenColor: options.existingChosenColor ? String(options.existingChosenColor) : undefined,
    chosenCreatureType: options.existingChosenCreatureType ? String(options.existingChosenCreatureType) : undefined,
    sourceColors: Array.isArray(effectiveCard?.colors) ? effectiveCard.colors : undefined,
    sourceImage: effectiveCard?.image_uris?.small || effectiveCard?.image_uris?.normal,
    sourceItem: item,
  });

  let spellSpec: ReturnType<typeof categorizeSpell> | null = null;
  const oracleIrSpellHandled = irSpellOutcome.handled;

  if (!oracleIrSpellHandled) {
    if (shouldSkipLegacySpellCategorizeExecution(oracleText, effectiveCard?.name || 'spell')) {
      debug(
        1,
        `[tryResolveInstantSorceryOracleIrSpell] ${effectiveCard?.name || 'spell'}: IR primary owns spell but did not apply; falling through to legacy categorize: ${String(oracleText || '').trim()}`,
      );
    }
    spellSpec = categorizeSpell(effectiveCard?.name || '', oracleText);
    if (
      spellSpec
      && !isOracleIrSpellPrimaryEnabled()
      && legacyCategorizeSpecMissesZoneIntent(oracleText, spellSpec)
    ) {
      spellSpec = null;
    }
    if (irSpellOutcome.shadowWouldHandle && spellSpec) {
      debug(
        1,
        `[oracleIR-shadow] ${effectiveCard?.name || 'spell'}: IR would handle but legacy categorizeSpell matched op=${String((spellSpec as any)?.op || 'unknown')}`,
      );
    }
  } else if (isOracleIrSpellPrimaryEnabled()) {
    debug(2, `[tryResolveInstantSorceryOracleIrSpell] ${effectiveCard?.name || 'spell'} resolved via Oracle IR primary path (${irSpellOutcome.applied} step(s))`);
  }

  return { oracleIrSpellHandled, spellSpec };
}

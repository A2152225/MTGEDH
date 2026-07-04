import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { recordOracleIrGapTelemetry, isOracleIrGapTelemetryLegacySoakEnabled } from './oracleIrGapTelemetry.js';
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
    card,
    effectiveCard,
    cardId: String(
      effectiveCard?.oracle_id
      || card?.oracle_id
      || item?.card?.oracle_id
      || '',
    ).trim() || undefined,
  });

  let spellSpec: ReturnType<typeof categorizeSpell> | null = null;
  const oracleIrSpellHandled = irSpellOutcome.handled;

  if (!oracleIrSpellHandled) {
    const irOwnsSpell = shouldSkipLegacySpellCategorizeExecution(oracleText, effectiveCard?.name || 'spell');
    if (irOwnsSpell) {
      debug(
        1,
        `[tryResolveInstantSorceryOracleIrSpell] ${effectiveCard?.name || 'spell'}: IR primary owns spell but did not apply; legacy categorize skipped: ${String(oracleText || '').trim()}`,
      );
      recordOracleIrGapTelemetry({
        kind: 'owned_but_unhandled',
        scope: 'spell',
        label: String(effectiveCard?.name || 'spell'),
        reasons: ['ir_primary_owns_spell_but_did_not_apply; legacy categorize skipped'],
        effectText: oracleText,
        gameId: String((ctx as any)?.gameId || '') || undefined,
      });
      spellSpec = null;
    } else {
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
      if (spellSpec && (isOracleIrSpellPrimaryEnabled() || isOracleIrGapTelemetryLegacySoakEnabled())) {
        // Retirement triage: which spells still resolve via legacy categorize in production.
        recordOracleIrGapTelemetry({
          kind: 'legacy_handled',
          scope: 'spell',
          label: String(effectiveCard?.name || 'spell'),
          reasons: [`legacy_categorize_op:${String((spellSpec as any)?.op || 'unknown')}`],
          effectText: oracleText,
          gameId: String((ctx as any)?.gameId || '') || undefined,
        });
      }
    }
  } else if (isOracleIrSpellPrimaryEnabled()) {
    debug(2, `[tryResolveInstantSorceryOracleIrSpell] ${effectiveCard?.name || 'spell'} resolved via Oracle IR primary path (${irSpellOutcome.applied} step(s))`);
  }

  return { oracleIrSpellHandled, spellSpec };
}

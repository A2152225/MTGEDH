import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { buildOracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutor.js';
import {
  inferOracleIrTargetBinding,
  oracleIrTargetBindingToBaseContext,
  oracleIrTargetBindingToEventHint,
} from '../../../../rules-engine/src/oracleIrTargetBinding.js';
import { applyOracleIRUncategorizedSpellFallback } from './oracleIrUncategorizedSpellFallback.js';
import { isCategorizeOpcodeRetiredUnderOracleIrPrimary, shouldSkipSpellUncategorizedFallback } from './oracleIrSpellLegacyRouting.js';
import { wasSpellCastFromGraveyard } from './stackResolveSpellCopyChoiceUtils.js';
import type { categorizeSpell } from '../../rules-engine/targeting.js';
import { isOracleIrSpellPrimaryEnabled } from './oracleIrFeatureFlags.js';

function buildUncategorizedSpellIrContext(
  caster: PlayerID,
  spellName: string,
  options: {
    xValue?: number;
    sourcePermanentId?: string;
    sourceId?: string;
    castFromGraveyard?: boolean;
  },
  targetBinding: ReturnType<typeof inferOracleIrTargetBinding>,
) {
  return buildOracleIRExecutionContext(
    {
      controllerId: caster,
      sourceId: options.sourceId || options.sourcePermanentId,
      sourceName: spellName,
      sourceObjectType: 'spell',
      xValue: options.xValue,
      ...(options.castFromGraveyard ? { castFromZone: 'graveyard' } : {}),
      ...oracleIrTargetBindingToBaseContext(targetBinding),
      selectorContext: oracleIrTargetBindingToBaseContext(targetBinding).selectorContext,
    },
    {
      ...oracleIrTargetBindingToEventHint(targetBinding),
      sourceObjectType: 'spell',
      castFromZone: options.castFromGraveyard ? 'graveyard' : undefined,
    },
  );
}

export function legacyCategorizeSpecMissesZoneIntent(
  oracleText: string,
  spec: NonNullable<ReturnType<typeof categorizeSpell>>,
): boolean {
  const lower = String(oracleText || '').trim().toLowerCase();
  const op = String(spec.op || '');
  if (op === 'EXILE_ALL' && /\b(?:from|in)\b[^.]*\bgraveyard\b/.test(lower)) return true;
  if (op === 'EXILE_ALL' && /\btarget player'?s?\b/.test(lower) && /\bgraveyard\b/.test(lower)) return true;
  return false;
}

export function tryApplyInstantSorceryUncategorizedSpellFallback(
  ctx: GameContext,
  options: {
    oracleIrSpellHandled: boolean;
    spellSpec: ReturnType<typeof categorizeSpell> | null;
    skipLegacySpellCategorization: boolean;
    oracleText: string;
    effectiveCard: any;
    controller: PlayerID;
    spellXValue: unknown;
    item: any;
    card: any;
  },
): number {
  if (options.oracleIrSpellHandled || options.skipLegacySpellCategorization) {
    return 0;
  }

  const spellName = String(options.effectiveCard?.name || 'spell');
  if (shouldSkipSpellUncategorizedFallback(options.oracleText, spellName)) {
    return 0;
  }

  if (options.spellSpec) {
    const allowRetiredLegacySupplement =
      !isOracleIrSpellPrimaryEnabled()
      && isCategorizeOpcodeRetiredUnderOracleIrPrimary(String(options.spellSpec.op || ''))
      && legacyCategorizeSpecMissesZoneIntent(options.oracleText, options.spellSpec);
    if (!allowRetiredLegacySupplement) {
      return 0;
    }
  }

  const item = options.item;
  const card = options.card;
  const targetIds = (Array.isArray(item?.targets) ? item.targets : [])
    .map((targetRef: any) => (typeof targetRef === 'string' ? targetRef : String(targetRef?.id || '')))
    .filter(Boolean);
  const targetBinding = inferOracleIrTargetBinding((ctx as any).state, targetIds, options.controller);
  const xValue = typeof options.spellXValue === 'number' && Number.isFinite(options.spellXValue)
    ? options.spellXValue
    : undefined;
  const castFromGraveyard = wasSpellCastFromGraveyard(item);
  const irCtx = buildUncategorizedSpellIrContext(
    options.controller,
    options.effectiveCard.name || 'spell',
    {
      xValue,
      sourcePermanentId: String(item?.source || item?.permanentId || ''),
      sourceId: String(item?.id || card?.id || ''),
      castFromGraveyard,
    },
    targetBinding,
  );

  const applied = applyOracleIRUncategorizedSpellFallback(
    ctx,
    options.oracleText,
    options.controller,
    options.effectiveCard.name || 'spell',
    xValue,
    String(item?.source || item?.permanentId || ''),
    String(item?.id || card?.id || ''),
    castFromGraveyard,
    irCtx,
    'spell',
    item,
    targetIds,
  );

  return applied;
}

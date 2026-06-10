import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { applyOracleIRUncategorizedSpellFallback } from './oracleIrUncategorizedSpellFallback.js';
import { shouldSkipSpellUncategorizedFallback } from './oracleIrSpellLegacyRouting.js';
import { wasSpellCastFromGraveyard } from './stackResolveSpellCopyChoiceUtils.js';
import type { categorizeSpell } from '../../rules-engine/targeting.js';

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
  if (
    options.oracleIrSpellHandled
    || options.spellSpec
    || options.skipLegacySpellCategorization
    || shouldSkipSpellUncategorizedFallback(options.oracleText, options.effectiveCard.name || 'spell')
  ) {
    return 0;
  }

  const item = options.item;
  const card = options.card;

  return applyOracleIRUncategorizedSpellFallback(
    ctx,
    options.oracleText,
    options.controller,
    options.effectiveCard.name || 'spell',
    options.spellXValue,
    String(item?.source || item?.permanentId || ''),
    String(item?.id || card?.id || ''),
    wasSpellCastFromGraveyard(item),
  );
}

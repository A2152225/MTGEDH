import { findTriggerEffectClauseMatchingFragment } from '../../../../rules-engine/src/triggerEffectTextExtraction.js';
import { lookupLocalCardByNameSync } from '../../services/localCardLookup.js';

export interface ResolveTriggerStackItemEffectTextOptions {
  readonly state?: any;
}

/**
 * When a malformed stack item merges a static ability into the trigger description,
 * keep only the first sentence of the extracted effect clause.
 */
function trimMergedStaticAbilityTail(effectClause: string): string {
  const trimmed = effectClause.trim();
  const dotIdx = trimmed.indexOf('.');
  if (dotIdx === -1) return trimmed;

  const afterDot = trimmed.slice(dotIdx + 1).trim();
  if (/^(creatures|this creature|this artifact|this permanent|equipped|at the beginning|other|all)/i.test(afterDot)) {
    return trimmed.slice(0, dotIdx).trim();
  }

  return trimmed;
}

function resolveSourcePermanentFromItem(state: any, item: any): any | null {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const candidateIds = [
    item?.permanentId,
    item?.source,
    item?.sourceId,
  ].map((id) => String(id || '').trim()).filter(Boolean);

  for (const id of candidateIds) {
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === id);
    if (permanent) return permanent;
  }

  if (item?.sourcePermanentSnapshot && typeof item.sourcePermanentSnapshot === 'object') {
    return item.sourcePermanentSnapshot;
  }

  return null;
}

function readOracleTextFromPermanentLike(permanent: any): string {
  return String(
    permanent?.card?.oracle_text
    || permanent?.card?.oracleText
    || permanent?.oracle_text
    || permanent?.oracleText
    || '',
  ).trim();
}

function resolveOracleTextForTriggerItem(item: any, state?: any): string {
  const fromPermanent = readOracleTextFromPermanentLike(resolveSourcePermanentFromItem(state, item));
  if (fromPermanent) return fromPermanent;

  const fromItemCard = readOracleTextFromPermanentLike({ card: item?.card });
  if (fromItemCard) return fromItemCard;

  const sourceName = String(item?.sourceName || item?.card?.name || '').trim();
  if (!sourceName) return '';

  try {
    const localCard = lookupLocalCardByNameSync(sourceName);
    return String(localCard?.oracle_text || '').trim();
  } catch {
    return '';
  }
}

function hydrateTriggerEffectFromOracleText(
  fragment: string,
  item: any,
  options?: ResolveTriggerStackItemEffectTextOptions,
): string {
  const oracleText = resolveOracleTextForTriggerItem(item, options?.state);
  if (!oracleText) return fragment;

  const hydrated = findTriggerEffectClauseMatchingFragment(oracleText, fragment);
  if (!hydrated || hydrated === fragment) return fragment;
  return hydrated;
}

/**
 * Resolve the effect clause text for a triggered-ability stack item.
 * Prefer explicit `effect`; fall back to parsing `description` for known shapes.
 * When the stack item only carries a truncated fragment, hydrate the full clause
 * from the source permanent or card oracle text.
 */
export function resolveTriggerStackItemEffectText(
  item: any,
  options?: ResolveTriggerStackItemEffectTextOptions,
): string {
  const effect = String(item?.effect || '').trim();
  if (effect) return effect;

  const description = String(item?.description || '').trim();
  if (!description) return '';

  const triggerType = String(item?.triggerType || '').trim();
  if (triggerType === 'cast_creature_type') {
    const tribalMatch = description.match(
      /whenever you cast an? [^.]+ spell,?\s*(.+)$/i,
    );
    if (tribalMatch?.[1]) {
      return trimMergedStaticAbilityTail(String(tribalMatch[1]).trim());
    }

    const chosenTypeMatch = description.match(
      /whenever you cast a spell of the chosen type,?\s*(.+)$/i,
    );
    if (chosenTypeMatch?.[1]) {
      return trimMergedStaticAbilityTail(String(chosenTypeMatch[1]).trim());
    }
  }

  return hydrateTriggerEffectFromOracleText(description, item, options);
}

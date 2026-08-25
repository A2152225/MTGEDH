/**
 * Extracted from triggerEtbEntryEffects.ts: typed ETB matching and stack-item build.
 * Cluster moved: escapeRegExp through matchesRequiredTypePhrase, including
 * shouldQueueChosenTypeCreatureEtbTrigger and tryBuildTypedPermanentEtbStackItem.
 * Public: shouldQueueChosenTypeCreatureEtbTrigger, TYPED_PERMANENT_ETB_REQUIRED_TYPE,
 * isTypedPermanentEtbTrigger, shouldQueueTypedPermanentEtbTrigger,
 * isNamedOrAnotherTypedEtbTrigger, resolveEnteringCreatureDiscoverXValue,
 * shouldQueueNamedOrAnotherTypedEtbTrigger, tryBuildTypedPermanentEtbStackItem,
 * matchesRequiredTypePhrase
 *
 * Leaf must not import triggerEtbEntryEffects.ts or triggerEtbEntryEffects-handlers/index.ts.
 */

import type { GameContext } from '../../context.js';
import { getActualPowerToughness, uid } from '../../utils.js';
import { permanentHasCreatureTypeNow } from '../../creatureTypeNow.js';
import { inferTriggeredAbilityTargetMetadata, isModalChooseModesEffectText } from '../inferTriggeredAbilityTargetMetadata.js';
import { isInterveningIfSatisfied } from '../triggers/intervening-if.js';
import {
  buildInterveningIfSubjectSnapshot,
  buildTriggerSourcePermanentSnapshot,
} from '../triggerSourceUtils.js';
import {
  recordTurnLimitedEtbTriggerQueued,
  shouldSkipTurnLimitedEtbTrigger,
} from '../triggerDoThisOnlyOnceEachTurn.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTypeLineForMatching(typeLine: string): string {
  // Replace em dash separators and normalize to spaces so word-boundary matching works.
  return String(typeLine || '')
    .toLowerCase()
    .replace(/[â€™]/g, "'")
    .replace(/â€”/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function typeLineHasAllWords(typeLine: string, phrase: string): boolean {
  const tl = normalizeTypeLineForMatching(typeLine);
  const tokens = String(phrase || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((tok) => new RegExp(`\\b${escapeRegExp(tok)}\\b`, 'i').test(tl));
}

export function shouldQueueChosenTypeCreatureEtbTrigger(
  trigger: any,
  sourcePermanent: any,
  enteringPermanent: any,
  enteringController: string,
  isToken: boolean,
  isCreature: boolean,
): boolean {
  if (!enteringPermanent) return false;
  const subjectKind = String((trigger as any)?.subjectKind || 'creature').trim().toLowerCase();
  // Permanent chosen-type ETBs (Pennant / Torque) fire for any permanent with the type;
  // creature chosen-type ETBs still require a creature.
  if (subjectKind !== 'permanent' && !isCreature) return false;
  if ((trigger as any)?.nontokenOnly && isToken) return false;
  if ((trigger as any)?.anotherOnly) {
    const sourceId = String(sourcePermanent?.id || '').trim();
    const enteringId = String(enteringPermanent?.id || '').trim();
    if (sourceId && enteringId && sourceId === enteringId) return false;
  }
  const chosenType = String(sourcePermanent?.chosenCreatureType || '').trim();
  if (!chosenType) return false;
  const triggerController = String(sourcePermanent?.controller || enteringController || '');
  if (String(enteringController || '') !== triggerController) return false;
  return permanentHasCreatureTypeNow(enteringPermanent, chosenType);
}

/** "Whenever an enchantment/artifact/equipment you control enters" — not a self-ETB. */
export const TYPED_PERMANENT_ETB_REQUIRED_TYPE: Record<string, string> = {
  enchantment_etb: 'enchantment',
  artifact_etb: 'artifact',
  equipment_etb: 'equipment',
  planeswalker_etb: 'planeswalker',
};

export function isTypedPermanentEtbTrigger(triggerType: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    TYPED_PERMANENT_ETB_REQUIRED_TYPE,
    String(triggerType || '').trim(),
  );
}

export function shouldQueueTypedPermanentEtbTrigger(
  trigger: any,
  sourcePermanent: any,
  enteringPermanent: any,
  enteringController: string,
): boolean {
  const triggerType = String(trigger?.triggerType || '').trim();
  const requiredType = TYPED_PERMANENT_ETB_REQUIRED_TYPE[triggerType];
  if (!requiredType || !enteringPermanent) return false;

  const typeLine = String(enteringPermanent?.card?.type_line || '').toLowerCase();
  if (!typeLine.includes(requiredType)) return false;

  const isToken = Boolean(enteringPermanent?.isToken || enteringPermanent?.card?.isToken);
  if ((trigger as any)?.nontokenOnly && isToken) return false;
  if ((trigger as any)?.tokenOnly && !isToken) return false;

  if ((trigger as any)?.controlledOnly) {
    const triggerController = String(sourcePermanent?.controller || enteringController || '');
    if (!triggerController || String(enteringController || '') !== triggerController) {
      return false;
    }
  }

  return true;
}

const NAMED_OR_ANOTHER_TYPED_ETB_TYPES = new Set([
  'named_or_another_typed_etb',
  'this_or_another_typed_etb',
  'this_or_another_typed_etb_any',
  'named_or_another_nontoken_typed_etb',
  'this_or_another_nontoken_typed_etb',
]);

export function isNamedOrAnotherTypedEtbTrigger(triggerType: string): boolean {
  return NAMED_OR_ANOTHER_TYPED_ETB_TYPES.has(String(triggerType || '').trim());
}

export function resolveEnteringCreatureDiscoverXValue(
  trigger: any,
  enteringPermanent: any,
  state: any,
): number | undefined {
  const effect = String(trigger?.effect || trigger?.description || '');
  const match = effect.match(/where\s+x\s+is\s+that\s+creature(?:'|’)?s\s+(power|toughness)/i);
  if (!match || !enteringPermanent) return undefined;
  const pt = getActualPowerToughness(enteringPermanent, state);
  const value = String(match[1] || '').toLowerCase() === 'power' ? pt.power : pt.toughness;
  return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : undefined;
}

export function shouldQueueNamedOrAnotherTypedEtbTrigger(
  trigger: any,
  sourcePermanent: any,
  enteringPermanent: any,
  enteringController: string,
): boolean {
  const triggerType = String(trigger?.triggerType || '').trim();
  if (!isNamedOrAnotherTypedEtbTrigger(triggerType) || !enteringPermanent) return false;

  const isToken = Boolean(enteringPermanent?.isToken || enteringPermanent?.card?.isToken);
  if ((trigger as any)?.nontokenOnly && isToken) return false;
  if (/nontoken/i.test(triggerType) && isToken) return false;

  const sourceId = String(sourcePermanent?.id || '').trim();
  const enteringId = String(enteringPermanent?.id || '').trim();
  const isSelf = Boolean(sourceId && enteringId && sourceId === enteringId);

  const triggerController = String(sourcePermanent?.controller || enteringController || '');
  const requiresControllerMatch = (trigger as any)?.controlledOnly === true
    || triggerType !== 'this_or_another_typed_etb_any';
  if (!isSelf && requiresControllerMatch && triggerController
    && String(enteringController || '') !== triggerController) {
    return false;
  }

  // "NAME or another TYPE" always includes the named permanent itself.
  if (isSelf) return true;

  const phrase = String((trigger as any)?.requiredTypePhrase || '').trim();
  if (!phrase) return false;
  const types = phrase.split(/\s+or\s+/i).map((part) => part.trim()).filter(Boolean);
  return types.some((creatureType) => permanentHasCreatureTypeNow(enteringPermanent, creatureType));
}

export function tryBuildTypedPermanentEtbStackItem(
  ctx: GameContext,
  trigger: any,
  sourcePermanent: any,
  enteringPermanent: any,
  enteringController: string,
): any | null {
  if (
    !shouldQueueTypedPermanentEtbTrigger(trigger, sourcePermanent, enteringPermanent, enteringController)
    && !shouldQueueNamedOrAnotherTypedEtbTrigger(trigger, sourcePermanent, enteringPermanent, enteringController)
  ) {
    return null;
  }

  const triggerController = String(sourcePermanent?.controller || enteringController || '');
  if (shouldSkipTurnLimitedEtbTrigger((ctx as any).state, trigger, String(sourcePermanent?.id || ''))) {
    return null;
  }
  const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
  let textForEval = desc;
  if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
    const requiredType = TYPED_PERMANENT_ETB_REQUIRED_TYPE[String(trigger?.triggerType || '').trim()] || 'permanent';
    const article = /^[aeiou]/i.test(requiredType) ? 'an' : 'a';
    textForEval = (trigger as any)?.controlledOnly
      ? `Whenever ${article} ${requiredType} you control enters the battlefield, ${textForEval}`
      : `Whenever ${article} ${requiredType} enters the battlefield, ${textForEval}`;
  }

  try {
    const satisfied = isInterveningIfSatisfied(
      ctx as any,
      triggerController,
      textForEval,
      enteringPermanent,
    );
    if (satisfied === false) {
      return null;
    }
  } catch {
    // Conservative fallback: keep the trigger if evaluation fails.
  }

  const effectText = String((trigger as any)?.effect || trigger?.description || '');
  const modalChooseModes = isModalChooseModesEffectText(effectText);
  const enrichedMetadata = (
    !modalChooseModes
    && (
      (trigger as any)?.requiresTarget === true
      || /\btarget\b/i.test(effectText)
      || String((trigger as any)?.targetZone || '').trim().length > 0
    )
  )
    ? inferTriggeredAbilityTargetMetadata(effectText, {
        gameState: (ctx as any).state,
        controllerId: triggerController,
        sourceName: String(trigger?.cardName || sourcePermanent?.card?.name || ''),
        sourcePermanent,
      } as any)
    : ({} as ReturnType<typeof inferTriggeredAbilityTargetMetadata>);
  const effectiveRequiresTarget = !modalChooseModes && (
    (trigger as any)?.requiresTarget === true
    || Boolean(enrichedMetadata.targetZone)
    || Boolean(enrichedMetadata.targetType)
  );

  const discoverXValue = resolveEnteringCreatureDiscoverXValue(trigger, enteringPermanent, (ctx as any).state);
  recordTurnLimitedEtbTriggerQueued((ctx as any).state, trigger, String(sourcePermanent?.id || ''));

  return {
    id: uid('trigger'),
    type: 'triggered_ability',
    controller: triggerController,
    source: sourcePermanent?.id,
    permanentId: sourcePermanent?.id,
    sourceName: trigger?.cardName,
    description: trigger?.description,
    triggerType: trigger?.triggerType,
    mandatory: trigger?.mandatory,
    effect: effectText || trigger?.description,
    card: sourcePermanent?.card,
    sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(sourcePermanent),
    interveningIfSubjectPermanentId: enteringPermanent?.id,
    interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(enteringPermanent),
    requiresTarget: effectiveRequiresTarget,
    targetType: enrichedMetadata.targetType || (trigger as any)?.targetType,
    targetConstraint: enrichedMetadata.targetConstraint || (trigger as any)?.targetConstraint,
    needsTargetSelection: effectiveRequiresTarget,
    ...(typeof discoverXValue === 'number' ? { xValue: discoverXValue } : null),
    ...((trigger as any)?.doThisOnlyOnceEachTurn ? { doThisOnlyOnceEachTurn: true } : null),
    ...((trigger as any)?.oncePerTurn ? { oncePerTurn: true } : null),
    ...(enrichedMetadata.targetZone ? { targetZone: enrichedMetadata.targetZone } : null),
    ...(enrichedMetadata.targetDestination ? { targetDestination: enrichedMetadata.targetDestination } : null),
    ...(typeof enrichedMetadata.minTargets === 'number' ? { minTargets: enrichedMetadata.minTargets } : null),
    ...(typeof enrichedMetadata.maxTargets === 'number' ? { maxTargets: enrichedMetadata.maxTargets } : null),
  };
}

export function matchesRequiredTypePhrase(typeLine: string, requiredPhrase: string, isToken: boolean): boolean {
  let phrase = String(requiredPhrase || '').toLowerCase().trim();
  if (!phrase) return true;

  const hasNontoken = /\b(?:nontoken|non-token)\b/i.test(phrase);
  const hasTokenWord = /\btoken\b/i.test(phrase);

  if (hasNontoken && isToken) return false;
  if (!hasNontoken && hasTokenWord && !isToken) return false;

  // Strip token qualifiers from the phrase so the remaining words match the actual type line.
  phrase = phrase
    .replace(/\b(?:nontoken|non-token)\b/gi, '')
    .replace(/\btoken\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return typeLineHasAllWords(typeLine, phrase);
}

/**
 * Shared process/queue emitters for detector families that previously had
 * detect* helpers but no live emission path (equipped, bounce, transform,
 * monstrous, LTB). Modeled after spellCounteredTriggerUtils.
 */
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { uid } from '../utils.js';
import {
  detectAbilityActivatedTriggers,
  detectETBTriggers,
  detectEquippedTriggers,
  detectLTBTriggers,
  detectMonstrousTriggers,
  detectReturnedToHandTriggers,
  detectTransformTriggers,
} from './triggered-abilities.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';
import {
  hasUnsupportedTargetRequirement,
  inferGenericTriggeredAbilityTargetMetadata,
} from './triggers/target-metadata.js';

function snapshotPermanent(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;
  return {
    ...permanent,
    ...(permanent.card && typeof permanent.card === 'object' ? { card: { ...permanent.card } } : null),
    ...(permanent.counters && typeof permanent.counters === 'object'
      ? { counters: { ...permanent.counters } }
      : null),
  };
}

export function queueGenericTriggeredAbility(
  ctx: GameContext,
  trigger: any,
  triggerType: string,
  effectData?: Record<string, unknown>,
): any | null {
  const state = (ctx as any).state;
  if (!state) return null;

  const effect = String(trigger.effect || trigger.description || '').trim();
  if (!effect) return null;

  const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
  if (hasUnsupportedTargetRequirement(targetMetadata)) return null;

  const triggerId = uid('trigger');
  const sourcePermanentSnapshot = snapshotPermanent(
    (Array.isArray(state.battlefield) ? state.battlefield : []).find(
      (perm: any) => String(perm?.id || '') === String(trigger.permanentId || ''),
    ) || (trigger._sourceSnapshot ? trigger._sourceSnapshot : undefined),
  );
  const stackItem = {
    id: triggerId,
    type: 'triggered_ability',
    controller: trigger.controllerId || trigger.controller,
    source: trigger.permanentId,
    permanentId: trigger.permanentId,
    sourceName: trigger.cardName,
    description: effect,
    effect,
    ...targetMetadata,
    ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
    triggerType,
    mandatory: trigger.mandatory !== false,
    ...(effectData ? { effectData } : null),
  };

  state.stack = Array.isArray(state.stack) ? state.stack : [];
  state.stack.push(stackItem);
  try {
    (ctx as any).bumpSeq?.();
  } catch {
    // best-effort
  }

  const gameId = String((ctx as any)?.gameId || '').trim();
  if (gameId && gameId !== 'unknown') {
    try {
      appendEvent(gameId, Number(state.seq ?? (ctx as any).seq?.value ?? 0), 'pushTriggeredAbility', {
        triggerId,
        sourceId: trigger.permanentId,
        permanentId: trigger.permanentId,
        sourceName: trigger.cardName,
        controllerId: stackItem.controller,
        description: effect,
        triggerType,
        effect,
        ...targetMetadata,
        mandatory: trigger.mandatory !== false,
        ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
        ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
        ...(effectData ? { effectData } : null),
      });
    } catch (err) {
      debugWarn(1, `[triggerEmissionFamilyUtils] appendEvent(${triggerType}) failed:`, err);
    }
  }

  return stackItem;
}

function evaluateInterveningIf(
  ctx: GameContext,
  trigger: any,
  prefix: string,
  sourcePermanent?: any,
  refs?: Record<string, unknown>,
): boolean {
  const raw = String(trigger.effect || trigger.description || '').trim();
  let textForEval = raw;
  if (textForEval && !/^(?:when|whenever|at)\b/i.test(textForEval)) {
    textForEval = `${prefix}, ${textForEval}`;
  }
  const ok = isInterveningIfSatisfied(
    ctx as any,
    String(trigger.controllerId || sourcePermanent?.controller || ''),
    textForEval,
    sourcePermanent,
    refs as any,
  );
  return ok !== false;
}

/**
 * Equipment becomes attached to a creature.
 */
export function processEquippedTriggers(
  ctx: GameContext,
  equipment: any,
  attachedToPermanent?: any,
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!equipment?.card || !equipment?.id) return [];

  const detected = detectEquippedTriggers(equipment.card, equipment);
  if (detected.length === 0) return [];

  const queued: any[] = [];
  const ordered = orderTriggersByAPNAP(
    ctx,
    detected.map((trigger) => ({
      ...trigger,
      controllerId: String(equipment.controller || trigger.controllerId || ''),
    })),
  );

  for (const trigger of ordered) {
    if (!evaluateInterveningIf(ctx, trigger, 'Whenever this Equipment becomes attached to a creature', equipment)) {
      continue;
    }
    debug(2, `[triggerEmission] Equipped trigger: ${trigger.cardName} - ${trigger.description}`);
    const item = queueGenericTriggeredAbility(ctx, trigger, 'equipped_attached', {
      equipmentId: String(equipment.id || ''),
      attachedToId: String(attachedToPermanent?.id || equipment.attachedTo || ''),
      attachedToName: String(attachedToPermanent?.card?.name || ''),
    });
    if (item) queued.push(item);
  }
  return queued;
}

/**
 * A permanent was returned to hand from the battlefield.
 * Scans remaining battlefield for watchers; also self-triggers if the bounced
 * permanent itself has returned-to-hand text (rare).
 */
export function processReturnedToHandTriggers(
  ctx: GameContext,
  returnedPermanent: any,
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!returnedPermanent) return [];

  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const returnedId = String(returnedPermanent.id || '');
  const returnedController = String(returnedPermanent.controller || returnedPermanent.owner || '');
  const isCreature = String(returnedPermanent?.card?.type_line || '').toLowerCase().includes('creature');
  const isNoncreature = !isCreature;
  const queued: any[] = [];

  const candidates = [
    ...battlefield,
    // Self-triggers still need the leaving permanent's oracle (already removed from BF).
    returnedPermanent,
  ];
  const seen = new Set<string>();

  for (const permanent of candidates) {
    if (!permanent?.card) continue;
    const key = `${String(permanent.id || '')}:${String(permanent.card?.name || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const detected = detectReturnedToHandTriggers(permanent.card, permanent);
    for (const trigger of detected) {
      const controllerId = String(permanent.controller || returnedController || '');
      const effectLower = String(trigger.description || trigger.effect || '').toLowerCase();
      const clause = String(permanent.card?.oracle_text || '').toLowerCase();

      // Filter common clause shapes against the returned permanent.
      if (clause.includes('noncreature') && !isNoncreature) continue;
      if (
        (clause.includes('creature is returned') || clause.includes('creature you control is returned')
          || clause.includes('or another creature is returned'))
        && !isCreature
      ) {
        continue;
      }
      if (
        (clause.includes('permanent you control') || clause.includes('returned to your hand'))
        && returnedController
        && controllerId
        && returnedController !== controllerId
        && !clause.includes("a player's hand")
      ) {
        // "your hand" / "you control" watchers only care about their own returns.
        if (clause.includes('you control') || clause.includes('your hand')) {
          if (returnedController !== controllerId) continue;
        }
      }

      const enriched = {
        ...trigger,
        controllerId,
        permanentId: String(permanent.id || trigger.permanentId || ''),
        _sourceSnapshot: permanent.id === returnedId ? snapshotPermanent(returnedPermanent) : undefined,
      };

      if (!evaluateInterveningIf(
        ctx,
        enriched,
        'Whenever a permanent is returned to hand',
        permanent.id === returnedId ? returnedPermanent : permanent,
      )) {
        continue;
      }

      debug(2, `[triggerEmission] Returned-to-hand trigger: ${trigger.cardName} - ${trigger.description}`);
      const item = queueGenericTriggeredAbility(ctx, enriched, 'returned_to_hand', {
        returnedPermanentId: returnedId,
        returnedPermanentName: String(returnedPermanent?.card?.name || ''),
        returnedController,
        returnedWasCreature: isCreature,
        effectHint: effectLower.slice(0, 80),
      });
      if (item) queued.push(item);
    }
  }

  return queued;
}

/**
 * Permanent transforms / flips.
 */
export function processTransformTriggers(ctx: GameContext, permanent: any): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!permanent?.card || !permanent?.id) return [];

  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const queued: any[] = [];

  // Self transform triggers on the transforming permanent.
  const selfDetected = detectTransformTriggers(permanent.card, permanent);
  for (const trigger of selfDetected) {
    const enriched = {
      ...trigger,
      controllerId: String(permanent.controller || ''),
    };
    if (!evaluateInterveningIf(ctx, enriched, 'Whenever this permanent transforms', permanent)) continue;
    debug(2, `[triggerEmission] Transform trigger: ${trigger.cardName} - ${trigger.description}`);
    const item = queueGenericTriggeredAbility(ctx, enriched, 'transform', {
      transformedPermanentId: String(permanent.id || ''),
    });
    if (item) queued.push(item);
  }

  // Watchers that care about equipped/enchanted creature transforming.
  for (const watcher of battlefield) {
    if (!watcher?.card || String(watcher.id) === String(permanent.id)) continue;
    const attachedTo = String(watcher.attachedTo || '');
    if (!attachedTo || attachedTo !== String(permanent.id)) continue;
    const detected = detectTransformTriggers(watcher.card, watcher);
    for (const trigger of detected) {
      const enriched = {
        ...trigger,
        controllerId: String(watcher.controller || ''),
      };
      if (!evaluateInterveningIf(ctx, enriched, 'Whenever equipped creature transforms', watcher)) continue;
      const item = queueGenericTriggeredAbility(ctx, enriched, 'transform', {
        transformedPermanentId: String(permanent.id || ''),
        watcherPermanentId: String(watcher.id || ''),
      });
      if (item) queued.push(item);
    }
  }

  return queued;
}

/** Detector types that fire when a permanent is turned face up — not on ETB. */
export const FACE_UP_TRIGGER_TYPES = new Set<string>([
  'face_up',
  'another_permanent_face_up',
  'enchantment_or_permanent_turned_face_up',
  'face_down_controlled_turned_face_up',
  'named_or_another_permanent_face_up',
  'self_or_another_permanent_face_up',
  'controlled_permanent_face_up',
  'any_permanent_face_up',
]);

export function isFaceUpTriggerType(triggerType: string | undefined): boolean {
  return FACE_UP_TRIGGER_TYPES.has(String(triggerType || ''));
}

function faceUpTriggerMatchesEvent(
  triggerType: string,
  isSelf: boolean,
  sameController: boolean,
): boolean {
  switch (triggerType) {
    case 'face_up':
      return isSelf;
    case 'another_permanent_face_up':
      return !isSelf && sameController;
    case 'face_down_controlled_turned_face_up':
      return sameController;
    case 'enchantment_or_permanent_turned_face_up':
    case 'named_or_another_permanent_face_up':
      return isSelf || sameController;
    case 'self_or_another_permanent_face_up':
    case 'any_permanent_face_up':
      return true;
    case 'controlled_permanent_face_up':
      return sameController;
    default:
      return false;
  }
}

/**
 * A permanent was turned face up (morph / megamorph / manifest special action).
 * Scans the face-up permanent plus remaining battlefield watchers.
 */
export function processFaceUpTriggers(ctx: GameContext, faceUpPermanent: any): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!faceUpPermanent?.card || !faceUpPermanent?.id) return [];

  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const faceUpId = String(faceUpPermanent.id || '');
  const faceUpController = String(faceUpPermanent.controller || faceUpPermanent.owner || '');
  const queued: any[] = [];
  const seenKeys = new Set<string>();

  const candidates = [...battlefield];
  if (!candidates.some((permanent: any) => String(permanent?.id || '') === faceUpId)) {
    candidates.push(faceUpPermanent);
  }

  for (const permanent of candidates) {
    if (!permanent?.card) continue;
    const key = `${String(permanent.id || '')}:${String(permanent.card?.name || '')}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const detected = detectETBTriggers(permanent.card, permanent);
    for (const trigger of detected) {
      const triggerType = String(trigger.triggerType || '');
      if (!isFaceUpTriggerType(triggerType)) continue;

      const isSelf = String(permanent.id || '') === faceUpId;
      const sameController = String(permanent.controller || '') === faceUpController;
      if (!faceUpTriggerMatchesEvent(triggerType, isSelf, sameController)) continue;

      const enriched = {
        ...trigger,
        controllerId: String(permanent.controller || faceUpController || ''),
        permanentId: String(permanent.id || trigger.permanentId || ''),
      };

      if (!evaluateInterveningIf(
        ctx,
        enriched,
        'Whenever a permanent is turned face up',
        isSelf ? faceUpPermanent : permanent,
      )) {
        continue;
      }

      debug(2, `[triggerEmission] Face-up trigger: ${trigger.cardName} (${triggerType}) - ${trigger.description}`);
      const item = queueGenericTriggeredAbility(ctx, enriched, triggerType, {
        faceUpPermanentId: faceUpId,
        faceUpPermanentName: String(faceUpPermanent?.card?.name || ''),
        faceUpController,
      });
      if (item) queued.push(item);
    }
  }

  return queued;
}

/**
 * Creature becomes monstrous.
 */
export function processMonstrousTriggers(ctx: GameContext, permanent: any): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!permanent?.card || !permanent?.id) return [];

  const detected = detectMonstrousTriggers(permanent.card, permanent);
  if (detected.length === 0) return [];

  const queued: any[] = [];
  const ordered = orderTriggersByAPNAP(
    ctx,
    detected.map((trigger) => ({
      ...trigger,
      controllerId: String(permanent.controller || ''),
    })),
  );

  for (const trigger of ordered) {
    if (!evaluateInterveningIf(ctx, trigger, 'Whenever this creature becomes monstrous', permanent)) {
      continue;
    }
    debug(2, `[triggerEmission] Monstrous trigger: ${trigger.cardName} - ${trigger.description}`);
    const item = queueGenericTriggeredAbility(ctx, trigger, 'became_monstrous', {
      monstrousPermanentId: String(permanent.id || ''),
    });
    if (item) queued.push(item);
  }
  return queued;
}

/**
 * Permanent leaves the battlefield. `leftPermanent` is the snapshot after removal
 * from the battlefield array. Scans remaining battlefield + the leaving permanent
 * for self-LTB text.
 */
export function processLTBTriggers(
  ctx: GameContext,
  leftPermanent: any,
  options?: { cause?: string },
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!leftPermanent) return [];

  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const leftId = String(leftPermanent.id || '');
  const leftController = String(leftPermanent.controller || leftPermanent.owner || '');
  const leftIsToken = leftPermanent.isToken === true;
  const leftTypeLine = String(leftPermanent?.card?.type_line || '').toLowerCase();
  const queued: any[] = [];
  const cause = String(options?.cause || 'leave').trim() || 'leave';

  const candidates = [...battlefield, leftPermanent];
  const seenKeys = new Set<string>();

  for (const permanent of candidates) {
    if (!permanent?.card) continue;
    const key = `${String(permanent.id || '')}:${String(permanent.card?.name || '')}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const detected = detectLTBTriggers(permanent.card, permanent);
    for (const trigger of detected) {
      const triggerType = String(trigger.triggerType || 'ltb');
      const controllerId = String(permanent.controller || leftController || '');
      const isSelf = String(permanent.id || '') === leftId;

      // Match trigger type to the leave event.
      if (triggerType === 'ltb' || triggerType === 'self_enters_or_leaves') {
        if (!isSelf) continue;
      } else if (triggerType === 'another_permanent_ltb' || triggerType === 'another_creature_ltb') {
        if (isSelf) continue;
        if (triggerType === 'another_creature_ltb' && !leftTypeLine.includes('creature')) continue;
      } else if (triggerType === 'controlled_ltb' || triggerType === 'permanent_you_control_ltb') {
        if (leftController !== controllerId) continue;
      } else if (triggerType === 'token_ltb' || triggerType === 'token_you_control_ltb') {
        if (!leftIsToken) continue;
        if (triggerType === 'token_you_control_ltb' && leftController !== controllerId) continue;
      }
      // any_permanent_ltb / enters_or_leaves / phases_out_or_leaves: fire for any leave

      const enriched = {
        ...trigger,
        controllerId,
        permanentId: String(permanent.id || trigger.permanentId || ''),
        _sourceSnapshot: isSelf ? snapshotPermanent(leftPermanent) : undefined,
      };

      if (!evaluateInterveningIf(
        ctx,
        enriched,
        'Whenever a permanent leaves the battlefield',
        isSelf ? leftPermanent : permanent,
      )) {
        continue;
      }

      debug(2, `[triggerEmission] LTB trigger: ${trigger.cardName} (${triggerType}) - ${trigger.description}`);
      const item = queueGenericTriggeredAbility(ctx, enriched, triggerType, {
        leftPermanentId: leftId,
        leftPermanentName: String(leftPermanent?.card?.name || ''),
        leftController,
        leftWasToken: leftIsToken,
        cause,
      });
      if (item) queued.push(item);
    }
  }

  return queued;
}

/**
 * Generic ability-activated detector emission (complements card-name whitelist
 * in triggerAbilityActivatedTriggers).
 */
export function processDetectedAbilityActivatedTriggers(
  ctx: GameContext,
  event: {
    activatedBy: string;
    sourcePermanentId: string;
    isManaAbility: boolean;
    abilityText?: string;
    stackItemId?: string;
    lifePaidForCost?: number;
    isExhaustAbility?: boolean;
  },
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const sourcePermanent = battlefield.find(
    (perm: any) => String(perm?.id || '') === String(event.sourcePermanentId || ''),
  );
  if (!sourcePermanent) return [];

  const queued: any[] = [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const detected = detectAbilityActivatedTriggers(permanent.card, permanent);
    for (const trigger of detected) {
      const triggerType = String(trigger.triggerType || '');
      // Only wire activation-shaped detectors here; exploit/surveil are other events.
      if (
        triggerType !== 'opponent_ability_activated'
        && triggerType !== 'opponent_artifact_ability_activated'
        && triggerType !== 'non_mana_ability_activated'
        && triggerType !== 'exhaust_ability_activated'
        && triggerType !== 'exhaust_ability_next'
      ) {
        continue;
      }
      if (event.isManaAbility) continue;
      const controllerId = String(permanent.controller || '');

      if (
        triggerType === 'exhaust_ability_activated'
        || triggerType === 'exhaust_ability_next'
      ) {
        if (!event.isExhaustAbility || String(event.activatedBy) !== controllerId) continue;
        const enriched = { ...trigger, controllerId };
        const item = queueGenericTriggeredAbility(ctx, enriched, 'ability_activated', {
          activatedBy: String(event.activatedBy),
          sourcePermanentId: String(event.sourcePermanentId),
          isManaAbility: event.isManaAbility,
          isExhaustAbility: true,
          ...(event.abilityText ? { abilityText: event.abilityText } : null),
          ...(event.stackItemId ? { triggeringStackItemId: String(event.stackItemId) } : null),
        });
        if (item) queued.push(item);
        continue;
      }

      if (
        triggerType === 'opponent_ability_activated'
        || triggerType === 'opponent_artifact_ability_activated'
      ) {
        if (String(event.activatedBy) === controllerId) continue;
        if (
          triggerType === 'opponent_artifact_ability_activated'
          && !String(sourcePermanent?.card?.type_line || '').toLowerCase().includes('artifact')
        ) {
          continue;
        }

        const enriched = { ...trigger, controllerId };
        if (!evaluateInterveningIf(
          ctx,
          enriched,
          "Whenever an opponent activates an ability, if it isn't a mana ability",
          permanent,
        )) {
          continue;
        }

        const item = queueGenericTriggeredAbility(ctx, enriched, 'ability_activated', {
          activatedBy: String(event.activatedBy),
          sourcePermanentId: String(event.sourcePermanentId),
          isManaAbility: event.isManaAbility,
          ...(event.abilityText ? { abilityText: event.abilityText } : null),
          ...(event.stackItemId ? { triggeringStackItemId: String(event.stackItemId) } : null),
          ...(event.isExhaustAbility ? { isExhaustAbility: true } : null),
        });
        if (item) queued.push(item);
        continue;
      }

      // Verrak-shaped: whenever YOU activate a non-mana ability, if life was paid...
      if (triggerType === 'non_mana_ability_activated') {
        if (String(event.activatedBy) !== controllerId) continue;
        const lifePaid = Math.max(0, Math.floor(Number(event.lifePaidForCost) || 0));
        if (lifePaid <= 0 && /if life was paid to activate it/i.test(String(trigger.effect || ''))) {
          continue;
        }

        const ok = evaluateInterveningIf(
          ctx,
          { ...trigger, controllerId },
          "Whenever you activate an ability that isn't a mana ability",
          permanent,
          {
            lifeWasPaidToActivateIt: lifePaid > 0,
            lifePaidForCost: lifePaid,
            stackItem: {
              type: 'ability',
              description: String(event.abilityText || ''),
              lifePaidForCost: lifePaid,
            },
          },
        );
        if (!ok) continue;

        let effect = String(trigger.effect || trigger.description || '')
          .replace(/^if life was paid to activate it,\s*/i, '')
          .trim();
        if (/pay that much life again/i.test(effect) && lifePaid > 0) {
          effect = effect.replace(/pay that much life again/gi, `pay ${lifePaid} life again`);
        }

        const item = queueGenericTriggeredAbility(
          ctx,
          {
            ...trigger,
            controllerId,
            effect,
            description: effect,
            mandatory: false,
          },
          'ability_activated',
          {
            activatedBy: String(event.activatedBy),
            sourcePermanentId: String(event.sourcePermanentId),
            isManaAbility: false,
            ...(event.abilityText ? { abilityText: event.abilityText } : null),
            ...(event.stackItemId ? { triggeringStackItemId: String(event.stackItemId) } : null),
            ...(event.isExhaustAbility ? { isExhaustAbility: true } : null),
            lifePaidForCost: lifePaid,
            lifeWasPaidToActivateIt: lifePaid > 0,
          },
        );
        if (item) {
          if (event.stackItemId) {
            (item as any).triggeringStackItemId = String(event.stackItemId);
          }
          queued.push(item);
        }
      }
    }
  }
  return queued;
}

/** Emit the CR 702.189b event only after a Firebending ability resolves. */
export function processDetectedFirebendingResolvedTriggers(
  ctx: GameContext,
  event: { playerId: string; sourcePermanentId?: string; amount?: number },
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const queued: any[] = [];

  for (const permanent of battlefield) {
    const oracle = String(permanent?.card?.oracle_text || '');
    const match = oracle.match(/whenever\s+(?:a|one or more)\s+player(?:s)?\s+firebends?,?\s*([^.]+)/i);
    if (!match) continue;
    const controllerId = String(permanent?.controller || '');
    if (!controllerId) continue;
    const effect = String(match[1] || '').trim();
    const item = queueGenericTriggeredAbility(ctx, {
      permanentId: String(permanent.id || ''),
      cardName: String(permanent?.card?.name || 'Triggered ability'),
      controllerId,
      description: effect,
      effect,
      mandatory: !/\byou may\b/i.test(effect),
    }, 'firebending_resolved', {
      firebendingPlayerId: String(event.playerId),
      ...(event.sourcePermanentId ? { firebendingSourcePermanentId: String(event.sourcePermanentId) } : null),
      ...(typeof event.amount === 'number' ? { firebendingAmount: event.amount } : null),
    });
    if (item) queued.push(item);
  }

  return queued;
}

import type { GameContext } from "./types.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { uid } from "../../utils.js";
import { debug } from "../../../utils/debug.js";
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';

export type AbilityActivatedEvent = {
  activatedBy: PlayerID;
  sourcePermanentId: string;
  isManaAbility: boolean;
  abilityText?: string;
  stackItemId?: string;
  manaFromTreasureSpentKnown?: boolean;
  manaFromTreasureSpent?: boolean;
};

export type AbilityActivatedTriggeredStackItem = {
  id: string;
  type: 'triggered_ability';
  controller: PlayerID;
  source: string;
  permanentId?: string;
  sourceName: string;
  description: string;
  effect: string;
  triggerType: 'ability_activated';
  mandatory: boolean;
  triggeringPlayer: PlayerID;
  triggeringPermanentId?: string;
  activatedAbilityIsManaAbility: boolean;
  triggeringStackItemId?: string;
  sourcePermanentSnapshot?: any;
  card?: any;
  effectData?: Record<string, unknown>;
  requiresTarget?: boolean;
  needsTargetSelection?: boolean;
  targetType?: 'player' | 'creature' | 'permanent';
};

function isOpponent(ctx: GameContext, a: PlayerID, b: PlayerID): boolean {
  if (!a || !b) return false;
  // In multiplayer EDH, "opponent" means any other player.
  return String(a) !== String(b);
}

function sourceHasType(source: any, type: string): boolean {
  const tl = String(source?.card?.type_line || '').toLowerCase();
  return tl.includes(type.toLowerCase());
}

function cloneAbilityActivatedPermanentSnapshot(permanent: any): any {
  if (!permanent || typeof permanent !== 'object') return undefined;
  return {
    ...permanent,
    ...(permanent.card && typeof permanent.card === 'object' ? { card: { ...permanent.card } } : null),
    ...(permanent.counters && typeof permanent.counters === 'object' ? { counters: { ...permanent.counters } } : null),
  };
}

function orderAbilityActivatedTriggersByAPNAP(
  ctx: GameContext,
  triggers: AbilityActivatedTriggeredStackItem[]
): AbilityActivatedTriggeredStackItem[] {
  return orderTriggersByAPNAP(
    ctx,
    triggers.map((item) => ({ controllerId: String(item.controller || ''), item }))
  ).map((entry) => entry.item);
}

function buildTriggeredAbility(
  ctx: GameContext,
  triggerSource: any,
  controller: PlayerID,
  description: string,
  fullOracleForInterveningIf: string,
  e: AbilityActivatedEvent,
  extra?: Partial<AbilityActivatedTriggeredStackItem>
): AbilityActivatedTriggeredStackItem {
  const state: any = ctx.state as any;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const triggerSourceId = String(triggerSource?.id || '');
  const sourcePermanentSnapshot = cloneAbilityActivatedPermanentSnapshot(triggerSource);
  const activatedSourcePermanent = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === String(e.sourcePermanentId || ''));
  const activatedSourcePermanentSnapshot = cloneAbilityActivatedPermanentSnapshot(activatedSourcePermanent);
  const effectData = {
    ...((extra?.effectData && typeof extra.effectData === 'object') ? extra.effectData : {}),
    activatedAbilitySourcePermanentId: String(e.sourcePermanentId || ''),
    ...(e.abilityText ? { activatedAbilityText: e.abilityText } : null),
    ...(activatedSourcePermanentSnapshot ? { activatedSourcePermanentSnapshot } : null),
  };
  const triggerItem: AbilityActivatedTriggeredStackItem = {
    id: uid('trigger'),
    type: 'triggered_ability',
    controller,
    source: triggerSourceId,
    ...(triggerSourceId ? { permanentId: triggerSourceId } : null),
    sourceName: triggerSource?.card?.name || 'Triggered ability',
    description, // effect-only for execution
    effect: fullOracleForInterveningIf, // full line so intervening-if extraction works
    triggerType: 'ability_activated',
    mandatory: false,
    triggeringPlayer: e.activatedBy,
    triggeringPermanentId: String(e.sourcePermanentId || ''),
    activatedAbilityIsManaAbility: e.isManaAbility,
    triggeringStackItemId: e.stackItemId,
    ...(extra || {}),
    ...(triggerSource?.card && typeof triggerSource.card === 'object' ? { card: { ...triggerSource.card } } : null),
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
    effectData,
  };
  return triggerItem;
}

export function serializeAbilityActivatedTriggeredStackItem(triggerItem: AbilityActivatedTriggeredStackItem): Record<string, unknown> {
  return {
    triggerId: triggerItem.id,
    sourceId: triggerItem.source,
    ...(triggerItem.permanentId || triggerItem.source ? { permanentId: triggerItem.permanentId || triggerItem.source } : {}),
    sourceName: triggerItem.sourceName,
    controllerId: triggerItem.controller,
    description: triggerItem.description,
    triggerType: triggerItem.triggerType,
    effect: triggerItem.effect,
    mandatory: triggerItem.mandatory,
    triggeringPlayer: triggerItem.triggeringPlayer,
    triggeringPermanentId: triggerItem.triggeringPermanentId,
    activatedAbilityIsManaAbility: triggerItem.activatedAbilityIsManaAbility,
    triggeringStackItemId: triggerItem.triggeringStackItemId,
    ...(triggerItem.card && typeof triggerItem.card === 'object' ? { card: { ...triggerItem.card } } : {}),
    ...(triggerItem.sourcePermanentSnapshot && typeof triggerItem.sourcePermanentSnapshot === 'object' ? { sourcePermanentSnapshot: triggerItem.sourcePermanentSnapshot } : {}),
    ...(triggerItem.effectData && typeof triggerItem.effectData === 'object' ? { effectData: triggerItem.effectData } : {}),
    ...(triggerItem.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : {}),
    ...(triggerItem.targetType ? { targetType: triggerItem.targetType } : {}),
  };
}

/**
 * Fire triggers that occur when an ability is activated.
 *
 * This is intentionally conservative and currently focuses on the AtomicCards
 * intervening-if family "if it isn't a mana ability".
 */
export function triggerAbilityActivatedTriggers(ctx: GameContext, e: AbilityActivatedEvent): AbilityActivatedTriggeredStackItem[] {
  const state: any = ctx.state as any;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const createdTriggers: AbilityActivatedTriggeredStackItem[] = [];

  if ((ctx as any).isReplaying) return createdTriggers;

  const sourcePermanent = battlefield.find((p) => p && p.id === e.sourcePermanentId);

  if (!sourcePermanent) return createdTriggers;

  for (const permanent of battlefield) {
    if (!permanent?.card?.name) continue;

    const nameLower = String(permanent.card.name).toLowerCase();
    const controller = permanent.controller as PlayerID;

    // Harsh Mentor
    // "Whenever an opponent activates an ability of an artifact, creature, or land on the battlefield,
    // if it isn't a mana ability, Harsh Mentor deals 2 damage to that player."
    if (nameLower === 'harsh mentor') {
      if (!isOpponent(ctx, controller, e.activatedBy)) continue;
      if (e.isManaAbility) continue;
      if (!sourceHasType(sourcePermanent, 'artifact') && !sourceHasType(sourcePermanent, 'creature') && !sourceHasType(sourcePermanent, 'land')) {
        continue;
      }

      const full =
        "Whenever an opponent activates an ability of an artifact, creature, or land on the battlefield, if it isn't a mana ability, Harsh Mentor deals 2 damage to that player.";
      const ok = isInterveningIfSatisfied(ctx as any, String(controller), full, permanent, {
        activatedAbilityIsManaAbility: e.isManaAbility,
        thatPlayerId: String(e.activatedBy),
        referencedPlayerId: String(e.activatedBy),
        theirPlayerId: String(e.activatedBy),
      } as any);
      if (ok === false) continue;

      createdTriggers.push(buildTriggeredAbility(
        ctx,
        permanent,
        controller,
        'Harsh Mentor deals 2 damage to that player.',
        full,
        e,
        {
          mandatory: true,
        }
      ));
      debug(2, `[ability-activated] Harsh Mentor triggered vs ${String(e.activatedBy)} (source=${String(sourcePermanent?.card?.name || e.sourcePermanentId)})`);
      continue;
    }

    // Kurkesh, Onakke Ancient
    // "Whenever you activate an ability of an artifact, if it isn't a mana ability, you may pay {R}. If you do, copy that ability."
    if (nameLower === 'kurkesh, onakke ancient') {
      if (String(controller) !== String(e.activatedBy)) continue;
      if (e.isManaAbility) continue;
      if (!sourceHasType(sourcePermanent, 'artifact')) continue;
      const full =
        "Whenever you activate an ability of an artifact, if it isn't a mana ability, you may pay {R}. If you do, copy that ability.";
      const ok = isInterveningIfSatisfied(ctx as any, String(controller), full, permanent, {
        activatedAbilityIsManaAbility: e.isManaAbility,
      } as any);
      if (ok === false) continue;
      createdTriggers.push(buildTriggeredAbility(ctx, permanent, controller, 'You may pay {R}. If you do, copy that ability.', full, e));
      continue;
    }

    // Rings of Brighthearth
    if (nameLower === 'rings of brighthearth') {
      if (String(controller) !== String(e.activatedBy)) continue;
      if (e.isManaAbility) continue;
      const full =
        "Whenever you activate an ability, if it isn't a mana ability, you may pay {2}. If you do, copy that ability. You may choose new targets for the copy.";
      const ok = isInterveningIfSatisfied(ctx as any, String(controller), full, permanent, {
        activatedAbilityIsManaAbility: e.isManaAbility,
      } as any);
      if (ok === false) continue;
      createdTriggers.push(buildTriggeredAbility(ctx, permanent, controller, 'You may pay {2}. If you do, copy that ability. You may choose new targets for the copy.', full, e));
      continue;
    }

    // Vazi, Keen Negotiator
    // "Whenever an opponent casts a spell or activates an ability, if mana from a Treasure was spent to cast it or activate it,
    // put a +1/+1 counter on target creature, then draw a card."
    if (nameLower === 'vazi, keen negotiator') {
      if (!isOpponent(ctx, controller, e.activatedBy)) continue;

      const full =
        "Whenever an opponent casts a spell or activates an ability, if mana from a Treasure was spent to cast it or activate it, put a +1/+1 counter on target creature, then draw a card.";
      const ok = isInterveningIfSatisfied(ctx as any, String(controller), full, permanent, {
        ...(e.stackItemId ? { triggeringStackItemId: e.stackItemId } : {}),
        ...(typeof e.manaFromTreasureSpentKnown === 'boolean'
          ? { manaFromTreasureSpentKnown: e.manaFromTreasureSpentKnown }
          : {}),
        ...(typeof e.manaFromTreasureSpent === 'boolean'
          ? { manaFromTreasureSpent: e.manaFromTreasureSpent }
          : {}),
      } as any);
      if (ok === false) continue;

      createdTriggers.push(
        buildTriggeredAbility(
          ctx,
          permanent,
          controller,
          'Put a +1/+1 counter on target creature, then draw a card.',
          full,
          e,
          {
            mandatory: true,
            requiresTarget: true,
            targetType: 'creature',
          }
        )
      );
      continue;
    }

    // Illusionist's Bracers / Battlemage's Bracers
    // These are equipment; we approximate by requiring the equipment is attached to the source permanent.
    if (nameLower === "illusionist's bracers" || nameLower === "battlemage's bracers") {
      if (String(controller) !== String(e.activatedBy)) continue;
      if (e.isManaAbility) continue;

      const attachedTo = String((permanent as any).attachedTo || '');
      if (!attachedTo || attachedTo !== String(e.sourcePermanentId)) continue;
      if (!sourceHasType(sourcePermanent, 'creature')) continue;

      const full =
        nameLower === "battlemage's bracers"
          ? "Whenever an ability of equipped creature is activated, if it isn't a mana ability, you may pay {1}. If you do, copy that ability. You may choose new targets for the copy."
          : "Whenever an ability of equipped creature is activated, if it isn't a mana ability, copy that ability. You may choose new targets for the copy.";

      const ok = isInterveningIfSatisfied(ctx as any, String(controller), full, permanent, {
        activatedAbilityIsManaAbility: e.isManaAbility,
      } as any);
      if (ok === false) continue;

      const effectOnly =
        nameLower === "battlemage's bracers"
          ? 'You may pay {1}. If you do, copy that ability. You may choose new targets for the copy.'
          : 'Copy that ability. You may choose new targets for the copy.';

      createdTriggers.push(
        buildTriggeredAbility(ctx, permanent, controller, effectOnly, full, e, {
          mandatory: nameLower !== "battlemage's bracers",
        })
      );
      continue;
    }
  }

  const orderedTriggers = orderAbilityActivatedTriggersByAPNAP(ctx, createdTriggers);
  if (orderedTriggers.length > 0) {
    state.stack = state.stack || [];
    state.stack.push(...orderedTriggers as any[]);
  }

  return orderedTriggers;
}

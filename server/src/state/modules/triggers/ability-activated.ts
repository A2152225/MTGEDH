import type { GameContext } from "./types.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { uid } from "../../utils.js";
import { debug } from "../../../utils/debug.js";
import { isInterveningIfSatisfied } from './intervening-if.js';

export type AbilityActivatedEvent = {
  activatedBy: PlayerID;
  sourcePermanentId: string;
  isManaAbility: boolean;
  abilityText?: string;
  stackItemId?: string;
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

function pushTriggeredAbility(
  ctx: GameContext,
  triggerSource: any,
  controller: PlayerID,
  description: string,
  fullOracleForInterveningIf: string,
  e: AbilityActivatedEvent
): void {
  const state: any = ctx.state as any;
  state.stack = state.stack || [];
  state.stack.push({
    id: uid('trigger'),
    type: 'triggered_ability',
    controller,
    source: triggerSource?.id,
    sourceName: triggerSource?.card?.name || 'Triggered ability',
    description, // effect-only for execution
    effect: fullOracleForInterveningIf, // full line so intervening-if extraction works
    triggerType: 'ability_activated',
    triggeringPlayer: e.activatedBy,
    activatedAbilityIsManaAbility: e.isManaAbility,
    triggeringStackItemId: e.stackItemId,
  } as any);
}

/**
 * Fire triggers that occur when an ability is activated.
 *
 * This is intentionally conservative and currently focuses on the AtomicCards
 * intervening-if family "if it isn't a mana ability".
 */
export function triggerAbilityActivatedTriggers(ctx: GameContext, e: AbilityActivatedEvent): void {
  const state: any = ctx.state as any;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const sourcePermanent = battlefield.find((p) => p && p.id === e.sourcePermanentId);

  if (!sourcePermanent) return;

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

      pushTriggeredAbility(
        ctx,
        permanent,
        controller,
        'Harsh Mentor deals 2 damage to that player.',
        full,
        e
      );
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
      pushTriggeredAbility(ctx, permanent, controller, 'You may pay {R}. If you do, copy that ability.', full, e);
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
      pushTriggeredAbility(ctx, permanent, controller, 'You may pay {2}. If you do, copy that ability. You may choose new targets for the copy.', full, e);
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

      pushTriggeredAbility(ctx, permanent, controller, effectOnly, full, e);
      continue;
    }
  }
}

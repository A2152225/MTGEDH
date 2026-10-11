import { parsePhaseTriggerClause, triggerConditionMatches } from '../../../../../rules-engine/src/triggerCondition/index.js';

/**
 * Whose-turn filters for phase-based triggers.
 *
 * Timing ("your" / "each player's" / "enchanted player's") is independent of
 * whether the *effect* mentions each player. Getters should use this helper
 * instead of ad-hoc oracle includes + controller === activePlayer.
 */

export type PhaseWhoseTurn =
  | 'controller'
  | 'each'
  | 'opponent'
  | 'other'
  | 'enchanted_player'
  | 'enchanted_controller'
  | 'monarch'
  | 'chosen_player'
  | 'exiled_card_owner';

export function listStatePlayerIds(state: any): string[] {
  const players = Array.isArray(state?.players) ? state.players : [];
  return players.map((player: any) => String(player?.id || '').trim()).filter(Boolean);
}

export function resolveAttachedToId(permanent: any): string {
  return String(permanent?.attachedTo || permanent?.enchanting || '').trim();
}

export function resolveEnchantedPlayerId(permanent: any, state?: any): string {
  const attachedTo = resolveAttachedToId(permanent);
  if (!attachedTo) return '';
  const playerIds = listStatePlayerIds(state);
  if (playerIds.includes(attachedTo)) return attachedTo;
  const host = (Array.isArray(state?.battlefield) ? state.battlefield : []).find(
    (entry: any) => String(entry?.id || '').trim() === attachedTo,
  );
  if (host) return String(host.controller || '').trim();
  return attachedTo;
}

export function resolveEnchantedControllerId(permanent: any, state?: any): string {
  const attachedTo = resolveAttachedToId(permanent);
  if (!attachedTo) return '';
  const host = (Array.isArray(state?.battlefield) ? state.battlefield : []).find(
    (entry: any) => String(entry?.id || '').trim() === attachedTo,
  );
  if (host) return String(host.controller || '').trim();
  const playerIds = listStatePlayerIds(state);
  if (playerIds.includes(attachedTo)) return attachedTo;
  return '';
}

export function shouldQueuePhaseTriggerForActivePlayer(params: {
  whose: PhaseWhoseTurn;
  activePlayerId: string;
  controllerId: string;
  sourcePermanent?: any;
  state?: any;
}): boolean {
  const active = String(params.activePlayerId || '').trim();
  const controller = String(params.controllerId || '').trim();
  if (!active) return false;

  const phaseClause = params.whose === 'each'
    ? "at the beginning of each player's upkeep"
    : params.whose === 'controller'
      ? 'at the beginning of your upkeep'
      : params.whose === 'opponent' || params.whose === 'other'
        ? "at the beginning of each opponent's end step"
        : params.whose === 'enchanted_player'
          ? "at the beginning of enchanted player's upkeep"
          : params.whose === 'monarch'
            ? "at the beginning of the monarch's end step"
            : params.whose === 'chosen_player'
              ? "at the beginning of the chosen player's upkeep"
              : '';
  if (phaseClause) {
    const parsed = parsePhaseTriggerClause(phaseClause);
    if (parsed) {
      return triggerConditionMatches(
        parsed,
        { id: 'step', typeLine: '', controllerId: controller },
        { id: 'source', controllerId: controller },
        {
          activePlayerId: active,
          enchantedPlayerId: resolveEnchantedPlayerId(params.sourcePermanent, params.state),
          monarchPlayerId: String(params.state?.monarch || '').trim(),
          chosenPlayerId: String(
            params.sourcePermanent?.chosenPlayer
            || params.sourcePermanent?.chosenPlayerId
            || params.sourcePermanent?.card?.chosenPlayer
            || '',
          ).trim(),
        },
      );
    }
  }

  switch (params.whose) {
    case 'each':
      return true;
    case 'controller':
      return Boolean(controller) && controller === active;
    case 'opponent':
    case 'other':
      return Boolean(controller) && controller !== active;
    case 'enchanted_player': {
      const enchanted = resolveEnchantedPlayerId(params.sourcePermanent, params.state);
      return Boolean(enchanted) && enchanted === active;
    }
    case 'enchanted_controller': {
      const enchantedController = resolveEnchantedControllerId(params.sourcePermanent, params.state);
      return Boolean(enchantedController) && enchantedController === active;
    }
    case 'monarch': {
      const monarch = String(params.state?.monarch || '').trim();
      return Boolean(monarch) && monarch === active;
    }
    case 'chosen_player': {
      const chosen = String(
        params.sourcePermanent?.chosenPlayer
        || params.sourcePermanent?.chosenPlayerId
        || params.sourcePermanent?.card?.chosenPlayer
        || '',
      ).trim();
      return Boolean(chosen) && chosen === active;
    }
    case 'exiled_card_owner': {
      const owner = String(
        params.sourcePermanent?.exiledCardOwner
        || params.sourcePermanent?.linkedExileOwner
        || params.sourcePermanent?.exiledOwner
        || '',
      ).trim();
      return Boolean(owner) && owner === active;
    }
    default:
      return Boolean(controller) && controller === active;
  }
}

export function inferUpkeepWhoseTurn(triggerType: string | undefined): PhaseWhoseTurn {
  switch (String(triggerType || '')) {
    case 'each_upkeep':
    case 'each_player_upkeep':
    case 'each_participant_upkeep':
    case 'next_turn_upkeep':
    case 'each_of_that_player_upkeep':
      return 'each';
    case 'opponent_upkeep':
      return 'opponent';
    case 'each_other_player_upkeep':
      return 'other';
    case 'enchanted_player_upkeep':
    case 'enchanted_player_first_upkeep':
      return 'enchanted_player';
    case 'enchanted_controller_upkeep':
      return 'enchanted_controller';
    case 'chosen_player_upkeep':
      return 'chosen_player';
    case 'exiled_card_owner_upkeep':
      return 'exiled_card_owner';
    default:
      return 'controller';
  }
}

/** Timing clause only — never the effect sentence after the comma. */
export function extractPhaseTimingClause(oracleText: string): string {
  const text = String(oracleText || '');
  const match = text.match(
    /at the beginning of ([^,.\n]+)|at the end of ([^,.\n]+)|at end of ([^,.\n]+)/i,
  );
  if (!match) return text.toLowerCase();
  return String(match[1] || match[2] || match[3] || '').toLowerCase();
}

export function inferEndStepWhoseTurn(
  trigger: { triggersOnOpponentEndStep?: boolean; whoseTurn?: PhaseWhoseTurn },
  oracleText: string,
): PhaseWhoseTurn {
  if (trigger.whoseTurn) return trigger.whoseTurn;
  if (trigger.triggersOnOpponentEndStep) return 'opponent';
  const timing = extractPhaseTimingClause(oracleText);
  if (timing.includes('enchanted opponent') || timing.includes('enchanted player')) {
    return 'enchanted_player';
  }
  if (timing.includes('monarch')) return 'monarch';
  if (timing.includes('each opponent')) return 'opponent';
  if (
    timing.includes("each player's end step")
    || timing.includes('each end step')
    || timing.includes("that turn's end step")
  ) {
    return 'each';
  }
  return 'controller';
}

export function inferDrawStepWhoseTurn(oracleText: string): PhaseWhoseTurn {
  const timing = extractPhaseTimingClause(oracleText);
  if (timing.includes('enchanted player')) return 'enchanted_player';
  if (timing.includes('each opponent')) return 'opponent';
  if (timing.includes("each player's") || timing.includes('each draw step')) return 'each';
  return 'controller';
}

export function inferCombatWhoseTurn(
  trigger: { triggerType?: string },
  oracleText: string,
): PhaseWhoseTurn {
  switch (String(trigger.triggerType || '')) {
    case 'opponent_turn_combat':
      return 'opponent';
    case 'enchanted_opponent_turn_combat':
      return 'enchanted_player';
    case 'each_player_turn_combat':
    case 'next_combat_phase':
    case 'that_combat':
    case 'combat_this_turn':
      return 'each';
    case 'your_combat_step':
      return 'controller';
    default:
      break;
  }
  const timing = extractPhaseTimingClause(oracleText);
  if (timing.includes('enchanted opponent') || timing.includes('enchanted player')) {
    return 'enchanted_player';
  }
  if (timing.includes('each opponent')) return 'opponent';
  if (timing.includes('on your turn') || timing.includes('your combat')) return 'controller';
  if (
    timing.includes('each combat')
    || timing.includes("each player's")
    || timing.includes('every combat')
  ) {
    return 'each';
  }
  return 'controller';
}

export function inferEndCombatWhoseTurn(
  trigger: { triggerType?: string },
  oracleText: string,
): PhaseWhoseTurn {
  if (trigger.triggerType === 'your_turn_end_combat') return 'controller';
  if (trigger.triggerType === 'each_combat_end') return 'each';
  const timing = extractPhaseTimingClause(oracleText);
  if (timing.includes('on your turn') || timing.includes('your combat')) return 'controller';
  if (timing.includes('each opponent')) return 'opponent';
  if (timing.includes('each combat')) return 'each';
  return 'each';
}

export function inferMainPhaseWhoseTurn(oracleText: string): PhaseWhoseTurn {
  const timing = extractPhaseTimingClause(oracleText);
  if (timing.includes('enchanted player')) return 'enchanted_player';
  if (timing.includes("each player's") || timing.includes('each postcombat main')) return 'each';
  return 'controller';
}

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { lifeThresholdInterveningIfFails } from './triggers/lifeThresholdStateTriggers.js';

export function trySkipTriggeredAbilityForUnmetInterveningIf(
  ctx: GameContext,
  item: any,
  options: {
    triggerController: PlayerID | string;
    description: string;
    triggerType?: string;
    sourceName: string;
    bumpSeq: () => void;
  },
): boolean {
  try {
    if (lifeThresholdInterveningIfFails(ctx, item)) {
      debug(2, `[resolveTopOfStack] life-threshold intervening-if no longer satisfied; skipping ${options.sourceName}`);
      options.bumpSeq();
      return true;
    }
    const desc = String(options.description || '').trim();
    const triggerType = options.triggerType;

    const rawEffect = String((item as any).effect || '').trim();
    const maybeStripped = desc.startsWith('Landfall - ')
      ? desc.slice('Landfall - '.length).trim()
      : desc;

    let textForEval = rawEffect || maybeStripped;
    const hasTriggerPrefix = /^(?:when|whenever|at)\b/i.test(textForEval);
    if (!hasTriggerPrefix) {
      if (triggerType === 'deals_damage') {
        textForEval = `Whenever ~ deals damage to a player, ${textForEval}`;
      } else if (triggerType === 'deals_combat_damage') {
        textForEval = `Whenever ~ deals combat damage to a player, ${textForEval}`;
      } else if (triggerType === 'tap') {
        textForEval = `Whenever ~ becomes tapped, ${textForEval}`;
      } else if (triggerType === 'attacks' || triggerType === 'attack' || triggerType === 'myriad') {
        textForEval = `Whenever ~ attacks, ${textForEval}`;
      } else if (triggerType === 'blocks') {
        textForEval = `Whenever ~ blocks, ${textForEval}`;
      } else if (triggerType === 'upkeep') {
        textForEval = `At the beginning of upkeep, ${textForEval}`;
      } else if (triggerType === 'draw_step') {
        textForEval = `At the beginning of draw step, ${textForEval}`;
      } else if (triggerType === 'precombat_main') {
        textForEval = `At the beginning of your precombat main phase, ${textForEval}`;
      } else if (triggerType === 'begin_combat') {
        textForEval = `At the beginning of combat, ${textForEval}`;
      } else if (triggerType === 'end_combat') {
        textForEval = `At end of combat, ${textForEval}`;
      } else if (triggerType === 'end_step') {
        textForEval = `At the beginning of end step, ${textForEval}`;
      } else if (triggerType === 'landfall') {
        textForEval = `Whenever a land enters the battlefield under your control, ${textForEval}`;
      } else if (triggerType === 'opponent_loses_life' || triggerType === 'player_loses_life' || triggerType === 'you_lose_life') {
        textForEval = `Whenever a player loses life, ${textForEval}`;
      } else if (triggerType === 'opponent_pays_life' || triggerType === 'player_pays_life' || triggerType === 'you_pay_life') {
        textForEval = `Whenever a player pays life, ${textForEval}`;
      } else if (triggerType === 'you_sacrifice' || triggerType === 'opponent_sacrifices' || triggerType === 'player_sacrifices') {
        textForEval = `Whenever a player sacrifices a permanent, ${textForEval}`;
      } else if (triggerType === 'counters_removed_from_self' || triggerType === 'counters_removed_from_permanent_you_control') {
        textForEval = `Whenever one or more counters are removed from a permanent, ${textForEval}`;
      } else if (triggerType === 'counters_put_on_creature_you_control' || triggerType === 'counters_put_on_permanent_you_control') {
        textForEval = `Whenever one or more counters are put on a permanent, ${textForEval}`;
      } else if (triggerType === 'library_shuffle') {
        textForEval = `Whenever a player shuffles their library, ${textForEval}`;
      } else if (triggerType === 'token_created') {
        textForEval = `Whenever you create a token, ${textForEval}`;
      } else if (triggerType === 'card_put_into_graveyard' || triggerType === 'card_left_graveyard' || triggerType === 'creature_exiled_from_battlefield' || triggerType === 'permanent_exiled_from_battlefield') {
        textForEval = `Whenever a card changes zones, ${textForEval}`;
      } else if (triggerType === 'opponent_draws' || triggerType === 'player_draws' || triggerType === 'you_draw') {
        textForEval = `Whenever a player draws a card, ${textForEval}`;
      } else if (triggerType === 'opponent_discards' || triggerType === 'player_discards' || triggerType === 'you_discard') {
        textForEval = `Whenever a player discards a card, ${textForEval}`;
      } else if (triggerType === 'player_mills' || triggerType === 'opponent_mills' || triggerType === 'you_mill') {
        textForEval = `Whenever a player mills a card, ${textForEval}`;
      } else if (typeof triggerType === 'string' && triggerType.includes('etb')) {
        textForEval = `When ~ enters the battlefield, ${textForEval}`;
      }
    }

    const thatPlayerId = String(
      (item as any).defendingPlayer ||
      (item as any).targetPlayer ||
      (item as any).triggeringPlayer ||
      '',
    );

    const needsThatPlayerRef = /\bthat player\b/i.test(textForEval);
    const needsTheirTurnRef = /\btheir\s+turn\b/i.test(textForEval) || /\bthat player's\s+turn\b/i.test(textForEval);
    const needsManaAbilityRef = /\bmana ability\b/i.test(textForEval);
    const needsSingleTargetRef = /\bsingle\s+target\b/i.test(textForEval) || /\btargets?\s+only\s+a\s+single\b/i.test(textForEval);
    const needsCardTypeShareRef = /\bshares\s+a\s+card\s+type\s+with\s+the\s+exiled\s+card\b/i.test(textForEval);
    const needsDamageSourceRefs = /\bany\s+of\s+that\s+damage\s+was\s+dealt\s+by\s+a\s+warrior\b/i.test(textForEval);
    const activatedAbilityIsManaAbility = (item as any).activatedAbilityIsManaAbility;
    const triggeringStackItemId = (item as any).triggeringStackItemId;

    const damageSourcePermanentIds = Array.isArray((item as any).damageSourcePermanentIds)
      ? (item as any).damageSourcePermanentIds
      : undefined;
    const damageIncludedWarriorSource = (item as any).damageIncludedWarriorSource;
    const wantsDamageSourceRefs =
      needsDamageSourceRefs ||
      Array.isArray(damageSourcePermanentIds) ||
      typeof damageIncludedWarriorSource === 'boolean';

    const battlefield = (ctx as any).state?.battlefield || [];
    const sourcePerm = battlefield.find((p: any) => p?.id === (item as any).source);
    const interveningSubjectPermanentId = String((item as any)?.interveningIfSubjectPermanentId || '').trim();
    const interveningSubjectPermanent = interveningSubjectPermanentId
      ? battlefield.find((p: any) => String(p?.id || '') === interveningSubjectPermanentId)
      : null;
    const interveningSubjectSnapshot = (item as any)?.interveningIfSubjectSnapshot && typeof (item as any).interveningIfSubjectSnapshot === 'object'
      ? (item as any).interveningIfSubjectSnapshot
      : null;
    const sourcePermanentForInterveningIf = interveningSubjectPermanent || interveningSubjectSnapshot || sourcePerm;
    // Always bind the resolving stack item so cast-time ledgers (wasKicked /
    // paidKickerCosts / timesKicked) are visible to intervening-if evaluators.
    const refs: Record<string, unknown> = {
      stackItem: item,
      card: (item as any)?.card,
      wasKicked: (item as any)?.wasKicked ?? (item as any)?.card?.wasKicked,
      kickerPaidCount: (item as any)?.kickerPaidCount ?? (item as any)?.card?.kickerPaidCount,
      timesKicked: (item as any)?.timesKicked ?? (item as any)?.card?.timesKicked,
      paidKickerCosts: (item as any)?.paidKickerCosts ?? (item as any)?.card?.paidKickerCosts,
    };
    if (thatPlayerId && (needsThatPlayerRef || needsTheirTurnRef)) {
      refs.thatPlayerId = thatPlayerId;
      refs.referencedPlayerId = thatPlayerId;
      refs.theirPlayerId = thatPlayerId;
    }
    if (typeof activatedAbilityIsManaAbility === 'boolean') {
      refs.activatedAbilityIsManaAbility = activatedAbilityIsManaAbility;
    }
    if ((needsSingleTargetRef || needsCardTypeShareRef) && triggeringStackItemId) {
      refs.triggeringStackItemId = String(triggeringStackItemId);
    }
    if (wantsDamageSourceRefs && Array.isArray(damageSourcePermanentIds)) {
      refs.damageSourcePermanentIds = damageSourcePermanentIds;
      refs.damageSourceCreatureIds = damageSourcePermanentIds;
      refs.damageSourceIds = damageSourcePermanentIds;
    }
    if (wantsDamageSourceRefs && typeof damageIncludedWarriorSource === 'boolean') {
      refs.damageIncludedWarriorSource = damageIncludedWarriorSource;
    }
    const satisfied = isInterveningIfSatisfied(
      ctx as any,
      String(options.triggerController),
      textForEval,
      sourcePermanentForInterveningIf,
      refs as any,
    );
    if (satisfied === false) {
      debug(2, `[resolveTopOfStack] Intervening-if no longer satisfied; skipping resolution for ${options.sourceName}: ${textForEval}`);
      options.bumpSeq();
      return true;
    }
  } catch {
    // If evaluation fails, be conservative and continue.
  }

  return false;
}

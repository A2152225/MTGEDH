/**
 * Trigger-condition qualifiers: the event-specific extra checks a parsed condition
 * carries beyond its subject alternatives. Used by triggerConditionMatches (match.ts).
 */

import type { TriggerConditionIR, TriggerMatchContext, TriggerMatchPermanent, TriggerMatchSource } from './types.js';
import { subjectFilterMatches } from './matchSubjectFilter.js';

export function qualifiersMatch(
  condition: TriggerConditionIR,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context: TriggerMatchContext | undefined,
): boolean {
  if (condition.castFromZone) {
    const zone = String(context?.castFromZone || '').trim().toLowerCase();
    // Fail closed: an unknown zone never satisfies "from anywhere other than your hand"
    // or "from exile/graveyard/library". Only "from your hand" tolerates a missing zone,
    // because casts default to the hand.
    if (condition.castFromZone === 'not_hand') {
      if (!zone || zone === 'hand') return false;
    } else if (condition.castFromZone === 'hand') {
      if (zone && zone !== 'hand') return false;
    } else if (condition.castFromZone === 'not_exile') {
      if (!zone || zone === 'exile') return false;
    } else if (zone !== condition.castFromZone) {
      return false;
    }
  }

  if (condition.ordinal === 'first' && context?.spellOrdinal !== 1) return false;
  if (condition.ordinal === 'second' && context?.spellOrdinal !== 2) return false;
  if (condition.ordinal === 'third' && context?.spellOrdinal !== 3) return false;
  if (condition.ordinal === 'fourth' && context?.spellOrdinal !== 4) return false;
  if (condition.ordinal === 'fifth' && context?.spellOrdinal !== 5) return false;
  if (condition.ordinal === 'twelfth' && context?.spellOrdinal !== 12) return false;
  if (condition.excludeFirstSpellEachTurn) {
    const isCopy = Boolean(context?.isSpellCopy);
    if (!(condition.orSpellCopy && isCopy) && context?.spellOrdinal === 1) return false;
  }
  if (condition.requiresChosenName) {
    const chosen = String(context?.chosenCardName || source.chosenCardName || '').trim().toLowerCase();
    const spellName = String(context?.spellName || '').trim().toLowerCase();
    if (!chosen || !spellName || chosen !== spellName) return false;
  }
  if (condition.chosenName && !condition.requiresChosenName) {
    const chosen = String(context?.chosenCardName || source.chosenCardName || '').trim().toLowerCase();
    const spellName = String(context?.spellName || '').trim().toLowerCase();
    if (!chosen || !spellName || chosen !== spellName) return false;
  }
  if (condition.chosenManaValue && !condition.chosenPowerOrToughness) {
    const chosen = Number(context?.chosenManaValue ?? (source as any).chosenManaValue);
    const mv = Number(context?.spellManaValue);
    if (!Number.isFinite(chosen) || !Number.isFinite(mv) || chosen !== mv) return false;
  }

  if (condition.targets === 'self' || condition.targets === 'self_only') {
    const ids = context?.targetPermanentIds;
    if (!ids || !ids.map(String).includes(String(source.id || ''))) return false;
    if (condition.targets === 'self_only' && ids.length !== 1) return false;
  } else if (condition.targets === 'permanent') {
    const permanents = context?.targetPermanents || [];
    const hit = permanents.some((t) => /\b(artifact|battle|creature|enchantment|land|planeswalker)\b/i.test(String(t?.typeLine || '')));
    if (!hit && !(context?.targetPermanentIds && context.targetPermanentIds.length > 0)) return false;
  } else if (condition.targets === 'creature' || condition.targets === 'creature_you_control' || condition.targets === 'creature_you_dont_control' || condition.targets === 'single_creature_you_control' || condition.targets === 'creature_or_vehicle_you_control') {
    const sourceController = String(source.controllerId || '').trim();
    const permanents = context?.targetPermanents || [];
    const hit = permanents.some((t) => {
      if (condition.targets === 'creature_or_vehicle_you_control') { if (!/\b(creature|vehicle)\b/i.test(String(t?.typeLine || ''))) return false; } else if (!/\bcreature\b/i.test(String(t?.typeLine || ''))) return false;
      if (condition.targets === 'creature') return true;
      if (!sourceController) return false;
      const ctrl = String(t?.controllerId || '');
      if (condition.targets === 'creature_you_control' || condition.targets === 'single_creature_you_control' || condition.targets === 'creature_or_vehicle_you_control') return ctrl === sourceController;
      if (condition.targets === 'creature_you_dont_control') return ctrl !== sourceController;
      return false;
    });
    if (!hit) return false;
    if (condition.targets === 'single_creature_you_control' && (context?.targetPermanentIds || []).length !== 1) return false;
  } else if (condition.targets === 'you_or_creature_you_control') {
    const sourceController = String(source.controllerId || '').trim();
    const targetController = String(context?.targetControllerId || '').trim();
    const creatureHit = (context?.targetPermanents || []).some((t) => /\bcreature\b/i.test(String(t?.typeLine || ''))
      && Boolean(sourceController) && String(t?.controllerId || '') === sourceController);
    const youHit = Boolean(sourceController) && targetController === sourceController && Boolean(context?.subjectIsPlayer || context?.targetIsPlayer);
    if (!creatureHit && !youHit && !(targetController === sourceController)) return false;
  } else if (condition.targets === 'opponent_or_creature_opponent_controls') {
    const sourceController = String(source.controllerId || '').trim();
    const targetController = String(context?.targetControllerId || '').trim();
    const creatureHit = (context?.targetPermanents || []).some((t) => /\bcreature\b/i.test(String(t?.typeLine || ''))
      && Boolean(sourceController) && String(t?.controllerId || '') !== sourceController);
    const oppHit = Boolean(sourceController) && targetController && targetController !== sourceController;
    if (!creatureHit && !oppHit) return false;
  } else if (condition.targets === 'artifact_or_land') {
    const hit = (context?.targetPermanents || []).some((t) => /\b(artifact|land)\b/i.test(String(t?.typeLine || '')));
    if (!hit) return false;
  } else if (condition.targets === 'single_creature_other') {
    const ids = context?.targetPermanentIds || [];
    const permanents = context?.targetPermanents || [];
    if (ids.length !== 1) return false;
    const only = permanents[0];
    if (!only || !/\bcreature\b/i.test(String(only.typeLine || ''))) return false;
    if (String(ids[0]) === String(source.id || '')) return false;
  } else if (condition.targets) {
    const targetController = String(context?.targetControllerId || '').trim();
    const sourceController = String(source.controllerId || '').trim();
    if (!targetController || !sourceController) return false;
    if (condition.targets === 'you' && targetController !== sourceController) return false;
    if (condition.targets === 'opponent' && targetController === sourceController) return false;
  }
  if (condition.abilityWord) {
    if (String(context?.abilityWord || '').trim().toLowerCase() !== String(condition.abilityWord).toLowerCase()) return false;
  }
  if (condition.notTapCost && context?.notTapCost !== true) return false;

  if (condition.requiresSaddled && !source.saddled) return false;
  if (condition.requiresUntapped && source.tapped !== false) return false;
  if (condition.legacyRuntimeOnly) return false;
  // Parent-scheduled delayed / reflexive riders: IR owns the parse, permanent detectors must not fire them.
  if (condition.delayedNextTurn || condition.nextSpellThisTurn || condition.thatSpell || condition.delayedRider || condition.reflexiveActor || condition.event === 'reflexive_do') return false;
  if (condition.event === 'attacks_alone' && Number(context?.attackerCount) !== 1) return false;
  if (condition.minOtherAttackers != null) {
    const attackers = Number(context?.attackerCount);
    if (!Number.isFinite(attackers) || attackers < condition.minOtherAttackers + 1) return false;
  }
  if (condition.targetedBy) {
    const by = String(context?.targetingControllerId || '').trim();
    const kind = context?.targetingKind;
    const sourceController = String(source.controllerId || '').trim();
    if (!by || !kind) return false;
    if (condition.targetedBy.kind !== 'spell_or_ability' && condition.targetedBy.kind !== kind) return false;
    if (condition.targetedBy.controller === 'you' && by !== sourceController) return false;
    if (condition.targetedBy.controller === 'not_you' && by === sourceController) return false;
  }
  if (condition.damageRecipient && condition.damageRecipient !== 'any') {
    const recipientPlayer = String(context?.damageRecipientPlayerId || '').trim();
    if (condition.damageRecipient === 'creature' && !context?.damageRecipientIsCreature) return false;
    if (condition.damageRecipient === 'player' && !recipientPlayer) return false;
    if (condition.damageRecipient === 'opponent' && (!recipientPlayer || recipientPlayer === String(source.controllerId || '').trim())) return false;
    if (condition.damageRecipient === 'planeswalker') {
      if (!/\bplaneswalker\b/i.test(String(context?.damagedTypeLine || ''))) return false;
    }
    if (condition.damageRecipient === 'player_or_planeswalker') {
      const pw = /\bplaneswalker\b/i.test(String(context?.damagedTypeLine || ''));
      if (!recipientPlayer && !pw) return false;
    }
    if (condition.damageRecipient === 'you' && recipientPlayer !== String(source.controllerId || '').trim()) return false;
    if (condition.damageRecipient === 'source' && !context?.damageRecipientIsSource) return false;
    if (condition.damageRecipient === 'enchanted_planeswalker') {
      if (!/\bplaneswalker\b/i.test(String(context?.damagedTypeLine || '')) || !context?.damageRecipientIsEnchanted) return false;
    }
    if (condition.damageRecipient === 'creature_or_opponent') {
      const opp = recipientPlayer && recipientPlayer !== String(source.controllerId || '').trim();
      if (!context?.damageRecipientIsCreature && !opp) return false;
    }
    if (condition.damageRecipient === 'blocking_creature' && context?.damageRecipientIsBlocking !== true) return false;
    if (condition.damageRecipient === 'you_or_permanent_you_control' || condition.damageRecipient === 'permanent_you_control') {
      const you = String(source.controllerId || '').trim();
      const recipientPlayer = String(context?.damageRecipientPlayerId || '').trim();
      const permCtrl = String((context as any)?.damagedPermanentControllerId || '').trim();
      const toYou = Boolean(recipientPlayer && you && recipientPlayer === you);
      const toYourPerm = Boolean(permCtrl && you && permCtrl === you);
      if (condition.damageRecipient === 'permanent_you_control') {
        if (!toYourPerm) return false;
      } else if (!toYou && !toYourPerm) return false;
    }
  }
  if (condition.attackedPlayer === 'you') {
    const attacked = String(context?.attackedPlayerId || '').trim();
    if (!attacked || attacked !== String(source.controllerId || '').trim()) return false;
  } else if (condition.attackedPlayer === 'enchanted') {
    const attacked = String(context?.attackedPlayerId || '').trim();
    const enchanted = String(context?.enchantedPlayerId || '').trim();
    if (!attacked || !enchanted || attacked !== enchanted) return false;
  } else if (condition.attackedPlayer === 'any') {
    const attacked = String(context?.attackedPlayerId || '').trim();
    if (!attacked) return false;
  } else if (condition.attackedPlayer === 'opponent') {
    const attacked = String(context?.attackedPlayerId || '').trim();
    const src = String(source.controllerId || '').trim();
    if (!attacked || !src || attacked === src) return false;
  }
  if (condition.classLevel != null && Number(context?.classLevel) !== condition.classLevel) return false;
  if (condition.minBlockers != null) {
    const n = Number(context?.blockerCount);
    if (!Number.isFinite(n) || n < condition.minBlockers) return false;
  }
  if (condition.blockPartnerIsSource) {
    const partnerId = String((context as any)?.blockPartner?.id || '').trim();
    const sourceId = String(source.id || '').trim();
    if (!partnerId || !sourceId || partnerId !== sourceId) return false;
  }
  if (condition.blockPartnerDealtDamageThisTurn && !context?.blockPartnerDealtDamageThisTurn) return false;
  if (condition.foughtThisWay && !context?.foughtThisWay) return false;
  if (condition.requiresOpponentControlsNamed) {
    const names = (context?.opponentControlsNamed || []).map((n) => String(n).toLowerCase());
    if (!names.includes(String(condition.requiresOpponentControlsNamed).toLowerCase())) return false;
  }
  if (condition.blockPartner) {
    const partner = context?.blockPartner;
    if (!partner || !subjectFilterMatches(condition.blockPartner, partner, source, context)) return false;
  }

  if (condition.duringCombat && context?.inCombat === false) return false;
  if (condition.attachedToSource) {
    const host = String(context?.attachedToId || '').trim();
    const sourceId = String(source.id || '').trim();
    if (!host || !sourceId || host !== sourceId) return false;
  }

  if (condition.whoseTurn) {
    const active = String(context?.activePlayerId || '').trim();
    const sourceController = String(source.controllerId || '').trim();
    if (!active) return false;
    if (condition.whoseTurn === 'you' && active !== sourceController) return false;
    if (condition.whoseTurn === 'each_opponent' && (!sourceController || active === sourceController)) return false;
    if (condition.whoseTurn === 'each_other_player' && (!sourceController || active === sourceController)) return false;
    if (condition.whoseTurn === 'enchanted_player' && active !== String(context?.enchantedPlayerId || '').trim()) return false;
    if (condition.whoseTurn === 'monarch' && active !== String(context?.monarchPlayerId || '').trim()) return false;
    if (condition.whoseTurn === 'chosen_player' && active !== String(context?.chosenPlayerId || '').trim()) return false;
    if (condition.whoseTurn === 'enchanted_controller' && active !== String(context?.enchantedControllerId || '').trim()) return false;
    if (condition.whoseTurn === 'exiled_card_owner' && active !== String(context?.exiledCardOwnerId || '').trim()) return false;
    if (condition.whoseTurn === 'that_player') {
      const thatPlayer = String(context?.thatPlayerId || context?.referencedPlayerId || '').trim();
      if (!thatPlayer || active !== thatPlayer) return false;
    }
  }

  if (condition.fromZone && condition.fromZone !== 'anywhere') {
    const fromZone = String(context?.fromZone || '').trim().toLowerCase();
    if (condition.fromZone === 'not_hand') {
      if (!fromZone || fromZone === 'hand') return false;
    } else if (condition.fromZone === 'battlefield_or_graveyard') {
      if (fromZone !== 'battlefield' && fromZone !== 'graveyard') return false;
    } else if (condition.fromZone === 'library_or_graveyard') {
      if (fromZone !== 'library' && fromZone !== 'graveyard') return false;
    } else if (condition.fromZone === 'not_battlefield') {
      if (!fromZone || fromZone === 'battlefield') return false;
    } else if (condition.fromZone === 'not_graveyard_or_exile') {
      if (fromZone === 'graveyard' || fromZone === 'exile') return false;
    } else if (condition.fromZone === 'hand_or_library') {
      if (fromZone !== 'hand' && fromZone !== 'library') return false;
    } else if (condition.fromZone === 'hand_or_battlefield') {
      if (fromZone !== 'hand' && fromZone !== 'battlefield') return false;
      const sourceController = String(source.controllerId || '').trim();
      if (fromZone === 'hand') {
        const zoneOwnerId = String(context?.zoneOwnerId || '').trim();
        if (condition.zoneOwner === 'you' && (!zoneOwnerId || zoneOwnerId !== sourceController)) return false;
      } else if (condition.causedByYou) {
        const exiler = String((context as any)?.exileControllerId || context?.targetingControllerId || '').trim();
        if (!exiler || !sourceController || exiler !== sourceController) return false;
      }
    } else if (fromZone !== condition.fromZone) {
      return false;
    }
  }

  if (condition.damageKind === 'combat' && String(context?.damageKind || '').trim().toLowerCase() !== 'combat') return false;
  if (condition.damageKind === 'noncombat' && String(context?.damageKind || '').trim().toLowerCase() === 'combat') return false;
  if (condition.requiresExcess && !context?.excessDamage) return false;
  if (condition.resolveOrdinal != null) {
    const n = Number(context?.abilityResolveCount ?? context?.rollIndexThisTurn);
    if (!Number.isFinite(n) || n !== condition.resolveOrdinal) return false;
  }
  if (condition.manaValueLessThanResult) {
    const mv = Number(context?.revealedManaValue ?? context?.spellManaValue);
    const result = Number(context?.rollResult);
    if (!Number.isFinite(mv) || !Number.isFinite(result) || !(mv < result)) return false;
  }
  if (condition.powerBecomes != null) {
    if (Number(context?.subjectPower) !== condition.powerBecomes) return false;
  }
  if (condition.minTotalPower != null) {
    const p = Number(context?.totalAttackerPower);
    if (!Number.isFinite(p) || p < condition.minTotalPower) return false;
  }
  if (condition.minDamageAmount != null && context?.damageAmount != null && String(context.damageAmount) !== '') {
    const d = Number(context.damageAmount);
    if (!Number.isFinite(d)) return false;
    if (condition.exactDamage) {
      if (d !== condition.minDamageAmount) return false;
    } else if (d < condition.minDamageAmount) return false;
  } else if (condition.minDamageAmount != null && !condition.exactDamage) {
    const d = Number(context?.damageAmount);
    if (!Number.isFinite(d) || d < condition.minDamageAmount) return false;
  }
  if (condition.naturalRoll != null && Number(context?.naturalRoll) !== condition.naturalRoll) return false;
  if (condition.losesGame === 'not_you') {
    const loser = String((context as any)?.loserPlayerId || subject.controllerId || '').trim();
    const you = String(source.controllerId || '').trim();
    if (!loser || !you || loser === you) return false;
  }
  if (condition.lifeMaximum != null) {
    const life = Number(context?.playerLife);
    if (!Number.isFinite(life) || life > condition.lifeMaximum) return false;
  }
  if (condition.lifeMinimum != null) {
    const life = Number(context?.playerLife);
    if (!Number.isFinite(life) || life < condition.lifeMinimum) return false;
  }
  if (condition.hasKeyword) {
    const kws = ((source as any).keywords || []).map((k: any) => String(k).toLowerCase());
    if (!kws.includes(String(condition.hasKeyword).toLowerCase())) return false;
  }
  if (condition.minAttackers != null) {
    const n = Number(context?.attackerCount);
    if (!Number.isFinite(n) || n < condition.minAttackers) return false;
  }
  if (condition.spellNotOwned) {
    const owner = String(context?.spellOwnerId || '').trim();
    const ctrl = String((context as any)?.controllerId || '').trim();
    if (!owner || !ctrl || owner === ctrl) return false;
  }
  if (condition.kickedSpell) {
    if (!(context as any)?.kicked) return false;
  }
  if (condition.fromYou) {
    const prev = String(context?.previousControllerId || '').trim();
    const srcCtrl = String(source.controllerId || '').trim();
    if (!prev || !srcCtrl || prev !== srcCtrl) return false;
  }
  if (condition.attackDifferentPlayers) {
    const ids = context?.attackedPlayerIds || [];
    if (new Set(ids.map(String)).size < 2) return false;
  }
  if (condition.thisWay && !(context as any)?.thisWay) return false;
      if (condition.dealtDamageBySource && !context?.dealtDamageBySource) return false;
    if (condition.manaValueEqualsChargeCounters) {
    const mv = Number(context?.spellManaValue);
    const cc = Number(context?.chargeCountersOnSource);
    if (!Number.isFinite(mv) || !Number.isFinite(cc) || mv !== cc) return false;
  }
  if (condition.manaValueEqualsSourceCounter) {
    const mv = Number(context?.spellManaValue);
    const wanted = condition.manaValueEqualsSourceCounter.toLowerCase();
    const counters = context?.sourceCounters;
    let found = false;
    let count = 0;
    if (counters && typeof counters === 'object') {
      for (const [key, value] of Object.entries(counters)) {
        if (key.toLowerCase() === wanted) {
          found = true;
          count = Number(value) || 0;
          break;
        }
      }
    }
    if (!found || !Number.isFinite(mv) || mv !== count) return false;
  }
  if (condition.teamworkCast && context?.teamworkWasPaid !== true) return false;
  if (condition.damageEqualsRecipientToughness) {
    const amount = Number(context?.damageAmount);
    const toughness = Number(context?.damagedToughness);
    if (!Number.isFinite(amount) || !Number.isFinite(toughness) || amount !== toughness) return false;
  }
  if (condition.scryToBottom && !(Number(context?.scryBottomCount) > 0)) return false;
  if (condition.damageSourceIsSpell && context?.damageSourceIsSpell !== true) return false;
  if (condition.requiresChosenDrawnName) {
    const chosen = String(source.chosenCardName || context?.chosenCardName || '').trim().toLowerCase();
    const drawn = String(context?.drawnCardName || '').trim().toLowerCase();
    if (!chosen || !drawn || chosen !== drawn) return false;
  }
  if (condition.damagedPlayerMissingCounter) {
    const counters = context?.damagedPlayerCounters;
    if (!counters || typeof counters !== 'object') return false;
    const wanted = condition.damagedPlayerMissingCounter.toLowerCase();
    for (const [key, value] of Object.entries(counters)) {
      if (key.toLowerCase() === wanted && (Number(value) || 0) > 0) return false;
    }
  }
  if (condition.withoutBeingPlayed && !context?.withoutBeingPlayed) return false;
  if (condition.upkeepOrdinal) {
    const want = condition.upkeepOrdinal === 'first' ? 1 : condition.upkeepOrdinal === 'second' ? 2 : Number(condition.upkeepOrdinal);
    const got = context?.upkeepOrdinal === 'first' ? 1 : context?.upkeepOrdinal === 'second' ? 2 : Number(context?.upkeepOrdinal);
    if (!Number.isFinite(want) || got !== want) return false;
  }
  if (condition.noSharedCreatureTypeWithBattlefieldOrGraveyard) {
    if (context?.sharesCreatureTypeWithBattlefield || context?.sharesCreatureTypeWithGraveyard) return false;
  }
  if (condition.sharesColorOrManaValueWithExiled) {
    const colors = (context?.exiledCardColors || []).map(String);
    const spellColors = (context?.spellColors || []).map(String);
    const colorHit = colors.some((c) => spellColors.map((x: string) => x.toLowerCase()).includes(String(c).toLowerCase()));
    const mvHit = Number(context?.spellManaValue) === Number(context?.exiledCardManaValue) && Number.isFinite(Number(context?.exiledCardManaValue));
    if (!colorHit && !mvHit) return false;
  }
  if (condition.sameNameAsExiledWithSource) {
    const names = (context?.exiledCardNames || []).map((n) => String(n).toLowerCase());
    const spellName = String(context?.spellName || '').toLowerCase();
    if (!spellName || !names.includes(spellName)) return false;
  }
  if (condition.lifeGainCausedByWhiteInstantOrSorcery && !context?.lifeGainFromWhiteInstantOrSorcery) return false;
  if (condition.abilitySourceNamed) {
    const got = String(context?.abilitySourceName || '').toLowerCase();
    if (!got || got !== String(condition.abilitySourceNamed).toLowerCase()) return false;
  }
  if (condition.abilitySourceType) {
    const tl = String(context?.abilitySourceTypeLine || '');
    if (!new RegExp('\\b' + condition.abilitySourceType + '\\b', 'i').test(tl)) return false;
  }
  if (condition.linkedWithSource && !context?.linkedToSource) return false;
  if (condition.putOntoBattlefieldWithSource && !context?.linkedToSource) {
    const by = String(context?.enteredBySourceId || '');
    if (!by || by !== String(source.id || '')) return false;
  }
  if (condition.whileExiled && !(context as any)?.whileExiled && !(source as any)?.zone?.toString?.().includes?.("exile")) {
    // Fail closed unless caller asserts whileExiled.
    if (!(context as any)?.whileExiled) return false;
  }
  if (condition.chosenPowerOrToughness && condition.chosenManaValue) {
    const chosen = Number(context?.chosenManaValue ?? (source as any).chosenManaValue);
    const mv = Number(context?.spellManaValue);
    const pow = Number(context?.spellPower);
    const tou = Number(context?.spellToughness);
    const hit = (Number.isFinite(mv) && mv === chosen) || (Number.isFinite(pow) && pow === chosen) || (Number.isFinite(tou) && tou === chosen);
    if (!Number.isFinite(chosen) || !hit) return false;
  }
  if (condition.damagePrevented && !context?.damagePrevented) return false;
  if (condition.loyaltyMaximum != null) {
    const loy = Number(context?.loyaltyCounters ?? (source as any).loyalty);
    if (!Number.isFinite(loy) || loy > condition.loyaltyMaximum) return false;
  }
  if (condition.chargeCounterMinimum != null) {
    const cc = Number(context?.chargeCountersOnSource);
    if (!Number.isFinite(cc) || cc < condition.chargeCounterMinimum) return false;
  }
  if (condition.exactLife && condition.lifeAmount != null && (context as any)?.lifeAmount != null) {
    const amt = (context as any).lifeAmount;
    if (amt !== condition.lifeAmount) return false;
  }
  if (condition.atRandom && context?.atRandom !== true) return false;
  if (condition.causedByYou) {
    const cause = String((context as any)?.causeControllerId || (context as any)?.exileControllerId || '').trim();
    if (cause && cause !== String(source.controllerId || '').trim()) return false;
  }
  if (condition.causedByOpponent) {
    const cause = String((context as any)?.causeControllerId || '').trim();
    const src = String(source.controllerId || '').trim();
    if (!cause || !src || cause === src) return false;
  }
  if (condition.notDying) {
    const toZone = String(context?.toZone || '').trim().toLowerCase();
    if (toZone === 'graveyard') return false;
  }

  if (condition.zoneOwner && condition.zoneOwner !== 'any' && condition.fromZone !== 'hand_or_battlefield') {
    const zoneOwnerId = String(context?.zoneOwnerId || '').trim();
    const sourceController = String(source.controllerId || '').trim();
    if (!zoneOwnerId || !sourceController) return false;
    if (condition.zoneOwner === 'you' && zoneOwnerId !== sourceController) return false;
    if (condition.zoneOwner === 'not_you' && zoneOwnerId === sourceController) return false;
  }

  return true;
}

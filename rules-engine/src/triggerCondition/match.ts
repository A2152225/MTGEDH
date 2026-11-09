/**
 * Shared trigger-condition matcher.
 * Public: triggerConditionMatches.
 *
 * Compares a parsed condition to the event's subject and source. It does not
 * read oracle text.
 */

import { playerBindingsMatch } from './matchPlayerBindings.js';
import type {
  TriggerConditionIR,
  TriggerMatchContext,
  TriggerMatchPermanent,
  TriggerMatchSource,
  TriggerSubjectFilter,
} from './types.js';

const CARD_TYPES = new Set([
  'creature',
  'artifact',
  'enchantment',
  'land',
  'planeswalker',
  'battle',
  'instant',
  'sorcery',
  'kindred',
  'tribal',
  'permanent',
  'aura',
  'equipment',
]);

function typeLineHasWord(typeLine: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, 'i').test(typeLine);
}

function excludedWordPresent(subject: TriggerMatchPermanent, word: string): boolean {
  if (typeLineHasWord(subject.typeLine, word)) return true;
  return Boolean(subject.hasAllCreatureTypes) && !CARD_TYPES.has(word);
}

function counterCount(counters: Readonly<Record<string, number>> | undefined, name?: string): number {
  if (!counters) return 0;
  if (!name) {
    return Object.values(counters).reduce((sum, value) => sum + (Number(value) > 0 ? Number(value) : 0), 0);
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(counters)) {
    if (key.toLowerCase() === wanted) return Number(value) || 0;
  }
  return 0;
}

function subjectFilterMatches(
  filter: TriggerSubjectFilter,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context: TriggerMatchContext | undefined,
): boolean {
  const typeLine = String(subject.typeLine || '');
  if (filter.token === 'nontoken' && subject.isToken) return false;
  if (filter.token === 'token' && !subject.isToken) return false;
  for (const word of filter.excludedWords) {
    if (excludedWordPresent(subject, word)) return false;
  }
  if (filter.excludedColors && filter.excludedColors.length > 0) {
    const colors = (subject.colors || []).map((color) => String(color || '').toLowerCase());
    if (filter.excludedColors.some((color) => colors.includes(color))) return false;
  }
  for (const supertype of filter.supertypes) {
    if (!typeLineHasWord(typeLine, supertype)) return false;
  }
  const keywords = (subject.keywords || []).map((keyword) => String(keyword || '').toLowerCase());
  for (const keyword of filter.keywordsWith) {
    if (!keywords.includes(keyword)) return false;
  }
  for (const keyword of filter.keywordsWithout) {
    if (keywords.includes(keyword)) return false;
  }
  for (const counter of filter.counters || []) {
    if (counterCount(subject.counters, counter.name) < counter.minimum) return false;
  }
  for (const stat of filter.stats || []) {
    const actual = stat.stat === 'power' ? subject.power : stat.stat === 'toughness' ? subject.toughness : subject.manaValue;
    if (actual === undefined || !Number.isFinite(actual)) return false;
    if (stat.op === 'gte' && actual < stat.value) return false;
    if (stat.op === 'lte' && actual > stat.value) return false;
  }
  if (filter.chosenType) {
    const chosen = String(source.chosenCreatureType || '').trim().toLowerCase();
    if (!chosen) return false;
    if (!typeLineHasWord(typeLine, chosen) && !subject.hasAllCreatureTypes) return false;
  }
  if (filter.chosenColor) {
    const chosen = String(source.chosenColor || '').trim().toLowerCase();
    const letter = ({ white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g' } as Record<string, string>)[chosen] || chosen;
    if (!letter || !Array.isArray(subject.colors) || !subject.colors.map(String).map((c) => c.toLowerCase()).includes(letter)) return false;
  }
  if (filter.dealtDamageBy === 'source' && !context?.dealtDamageBySource) return false;
  if (filter.dealtDamageBy === 'equipped' && !context?.dealtDamageByEquipped) return false;
  if (filter.faceDown && !subject.faceDown) return false;
  if (filter.goaded && !subject.goaded) return false;
  if (filter.modified && subject.modified !== true) return false;
  if (filter.suspected && (subject as any).suspected !== true) return false;
  if (filter.doubleFaced && (subject as any).doubleFaced !== true) return false;
  if (filter.excludeBasicLand) {
    const tl = String(subject.typeLine || '');
    if (/\bbasic\b/i.test(tl) && /\bland\b/i.test(tl)) return false;
  }
  if (filter.keywordsWithAny && filter.keywordsWithAny.length > 0) {
    const kws = (subject.keywords || []).map((k) => String(k).toLowerCase());
    if (!filter.keywordsWithAny.some((k) => kws.includes(String(k).toLowerCase()))) return false;
  }
  if (filter.equipped && subject.equipped !== true) return false;
  if (filter.powerAboveBase) {
    const power = subject.power;
    const base = subject.basePower;
    if (power === undefined || base === undefined || !Number.isFinite(power) || !Number.isFinite(base) || power <= base) return false;
  }
  if (filter.attackingOrBlocking && !subject.attackingOrBlocking) return false;
  if (filter.combatRole === 'attacking' && subject.attacking !== true) return false;
  if (filter.combatRole === 'blocking' && subject.blocking !== true) return false;
  if (filter.commander && !subject.isCommander) return false;
  if (filter.historic) {
    const historic = typeLineHasWord(typeLine, 'artifact')
      || typeLineHasWord(typeLine, 'legendary')
      || typeLineHasWord(typeLine, 'saga');
    if (!historic) return false;
  }
  if (filter.colors && filter.colors.length > 0) {
    const colors = (subject.colors || []).map((color) => String(color || '').toLowerCase());
    if (!filter.colors.some((color) => colors.includes(color))) return false;
  }
  if (filter.kicked && !subject.kicked) return false;
  if (filter.colorCount) {
    if (!Array.isArray(subject.colors)) return false;
    const count = new Set(subject.colors.map((color) => String(color || '').toLowerCase()).filter(Boolean)).size;
    if (filter.colorCount === 'colorless' && count !== 0) return false;
    if (filter.colorCount === 'monocolored' && count !== 1) return false;
    if (filter.colorCount === 'multicolored' && count < 2) return false;
  }
  if (filter.owner === 'you' || filter.owner === 'not_you') {
    const ownerId = String(subject.ownerId || '').trim();
    const sourceController = String(source.controllerId || '').trim();
    if (!ownerId || !sourceController) return false;
    if (filter.owner === 'you' && ownerId !== sourceController) return false;
    if (filter.owner === 'not_you' && ownerId === sourceController) return false;
  }

  if (filter.groups && filter.groups.length > 0) {
    return filter.groups.some((group) => {
      if (group.types.length === 0 && group.subtypes.length === 0) return filter.anyObject;
      if (!group.types.every((word) => typeLineHasWord(typeLine, word))) return false;
      return group.subtypes.every((word) => typeLineHasWord(typeLine, word) || Boolean(subject.hasAllCreatureTypes));
    });
  }

  const pairCount = Math.max(filter.typeGroups.length, filter.subtypeGroups.length);
  if (pairCount === 0) return filter.anyObject || Boolean(
    filter.commander || filter.historic || (filter.colors && filter.colors.length > 0) || Boolean(filter.colorCount) || Boolean(filter.kicked),
  );
  return Array.from({ length: pairCount }, (_, index) => index).some((index) => {
    const types = filter.typeGroups[index] || [];
    const subtypes = filter.subtypeGroups[index] || [];
    if (types.length === 0 && subtypes.length === 0) return false;
    if (types.length > 0 && !types.every((word) => typeLineHasWord(typeLine, word))) return false;
    if (subtypes.length > 0 && !subtypes.every((word) => (
      typeLineHasWord(typeLine, word) || Boolean(subject.hasAllCreatureTypes)
    ))) {
      return false;
    }
    return true;
  });
}

function alternativeMatches(
  alternative: TriggerConditionIR['alternatives'][number],
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context: TriggerMatchContext | undefined,
): boolean {
  const subjectId = String(subject.id || '').trim();
  const sourceId = String(source.id || '').trim();
  if (alternative.source === 'another' && subjectId && sourceId && subjectId === sourceId) {
    return false;
  }
  if (alternative.source === 'self' && (!subjectId || !sourceId || subjectId !== sourceId)) {
    return false;
  }
  if (alternative.source === 'self_or_another' && (!subjectId || !sourceId)) {
    return false;
  }
  if (alternative.source === 'enchanted' || alternative.source === 'equipped') {
    const attachedToId = String(source.attachedToId || '').trim();
    if (!attachedToId || !subjectId || attachedToId !== subjectId) return false;
  }

  const subjectController = String(subject.controllerId || '').trim();
  const sourceController = String(source.controllerId || '').trim();
  if (alternative.controller === 'you' && subjectController !== sourceController) return false;
  if (alternative.controller === 'not_you' && subjectController === sourceController) return false;
  if (alternative.controller === 'enchanted_player') {
    const enchanted = String(context?.enchantedPlayerId || '').trim();
    if (!enchanted || subjectController !== enchanted) return false;
  }

  return subjectFilterMatches(alternative.subject, subject, source, context);
}

function qualifiersMatch(
  condition: TriggerConditionIR,
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
    const n = Number(context?.abilityResolveCount);
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
  if (condition.minDamageAmount != null) {
    const d = Number(context?.damageAmount);
    if (!Number.isFinite(d) || d < condition.minDamageAmount) return false;
  }
  if (condition.naturalRoll != null && Number(context?.naturalRoll) !== condition.naturalRoll) return false;
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
  if ((condition.linkedWithSource || condition.putOntoBattlefieldWithSource) && !context?.linkedToSource) return false;
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
  if (condition.exactLife && condition.lifeAmount != null) {
    const amt = (context as any)?.lifeAmount;
    if (amt !== condition.lifeAmount) return false;
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

function libraryOwnerMatches(
  condition: TriggerConditionIR,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context: TriggerMatchContext | undefined,
): boolean {
  if (!condition.libraryOwner || condition.libraryOwner === 'any') return true;
  const libraryOwnerId = String(context?.libraryOwnerId || '').trim();
  const wanted = condition.libraryOwner === 'source'
    ? String(source.controllerId || '').trim()
    : String(subject.controllerId || '').trim();
  return Boolean(libraryOwnerId && wanted && libraryOwnerId === wanted);
}

export function triggerConditionMatches(
  condition: TriggerConditionIR,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context?: TriggerMatchContext,
): boolean {
  if (!qualifiersMatch(condition, source, context)) return false;
  if (condition.requireEquippedAttacker) {
    const ok = (context as any)?.attackerEquipped === true || subject.equipped === true;
    if (!ok) return false;
  }
  if (condition.requireToken) {
    const ok = (context as any)?.subjectIsToken === true || subject.isToken === true;
    if (!ok) return false;
  }
  if (condition.hasXInCost) {
    const fromCtx = (context as any)?.hasXInCost === true || (context as any)?.spellHasXInCost === true;
    const cost = String((subject as any)?.manaCost || (subject as any)?.mana_cost || '').toLowerCase();
    if (!fromCtx && !/\{x\}/i.test(cost)) return false;
  }
  if (condition.hasAdventure && !subject.hasAdventure) return false;
  if (condition.playerSubject) {
    if (!context?.subjectIsPlayer) return false;
  } else if (context?.subjectIsPlayer) {
    if (!condition.orControllerPlayer) return false;
    const sourceController = String(source.controllerId || '').trim();
    if (!sourceController || String(subject.controllerId || '').trim() !== sourceController) return false;
  }
  if (!libraryOwnerMatches(condition, subject, source, context)) return false;
  if (condition.requireAttackerName) {
    const n = String((subject as any).name || (subject as any).cardName || '').toLowerCase();
    if (n !== String(condition.requireAttackerName).toLowerCase()) return false;
  }
  if (condition.chosenPlayer) {
    const chosen = String(context?.chosenPlayerId || '').trim();
    if (!chosen || String(subject.controllerId || '').trim() !== chosen) return false;
  }
  if (condition.orPlayerSubject) {
    // Subject may be a player or a permanent; accept either.
  }
  if (condition.damageRecipientOwner) {
    const owner = String(subject.ownerId || '').trim();
    const damaged = String(context?.damagedPlayerId || '').trim();
    if (!owner || !damaged || owner !== damaged) return false;
  }
  if (condition.blockPartnerLesserPower) {
    const partner = context?.blockPartner;
    const subjPower = Number((subject as any).power);
    const partnerPower = Number(partner?.power);
    if (!partner || !Number.isFinite(subjPower) || !Number.isFinite(partnerPower) || !(partnerPower < subjPower)) return false;
  }
  if (condition.requireSubjectName) {
    const want = String(condition.requireSubjectName).toLowerCase();
    const got = String(subject.name || '').toLowerCase();
    if (!want || !got || (got !== want && !got.startsWith(want + ",") && !got.startsWith(want + " "))) return false;
  }
  if (condition.sameNameAsSource) {
    const sn = String((subject as any).name || (subject as any).cardName || '').toLowerCase();
    const srcName = String((source as any).name || (source as any).cardName || '').toLowerCase();
    if (!sn || !srcName || sn !== srcName) return false;
  }
  if (condition.controllerNotOwner) {
    const owner = String(subject.ownerId || '').trim();
    const ctrl = String(subject.controllerId || '').trim();
    if (!owner || !ctrl || owner === ctrl) return false;
  }
  if (!playerBindingsMatch(condition, subject, source, context)) return false;
  if (condition.alternatives.length === 0) return Boolean(condition.whoseTurn);
  return condition.alternatives.some((alternative) => alternativeMatches(alternative, subject, source, context));
}

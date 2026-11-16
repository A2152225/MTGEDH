/**
 * Player bindings for trigger conditions: "attacks you" (the player, not a planeswalker),
 * "attacks enchanted player", "deals combat damage to enchanted player" and
 * "a land enchanted player controls enters". All fail closed when the context lacks the ids.
 * Origin parent: match.ts triggerConditionMatches.
 * Public: playerBindingsMatch.
 */

import type { TriggerConditionIR, TriggerMatchContext, TriggerMatchPermanent, TriggerMatchSource } from './types.js';

const id = (value: unknown): string => String(value || '').trim();

export function playerBindingsMatch(
  condition: TriggerConditionIR,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context?: TriggerMatchContext,
): boolean {
  const enchanted = id(context?.enchantedPlayerId);
  if (condition.attackedTargetType === 'player' && context?.attackedTargetIsPlayer !== true) return false;
  if (condition.attackedPlayer === 'opponent') {
    const attacked = id(context?.attackedPlayerId);
    if (!attacked || attacked === id(source.controllerId)) return false;
  }
  if (condition.attackedPlayer === 'enchanted' && (!enchanted || id(context?.attackedPlayerId) !== enchanted)) return false;
  if (condition.damagedPlayer === 'enchanted' && (!enchanted || id(context?.damagedPlayerId) !== enchanted)) return false;
  // "deals combat damage to you" (Harsh Justice): enforced when the caller knows the damaged player.
  if (condition.damagedPlayer === 'you' && id(context?.damagedPlayerId) && id(context?.damagedPlayerId) !== id(source.controllerId)) return false;
  if (condition.subjectControlledBy === 'enchanted_player' && (!enchanted || id(subject.controllerId) !== enchanted)) return false;
  if (condition.attackedTargetType === 'battle' && context?.attackedTargetIsBattle !== true) return false;
  if (condition.attackedTargetType === 'planeswalker' && context?.attackedTargetIsPlaneswalker !== true) return false;
  if (condition.attackedPlayer === 'monarch') {
    const attacked = id(context?.attackedPlayerId);
    if (!attacked || context?.attackedTargetIsPlayer !== true || attacked !== id(context?.monarchPlayerId)) return false;
  }
  if (condition.attackedPlayer === 'most_life') {
    const attacked = id(context?.attackedPlayerId);
    const lives = context?.playerLives || [];
    if (!attacked || context?.attackedTargetIsPlayer !== true || lives.length === 0) return false;
    const attackedLife = Number(lives.find((p) => id(p.id) === attacked)?.life);
    const max = Math.max(...lives.map((p) => Number(p.life)));
    if (!Number.isFinite(attackedLife) || !Number.isFinite(max) || attackedLife < max) return false;
  }
  if (condition.attackedPlayer === 'more_life_than_you') {
    const attacked = id(context?.attackedPlayerId);
    const lives = context?.playerLives || [];
    const you = lives.find((p) => id(p.id) === id(source.controllerId));
    const attackedLife = Number(lives.find((p) => id(p.id) === attacked)?.life);
    if (!attacked || context?.attackedTargetIsPlayer !== true || !you || !Number.isFinite(attackedLife) || attackedLife <= Number(you.life)) return false;
  }
  if (condition.attacksPlayerAlone) {
    if (context?.attackedTargetIsPlayer !== true || Number(context?.attackersAtDefender) !== 1) return false;
  }
  if (condition.attacksAlone && Number(context?.attackerCount) !== 1) return false;
  if (condition.exactAttackers != null) {
    const n = Number(context?.attackerCount);
    if (!Number.isFinite(n) || n !== condition.exactAttackers) return false;
  }
  if (condition.minRoll != null) {
    const n = Number(context?.rollResult ?? context?.naturalRoll);
    if (!Number.isFinite(n) || n < condition.minRoll) return false;
  }
  if (condition.rollValues && condition.rollValues.length > 0) {
    const n = Number(context?.rollResult ?? context?.naturalRoll);
    if (!condition.rollValues.includes(n)) return false;
  }
  if (condition.highestNatural) {
    const n = Number(context?.rollResult ?? context?.naturalRoll);
    const sides = Number(context?.dieSides);
    if (!Number.isFinite(n) || !Number.isFinite(sides) || sides <= 0 || n !== sides) return false;
  }
  if (condition.exploredIsLand != null && context?.revealedIsLand !== condition.exploredIsLand) return false;
  if (condition.sourceMostLife) {
    const lives = context?.playerLives || [];
    const you = lives.find((p) => id(p.id) === id(source.controllerId));
    if (!you || lives.length === 0) return false;
    const max = Math.max(...lives.map((p) => Number(p.life)));
    if (!Number.isFinite(Number(you.life)) || Number(you.life) < max) return false;
  }
  if (condition.attackedPlayer === 'initiative') {
    const attacked = id(context?.attackedPlayerId);
    if (!attacked || context?.attackedTargetIsPlayer !== true || attacked !== id(context?.initiativePlayerId)) return false;
  }
  if (condition.damageRecipientSubtypes && condition.damageRecipientSubtypes.length > 0) {
    const typeLine = String(context?.damagedTypeLine || '').toLowerCase();
    if (!condition.damageRecipientSubtypes.some((sub) => new RegExp('\\b' + String(sub).toLowerCase() + '\\b').test(typeLine))) return false;
  }
  if (condition.notManaAbility && context?.isManaAbility !== false) return false;
  if (condition.duringMainPhase && context?.inMainPhase !== true) return false;
  if (condition.manaValueParity) {
    const mv = Number(context?.spellManaValue ?? subject.manaValue);
    if (!Number.isFinite(mv) || (condition.manaValueParity === 'even' ? mv % 2 !== 0 : mv % 2 !== 1)) return false;
  }
  if (condition.exactColorCount != null) {
    const colors = context?.spellColors || subject.colors || [];
    const n = new Set((colors as readonly string[]).map((c) => String(c).toLowerCase())).size;
    if (n !== condition.exactColorCount) return false;
  }
  if (condition.powerEqualsToughness) {
    const p = Number(subject.power);
    const t = Number(subject.toughness);
    if (!Number.isFinite(p) || !Number.isFinite(t) || p !== t) return false;
  }
  if (condition.toughnessGreaterThanPower) {
    const p = Number(subject.power);
    const t = Number(subject.toughness);
    if (!Number.isFinite(p) || !Number.isFinite(t) || !(t > p)) return false;
  }
  if (condition.basePowerEquals != null && Number(subject.basePower) !== condition.basePowerEquals) return false;
  if (condition.baseToughnessEquals != null) {
    const bt = Number((subject as any).baseToughness ?? subject.toughness);
    if (bt !== condition.baseToughnessEquals) return false;
  }
  if (condition.requiresSubjectSaddled && subject.saddled !== true) return false;
  if (condition.requiresEnchantedSubject && (subject as any).isEnchanted !== true) return false;
  if (condition.isRenowned && !((subject.keywords || []).some((k) => /renowned/i.test(String(k))) || (subject as any).renowned === true)) return false;
  if (condition.requireYouAreMonarch) {
    const monarch = id(context?.monarchPlayerId);
    if (!monarch || monarch !== id(source.controllerId)) return false;
  }
  if (condition.requireControlledPowerGte != null) {
    const n = Number((context as any)?.controlledMaxPower ?? (context as any)?.maxControlledPower);
    if (!Number.isFinite(n) || n < condition.requireControlledPowerGte) return false;
  }
  if (condition.minCardTypesInGraveyard != null) {
    const n = Number((context as any)?.graveyardCardTypeCount);
    if (!Number.isFinite(n) || n < condition.minCardTypesInGraveyard) return false;
  }
  if (condition.minSpellTargets != null) {
    const n = Array.isArray(context?.targetPermanentIds) ? context.targetPermanentIds.length : Number((context as any)?.spellTargetCount);
    if (!Number.isFinite(n) || n < condition.minSpellTargets) return false;
  }
  if (condition.minSpellManaValue != null) {
    const mv = Number(context?.spellManaValue ?? subject.manaValue);
    if (!Number.isFinite(mv) || mv < condition.minSpellManaValue) return false;
  }
  if (condition.preparedSpell && (context as any)?.isPreparedSpell !== true) return false;
  if (condition.modalSpell && (context as any)?.isModalSpell !== true) return false;
  if (condition.exceptFirstCardDrawnInDrawStep && (context as any)?.isFirstCardDrawnInDrawStep === true) return false;
  if (condition.youDontControlAnotherSubtype) {
    const has = (context as any)?.youControlAnotherSubtype === true;
    if (has) return false;
  }
  if (condition.requireYouControlSubtype && (context as any)?.youControlRequiredSubtype !== true) return false;
  if (condition.powerOrToughnessLte != null) {
    const p = Number(subject.power);
    const t = Number(subject.toughness);
    const cap = condition.powerOrToughnessLte;
    if ((!Number.isFinite(p) || p > cap) && (!Number.isFinite(t) || t > cap)) return false;
    if (!Number.isFinite(p) && !Number.isFinite(t)) return false;
  }
  if (condition.ownerNotYou) {
    const owner = String((subject as any).ownerId || '').trim();
    const you = id(source.controllerId);
    if (!owner || !you || owner === you) return false;
  }
  if (condition.sourceInGraveyard && (context as any)?.sourceZone !== 'graveyard' && (source as any).zone !== 'graveyard') return false;
  if (condition.sourceHasCounter) {
    const key = String(condition.sourceHasCounter).toLowerCase().replace(/[^a-z0-9/+-]/g, '');
    const counters = (source as any).counters || (context as any)?.sourceCounters || {};
    const n = Number(counters[condition.sourceHasCounter] ?? counters[key] ?? counters[key.replace('/', '')]);
    if (!Number.isFinite(n) || n < 1) return false;
  }
  if (condition.enteredThisTurn && (subject as any).enteredThisTurn !== true && (context as any)?.enteredThisTurn !== true) return false;
  if (condition.becameFaceUpThisTurn && (subject as any).becameFaceUpThisTurn !== true && (context as any)?.becameFaceUpThisTurn !== true) return false;
  if (condition.hasLegendaryEquipmentAttached && (context as any)?.hasLegendaryEquipmentAttached !== true) return false;
  if (condition.moreLandsThanYou && (context as any)?.recipientHasMoreLandsThanYou !== true) return false;
  if (condition.defendingLandCountGte != null) {
    const n = Number((context as any)?.defendingLandCount);
    if (!Number.isFinite(n) || n < condition.defendingLandCountGte) return false;
  }
  if (condition.spellManaValueEqualsSourcePower) {
    const mv = Number(context?.spellManaValue ?? subject.manaValue);
    const pow = Number((source as any).power ?? (context as any)?.sourcePower);
    if (!Number.isFinite(mv) || !Number.isFinite(pow) || mv !== pow) return false;
  }
  if (condition.spellPowerIn && condition.spellPowerIn.length) {
    const pow = Number(subject.power ?? (context as any)?.spellPower);
    if (!condition.spellPowerIn.includes(pow)) return false;
  }
  if (condition.spellHasPhyrexian) {
    const cost = String((context as any)?.spellManaCost || (subject as any).manaCost || '').toLowerCase();
    if (!/{h}|phyrexian/.test(cost)) return false;
  }
  if (condition.spellHasColorManaSymbol) {
    const cost = String((context as any)?.spellManaCost || '').toLowerCase();
    const letter = String(condition.spellHasColorManaSymbol).charAt(0).toLowerCase();
    const word = { w: 'white', u: 'blue', b: 'black', r: 'red', g: 'green' }[letter] || letter;
    const count = (cost.match(new RegExp('\\{' + letter + '\\}|' + word, 'g')) || []).length;
    if (count < (condition.minColorManaSymbols || 1)) return false;
  }
  if (condition.exactColorCount != null && context?.spellColors) {
    /* already checked earlier when present */
  }
  if (condition.sourceCounterCountGte != null) {
    const counters = (source as any).counters || (context as any)?.sourceCounters || {};
    const typ = String(condition.sourceCounterType || '').toLowerCase();
    let n = 0;
    for (const [k, v] of Object.entries(counters)) {
      if (!typ || String(k).toLowerCase().includes(typ)) n += Number(v) || 0;
    }
    if (n < condition.sourceCounterCountGte) return false;
  }
  if (condition.excludeFirstSpellEachTurn && condition.whoseTurn === 'you' && context?.spellOrdinal === 1) return false;
  if (condition.milledNonland && (context as any)?.milledNonland === false) return false;
  if (condition.notFromDying && (context as any)?.leftBecauseItDied === true) return false;
  return true;
}


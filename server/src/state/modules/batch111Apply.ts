// Batch 111 live apply for the long-tail statics parsed in batch111Parsers.ts.
// Public: applyBatch111BasePowerToughness, applyBatch111PowerToughnessAdjustment, batch111PermanentHasKeyword,
// batch111AdditionalTypes, batch111LosesCreature, batch111AddedColor,
// batch111AttackRestrictionReason, batch111BlockRestrictionReason,
// batch111UntapProhibition, batch111MaxBlockers, batch111DefenderPower,
// collectBatch111DamageAdjustments.

import {
  normalizeBatch111Oracle,
  parseAnyCounterMaxBlockers,
  parseCantAttackOrBlockUnlessExile,
  parseCantAttackUnlessColorsAlsoAttack,
  parseCantAttackUnlessDefenderGraveyard,
  parseCantAttackUnlessDefenderMonarch,
  parseCantAttackUnlessDefenderPoisoned,
  parseCantAttackUnlessGreaterPowerAlsoAttacks,
  parseCantAttackUnlessYouControlPower,
  parseCantBeBlockedIfCastInstantOrSorcery,
  parseCantBeBlockedIfOpponentGraveyard,
  parseCantBlockUnlessGreaterPowerAlsoBlocks,
  parseChosenTypeCreaturesGetPt,
  parseChosenTypeDontUntap,
  parseColorConditionalKeywords,
  parseColorSpellDamageDouble,
  parseColorsCantBlock,
  parseCreaturesBasePtEqualCreatureCount,
  parseNonArchonBasePt,
  parseCreaturesYouControlMvOrLessPt,
  parseDamageBecomesIfAtLeast,
  parseDefenderIfPowerAtLeast,
  parseEnchantedCantBeBlockedExceptBy,
  parseEnchantedCreaturesYouControlPt,
  parseEnchantedIsSubtypes,
  parseEnchantedPtPerOtherEnchantment,
  parseEnchantedToxic,
  parseEnchantedYouControlExceptDefender,
  parseEquippedLegendaryPt,
  parseEquippedPtEqualsManaValue,
  parseEquippedPtPerArtifactYouControl,
  parseFlyingCantBlockYourCreatures,
  parseForestsAreElfCreatures,
  parseGoblinsAreBlackZombies,
  parseHasteIfAdventureInExile,
  parseIndestructibleWhileDefender,
  parseLandThatIsCreaturePt,
  parseLevelCounterCreaturesPt,
  parseNoncombatDamageToOpponentPlus,
  parseNonlandDontUntap,
  parseNonwhitePowerDontUntap,
  parseOpponentNoncombatKeywords,
  parseOpponentsWithCountersCantAttackOrBlock,
  parseOtherInfectCreaturesPt,
  parseOtherSamuraiPerBushido,
  parseSelfBasePtIfGraveyardAtLeast,
  parseSelfNotCreatureIfGraveyardBelow,
  parseSelfPtIfCommanderCreatureOrWalker,
  parseSelfPtIfOilCounters,
  parseSelfPtIfUnlockedDoors,
  parseSelfPtPerArtifactYouControl,
  parseSelfPtPerColorAmongOtherLegendaries,
  parseSelfPtPerExiledWithIt,
  parseSelfPtPerFaceDownCreature,
  parseSelfPtPerLandControlledNotOwned,
  parseSelfPtPerLandNamed,
  parseSelfPtPerOtherCreatureWithPlusCounter,
  parseSelfPtPerOtherSnow,
  parseShroudOnArtifactsAndEnchantments,
  parseTypeYouControlMaxBlockers,
  parseUnblockedNinjasLifelink,
  parseYourCreaturesCantBeBlockedExceptLegendary,
} from './batch111Parsers.js';
import * as batch111Parsers from './batch111Parsers.js';
import { createLongTailStaticSourceFilter, longTailStaticSources, parseExportsOf } from './longTailStaticSourceIndex.js';
import { declarativeSpecAppliesPtLine } from './longTailPtDeclarativeOverlapGuard.js';

const B111_SOURCES = createLongTailStaticSourceFilter('batch111', () => parseExportsOf(batch111Parsers));

const COLOR_LETTER: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function textOf(perm: any): string {
  return normalizeBatch111Oracle(String(perm?.card?.oracle_text || perm?.oracle_text || ''), String(perm?.card?.name || ''));
}

function battlefieldOf(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}

function typeLine(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function isCreature(perm: any): boolean {
  if (!perm || perm.notCreature === true) return false;
  return /\bcreature\b/.test(typeLine(perm)) || perm.isCreature === true;
}

function controller(perm: any): string {
  return String(perm?.controller || '');
}

function same(a: any, b: any): boolean {
  return String(a?.id || '') !== '' && String(a?.id || '') === String(b?.id || '');
}

function attachedHost(aura: any): string {
  return String(aura?.attachedTo || aura?.attachedToId || '');
}

function isAuraOn(host: any, aura: any): boolean {
  return attachedHost(aura) === String(host?.id || '') && /\baura\b/.test(typeLine(aura));
}

function isEquipmentOn(host: any, equipment: any): boolean {
  return attachedHost(equipment) === String(host?.id || '') && /\bequipment\b/.test(typeLine(equipment));
}

function graveyardCount(state: any, playerId: string): number {
  const zone = state?.zones?.[playerId];
  const list = zone?.graveyard;
  if (Array.isArray(list)) return list.length;
  return Math.max(0, Number(zone?.graveyardCount || 0));
}

function exileCount(state: any): number {
  const zones = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  return (Object.values(zones) as any[]).reduce((sum, zone) => sum + (Array.isArray(zone?.exile) ? zone.exile.length : 0), 0);
}

function manaValue(perm: any): number {
  const raw = perm?.card?.cmc ?? perm?.card?.mana_value ?? perm?.cmc ?? perm?.manaValue;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function powerNow(perm: any): number {
  const raw = Number(perm?.power ?? perm?.basePower ?? perm?.card?.power);
  return Number.isFinite(raw) ? raw : 0;
}

function colorsOf(perm: any): string[] {
  const raw = perm?.card?.colors || perm?.colors || [];
  return Array.isArray(raw) ? raw.map((color: unknown) => String(color).toUpperCase()) : [];
}

function hasColorWord(perm: any, word: string): boolean {
  const letter = COLOR_LETTER[word];
  return letter ? colorsOf(perm).includes(letter) : false;
}

function chosenType(perm: any): string {
  return String(perm?.chosenCreatureType || perm?.chosenType || perm?.card?.chosenCreatureType || perm?.card?.chosenType || '').toLowerCase();
}

function hasFlying(perm: any): boolean {
  if (/\bflying\b/i.test(String(perm?.card?.oracle_text || ''))) return true;
  const keywords = perm?.keywords || perm?.card?.keywords;
  return Array.isArray(keywords) && keywords.some((keyword) => String(keyword).toLowerCase() === 'flying');
}

function hasTypeWord(perm: any, word: string): boolean {
  const needle = String(word || '').toLowerCase();
  if (!needle) return false;
  return typeLine(perm).split(/[^a-z0-9]+/).includes(needle);
}

function counterCount(perm: any, key: string): number {
  return Math.max(0, Math.floor(Number(perm?.counters?.[key] || 0)));
}

function anyCounter(perm: any): boolean {
  const counters = perm?.counters;
  if (!counters || typeof counters !== 'object') return false;
  return Object.values(counters).some((value) => Number(value) > 0);
}

function exiledWith(perm: any, state: any): number {
  const lists = [perm?.exiledCards, perm?.exiledWith, perm?.imprinted, perm?.exileImprint];
  for (const list of lists) if (Array.isArray(list)) return list.length;
  const id = String(perm?.id || '');
  const zones = state?.zones && typeof state.zones === 'object' ? Object.values(state.zones) : [];
  let count = 0;
  for (const zone of zones as any[]) {
    const exile = Array.isArray(zone?.exile) ? zone.exile : [];
    count += exile.filter((card: any) => String(card?.exiledBy || card?.exiledWith || '') === id).length;
  }
  return count;
}

function isSnow(perm: any): boolean {
  return /\bsnow\b/.test(typeLine(perm)) || perm?.supertypes?.includes?.('Snow') || perm?.card?.supertypes?.includes?.('Snow');
}

function isFaceDown(perm: any): boolean {
  return perm?.faceDown === true || perm?.turnedFaceDown === true || perm?.isFaceDown === true;
}

function unlockedDoors(state: any, playerId: string): number {
  return battlefieldOf(state).reduce((sum, perm) => {
    if (!perm || controller(perm) !== playerId) return sum;
    if (!/\broom\b/.test(typeLine(perm))) return sum;
    if (Array.isArray(perm.unlockedDoors)) return sum + perm.unlockedDoors.length;
    return sum + Math.max(0, Number(perm.unlockedDoorCount || 0));
  }, 0);
}

function bushido(perm: any): number {
  const match = String(perm?.card?.oracle_text || '').match(/bushido\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function poisoned(state: any, playerId: string): boolean {
  if (Number(state?.poisonCounters?.[playerId] || 0) > 0) return true;
  const player = (state?.players || []).find((entry: any) => String(entry?.id || '') === playerId);
  return Number(player?.poisonCounters || player?.poison || 0) > 0;
}

function spellThisTurn(state: any, playerId: string, kind: 'instant' | 'sorcery'): boolean {
  const spells = Array.isArray(state?.spellsCastThisTurn) ? state.spellsCastThisTurn : [];
  return spells.some((entry: any) => String(entry?.casterId || entry?.playerId || '') === playerId
    && String(entry?.card?.type_line || entry?.type_line || '').toLowerCase().includes(kind));
}

function opponentHasGraveyard(state: any, playerId: string, count: number): boolean {
  const zones = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  return Object.entries(zones).some(([id, zone]) => id !== playerId && graveyardCount({ zones: { [id]: zone } }, id) >= count);
}

export function applyBatch111BasePowerToughness(
  permanent: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  return applyBatch111PowerToughnessAdjustment(permanent, state, power, toughness, 'base');
}

export function applyBatch111PowerToughnessAdjustment(
  permanent: any,
  state: any,
  power: number,
  toughness: number,
  mode: 'base' | 'delta' = 'delta',
): { power: number; toughness: number } {
  let nextPower = power;
  let nextToughness = toughness;
  const battlefield = battlefieldOf(state);
  const self = controller(permanent);
  for (const source of battlefield) {
    if (!source || source.phasedOut === true) continue;
    const line = textOf(source);
    const src = controller(source);
    const perEnchantment = mode === 'delta' ? parseEnchantedPtPerOtherEnchantment(line) : null;
    if (perEnchantment && isAuraOn(permanent, source)) {
      const others = battlefield.filter((perm) => perm && perm !== source && !perm.phasedOut && /\benchantment\b/.test(typeLine(perm))).length;
      nextPower += perEnchantment.power * others;
      nextToughness += perEnchantment.toughness * others;
    }
    if (mode === 'delta' && parseEquippedPtEqualsManaValue(line) && isEquipmentOn(permanent, source)) {
      const mv = manaValue(permanent);
      nextPower += mv;
      nextToughness += mv;
    }
    const chosen = mode === 'delta' ? parseChosenTypeCreaturesGetPt(line) : null;
    if (chosen && isCreature(permanent) && chosenType(source) && hasTypeWord(permanent, chosenType(source))) {
      nextPower += chosen.power;
      nextToughness += chosen.toughness;
    }
    const exiled = mode === 'delta' ? parseSelfPtPerExiledWithIt(line) : null;
    if (exiled && same(source, permanent)) {
      const count = exiledWith(source, state);
      nextPower += exiled.power * count;
      nextToughness += exiled.toughness * count;
    }
    const faceDown = mode === 'delta' ? parseSelfPtPerFaceDownCreature(line) : null;
    if (faceDown && same(source, permanent)) {
      const count = battlefield.filter((perm) => perm && isFaceDown(perm) && isCreature(perm)).length;
      nextPower += faceDown.power * count;
      nextToughness += faceDown.toughness * count;
    }
    const artifacts = mode === 'delta' ? parseSelfPtPerArtifactYouControl(line) : null;
    if (artifacts && same(source, permanent)
      && !declarativeSpecAppliesPtLine(source, (l) => !!parseSelfPtPerArtifactYouControl(normalizeBatch111Oracle(l, String(source?.card?.name || ''))))) {
      const count = battlefield.filter((perm) => perm && controller(perm) === src && /\bartifact\b/.test(typeLine(perm))).length;
      nextPower += artifacts.power * count;
      nextToughness += artifacts.toughness * count;
    }
    const equippedArtifacts = mode === 'delta' ? parseEquippedPtPerArtifactYouControl(line) : null;
    if (equippedArtifacts && isEquipmentOn(permanent, source)) {
      const count = battlefield.filter((perm) => perm && controller(perm) === src && /\bartifact\b/.test(typeLine(perm))).length;
      nextPower += count;
      nextToughness += equippedArtifacts.toughness;
    }
    const enchantedTeam = mode === 'delta' ? parseEnchantedCreaturesYouControlPt(line) : null;
    if (enchantedTeam && src === self && isCreature(permanent) && battlefield.some((aura) => isAuraOn(permanent, aura))
      && !declarativeSpecAppliesPtLine(source, (l) => !!parseEnchantedCreaturesYouControlPt(normalizeBatch111Oracle(l, String(source?.card?.name || ''))))) {
      nextPower += enchantedTeam.power;
      nextToughness += enchantedTeam.toughness;
    }
    const mvCap = mode === 'delta' ? parseCreaturesYouControlMvOrLessPt(line) : null;
    if (mvCap && src === self && isCreature(permanent) && manaValue(permanent) <= mvCap.mv) {
      nextPower += mvCap.power;
      nextToughness += mvCap.toughness;
    }
    const borrowedLands = mode === 'delta' ? parseSelfPtPerLandControlledNotOwned(line) : null;
    if (borrowedLands && same(source, permanent)) {
      const count = battlefield.filter((perm) => perm && controller(perm) === src && /\bland\b/.test(typeLine(perm))
        && String(perm.owner || perm.card?.owner || src) !== src).length;
      nextPower += borrowedLands.power * count;
      nextToughness += borrowedLands.toughness * count;
    }
    const plusFriends = mode === 'delta' ? parseSelfPtPerOtherCreatureWithPlusCounter(line) : null;
    if (plusFriends && same(source, permanent)) {
      const count = battlefield.filter((perm) => perm && !same(perm, permanent) && controller(perm) === src && isCreature(perm) && counterCount(perm, '+1/+1') > 0).length;
      nextPower += plusFriends.power * count;
      nextToughness += plusFriends.toughness * count;
    }
    const commanderBuff = mode === 'delta' ? parseSelfPtIfCommanderCreatureOrWalker(line) : null;
    if (commanderBuff && same(source, permanent) && battlefield.some((perm) => perm && controller(perm) === src
      && (perm.isCommander || perm.card?.isCommander || perm.commander)
      && (/\bcreature\b/.test(typeLine(perm)) || /\bplaneswalker\b/.test(typeLine(perm))))) {
      nextPower += commanderBuff.power;
      nextToughness += commanderBuff.toughness;
    }
    const infect = mode === 'delta' ? parseOtherInfectCreaturesPt(line) : null;
    if (infect && src === self && !same(source, permanent) && isCreature(permanent) && /\binfect\b/i.test(String(permanent?.card?.oracle_text || ''))) {
      nextPower += infect.power;
      nextToughness += infect.toughness;
    }
    const levels = mode === 'delta' ? parseLevelCounterCreaturesPt(line) : null;
    if (levels && src === self && isCreature(permanent) && counterCount(permanent, 'level') > 0) {
      nextPower += levels.power;
      nextToughness += levels.toughness;
    }
    const snow = mode === 'delta' ? parseSelfPtPerOtherSnow(line) : null;
    if (snow && same(source, permanent)) {
      const count = battlefield.filter((perm) => perm && !same(perm, permanent) && controller(perm) === src && isSnow(perm)).length;
      nextPower += snow.power * count;
      nextToughness += snow.toughness * count;
    }
    const legendaryEquip = mode === 'delta' ? parseEquippedLegendaryPt(line) : null;
    if (legendaryEquip && isEquipmentOn(permanent, source) && /\blegendary\b/.test(typeLine(permanent))) {
      nextPower += legendaryEquip.power;
      nextToughness += legendaryEquip.toughness;
    }
    const landCreature = mode === 'delta' ? parseLandThatIsCreaturePt(line) : null;
    if (landCreature && /\bland\b/.test(typeLine(permanent)) && isCreature(permanent)) {
      nextPower += landCreature.power;
      nextToughness += landCreature.toughness;
    }
    const named = mode === 'delta' ? parseSelfPtPerLandNamed(line) : null;
    if (named && same(source, permanent)) {
      const count = battlefield.filter((perm) => perm && controller(perm) === src && String(perm?.card?.name || '').toLowerCase() === named.name).length;
      nextPower += named.power * count;
      nextToughness += named.toughness * count;
    }
    const colors = mode === 'delta' ? parseSelfPtPerColorAmongOtherLegendaries(line) : null;
    if (colors && same(source, permanent)) {
      const seen = new Set<string>();
      for (const perm of battlefield) {
        if (!perm || same(perm, permanent) || controller(perm) !== src || !/\blegendary\b/.test(typeLine(perm))) continue;
        colorsOf(perm).forEach((color) => seen.add(color));
      }
      nextPower += colors.power * seen.size;
      nextToughness += colors.toughness * seen.size;
    }
    const nonArchon = mode === 'base' ? parseNonArchonBasePt(line) : null;
    if (nonArchon && isCreature(permanent) && !hasTypeWord(permanent, 'archon')) {
      nextPower = nonArchon.power;
      nextToughness = nonArchon.toughness;
    }
    if (mode === 'base' && parseCreaturesBasePtEqualCreatureCount(line) && src === self && isCreature(permanent)) {
      const count = battlefield.filter((perm) => perm && !perm.phasedOut && controller(perm) === src && isCreature(perm)).length;
      nextPower = count;
      nextToughness = count;
    }
    const gyBase = mode === 'base' ? parseSelfBasePtIfGraveyardAtLeast(line) : null;
    if (gyBase && same(source, permanent) && graveyardCount(state, src) >= gyBase.count) {
      nextPower = gyBase.power;
      nextToughness = gyBase.toughness;
    }
    const oil = mode === 'delta' ? parseSelfPtIfOilCounters(line) : null;
    if (oil && same(source, permanent) && counterCount(permanent, 'oil') >= oil.count) {
      nextPower += oil.power;
      nextToughness += oil.toughness;
    }
    const doors = mode === 'delta' ? parseSelfPtIfUnlockedDoors(line) : null;
    if (doors && same(source, permanent) && unlockedDoors(state, src) >= doors.count) {
      nextPower += doors.power;
      nextToughness += doors.toughness;
    }
    const samurai = mode === 'delta' ? parseOtherSamuraiPerBushido(line) : null;
    if (samurai && src === self && !same(source, permanent) && hasTypeWord(permanent, 'samurai')) {
      const points = bushido(permanent);
      nextPower += samurai.power * points;
      nextToughness += samurai.toughness * points;
    }
    if (mode === 'base' && parseForestsAreElfCreatures(line) && src === self && hasTypeWord(permanent, 'forest')) {
      nextPower = 1;
      nextToughness = 1;
    }
  }
  return { power: nextPower, toughness: nextToughness };
}

export function batch111PermanentHasKeyword(permanent: any, state: any, keyword: string): boolean {
  const needle = String(keyword || '').trim().toLowerCase();
  if (!needle || !permanent) return false;
  const self = controller(permanent);
  for (const source of longTailStaticSources(state, B111_SOURCES, textOf)) {
    if (!source || source.phasedOut === true) continue;
    const line = textOf(source);
    const src = controller(source);
    if (same(source, permanent) && parseOpponentNoncombatKeywords(line).includes(needle)) {
      const received = state?.noncombatDamageReceivedThisTurn;
      if (received && typeof received === 'object' && Object.entries(received).some(([id, amount]) => id !== self && Number(amount) > 0)) return true;
    }
    if (needle === 'indestructible' && same(source, permanent) && parseIndestructibleWhileDefender(line) && /\bdefender\b/i.test(String(permanent?.card?.oracle_text || ''))) return true;
    if (needle === 'lifelink' && parseUnblockedNinjasLifelink(line) && src === self && hasTypeWord(permanent, 'ninja') && (permanent.unblocked === true || permanent.isUnblocked === true)) return true;
    if (needle === 'haste' && same(source, permanent) && parseHasteIfAdventureInExile(line)) {
      const zones = state?.zones && typeof state.zones === 'object' ? Object.values(state.zones) : [];
      for (const zone of zones as any[]) {
        const exile = Array.isArray(zone?.exile) ? zone.exile : [];
        if (exile.some((card: any) => String(card?.owner || self) === self && /\badventure\b/i.test(String(card?.oracle_text || card?.layout || '')))) return true;
      }
    }
    if (needle === 'shroud' && parseShroudOnArtifactsAndEnchantments(line) && src === self && (/\bartifact\b/.test(typeLine(permanent)) || /\benchantment\b/.test(typeLine(permanent)))) return true;
    if (needle === 'toxic' && parseEnchantedToxic(line) > 0 && isAuraOn(permanent, source)) return true;
    if (src === self && parseColorConditionalKeywords(line).some((entry) => entry.keyword === needle && hasColorWord(permanent, entry.color))) return true;
  }
  return false;
}

export function batch111AdditionalTypes(permanent: any, state: any): string[] {
  const added = new Set<string>();
  for (const source of longTailStaticSources(state, B111_SOURCES, textOf)) {
    if (!source || source.phasedOut === true) continue;
    const line = textOf(source);
    if (parseForestsAreElfCreatures(line) && controller(source) === controller(permanent) && hasTypeWord(permanent, 'forest')) {
      added.add('Creature');
      added.add('Elf');
    }
    if (parseGoblinsAreBlackZombies(line) && hasTypeWord(permanent, 'goblin')) added.add('Zombie');
    if (isAuraOn(permanent, source)) {
      for (const subtype of parseEnchantedIsSubtypes(line)) {
        if (!['creature', 'gets', 'has'].includes(subtype)) added.add(subtype.replace(/\b\w/g, (letter) => letter.toUpperCase()));
      }
    }
  }
  return [...added];
}

export function batch111LosesCreature(permanent: any, state: any): boolean {
  const line = textOf(permanent);
  const below = parseSelfNotCreatureIfGraveyardBelow(line);
  return below > 0 && graveyardCount(state, controller(permanent)) < below;
}

export function batch111AddedColor(permanent: any, state: any): string[] {
  const set = new Set<string>();
  for (const source of battlefieldOf(state)) {
    if (!source || source.phasedOut === true) continue;
    if (parseGoblinsAreBlackZombies(textOf(source)) && hasTypeWord(permanent, 'goblin')) set.add('B');
    if (parseForestsAreElfCreatures(textOf(source)) && controller(source) === controller(permanent) && hasTypeWord(permanent, 'forest')) set.add('G');
  }
  return [...set];
}

export function batch111AttackRestrictionReason(
  creature: any,
  proposedAttackerIds: readonly string[] | undefined,
  state: any,
  defendingPlayerId?: string,
): string | null {
  const battlefield = battlefieldOf(state);
  const proposed = new Set((proposedAttackerIds || []).map((id) => String(id)));
  const attackers = battlefield.filter((perm) => perm && (proposed.has(String(perm.id || '')) || perm.attacking));
  const self = controller(creature);
  const defender = String(defendingPlayerId || '');
  for (const source of battlefield) {
    if (!source || source.phasedOut === true) continue;
    const line = textOf(source);
    const src = controller(source);
    const exileNeed = parseCantAttackOrBlockUnlessExile(line);
    if (exileNeed > 0 && same(source, creature) && exileCount(state) < exileNeed) {
      return `${creature?.card?.name || 'This creature'} can't attack unless there are ${exileNeed} or more cards in exile`;
    }
    const colors = parseCantAttackUnlessColorsAlsoAttack(line);
    if (colors.length && same(source, creature) && !attackers.some((perm) => !same(perm, creature) && colors.some((color) => hasColorWord(perm, color)))) {
      return `${creature?.card?.name || 'This creature'} can't attack unless a ${colors.join(' or ')} creature also attacks`;
    }
    const powerNeed = parseCantAttackUnlessYouControlPower(line);
    if (powerNeed > 0 && same(source, creature) && !battlefield.some((perm) => controller(perm) === self && isCreature(perm) && powerNow(perm) >= powerNeed)) {
      return `${creature?.card?.name || 'This creature'} can't attack unless you control a creature with power ${powerNeed} or greater`;
    }
    if (parseCantAttackUnlessGreaterPowerAlsoAttacks(line) && same(source, creature)) {
      const mine = powerNow(creature);
      if (!attackers.some((perm) => !same(perm, creature) && powerNow(perm) > mine)) {
        return `${creature?.card?.name || 'This creature'} can't attack unless a creature with greater power also attacks`;
      }
    }
    if (defender && parseCantAttackUnlessDefenderPoisoned(line) && same(source, creature) && !poisoned(state, defender)) {
      return `${creature?.card?.name || 'This creature'} can't attack unless defending player is poisoned`;
    }
    if (defender && parseCantAttackUnlessDefenderMonarch(line) && same(source, creature) && String(state?.monarch || '') !== defender) {
      return `${creature?.card?.name || 'This creature'} can't attack unless defending player is the monarch`;
    }
    const gyNeed = parseCantAttackUnlessDefenderGraveyard(line);
    if (defender && gyNeed > 0 && same(source, creature) && graveyardCount(state, defender) < gyNeed) {
      return `${creature?.card?.name || 'This creature'} can't attack unless defending player has ${gyNeed} or more cards in their graveyard`;
    }
    if (parseOpponentsWithCountersCantAttackOrBlock(line) && src !== self && isCreature(creature) && anyCounter(creature)) {
      return `${creature?.card?.name || 'This creature'} can't attack while it has a counter`;
    }
  }
  return null;
}

export function batch111BlockRestrictionReason(attacker: any, blocker: any, battlefield: readonly any[], state?: any): string | null {
  if (!attacker || !blocker) return null;
  const view = state || { battlefield };
  for (const source of battlefield) {
    if (!source || source.phasedOut === true) continue;
    const line = textOf(source);
    const exceptType = parseEnchantedCantBeBlockedExceptBy(line);
    if (exceptType && isAuraOn(attacker, source) && !hasTypeWord(blocker, exceptType)) {
      return `Can't be blocked except by ${exceptType}s`;
    }
    if (parseYourCreaturesCantBeBlockedExceptLegendary(line) && controller(source) === controller(attacker) && !/\blegendary\b/.test(typeLine(blocker))) {
      return "Can't be blocked except by legendary creatures";
    }
    if (parseFlyingCantBlockYourCreatures(line) && controller(source) === controller(attacker) && hasFlying(blocker)) {
      return "Creatures with flying can't block this creature";
    }
    const colors = parseColorsCantBlock(line);
    if (colors.some((color) => hasColorWord(blocker, color))) return `${colors.join(' and ')} creatures can't block`;
    if (parseCantBeBlockedIfCastInstantOrSorcery(line) && same(source, attacker)
      && (spellThisTurn(view, controller(attacker), 'instant') || spellThisTurn(view, controller(attacker), 'sorcery'))) {
      return "Can't be blocked this turn";
    }
    if (parseEnchantedYouControlExceptDefender(line) && controller(source) === controller(attacker) && isCreature(attacker)
      && battlefield.some((aura) => isAuraOn(attacker, aura)) && !/\bdefender\b/i.test(String(blocker?.card?.oracle_text || ''))) {
      return "Can't be blocked except by creatures with defender";
    }
    const oilBlock = parseSelfPtIfOilCounters(line);
    if (oilBlock && same(source, attacker) && counterCount(attacker, 'oil') >= oilBlock.count && /can't be blocked/.test(line)) {
      return "Can't be blocked";
    }
    const gy = parseCantBeBlockedIfOpponentGraveyard(line);
    if (gy > 0 && same(source, attacker) && opponentHasGraveyard(view, controller(attacker), gy)) return "Can't be blocked";
    if (parseCantBlockUnlessGreaterPowerAlsoBlocks(line) && same(source, blocker)) {
      return null;
    }
  }
  return null;
}

export function batch111GreaterPowerBlockReason(
  assignments: readonly { blockerId?: string }[],
  battlefield: readonly any[],
): string | null {
  const ids = assignments.map((entry) => String(entry?.blockerId || '')).filter(Boolean);
  for (const id of new Set(ids)) {
    const blocker = battlefield.find((perm) => perm && String(perm.id || '') === id);
    if (!blocker || !parseCantBlockUnlessGreaterPowerAlsoBlocks(textOf(blocker))) continue;
    const mine = powerNow(blocker);
    const other = battlefield.filter((perm) => ids.includes(String(perm?.id || '')) && String(perm?.id || '') !== id && powerNow(perm) > mine);
    if (other.length === 0) return `${blocker?.card?.name || 'This creature'} can't block unless a creature with greater power also blocks`;
  }
  return null;
}

export function batch111UntapProhibition(permanent: any, state: any): string | null {
  for (const source of battlefieldOf(state)) {
    if (!source || source.phasedOut === true) continue;
    const line = textOf(source);
    const name = String(source?.card?.name || 'A permanent');
    if (parseNonlandDontUntap(line) && !/\bland\b/.test(typeLine(permanent))) return name;
    if (parseChosenTypeDontUntap(line) && chosenType(source) && isCreature(permanent) && hasTypeWord(permanent, chosenType(source))) return name;
    const powerNeed = parseNonwhitePowerDontUntap(line);
    if (powerNeed > 0 && isCreature(permanent) && !hasColorWord(permanent, 'white') && powerNow(permanent) >= powerNeed) return name;
  }
  return null;
}

export function batch111MaxBlockers(attacker: any, battlefield: readonly any[]): number {
  let max = Infinity;
  const self = controller(attacker);
  for (const source of battlefield) {
    if (!source || controller(source) !== self) continue;
    const line = textOf(source);
    const typed = parseTypeYouControlMaxBlockers(line);
    if (typed && hasTypeWord(attacker, typed.type)) max = Math.min(max, typed.max);
    const any = parseAnyCounterMaxBlockers(line);
    if (any > 0 && anyCounter(attacker)) max = Math.min(max, any);
  }
  return max;
}

export function batch111DefenderPower(permanent: any, state: any): number {
  const need = parseDefenderIfPowerAtLeast(textOf(permanent));
  if (need <= 0) return 0;
  return powerNow(permanent) >= need ? need : 0;
}

function spellCard(state: any, sourceId: string): any | null {
  const id = String(sourceId || '');
  if (!id) return null;
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const stacked = stack.find((item: any) => item && (String(item.id || '') === id || String(item.card?.id || '') === id));
  if (stacked) return stacked.card || stacked;
  const resolving = state?.resolvingSpellSource || state?.resolvingSpell;
  if (resolving && (String(resolving.id || '') === id || String(resolving.card?.id || '') === id)) return resolving.card || resolving;
  return null;
}

export function collectBatch111DamageAdjustments(
  state: any,
  input: { damageDealer: string; damageReceiver: string; damageSourcePermanentId?: string; isCombatDamage?: boolean; targetPermanentId?: string },
): Array<{ type: 'double' | 'add_flat' | 'cap_if_at_least'; value?: number; threshold?: number; source: string; controllerId?: string }> {
  const effects: Array<{ type: 'double' | 'add_flat' | 'cap_if_at_least'; value?: number; threshold?: number; source: string; controllerId?: string }> = [];
  const dealer = String(input.damageDealer || '');
  const receiver = String(input.damageReceiver || '');
  const card = spellCard(state, String(input.damageSourcePermanentId || ''));
  const type = String(card?.type_line || '').toLowerCase();
  const spellColors = Array.isArray(card?.colors) ? card.colors.map((color: unknown) => String(color).toUpperCase()) : [];
  for (const source of battlefieldOf(state)) {
    if (!source || source.phasedOut === true) continue;
    const line = textOf(source);
    const src = controller(source);
    const color = parseColorSpellDamageDouble(line);
    const letter = COLOR_LETTER[color];
    if (letter && src === dealer && !input.isCombatDamage && (type.includes('instant') || type.includes('sorcery')) && spellColors.includes(letter)) {
      effects.push({ type: 'double', source: String(source?.card?.name || 'Spell damage double'), controllerId: src });
    }
    const plus = parseNoncombatDamageToOpponentPlus(line);
    if (plus > 0 && src === dealer && !input.isCombatDamage && !input.targetPermanentId && receiver && receiver !== dealer) {
      effects.push({ type: 'add_flat', value: plus, source: String(source?.card?.name || 'Noncombat damage plus'), controllerId: src });
    }
    const cap = parseDamageBecomesIfAtLeast(line);
    if (cap) {
      effects.push({
        type: 'cap_if_at_least',
        value: cap.becomes,
        threshold: cap.atLeast,
        source: String(source?.card?.name || 'Damage cap'),
        controllerId: src,
      });
    }
  }
  return effects;
}

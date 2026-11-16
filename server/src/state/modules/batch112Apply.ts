// Batch 112 live apply for the leftover census lines.
// Public: the apply* and batch112* functions exported below.

import { createToken } from './counters_tokens-handlers/countersTokensCreateToken.js';
import {
  normalizeBatch112Oracle,
  parseAffinityForCreatures,
  parseAgeCounterPrevent,
  parseArabianNightsLock,
  parseArmyArtifactCreature,
  parseAttackerChoosesBlockers,
  parseAttackersCantCast,
  parseBasicLandColorChoice,
  parseBoastTwice,
  parseCantBeTargetOfColors,
  parseCantCastDuringCombat,
  parseCascadeAtMv,
  parseChosenLandPhasing,
  parseChosenPlayersDouble,
  parseClueTokensInstead,
  parseColorManaReplacement,
  parseConspireFromExile,
  parseCounterCap,
  parseCountersCantBePutOnTypes,
  parseCreaturesCantBeTargeted,
  parseCreatureSpellsCantBeCast,
  parseCrewOnce,
  parseDamageNotRemoved,
  parseDelayDamage,
  parseDestroyBecomesHeal,
  parseDoubleCascadeFromHand,
  parseEchoSacrificeLands,
  parseEnchantedDiesToHand,
  parseEnterUntappedWhileSourceUntapped,
  parseExileGraveyardForDamage,
  parseExileLibraryForDamage,
  parseFirstTokenCopiesEnchanted,
  parseFoodsDuringYourTurn,
  parseFungusSaprolingMana,
  parseGlobalWither,
  parseGreatestMvProtection,
  parseHasteAsThoughAttackingOpponents,
  parseHellbentSkipUpkeep,
  parseLandTypeCycle,
  parseLichMirror,
  parseLivingWeaponGrant,
  parseLookOneRestGraveyard,
  parseLoyaltyNinja,
  parseMonarchSmallCantAttackYou,
  parseMustAttackYou,
  parseMvArtifactsAreElementals,
  parseNamedPermanentBuff,
  parseNegativePowerAssignsPositive,
  parseNonartifactSpellLock,
  parseNontokenArtifactsAreLands,
  parseNontokenDiesBlood,
  parseOneLandUntap,
  parseOneOfEachToken,
  parseOpponentGraveyardExile,
  parseOpponentNontokenDiesZombie,
  parsePartyEnteredUnblockable,
  parsePlayersCantGetCounters,
  parsePowerEqualToCardsDrawn,
  parsePowerEqualToCraftedCards,
  parsePowerEqualToCreatureCardsInGraveyards,
  parsePreventAndRemoveCounter,
  parsePreventOne,
  parseProtectionFromColorsYouControl,
  parseProtectionFromGorgons,
  parsePtFromExiledCreature,
  parsePtFromStoredResults,
  parsePtHalfHighestOpponentLife,
  parseRadiationGainInstead,
  parseRayamiKeywords,
  parseRetraceDuringYourTurn,
  parseSelfExtraTurn,
  parseSharedFatePlay,
  parseSpaceSculptor,
  parseSpellHasDelve,
  parseSpendColorPair,
  parseTreasureCascade,
  parseTwoOrMoreManaBecomesColorless,
  parseWardExperience,
  parseWindCounterUntap,
  parseOtherCreaturesSpeed,
} from './batch112Parsers.js';

function textOf(perm: any): string {
  return normalizeBatch112Oracle(String(perm?.card?.oracle_text || ''), String(perm?.card?.name || ''));
}
function board(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}
function typeLine(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}
function ctrl(perm: any): string {
  return String(perm?.controller || '');
}
function yourTurn(state: any, playerId: string): boolean {
  const active = String(state?.turnPlayer || state?.activePlayer || '');
  return !active || active === playerId;
}
function graveyards(state: any): any[] {
  const zones = state?.zones && typeof state.zones === 'object' ? Object.values(state.zones) : [];
  return zones.flatMap((zone: any) => Array.isArray(zone?.graveyard) ? zone.graveyard : []);
}
function manaValue(card: any): number {
  const value = Number(card?.cmc ?? card?.mana_value ?? card?.manaValue);
  return Number.isFinite(value) ? value : 0;
}
function colorsOf(perm: any): string[] {
  const raw = perm?.card?.colors || perm?.colors || [];
  return Array.isArray(raw) ? raw.map((color: unknown) => String(color).toUpperCase()) : [];
}
function experience(state: any, playerId: string): number {
  const player = (state?.players || []).find((entry: any) => String(entry?.id || '') === playerId);
  return Math.max(0, Number(player?.experienceCounters || player?.counters?.experience || state?.experienceCounters?.[playerId] || 0));
}

export function applyBatch112PowerToughness(
  permanent: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  let nextPower = power;
  let nextToughness = toughness;
  const self = ctrl(permanent);
  for (const source of board(state)) {
    if (!source || source.phasedOut) continue;
    const line = textOf(source);
    const src = ctrl(source);
    if (parsePowerEqualToCreatureCardsInGraveyards(line) && source.id === permanent.id) {
      nextPower = graveyards(state).filter((card) => /\bcreature\b/i.test(String(card?.type_line || ''))).length;
    }
    if (parsePtHalfHighestOpponentLife(line) && source.id === permanent.id) {
      const lives = (state?.players || [])
        .filter((player: any) => String(player?.id || '') !== src)
        .map((player: any) => Number(state?.life?.[player.id] ?? player.life ?? 0));
      const half = Math.ceil(Math.max(0, ...lives, 0) / 2);
      nextPower = half;
      nextToughness = half;
    }
    if (parsePowerEqualToCardsDrawn(line) && source.id === permanent.id) {
      nextPower = Math.max(0, Number(state?.cardsDrawnThisTurn?.[src] || 0));
    }
    if (parsePowerEqualToCraftedCards(line) && source.id === permanent.id) {
      const cards = source.craftedFrom || source.exiledCards || [];
      nextPower = (Array.isArray(cards) ? cards : []).reduce((sum: number, card: any) => sum + Math.max(0, Number(card?.power || 0)), 0);
    }
    if (parsePtFromExiledCreature(line) && source.id === permanent.id) {
      const cards = [...(source.exiledCards || []), ...(source.imprinted || [])];
      const creature = [...cards].reverse().find((card: any) => /\bcreature\b/i.test(String(card?.type_line || '')));
      if (creature) {
        nextPower = Number(creature.power || 0);
        nextToughness = Number(creature.toughness || 0);
      }
    }
    if (parsePtFromStoredResults(line) && source.id === permanent.id) {
      const results = Array.isArray(source.storedResults) ? source.storedResults.map(Number) : [];
      const counts = new Map<number, number>();
      for (const result of results) counts.set(result, (counts.get(result) || 0) + 1);
      const best = Math.max(0, ...counts.values(), 0);
      nextPower += best;
      nextToughness += best;
    }
    if (parseOtherCreaturesSpeed(line) && src === self && source.id !== permanent.id && /\bcreature\b/.test(typeLine(permanent))) {
      const speed = Number(state?.speed?.[src] || state?.playerSpeed?.[src] || 0);
      nextPower += Math.max(0, speed);
    }
    const named = parseNamedPermanentBuff(line);
    if (named && source.id === permanent.id && named.names.every((name) => board(state).some((perm) => ctrl(perm) === src && String(perm?.card?.name || '').toLowerCase() === name))) {
      nextPower += named.power;
      nextToughness += named.toughness;
    }
    const elemental = parseMvArtifactsAreElementals(line);
    if (elemental && src === self && yourTurn(state, src) && manaValue(permanent.card) >= elemental.mv
      && ((/\bartifact\b/.test(typeLine(permanent)) && !/\bequipment\b/.test(typeLine(permanent)))
        || (/\benchantment\b/.test(typeLine(permanent)) && !/\baura\b/.test(typeLine(permanent))))) {
      nextPower = elemental.power;
      nextToughness = elemental.toughness;
    }
    const ninja = parseLoyaltyNinja(line);
    if (ninja && source.id === permanent.id && yourTurn(state, src) && Number(permanent?.counters?.loyalty || 0) > 0) {
      nextPower = ninja.power;
      nextToughness = ninja.toughness;
    }
  }
  return { power: nextPower, toughness: nextToughness };
}

export function batch112AdditionalTypes(permanent: any, state: any): string[] {
  const added = new Set<string>();
  for (const source of board(state)) {
    if (!source || source.phasedOut) continue;
    const line = textOf(source);
    const src = ctrl(source);
    if (parseFoodsDuringYourTurn(line) && src === ctrl(permanent) && yourTurn(state, src) && /\bartifact\b/.test(typeLine(permanent))) added.add('Food');
    if (parseNontokenArtifactsAreLands(line) && src === ctrl(permanent) && /\bartifact\b/.test(typeLine(permanent)) && permanent.isToken !== true && permanent.card?.isToken !== true) added.add('Land');
    if (parseMvArtifactsAreElementals(line) && src === ctrl(permanent) && yourTurn(state, src)) {
      const animated = (/\bartifact\b/.test(typeLine(permanent)) && !/\bequipment\b/.test(typeLine(permanent)))
        || (/\benchantment\b/.test(typeLine(permanent)) && !/\baura\b/.test(typeLine(permanent)));
      if (animated && manaValue(permanent.card) >= (parseMvArtifactsAreElementals(line)?.mv || 0)) {
        added.add('Creature');
        added.add('Elemental');
      }
    }
    if (parseArmyArtifactCreature(line) && source.id === permanent.id && yourTurn(state, src) && board(state).some((perm) => ctrl(perm) === src && /\barmy\b/.test(typeLine(perm)))) {
      added.add('Artifact');
      added.add('Creature');
    }
    if (parseLoyaltyNinja(line) && source.id === permanent.id && yourTurn(state, src) && Number(permanent?.counters?.loyalty || 0) > 0) {
      added.add('Creature');
      added.add('Ninja');
    }
    if (parsePtFromExiledCreature(line) && source.id === permanent.id) added.add('Shapeshifter');
  }
  return [...added];
}

export function batch112PermanentHasKeyword(permanent: any, state: any, keyword: string): boolean {
  const needle = String(keyword || '').toLowerCase();
  for (const source of board(state)) {
    if (!source || source.phasedOut) continue;
    const line = textOf(source);
    const src = ctrl(source);
    if (needle === 'living weapon' && parseLivingWeaponGrant(line) && src === ctrl(permanent) && /\bequipment\b/.test(typeLine(permanent))) return true;
    if (needle === 'phasing' && parseChosenLandPhasing(line) && /\bland\b/.test(typeLine(permanent))) {
      const chosen = String(source.chosenLandType || source.chosenType || '').toLowerCase();
      if (chosen && typeLine(permanent).includes(chosen)) return true;
    }
    if (needle === 'hexproof' && parseLoyaltyNinja(line) && source.id === permanent.id && yourTurn(state, src) && Number(permanent?.counters?.loyalty || 0) > 0) return true;
    if ((needle === 'indestructible' || needle === 'haste') && parseMvArtifactsAreElementals(line) && src === ctrl(permanent) && yourTurn(state, src)) return true;
    if (parseRayamiKeywords(line) && source.id === permanent.id) {
      const zones = state?.zones ? Object.values(state.zones) : [];
      const cards = zones.flatMap((zone: any) => Array.isArray(zone?.exile) ? zone.exile : []);
      if (cards.some((card: any) => Number(card?.counters?.blood || card?.bloodCounters || 0) > 0 && new RegExp(`\\b${needle}\\b`, 'i').test(String(card?.oracle_text || '')))) return true;
    }
    if (needle === 'protection' && parseProtectionFromGorgons(line) && (colorsOf(permanent).includes('G') || colorsOf(permanent).includes('W'))) return true;
  }
  return false;
}

export function batch112HasteDespiteSummoningSickness(permanent: any, state: any, defendingPlayerId?: string): boolean {
  const granted = board(state).some((source) => source && !source.phasedOut && parseHasteAsThoughAttackingOpponents(textOf(source)) && ctrl(source) === ctrl(permanent));
  if (!granted) return false;
  return !defendingPlayerId || defendingPlayerId !== ctrl(permanent);
}

export function batch112AttackRestriction(creature: any, state: any, defendingPlayerId?: string): string | null {
  const defender = String(defendingPlayerId || '');
  for (const source of board(state)) {
    if (!source || source.phasedOut) continue;
    const line = textOf(source);
    const cap = parseMonarchSmallCantAttackYou(line);
    if (cap > 0 && String(state?.monarch || '') === ctrl(source) && defender === ctrl(source)) {
      const power = Number(creature?.power ?? creature?.card?.power ?? 0);
      if (power <= cap) return `${creature?.card?.name || 'This creature'} can't attack the monarch`;
    }
  }
  return null;
}

export function batch112MustAttackReason(playerId: string, attackers: readonly any[], state: any): string | null {
  for (const source of board(state)) {
    if (!source || source.phasedOut || !parseMustAttackYou(textOf(source))) continue;
    if (ctrl(source) === playerId) continue;
    const hits = attackers.some((attacker) => String(attacker?.targetPlayerId || attacker?.defendingPlayerId || '') === ctrl(source)
      || board(state).some((perm) => perm.id === attacker?.targetPermanentId && ctrl(perm) === ctrl(source) && /\bplaneswalker\b/.test(typeLine(perm))));
    if (!hits) return `${source.card?.name || 'A permanent'} says you must attack its controller or a planeswalker they control`;
  }
  return null;
}

export function batch112BlockRestriction(attacker: any, _blocker: any, battlefield: readonly any[], state?: any): string | null {
  const view = state || { battlefield };
  const line = textOf(attacker);
  if (parsePartyEnteredUnblockable(line)) {
    const entered = board(view).some((perm) => perm && perm.id !== attacker.id && ctrl(perm) === ctrl(attacker) && perm.enteredThisTurn
      && /\b(cleric|rogue|warrior|wizard)\b/.test(typeLine(perm)));
    if (entered) return "Can't be blocked";
  }
  return null;
}

export function batch112AttackerChoosesBlockers(state: any): boolean {
  return board(state).some((source) => source && !source.phasedOut && parseAttackerChoosesBlockers(textOf(source)));
}

export function batch112CastRestriction(state: any, playerId: string, spell: any): string | null {
  const type = String(spell?.type_line || spell?.card?.type_line || '').toLowerCase();
  const setCode = String(spell?.set || spell?.card?.set || spell?.set_name || spell?.card?.set_name || '').toLowerCase();
  const phase = String(state?.phase || state?.step || '').toLowerCase();
  for (const source of board(state)) {
    if (!source || source.phasedOut) continue;
    const line = textOf(source);
    if (parseCreatureSpellsCantBeCast(line) && /\bcreature\b/.test(type)) return `${source.card?.name || 'A permanent'} says creature spells can't be cast`;
    if (parseNonartifactSpellLock(line) && !/\bartifact\b/.test(type)) {
      const cast = (state?.spellsCastThisTurn || []).some((entry: any) => String(entry?.casterId || entry?.playerId || '') === playerId
        && !/\bartifact\b/i.test(String(entry?.card?.type_line || entry?.type_line || '')));
      if (cast) return `${source.card?.name || 'A permanent'} stops another nonartifact spell this turn`;
    }
    if (parseCantCastDuringCombat(line) && /combat/.test(phase)) return `${source.card?.name || 'A permanent'} stops spells during combat`;
    if (parseAttackersCantCast(line) && ctrl(source) !== playerId && state?.attackedPlayersThisTurn?.[playerId]?.[ctrl(source)]) {
      return `${source.card?.name || 'A permanent'} stops spells from a player who attacked its controller`;
    }
    if (parseArabianNightsLock(line) && (setCode === 'arn' || setCode.includes('arabian'))) {
      return `${source.card?.name || 'City in a Bottle'} stops Arabian Nights cards`;
    }
  }
  return null;
}

export function batch112ManaAsThough(state: any, playerId: string, color: string): string | null {
  const letter = String(color || '').toUpperCase();
  const word: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
  for (const source of board(state)) {
    if (!source || ctrl(source) !== playerId) continue;
    const pair = parseSpendColorPair(textOf(source));
    if (pair && word[letter] === pair.from) return pair.to;
  }
  return null;
}

const LAND_CYCLE: Record<string, string> = { plains: 'R', island: 'G', swamp: 'W', mountain: 'U', forest: 'B' };

export function applyBatch112ManaProduction(info: any, state: any, permanent: any, playerId: string): any {
  if (!info) return info;
  const next = { ...info };
  if (batch112GrantsFungusMana(permanent, state)) {
    const colors = Array.isArray(next.colors) ? next.colors : [];
    if (!colors.includes('G')) next.colors = [...colors, 'G'];
    next.totalAmount = Math.max(1, Number(next.totalAmount || next.baseAmount || 0));
  }
  const land = /\bland\b/.test(typeLine(permanent));
  const basic = land && /\bbasic\b/.test(typeLine(permanent));
  for (const source of board(state)) {
    if (!source || source.phasedOut) continue;
    const line = textOf(source);
    const src = ctrl(source);
    if (basic && src === playerId && parseBasicLandColorChoice(line)) {
      next.requiresColorChoice = true;
      next.colors = ['W', 'U', 'B', 'R', 'G'];
    }
    const color = parseColorManaReplacement(line);
    if (land && color) {
      next.colors = [color];
      next.requiresColorChoice = false;
      next.totalAmount = Math.max(1, Number(next.baseAmount || 1));
    }
    if (land && parseTwoOrMoreManaBecomesColorless(line) && Number(next.totalAmount || next.baseAmount || 1) >= 2) {
      next.colors = ['C'];
      next.totalAmount = 1;
      next.baseAmount = 1;
      next.requiresColorChoice = false;
    }
    if (land && parseLandTypeCycle(line)) {
      for (const [type, produced] of Object.entries(LAND_CYCLE)) {
        if (typeLine(permanent).includes(type)) {
          next.colors = [produced];
          next.requiresColorChoice = false;
        }
      }
    }
  }
  return next;
}

export function batch112GlobalWither(state: any): boolean {
  return board(state).some((source) => source && !source.phasedOut && parseGlobalWither(textOf(source)));
}

export function batch112CombatDamageAmount(perm: any, power: number): number {
  if (power < 0 && parseNegativePowerAssignsPositive(textOf(perm))) return Math.abs(power);
  return power;
}

export function batch112SkipDamageCleanup(perm: any): boolean {
  return parseDamageNotRemoved(textOf(perm));
}

export function batch112UntapReplacement(permanent: any, state: any, landsUntapped: number): 'stop' | 'remove-wind' | null {
  if (/\bland\b/.test(typeLine(permanent)) && landsUntapped >= 1 && board(state).some((source) => parseOneLandUntap(textOf(source)) && ctrl(source) === ctrl(permanent))) return 'stop';
  if (Number(permanent?.counters?.wind || 0) > 0 && board(state).some((source) => parseWindCounterUntap(textOf(source)))) return 'remove-wind';
  return null;
}

export function batch112EntersUntapped(card: any, controllerId: string, state: any): boolean {
  return board(state).some((source) => source && !source.phasedOut && !source.tapped && ctrl(source) === controllerId
    && parseEnterUntappedWhileSourceUntapped(textOf(source)) && String(source.id || '') !== String(card?.id || ''));
}

export function batch112CounterAllowed(state: any, perm: any, counter: string, nextCount: number): boolean {
  for (const source of board(state)) {
    if (!source || source.phasedOut) continue;
    const cap = parseCounterCap(textOf(source));
    if (cap && source.id === perm?.id && counter.toLowerCase().includes(cap.name) && nextCount > cap.max) return false;
    if (parsePlayersCantGetCounters(textOf(source)) && String(perm?.id || '').startsWith('player:')) return false;
    if (parseCountersCantBePutOnTypes(textOf(source))) {
      const tl = typeLine(perm);
      if (/\bartifact\b|\bcreature\b|\benchantment\b|\bland\b/.test(tl)) return false;
    }
  }
  return true;
}

export function batch112RadiationGainsLife(state: any, playerId: string): boolean {
  return board(state).some((source) => source && ctrl(source) === playerId && parseRadiationGainInstead(textOf(source)));
}

export function batch112BoastLimit(state: any, playerId: string): number {
  return board(state).some((source) => source && ctrl(source) === playerId && parseBoastTwice(textOf(source))) ? 2 : 1;
}

export function batch112GrantsRetrace(state: any, playerId: string, card: any): boolean {
  if (!yourTurn(state, playerId)) return false;
  const tl = String(card?.type_line || '').toLowerCase();
  if (!tl || /\bland\b/.test(tl) || !/\b(creature|artifact|enchantment|planeswalker|battle)\b/.test(tl)) return false;
  return board(state).some((source) => source && ctrl(source) === playerId && parseRetraceDuringYourTurn(textOf(source)));
}

export function batch112WardCost(permanent: any, state: any): string | null {
  if (!parseWardExperience(textOf(permanent))) return null;
  return `{${experience(state, ctrl(permanent))}}`;
}

export function batch112SkipUpkeep(state: any, playerId: string): boolean {
  const hand = state?.zones?.[playerId]?.hand;
  const empty = Array.isArray(hand) ? hand.length === 0 : Number(state?.zones?.[playerId]?.handCount || 0) === 0;
  return empty && board(state).some((source) => source && ctrl(source) === playerId && parseHellbentSkipUpkeep(textOf(source)));
}

export function batch112MayPlayExiledCard(state: any, playerId: string, card: any): boolean {
  return board(state).some((source) => {
    if (!source || !parseSharedFatePlay(textOf(source))) return false;
    const exiledBy = String(card?.exiledBy || card?.exiledWith || '');
    const actor = String(card?.exiledByPlayer || card?.exiledFor || '');
    return exiledBy === String(source.id || '') && actor === playerId;
  });
}

export function batch112SpellKeyword(state: any, playerId: string, card: any, keyword: string, zone?: string): boolean {
  const type = String(card?.type_line || '').toLowerCase();
  const mv = manaValue(card);
  const fromHand = !zone || zone === 'hand';
  const fromExile = zone === 'exile';
  for (const source of board(state)) {
    if (!source || source.phasedOut || ctrl(source) !== playerId) continue;
    const line = textOf(source);
    if (keyword === 'delve' && parseSpellHasDelve(line)) return true;
    if (keyword === 'cascade' && parseCascadeAtMv(line) > 0 && mv >= parseCascadeAtMv(line)) return true;
    if (keyword === 'cascade' && parseDoubleCascadeFromHand(line) > 0 && fromHand && mv >= parseDoubleCascadeFromHand(line) && colorsOf(card).length === 0) return true;
    if (keyword === 'cascade' && parseTreasureCascade(line) && state?.treasureManaSpentOnSpell?.[playerId]) return true;
    if (keyword === 'conspire' && parseConspireFromExile(line) && fromExile && !/\bcreature\b/.test(type)) return true;
    if (keyword === 'affinity' && parseAffinityForCreatures(line) && (/\binstant\b/.test(type) || /\bsorcery\b/.test(type))) return true;
  }
  return false;
}

export function batch112CascadeExtra(state: any, playerId: string, card: any, zone?: string): number {
  const mv = manaValue(card);
  let extra = 0;
  for (const source of board(state)) {
    if (!source || ctrl(source) !== playerId) continue;
    const line = textOf(source);
    if (parseCascadeAtMv(line) > 0 && mv >= parseCascadeAtMv(line)) extra += 1;
    if (parseDoubleCascadeFromHand(line) > 0 && (!zone || zone === 'hand') && mv >= parseDoubleCascadeFromHand(line) && colorsOf(card).length === 0) extra += 2;
    if (parseTreasureCascade(line) && state?.treasureManaSpentOnSpell?.[playerId] && !(state?.treasureCascadeUsed?.[playerId])) extra += 1;
  }
  return extra;
}

export function batch112DamageAdjustments(state: any, input: { damageDealer: string; damageReceiver: string; isCombatDamage?: boolean; targetPermanentId?: string }): Array<{ type: 'add_flat' | 'prevent' | 'double'; value?: number; source: string }> {
  const effects: Array<{ type: 'add_flat' | 'prevent' | 'double'; value?: number; source: string }> = [];
  for (const source of board(state)) {
    if (!source || source.phasedOut) continue;
    const line = textOf(source);
    const prevented = parsePreventOne(line);
    if (prevented && (input.damageReceiver === ctrl(source) || (input.targetPermanentId && board(state).some((perm) => perm.id === input.targetPermanentId && ctrl(perm) === ctrl(source))))) {
      effects.push({ type: 'add_flat', value: -prevented, source: String(source.card?.name || 'Prevent damage') });
    }
    if (parseAgeCounterPrevent(line) && input.isCombatDamage && input.damageReceiver === ctrl(source)) {
      const age = Number(source.counters?.age || 0);
      if (age > 0) effects.push({ type: 'add_flat', value: -age, source: String(source.card?.name || 'Age counters') });
    }
    if (parseChosenPlayersDouble(line)) {
      const chosen = source.chosenPlayers || source.chosenPlayerIds || [];
      if (Array.isArray(chosen) && chosen.includes(input.damageDealer) && chosen.includes(input.damageReceiver) && input.damageDealer !== input.damageReceiver) {
        effects.push({ type: 'double', source: String(source.card?.name || 'Chosen players') });
      }
    }
  }
  return effects;
}

export function applyBatch112DamageReplacement(state: any, amount: number, dealer: string, receiver: string, targetId?: string): { amount: number; note?: string } | null {
  for (const source of board(state)) {
    if (!source || source.phasedOut) continue;
    const line = textOf(source);
    if (parseDelayDamage(line) && receiver === ctrl(source) && !targetId) {
      source.counters = source.counters || {};
      source.counters.delay = Number(source.counters.delay || 0) + amount;
      return { amount: 0, note: 'delay counters' };
    }
    if (parseExileGraveyardForDamage(line) && receiver === ctrl(source) && !targetId) {
      const gy = state?.zones?.[receiver]?.graveyard;
      if (!Array.isArray(gy) || gy.length < amount) return { amount, note: 'lose-instead' };
      gy.splice(0, amount);
      return { amount: 0, note: 'exiled graveyard' };
    }
    if (parseExileLibraryForDamage(line) && !targetId) {
      const lib = state?.zones?.[receiver]?.library;
      if (Array.isArray(lib)) {
        const exile = state.zones[receiver].exile || (state.zones[receiver].exile = []);
        exile.push(...lib.splice(0, amount));
      }
      return { amount: 0, note: 'exiled library' };
    }
    if (parsePreventAndRemoveCounter(line) && targetId === source.id && Number(source.counters?.['+1/+1'] || 0) > 0) {
      source.counters['+1/+1'] -= 1;
      return { amount: 0, note: 'removed counter' };
    }
  }
  return null;
}

export function batch112DestroyReplacement(state: any, permanentId: string): boolean {
  const perm = board(state).find((entry) => entry && String(entry.id) === permanentId);
  if (!perm || Number(perm.counters?.['+1/+1'] || 0) <= 0) return false;
  const saved = board(state).some((source) => source && source.id !== perm.id && ctrl(source) === ctrl(perm) && parseDestroyBecomesHeal(textOf(source)));
  if (!saved) return false;
  perm.counters['+1/+1'] = 0;
  perm.markedDamage = 0;
  perm.damageMarked = 0;
  perm.damage = 0;
  return true;
}

export function batch112ZoneFollowup(ctx: any, object: any, metadata: any): void {
  const state = ctx?.state;
  if (!state || !metadata) return;
  if (metadata.createZombieToken) {
    const owner = String(metadata.sourceController || object?.controller || '');
    if (owner) createToken(ctx, owner, 'Zombie', 1, 2, 2, { colors: ['B'], typeLine: 'Creature — Zombie Token' }, true);
  }
  if (metadata.bloodCounter && object) {
    object.counters = object.counters || {};
    object.counters.blood = Number(object.counters.blood || 0) + 1;
  }
  if (metadata.voidCounter && object) {
    object.counters = object.counters || {};
    object.counters.void = Number(object.counters.void || 0) + 1;
  }
  if (metadata.extraTurn) {
    state.extraTurns = Array.isArray(state.extraTurns) ? state.extraTurns : [];
    state.extraTurns.push({ playerId: String(metadata.sourceController || object?.controller || '') });
  }
}

export function batch112LoseGameReplacement(state: any, playerId: string): boolean {
  return board(state).some((source) => source && ctrl(source) === playerId && parseLichMirror(textOf(source)));
}

export function shuffleForLichMirror(state: any, playerId: string): void {
  const zones = state.zones?.[playerId];
  if (!zones) return;
  const library = Array.isArray(zones.library) ? zones.library : [];
  library.push(...(zones.hand || []), ...(zones.graveyard || []));
  const owned = board(state).filter((perm) => String(perm?.owner || perm?.card?.owner || perm?.controller || '') === playerId);
  for (const perm of owned) library.push(perm.card || perm);
  state.battlefield = board(state).filter((perm) => !owned.includes(perm));
  zones.hand = [];
  zones.graveyard = [];
  zones.library = library;
  zones.handCount = 0;
  zones.graveyardCount = 0;
  zones.libraryCount = library.length;
  const drawn = library.splice(0, 7);
  zones.hand = drawn;
  zones.handCount = drawn.length;
  state.life = state.life || {};
  state.life[playerId] = 20;
  const player = (state.players || []).find((entry: any) => String(entry?.id) === playerId);
  if (player) player.life = 20;
}

export function batch112TokenReplacement(state: any, playerId: string, tokenName: string): { name: string; countMultiplier: number; also?: string[] } | null {
  for (const source of board(state)) {
    if (!source || ctrl(source) !== playerId) continue;
    const line = textOf(source);
    if (parseOneOfEachToken(line) && /clue|food|treasure/i.test(tokenName)) return { name: tokenName, countMultiplier: 1, also: ['Clue', 'Food', 'Treasure'] };
    if (parseClueTokensInstead(line)) return { name: 'Clue', countMultiplier: 1 };
    if (parseFirstTokenCopiesEnchanted(line) && !state.copiedEnchantedTokenThisTurn?.[playerId]) {
      const host = board(state).find((perm) => perm && String(perm.id) === String(source.attachedTo || ''));
      if (host) {
        state.copiedEnchantedTokenThisTurn = state.copiedEnchantedTokenThisTurn || {};
        state.copiedEnchantedTokenThisTurn[playerId] = true;
        return { name: String(host.card?.name || 'Copy'), countMultiplier: 1 };
      }
    }
  }
  return null;
}

export function batch112LookCount(text: string, name?: string): number {
  return parseLookOneRestGraveyard(normalizeBatch112Oracle(text, name));
}

export function batch112CrewOnce(permanent: any): boolean {
  return parseCrewOnce(textOf(permanent));
}

export function batch112EchoLandCount(text: string): number {
  return parseEchoSacrificeLands(normalizeBatch112Oracle(text));
}

export function batch112GrantsFungusMana(permanent: any, state: any): boolean {
  return /\b(fungus|saproling)\b/.test(typeLine(permanent)) && board(state).some((source) => ctrl(source) === ctrl(permanent) && parseFungusSaprolingMana(textOf(source)));
}

export function batch112HasSectorRule(state: any): boolean {
  return board(state).some((source) => source && parseSpaceSculptor(textOf(source)));
}

export function batch112ProtectionFromColor(permanent: any, state: any, colorWord: string): boolean {
  const attached = board(state).find((aura) => aura && String(aura.attachedTo || '') === String(permanent?.id || '') && parseProtectionFromColorsYouControl(textOf(aura)));
  if (!attached) return false;
  const colors = new Set<string>();
  for (const perm of board(state)) if (ctrl(perm) === ctrl(attached)) colorsOf(perm).forEach((color) => colors.add(color));
  const letter: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  return colors.has(letter[colorWord] || colorWord.toUpperCase());
}

export function batch112CantBeTargetOfSpell(permanent: any, spell: any, state: any): boolean {
  const spellColors = colorsOf(spell);
  const words: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
  const banned = parseCantBeTargetOfColors(textOf(permanent));
  if (banned.some((word) => spellColors.some((color) => words[color] === word))) return true;
  return /\bcreature\b/.test(typeLine(permanent)) && board(state).some((source) => parseCreaturesCantBeTargeted(textOf(source)));
}

export function batch112EnchantedDiesToHand(state: any, permanent: any): boolean {
  return board(state).some((aura) => aura && String(aura.attachedTo || '') === String(permanent?.id || '') && parseEnchantedDiesToHand(textOf(aura)))
    || board(state).some((source) => ctrl(source) === ctrl(permanent) && parseEnchantedDiesToHand(textOf(source))
      && board(state).some((aura) => String(aura.attachedTo || '') === String(permanent?.id || '')));
}

export function batch112OpponentZombieExile(state: any, permanent: any): { controller: string } | null {
  if (permanent?.isToken || permanent?.card?.isToken) return null;
  const source = board(state).find((entry) => entry && parseOpponentNontokenDiesZombie(textOf(entry)) && ctrl(entry) !== ctrl(permanent));
  return source ? { controller: ctrl(source) } : null;
}

export function batch112BloodExile(state: any, permanent: any): boolean {
  return !permanent?.isToken && !permanent?.card?.isToken && board(state).some((source) => parseNontokenDiesBlood(textOf(source)));
}

export function batch112OpponentGraveyardToExile(state: any, ownerId: string): { void: boolean } | null {
  const source = board(state).find((entry) => entry && ctrl(entry) !== ownerId && parseOpponentGraveyardExile(textOf(entry)));
  if (!source) return null;
  return { void: /void counter/.test(textOf(source)) };
}

export function batch112SelfExtraTurn(permanent: any): boolean {
  return parseSelfExtraTurn(textOf(permanent));
}

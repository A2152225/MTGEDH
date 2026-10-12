// server/src/state/modules/staticEffectSpecConditionEval.ts
// Origin parent: server/src/state/modules/staticEffectSpec.ts
// Cluster: specMatchesStaticCondition + StaticConditionState (unknown kinds do not grant).
// Public entry symbols: specMatchesStaticCondition, StaticConditionState,
// permanentHasKeywordAbility, StaticKeywordResolver.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { permanentHasCreatureType } from '../../../../shared/src/creatureTypes.js';
import { collectPrintedColorSymbols, printedObjectHasManaColor } from './printedColorSymbols.js';

export type StaticConditionState = {
  battlefield?: readonly BattlefieldPermanent[];
  life?: Record<string, number>;
  startingLife?: number;
  turnPlayer?: string;
  zones?: Record<string, {
    graveyard?: readonly unknown[];
    hand?: readonly unknown[];
    handCount?: number;
  }>;
  players?: readonly {
    id?: string;
    ringBearerId?: string;
    ringBearerPermanentId?: string;
    attackedThisTurn?: boolean;
  }[];
  /** Player-id â†’ attacked this turn (boolean / truthy). */
  attackedThisTurn?: Record<string, unknown>;
  /** Player-id â†’ creatures that attacked this turn. */
  creaturesAttackedThisTurn?: Record<string, number>;
  /** Player-id â†’ city's blessing (Ascend). */
  cityBlessing?: Record<string, unknown>;
};

type ConditionSpec = {
  condition?: {
    kind?: string;
    offset?: number;
    color?: string;
    landType?: string;
    keyword?: string;
    keywords?: readonly string[];
    power?: number;
    creatureType?: string;
    cardType?: string;
    count?: number;
    other?: boolean;
    creaturesOnly?: boolean;
    amount?: number;
    counterType?: string;
  };
  conditions?: readonly { kind?: string; color?: string; cardType?: string; keyword?: string; keywords?: readonly string[]; power?: number; creatureType?: string; landType?: string; offset?: number; count?: number; other?: boolean; creaturesOnly?: boolean; amount?: number; counterType?: string }[];
  sourceController?: string;
  sourcePermanentId?: string;
  sourceName?: string;
};

function colorNameToSymbol(colorName: string): string | null {
  const colorMap: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    w: 'W',
    u: 'U',
    b: 'B',
    r: 'R',
    g: 'G',
  };
  return colorMap[String(colorName || '').trim().toLowerCase()] || null;
}

function creatureHasManaColor(permanent: BattlefieldPermanent, colorName: string): boolean {
  const symbol = colorNameToSymbol(colorName);
  const colors = collectPrintedColorSymbols(permanent);
  const added = Array.isArray((permanent as any).colorAdditions)
    ? ((permanent as any).colorAdditions as string[]).map((entry) => String(entry).toUpperCase())
    : [];
  const effective = [...new Set([...colors, ...added])];
  if (symbol && effective.includes(symbol)) return true;
  return printedObjectHasManaColor(permanent, colorName);
}

function isCreaturePermanent(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('creature') || typeLine.includes('kindred') || typeLine.includes('tribal');
}

function isLegendaryCreaturePermanent(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('legendary') && isCreaturePermanent(permanent);
}

function isLandPermanent(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('land');
}

function permanentEnchantedByAuraYouControl(
  permanent: BattlefieldPermanent,
  spec: ConditionSpec,
  state: StaticConditionState,
): boolean {
  const hostId = String(permanent.id || '').trim();
  const controller = String(spec.sourceController || '').trim();
  if (!hostId || !controller) return false;
  return (state.battlefield || []).some((perm) => {
    if (String(perm.attachedTo || '') !== hostId) return false;
    if (String(perm.controller || '') !== controller) return false;
    const typeLine = String((perm.card as any)?.type_line || (perm as any).type_line || '').toLowerCase();
    return typeLine.includes('aura');
  });
}

function sourcePermanentIsUntapped(spec: ConditionSpec, state: StaticConditionState): boolean {
  const sourceId = String(spec.sourcePermanentId || '').trim();
  if (!sourceId) return false;
  const source = (state.battlefield || []).find((perm) => String(perm.id || '') === sourceId);
  if (!source) return false;
  return source.tapped !== true;
}

function permanentIsAttacking(permanent: BattlefieldPermanent): boolean {
  return Boolean((permanent as any).attacking) || (permanent as any).isAttacking === true;
}

function sourcePermanentIsAttacking(spec: ConditionSpec, state: StaticConditionState): boolean {
  const sourceId = String(spec.sourcePermanentId || '').trim();
  if (!sourceId) return false;
  const source = (state.battlefield || []).find((perm) => String(perm.id || '') === sourceId);
  if (!source) return false;
  return permanentIsAttacking(source);
}

function permanentIsRingBearer(
  permanent: BattlefieldPermanent,
  spec: ConditionSpec,
  state: StaticConditionState,
): boolean {
  if ((permanent as any).isRingBearer === true) return true;
  const permanentId = String(permanent.id || '').trim();
  if (!permanentId) return false;
  const controller = String(permanent.controller || spec.sourceController || '').trim();
  const players = Array.isArray(state.players) ? state.players : [];
  return players.some((player) => {
    const playerId = String(player?.id || '').trim();
    if (controller && playerId && playerId !== controller) return false;
    const ringBearerId = String(player?.ringBearerId || player?.ringBearerPermanentId || '').trim();
    return ringBearerId === permanentId;
  });
}

function playerLevelAttackedThisTurn(state: StaticConditionState, controller: string): boolean {
  const attackedMap = state.attackedThisTurn;
  if (attackedMap && typeof attackedMap === 'object') {
    const flag = attackedMap[controller];
    if (flag === true) return true;
    if (typeof flag === 'number' && flag > 0) return true;
  }
  const attackedCount = Number(state.creaturesAttackedThisTurn?.[controller] || 0);
  if (attackedCount > 0) return true;
  const players = Array.isArray(state.players) ? state.players : [];
  return players.some((player) => {
    const playerId = String(player?.id || '').trim();
    return playerId === controller && player?.attackedThisTurn === true;
  });
}

function sourceControllerAttackedThisTurn(spec: ConditionSpec, state: StaticConditionState): boolean {
  const controller = String(spec.sourceController || '').trim();
  if (!controller) return false;
  if (playerLevelAttackedThisTurn(state, controller)) return true;
  return (state.battlefield || []).some((perm) => {
    if (String(perm.controller || '') !== controller) return false;
    return Boolean((perm as any).attacking)
      || (perm as any).isAttacking === true
      || Boolean((perm as any).attackedThisTurn);
  });
}

function sourceIsInControllerGraveyard(
  spec: ConditionSpec,
  state: StaticConditionState,
): boolean {
  const controller = String(spec.sourceController || '');
  if (!controller) return false;
  const graveyard = Array.isArray(state.zones?.[controller]?.graveyard)
    ? state.zones[controller]!.graveyard!
    : [];
  const sourceId = String(spec.sourcePermanentId || '').trim();
  const sourceName = String(spec.sourceName || '').trim().toLowerCase();
  return graveyard.some((card) => {
    if (typeof card !== 'object' || card === null) return false;
    const record = card as { id?: unknown; name?: unknown; card?: { id?: unknown; name?: unknown } };
    if (sourceId) {
      if (String(record.id || '').trim() === sourceId) return true;
      if (String(record.card?.id || '').trim() === sourceId) return true;
    }
    if (!sourceName) return false;
    const cardName = String(record.name || record.card?.name || '').trim().toLowerCase();
    return cardName.length > 0 && cardName === sourceName;
  });
}

function sourceControllerControlsMatching(
  spec: ConditionSpec,
  condition: { creatureType?: string; cardType?: string; count?: number; other?: boolean; creaturesOnly?: boolean },
  state: StaticConditionState,
): boolean {
  const controller = String(spec.sourceController || '').trim();
  if (!controller) return false;
  const sourceId = String((spec as any).sourcePermanentId || '').trim();
  const wantedType = String(condition.creatureType || '').trim().toLowerCase();
  const wantedCard = String(condition.cardType || '').trim().toLowerCase();
  let count = 0;
  for (const perm of state.battlefield || []) {
    if (!perm || String((perm as any).controller || '') !== controller) continue;
    if (condition.other && String((perm as any).id || '') === sourceId) continue;
    const typeLine = String((perm.card as any)?.type_line || '').toLowerCase();
    if (wantedCard) {
      if (wantedCard === 'token') {
        if ((perm as any).isToken !== true) continue;
      } else if (!typeLine.includes(wantedCard)) continue;
    } else if (wantedType) {
      if (condition.creaturesOnly && !typeLine.includes('creature')) continue;
      const hasType = new RegExp(`\\b${wantedType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(typeLine)
        || /\bchangeling\b/i.test(String((perm.card as any)?.oracle_text || ''));
      if (!hasType) continue;
    }
    count += 1;
  }
  return count >= Math.max(1, Number(condition.count || 1));
}

function sourceControllerHasThreshold(spec: ConditionSpec, state: StaticConditionState): boolean {
  const controller = String(spec.sourceController || '').trim();
  if (!controller) return false;
  const graveyard = Array.isArray(state.zones?.[controller]?.graveyard)
    ? state.zones[controller]!.graveyard!
    : [];
  return graveyard.length >= 7;
}

function sourceControllerHandCount(spec: ConditionSpec, state: StaticConditionState): number | null {
  const controller = String(spec.sourceController || '').trim();
  if (!controller) return null;
  const zone = state.zones?.[controller];
  if (typeof zone?.handCount === 'number' && Number.isFinite(zone.handCount)) {
    return Math.max(0, Math.floor(zone.handCount));
  }
  if (Array.isArray(zone?.hand)) return zone.hand.length;
  return null;
}

/**
 * Shared current-power reader, registered by currentPowerToughness.ts. currentPowerToughness.ts imports
 * staticEffectSpec.ts, which imports this file, so a direct import here would be circular; the hook keeps the
 * dependency one-way (registration happens when currentPowerToughness.ts loads).
 */
type CurrentPowerResolver = (permanent: BattlefieldPermanent, state: StaticConditionState) => number | undefined;
let currentPowerResolver: CurrentPowerResolver | undefined;
/** Permanents whose current power is being computed right now (guards spec -> power -> spec recursion). */
const permanentsResolvingCurrentPower = new Set<string>();

export function registerStaticConditionCurrentPowerResolver(resolver: CurrentPowerResolver | undefined): void {
  currentPowerResolver = resolver;
}

function readPermanentPower(permanent: BattlefieldPermanent, state?: StaticConditionState): number {
  const guardKey = String((permanent as { id?: unknown }).id ?? '');
  if (currentPowerResolver && state && guardKey && !permanentsResolvingCurrentPower.has(guardKey)) {
    permanentsResolvingCurrentPower.add(guardKey);
    try {
      const current = currentPowerResolver(permanent, state);
      if (typeof current === 'number' && Number.isFinite(current)) return current;
    } catch {
      // fall through to the cached/printed reader
    } finally {
      permanentsResolvingCurrentPower.delete(guardKey);
    }
  }
  return readCachedPermanentPower(permanent);
}

function readCachedPermanentPower(permanent: BattlefieldPermanent): number {
  const record = permanent as BattlefieldPermanent & {
    effectivePower?: number;
    power?: number | string;
    basePower?: number | string;
    counters?: Record<string, number>;
    card?: { power?: number | string };
  };
  if (typeof record.effectivePower === 'number' && Number.isFinite(record.effectivePower)) {
    return record.effectivePower;
  }
  const printedRaw = record.power ?? record.basePower ?? record.card?.power;
  const printed = typeof printedRaw === 'number' ? printedRaw : parseInt(String(printedRaw ?? ''), 10);
  const base = Number.isFinite(printed) ? printed : 0;
  const counters = record.counters && typeof record.counters === 'object' ? record.counters : {};
  const plus = Number(counters['+1/+1'] || 0) || 0;
  const minus = Number(counters['-1/-1'] || 0) || 0;
  return base + plus - minus;
}

export function permanentHasKeywordAbility(permanent: BattlefieldPermanent, keyword: string): boolean {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  const record = permanent as BattlefieldPermanent & {
    keywords?: unknown;
    grantedAbilities?: unknown;
    oracle_text?: string;
    card?: { keywords?: unknown; oracle_text?: string };
  };
  const keywordLists = [record.keywords, record.card?.keywords, record.grantedAbilities];
  for (const list of keywordLists) {
    if (Array.isArray(list) && list.some((entry) => String(entry || '').trim().toLowerCase() === kw)) {
      return true;
    }
    if (list && typeof list === 'object' && !Array.isArray(list)) {
      const map = list as Record<string, unknown>;
      if (map[kw] === true || map[keyword] === true) return true;
    }
  }
  const oracle = String(record.card?.oracle_text || record.oracle_text || '');
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}\\b`, 'im').test(oracle);
}

function permanentColorSymbols(
  permanent: BattlefieldPermanent,
): string[] {
  const printed = collectPrintedColorSymbols(permanent);
  const added = Array.isArray((permanent as any).colorAdditions)
    ? ((permanent as any).colorAdditions as string[]).map((entry) => String(entry).toUpperCase())
    : [];
  return [...new Set([...printed, ...added])].filter((symbol) => ['W', 'U', 'B', 'R', 'G'].includes(symbol));
}

function permanentIsModified(
  permanent: BattlefieldPermanent,
  state: StaticConditionState,
): boolean {
  const counters = (permanent as any).counters;
  if (counters && typeof counters === 'object') {
    for (const value of Object.values(counters)) {
      if (typeof value === 'number' && value > 0) return true;
    }
  }
  if (permanentIsEquipped(permanent, state)) return true;
  const permanentId = String(permanent.id || '').trim();
  if (!permanentId) return false;
  return (state.battlefield || []).some((candidate) => {
    if (String((candidate as any).attachedTo || (candidate as any).enchanting || '').trim() !== permanentId) {
      return false;
    }
    const typeLine = String((candidate.card as any)?.type_line || '').toLowerCase();
    return typeLine.includes('aura');
  });
}

function permanentIsEquipped(
  permanent: BattlefieldPermanent,
  state: StaticConditionState,
): boolean {
  if ((permanent as any).isEquipped === true) return true;
  const attachedEquipment = Array.isArray((permanent as any).attachedEquipment)
    ? (permanent as any).attachedEquipment
    : [];
  if (attachedEquipment.length > 0) return true;
  const permanentId = String(permanent.id || '').trim();
  if (!permanentId) return false;
  return (state.battlefield || []).some((candidate) => {
    if (String((candidate as any).attachedTo || '').trim() !== permanentId) return false;
    const typeLine = String((candidate.card as any)?.type_line || '').toLowerCase();
    return typeLine.includes('equipment');
  });
}

/** Optional layer-6 keyword view (grants then removeAbilities). Printed fallback if omitted. */
export type StaticKeywordResolver = (permanent: BattlefieldPermanent, keyword: string) => boolean;

/** CR 700.8: Assassins, Mercenaries, Pirates, Rogues, and Warlocks are outlaws. */
const OUTLAW_CREATURE_TYPES = ['assassin', 'mercenary', 'pirate', 'rogue', 'warlock'] as const;

function permanentIsHistoric(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || (permanent as any).type_line || '').toLowerCase();
  return /\bartifact\b/.test(typeLine) || /\blegendary\b/.test(typeLine) || /\bsaga\b/.test(typeLine);
}

function sourceControllerHasCitysBlessing(spec: ConditionSpec, state: StaticConditionState): boolean {
  const controller = String(spec.sourceController || '').trim();
  if (!controller) return false;
  const map = state.cityBlessing;
  if (!map || typeof map !== 'object') return false;
  return map[controller] === true;
}

function permanentHasManaAbility(permanent: BattlefieldPermanent): boolean {
  const texts: string[] = [String((permanent.card as any)?.oracle_text || '')];
  for (const entry of Array.isArray((permanent as any).grantedAbilities) ? (permanent as any).grantedAbilities : []) {
    texts.push(String(entry || ''));
  }
  return texts.some((text) => {
    const lower = String(text || '').toLowerCase();
    if (/^tap_for_/.test(lower.trim())) return true;
    return /\{t\}(?:,[^:]*)?:\s*add\b/i.test(lower);
  });
}

export function specMatchesStaticCondition(
  permanent: BattlefieldPermanent,
  spec: ConditionSpec,
  state: StaticConditionState,
  keywordResolver?: StaticKeywordResolver,
): boolean {
  const extra = Array.isArray(spec.conditions) ? spec.conditions : [];
  if (extra.length > 0) {
    const list = [
      ...(spec.condition?.kind ? [spec.condition] : []),
      ...extra,
    ];
    return list.every((condition) => specMatchesStaticCondition(
      permanent,
      { ...spec, condition, conditions: undefined },
      state,
      keywordResolver,
    ));
  }
  const condition = spec.condition;
  if (!condition?.kind) return true;
  const hasKeyword = keywordResolver || permanentHasKeywordAbility;

  switch (condition.kind) {
    case 'controller_life_at_least_starting_plus': {
      const controller = String(spec.sourceController || '');
      const startingLife = Number(state.startingLife || 40);
      const currentLife = Number(state.life?.[controller] ?? startingLife);
      return currentLife >= startingLife + Number(condition.offset || 0);
    }
    case 'target_is_token':
      return permanent.isToken === true;
    case 'target_is_not_token':
      return permanent.isToken !== true;
    case 'during_source_controller_turn':
      return String(state.turnPlayer || '') === String(spec.sourceController || '');
    case 'source_controller_controls_matching':
      return sourceControllerControlsMatching(spec, condition, state);
    case 'source_controller_life_at_least': {
      const controller = String(spec.sourceController || '');
      const startingLife = Number(state.startingLife || 40);
      return Number(state.life?.[controller] ?? startingLife) >= Number(condition.amount || 0);
    }
    case 'target_has_counter': {
      const wanted = String(condition.counterType || '').trim().toLowerCase();
      const counters = ((permanent as any).counters || {}) as Record<string, unknown>;
      return Object.entries(counters).some(([key, value]) => String(key).toLowerCase() === wanted && Number(value) > 0);
    }
    case 'target_is_token_during_source_controller_turn':
      return permanent.isToken === true
        && String(state.turnPlayer || '') === String(spec.sourceController || '');
    case 'target_has_mana_color':
      return creatureHasManaColor(permanent, String(condition.color || ''));
    case 'target_is_not_black_creature': {
      const colors = ((permanent.card as any)?.colors || []).map((entry: string) => String(entry).toUpperCase());
      return !colors.includes('B');
    }
    case 'target_is_not_human_creature': {
      const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
      return !typeLine.includes('human');
    }
    case 'target_is_legendary_creature':
      return isLegendaryCreaturePermanent(permanent);
    case 'target_is_nonlegendary_creature':
      return isCreaturePermanent(permanent) && !isLegendaryCreaturePermanent(permanent);
    case 'target_is_tapped':
      return permanent.tapped === true;
    case 'target_is_untapped':
      return permanent.tapped !== true;
    case 'target_is_attacking':
      return permanentIsAttacking(permanent);
    case 'target_is_ring_bearer':
      return permanentIsRingBearer(permanent, spec, state);
    case 'source_controller_has_threshold':
      return sourceControllerHasThreshold(spec, state);
    case 'source_controller_attacked_this_turn':
      return sourceControllerAttackedThisTurn(spec, state);
    case 'target_is_equipped':
      return permanentIsEquipped(permanent, state);
    case 'source_in_graveyard':
      return sourceIsInControllerGraveyard(spec, state);
    case 'source_in_graveyard_and_control_land_type': {
      const controller = String(spec.sourceController || '');
      const landType = String(condition.landType || '').trim().toLowerCase();
      if (!controller || !landType) return false;
      if (!sourceIsInControllerGraveyard(spec, state)) return false;
      const landTypePattern = new RegExp(`\\b${landType.replace(/[^a-z]/g, '')}\\b`);
      return (state.battlefield || []).some((perm) => {
        if (String(perm.controller || '') !== controller || !isLandPermanent(perm)) return false;
        return landTypePattern.test(String((perm.card as any)?.type_line || '').toLowerCase());
      });
    }
    case 'target_has_keyword':
      return hasKeyword(permanent, String(condition.keyword || ''));
    case 'target_lacks_keyword':
      return !hasKeyword(permanent, String(condition.keyword || ''));
    case 'target_lacks_all_keywords': {
      const keywords = Array.isArray(condition.keywords) && condition.keywords.length > 0
        ? condition.keywords
        : (condition.keyword ? [condition.keyword] : []);
      if (keywords.length === 0) return false;
      return keywords.every((keyword) => !hasKeyword(permanent, String(keyword || '')));
    }
    case 'target_power_greater_than_source_controller_hand_size': {
      const handCount = sourceControllerHandCount(spec, state);
      if (handCount === null) return false;
      return readPermanentPower(permanent, state) > handCount;
    }
    case 'target_power_at_most': {
      const cap = Number(condition.power);
      if (!Number.isFinite(cap)) return false;
      return readPermanentPower(permanent, state) <= cap;
    }
    case 'target_has_creature_type':
      return permanentHasCreatureType(permanent as any, String(condition.creatureType || ''));
    case 'target_lacks_creature_type':
      return !permanentHasCreatureType(permanent as any, String(condition.creatureType || ''));
    case 'target_is_commander':
      return (permanent as any).isCommander === true
        || String((permanent as any).card?.isCommander || '') === 'true';
    case 'target_owned_by_source_controller': {
      const controller = String(spec.sourceController || '').trim();
      if (!controller) return false;
      const owner = String((permanent as any).owner || permanent.controller || '').trim();
      return owner === controller;
    }
    case 'target_has_type': {
      const cardType = String(condition.cardType || '').trim().toLowerCase().replace(/[^a-z]/g, '');
      if (!cardType) return false;
      const typeLine = String(
        (permanent.card as any)?.type_line || (permanent as any).type_line || '',
      ).toLowerCase();
      return new RegExp(`\\b${cardType}\\b`).test(typeLine);
    }
    case 'target_is_outlaw':
      return OUTLAW_CREATURE_TYPES.some((creatureType) => (
        permanentHasCreatureType(permanent as any, creatureType)
      ));
    case 'target_is_colorless':
      return permanentColorSymbols(permanent).length === 0;
    case 'target_is_multicolored':
      return permanentColorSymbols(permanent).length >= 2;
    case 'target_is_modified':
      return permanentIsModified(permanent, state);
    case 'target_has_mana_color_and_lacks_keyword':
      return creatureHasManaColor(permanent, String(condition.color || ''))
        && !hasKeyword(permanent, String(condition.keyword || ''));
    case 'target_enchanted_by_aura_you_control':
      return permanentEnchantedByAuraYouControl(permanent, spec, state);
    case 'source_is_untapped':
      return sourcePermanentIsUntapped(spec, state);
    case 'source_is_attacking':
      return sourcePermanentIsAttacking(spec, state);
    case 'source_controller_has_citys_blessing':
      return sourceControllerHasCitysBlessing(spec, state);
    case 'target_is_historic':
      return permanentIsHistoric(permanent);
    case 'target_is_historic_during_source_controller_turn':
      return permanentIsHistoric(permanent)
        && String(state.turnPlayer || '') === String(spec.sourceController || '');
    case 'target_has_mana_ability':
      return permanentHasManaAbility(permanent);
    default:
      return false;
  }
}

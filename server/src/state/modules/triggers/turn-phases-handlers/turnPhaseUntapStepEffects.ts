/**
 * turn-phases-handlers/turnPhaseUntapStepEffects.ts
 * Origin parent: server/src/state/modules/triggers/turn-phases.ts
 * Cluster moved: UntapStepEffect plus detect/get/apply for other-players'
 *   untap-step turn actions (Unwinding Clock, Seedborn Muse, Bender's Waterskin,
 *   Murkfiend Liege, Ivorytusk Fortress, Ohabi Caleria, Quest for Renewal).
 * Public entry symbols: UntapStepEffect, detectUntapStepEffects,
 *   getUntapStepEffects, applyUntapStepEffect.
 */

import { CREATURE_TYPES, permanentHasCreatureType } from "../../../../../../shared/src/creatureTypes.js";
import type { GameContext } from "../../../context.js";
import { getActivePermanentCardFace } from "./turnPhaseActivePermanentFace.js";

export interface UntapStepFilter {
  /** Card types to match (OR). `permanent` means every permanent. */
  types?: string[];
  /** Any of these color symbols (WUBRG). */
  colors?: string[];
  /** Creature subtype (Archers, Elves, …). */
  subtype?: string;
  /** Target must have a +1/+1 counter (Ivorytusk Fortress). */
  requirePlusOnePlusOne?: boolean;
}

export interface UntapStepEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  untapType: 'artifacts' | 'creatures' | 'all' | 'lands' | 'specific' | 'self';
  onOtherPlayersTurn: boolean;
  onYourTurn: boolean;
  filter?: UntapStepFilter;
  /** Quest for Renewal: source must have at least this many counters. */
  sourceCounterType?: string;
  sourceCounterMin?: number;
}

const SELF_UNTAP_THIS = /untap (?:this (?:artifact|creature|land|permanent|enchantment|vehicle|card)|~) during each other player's untap step/i;
const GRANTS_SELF_UNTAP = /(?:enchanted|equipped)\s+\w+\s+has\s+["']untap this (?:artifact|creature|land|permanent) during each other player's untap step/i;
const GROUP_UNTAP = /untap (?:all|each) (.+?) during each other player's untap step/i;
const SOURCE_COUNTER_GATE = /as long as there (?:are|is) (\w+|\d+)(?: or more)? (\w+) counters? on/i;
const COLOR_WORD = 'white|blue|black|red|green';
const COLOR_SYMBOL: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  w: 'W', u: 'U', b: 'B', r: 'R', g: 'G',
};
const CARD_TYPES = new Set(['artifact', 'creature', 'land', 'enchantment', 'planeswalker', 'battle', 'permanent']);
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function escapeRegExp(text: string): string {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCountWord(raw: string): number {
  const text = String(raw || '').trim().toLowerCase();
  if (NUMBER_WORDS[text] != null) return NUMBER_WORDS[text];
  const numeric = Number.parseInt(text, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function matchCreatureTypeName(word: string): string | null {
  const lower = String(word || '').trim().toLowerCase();
  if (!lower) return null;
  for (const creatureType of CREATURE_TYPES) {
    const typeLower = creatureType.toLowerCase();
    if (typeLower === lower || `${typeLower}s` === lower || `${typeLower}es` === lower) {
      return creatureType;
    }
  }
  return null;
}

function parseGroupUntapSubject(rawSubject: string): UntapStepFilter | null {
  let phrase = String(rawSubject || '').replace(/\s+you control\s*/gi, ' ').trim();
  if (!phrase) return null;

  const requirePlusOnePlusOne = /with a \+1\/\+1 counter on (?:it|them)/i.test(phrase);
  phrase = phrase.replace(/\s*with a \+1\/\+1 counter on (?:it|them)\s*/gi, ' ').trim();

  const colors: string[] = [];
  const colorPrefix = phrase.match(new RegExp(
    `^((?:${COLOR_WORD})(?:\\s*(?:,|and\\/or|and|or)\\s*(?:${COLOR_WORD}))*)\\s+(.+)$`,
    'i',
  ));
  if (colorPrefix) {
    const seen = new Set<string>();
    for (const match of colorPrefix[1].matchAll(new RegExp(COLOR_WORD, 'gi'))) {
      const symbol = COLOR_SYMBOL[String(match[0] || '').toLowerCase()];
      if (symbol && !seen.has(symbol)) {
        seen.add(symbol);
        colors.push(symbol);
      }
    }
    phrase = String(colorPrefix[2] || '').trim();
  }

  const parts = phrase.split(/\s+and\s+|\s+or\s+/i).map((part) => part.trim()).filter(Boolean);
  const types: string[] = [];
  let subtype: string | undefined;
  for (const part of parts) {
    const lower = part.toLowerCase();
    const singular = lower.replace(/s$/, '');
    if (CARD_TYPES.has(lower) || CARD_TYPES.has(singular)) {
      types.push(CARD_TYPES.has(lower) ? lower : singular);
      continue;
    }
    const creatureType = matchCreatureTypeName(part);
    if (creatureType) subtype = creatureType;
  }

  if (subtype && types.length === 0) types.push('creature');
  if (colors.length > 0 && types.length === 0) types.push('creature');
  if (types.length === 0 && !subtype && !requirePlusOnePlusOne && colors.length === 0) return null;

  return {
    ...(types.length > 0 ? { types } : {}),
    ...(colors.length > 0 ? { colors } : {}),
    ...(subtype ? { subtype } : {}),
    ...(requirePlusOnePlusOne ? { requirePlusOnePlusOne: true } : {}),
  };
}

function untapTypeFromFilter(filter: UntapStepFilter): UntapStepEffect['untapType'] {
  if (filter.types?.includes('permanent') && !filter.colors && !filter.subtype && !filter.requirePlusOnePlusOne) {
    return 'all';
  }
  if (filter.types?.length === 1 && filter.types[0] === 'artifact' && !filter.colors && !filter.subtype && !filter.requirePlusOnePlusOne) {
    return 'artifacts';
  }
  if (filter.types?.length === 1 && filter.types[0] === 'creature' && !filter.colors && !filter.subtype && !filter.requirePlusOnePlusOne) {
    return 'creatures';
  }
  if (filter.types?.length === 1 && filter.types[0] === 'land' && !filter.colors && !filter.subtype && !filter.requirePlusOnePlusOne) {
    return 'lands';
  }
  return 'specific';
}

function collectPermanentAbilityTexts(card: any, permanent: any): string[] {
  const { oracleText } = getActivePermanentCardFace(card, permanent);
  const texts = [oracleText];
  const granted = Array.isArray((permanent as any)?.grantedAbilities)
    ? (permanent as any).grantedAbilities
    : [];
  for (const ability of granted) {
    const text = String(ability || '').trim();
    if (text) texts.push(text);
  }
  return texts;
}

function pushSelfUntapEffect(
  effects: UntapStepEffect[],
  permanent: any,
  cardName: string,
  description: string,
): void {
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  if (!permanentId || !controllerId) return;
  if (effects.some((effect) => effect.untapType === 'self' && effect.permanentId === permanentId)) {
    return;
  }
  effects.push({
    permanentId,
    cardName,
    controllerId,
    description,
    untapType: 'self',
    onOtherPlayersTurn: true,
    onYourTurn: false,
  });
}

function detectGroupUntapFromText(
  abilityText: string,
  permanent: any,
  cardName: string,
): UntapStepEffect | null {
  if (GRANTS_SELF_UNTAP.test(abilityText) || SELF_UNTAP_THIS.test(abilityText)) return null;
  const groupMatch = abilityText.match(GROUP_UNTAP);
  if (!groupMatch) return null;

  const filter = parseGroupUntapSubject(String(groupMatch[1] || ''));
  if (!filter) return null;

  const before = abilityText.slice(0, groupMatch.index || 0);
  const gate = before.match(SOURCE_COUNTER_GATE);
  const sourceCounterMin = gate ? parseCountWord(String(gate[1] || '')) : 0;
  const sourceCounterType = gate ? String(gate[2] || '').trim().toLowerCase() : '';

  return {
    permanentId: String(permanent?.id || ''),
    cardName,
    controllerId: String(permanent?.controller || ''),
    description: String(groupMatch[0] || '').trim(),
    untapType: untapTypeFromFilter(filter),
    onOtherPlayersTurn: true,
    onYourTurn: false,
    filter,
    ...(sourceCounterMin > 0 && sourceCounterType
      ? { sourceCounterMin, sourceCounterType }
      : {}),
  };
}

/**
 * Detect untap step effects from a card's oracle text
 * Handles cards like:
 * - Unwinding Clock: "Untap all artifacts you control during each other player's untap step"
 * - Seedborn Muse: "Untap all permanents you control during each other player's untap step"
 * - Bender's Waterskin / Victory Chimes: "Untap this artifact during each other player's untap step"
 * - Murkfiend Liege / Ohabi Caleria / Ivorytusk Fortress / Quest for Renewal
 */
export function detectUntapStepEffects(card: any, permanent: any): UntapStepEffect[] {
  const effects: UntapStepEffect[] = [];
  const { cardName } = getActivePermanentCardFace(card, permanent);

  for (const abilityText of collectPermanentAbilityTexts(card, permanent)) {
    if (GRANTS_SELF_UNTAP.test(abilityText)) continue;
    const shortName = String(cardName || '').split(',')[0].trim();
    const nameAlternatives = [cardName, shortName].filter(Boolean).map(escapeRegExp).join('|');
    const namedSelf = Boolean(nameAlternatives) && new RegExp(
      `\\buntap\\s+(?:${nameAlternatives})\\b during each other player's untap step`,
      'i',
    ).test(abilityText);
    if (SELF_UNTAP_THIS.test(abilityText) || namedSelf) {
      pushSelfUntapEffect(
        effects,
        permanent,
        cardName,
        "Untap this permanent during each other player's untap step",
      );
    }

    const groupEffect = detectGroupUntapFromText(abilityText, permanent, cardName);
    if (groupEffect) effects.push(groupEffect);
  }

  return effects;
}

function detectGrantedHostSelfUntap(
  battlefield: any[],
  aura: any,
  card: any,
): UntapStepEffect | null {
  const { cardName, oracleText } = getActivePermanentCardFace(card, aura);
  if (!GRANTS_SELF_UNTAP.test(oracleText)) return null;
  const hostId = String(aura?.attachedTo || '').trim();
  if (!hostId) return null;
  const host = battlefield.find((permanent: any) => String(permanent?.id || '') === hostId);
  if (!host) return null;
  return {
    permanentId: String(host.id),
    cardName,
    controllerId: String(host.controller || ''),
    description: "Enchanted permanent untaps during each other player's untap step",
    untapType: 'self',
    onOtherPlayersTurn: true,
    onYourTurn: false,
  };
}

function getCounterCount(permanent: any, counterType: string): number {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object') return 0;
  const wanted = String(counterType || '').trim().toLowerCase();
  if (!wanted) return 0;
  if (wanted === '+1/+1') {
    return Math.max(0, Number(counters['+1/+1'] || counters.p1p1 || 0));
  }
  for (const [key, value] of Object.entries(counters)) {
    if (String(key || '').trim().toLowerCase() === wanted) {
      return Math.max(0, Number(value || 0));
    }
  }
  return 0;
}

function collectColorSymbols(permanent: any): string[] {
  const card = permanent?.card || {};
  const raw = Array.isArray(card.colors)
    ? card.colors
    : Array.isArray(permanent?.colors)
      ? permanent.colors
      : Array.isArray(card.color_identity)
        ? card.color_identity
        : [];
  const symbols: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const symbol = COLOR_SYMBOL[String(entry || '').trim().toLowerCase()]
      || (['W', 'U', 'B', 'R', 'G'].includes(String(entry || '').trim().toUpperCase())
        ? String(entry).trim().toUpperCase()
        : '');
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }
  return symbols;
}

function sourceCounterGateSatisfied(effect: UntapStepEffect, battlefield: any[]): boolean {
  if (!effect.sourceCounterType || !effect.sourceCounterMin) return true;
  const source = battlefield.find((permanent: any) => String(permanent?.id || '') === String(effect.permanentId || ''));
  return getCounterCount(source, effect.sourceCounterType) >= effect.sourceCounterMin;
}

/**
 * Get all untap step effects that apply during a specific player's untap step
 */
export function getUntapStepEffects(
  ctx: GameContext,
  untapPlayerId: string
): UntapStepEffect[] {
  const effects: UntapStepEffect[] = [];
  const battlefield = ctx.state?.battlefield || [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permEffects = detectUntapStepEffects(permanent.card, permanent);
    const grantedHost = detectGrantedHostSelfUntap(battlefield, permanent, permanent.card);
    if (grantedHost) permEffects.push(grantedHost);

    for (const effect of permEffects) {
      if (!sourceCounterGateSatisfied(effect, battlefield)) continue;
      const isControllersTurn = String(effect.controllerId || '') === String(untapPlayerId);
      if (effect.onOtherPlayersTurn && !isControllersTurn) {
        effects.push(effect);
      } else if (effect.onYourTurn && isControllersTurn) {
        effects.push(effect);
      }
    }
  }

  return effects;
}

function consumeStunCounterInsteadOfUntap(permanent: any): boolean {
  const stun = Number(permanent?.counters?.stun || 0);
  if (!Number.isFinite(stun) || stun <= 0) return false;
  permanent.counters = permanent.counters || {};
  permanent.counters.stun = stun - 1;
  if (permanent.counters.stun <= 0) {
    delete permanent.counters.stun;
  }
  return true;
}

function permanentMatchesUntapEffect(permanent: any, effect: UntapStepEffect): boolean {
  if (effect.untapType === 'self') {
    return String(permanent?.id || '') === String(effect.permanentId || '');
  }
  if (String(permanent?.controller || '') !== String(effect.controllerId || '')) return false;

  const filter = effect.filter;
  if (!filter) {
    const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
    if (effect.untapType === 'all') return true;
    if (effect.untapType === 'artifacts') return typeLine.includes('artifact');
    if (effect.untapType === 'creatures') return typeLine.includes('creature');
    if (effect.untapType === 'lands') return typeLine.includes('land');
    return false;
  }

  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  const types = filter.types || [];
  if (types.length > 0 && !types.includes('permanent')) {
    const typeOk = types.some((type) => typeLine.includes(type));
    if (!typeOk) return false;
  }
  if (filter.colors && filter.colors.length > 0) {
    const symbols = collectColorSymbols(permanent);
    if (!filter.colors.some((color) => symbols.includes(color))) return false;
  }
  if (filter.subtype) {
    if (!permanentHasCreatureType(permanent, filter.subtype)) return false;
  }
  if (filter.requirePlusOnePlusOne) {
    if (getCounterCount(permanent, '+1/+1') <= 0) return false;
  }
  return true;
}

/**
 * Apply untap step effects (actually untap the permanents)
 */
export function applyUntapStepEffect(ctx: GameContext, effect: UntapStepEffect): number {
  const battlefield = ctx.state?.battlefield || [];
  let untappedCount = 0;

  for (const permanent of battlefield) {
    if (!permanent) continue;
    if (!permanent.tapped) continue;
    if (!permanentMatchesUntapEffect(permanent, effect)) continue;
    if (consumeStunCounterInsteadOfUntap(permanent)) continue;

    permanent.tapped = false;
    untappedCount++;
  }

  if (untappedCount > 0) {
    ctx.bumpSeq();
  }

  return untappedCount;
}

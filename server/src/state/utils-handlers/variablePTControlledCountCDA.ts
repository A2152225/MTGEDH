// server/src/state/utils-handlers/variablePTControlledCountCDA.ts
// Generic CDA fallback for "~'s power and toughness are each equal to the number of <noun> you control"
// (Nightmare, Squelching Leeches: Swamps; Dungrove Elder-style subtype counts; "untapped lands", "other Elves",
// "... on the battlefield"). Used by calculateVariablePT after its named handlers.
// Also the Lhurgoyf/-vore graveyard family: "~'s power is equal to the number of card types among cards in all graveyards and its
// toughness is equal to that number plus 1" (Polygoyf, Barrowgoyf; "your graveyard" variants too).
// Also devotion: "~'s power is equal to your devotion to green" (Renata; toughness stays printed) and
// "power and toughness are each equal to your devotion to COLOR".
// Public entry symbols: calculateControlledCountCDA, calculateGraveyardCardTypesCDA, calculateDevotionCDA.

import { landAwareTypeLine } from '../modules/effectiveLandTypeLine.js';
import { countDevotionAmongPermanents } from '../../../../shared/src/devotionCount.js';

const COLORS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const TYPE_MODS = new Set(['basic', 'snow', 'legendary', 'artifact', 'enchantment', 'creature', 'land', 'nonbasic']);

function singular(noun: string): string {
  if (noun === 'elves') return 'elf';
  if (noun === 'dwarves') return 'dwarf';
  if (noun.endsWith('ies')) return noun.slice(0, -3) + 'y';
  if (/(?:ss|sh|ch|x)es$/.test(noun)) return noun.slice(0, -2);
  return noun.endsWith('s') ? noun.slice(0, -1) : noun;
}

const DEVOTION_COLOR: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

export function calculateDevotionCDA(
  oracleText: string,
  battlefield: readonly any[],
  controllerId: unknown,
  printedToughness: unknown,
): { power: number; toughness: number } | undefined {
  const text = String(oracleText || '').toLowerCase();
  const m = text.match(/power (and toughness are each|is) equal to your devotion to (white|blue|black|red|green)(?: and (white|blue|black|red|green))?/);
  if (!m) return undefined;
  const n = countDevotionAmongPermanents(battlefield, String(controllerId ?? ''), [m[2], m[3]].filter(Boolean).map((c) => DEVOTION_COLOR[c]));
  if (m[1] !== 'is') return { power: n, toughness: n };
  const t = Number.parseInt(String(printedToughness ?? ''), 10);
  return Number.isFinite(t) ? { power: n, toughness: t } : undefined;
}

const GY_CARD_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery', 'tribal'];
const GY_ZONE = String.raw`(all graveyards|graveyards|your graveyard|your opponents' graveyards|opponents' graveyards)`;
const GY_WHAT = String.raw`(card types among cards|(?:(artifact|creature|enchantment|instant|land|planeswalker|sorcery)(?: (?:and|or) (artifact|creature|enchantment|instant|land|planeswalker|sorcery))? )?cards)`;
// "power is equal to the number of W in Z and its toughness is equal to that number [plus N]"
const GY_SPLIT = new RegExp('power is equal to the number of ' + GY_WHAT + ' in ' + GY_ZONE + ' and its toughness is equal to that number(?: plus (\\d+))?');
// "power and toughness are each equal to the number of W in Z [plus N]"
const GY_EACH = new RegExp('power and toughness are each equal to the number of ' + GY_WHAT + ' in ' + GY_ZONE + '(?: plus (\\d+))?');

function graveyardOwnerIds(zone: string, zones: Record<string, any>, controllerId: unknown): string[] {
  const me = String(controllerId ?? '');
  if (zone === 'your graveyard') return [me];
  if (zone.includes('opponents')) return Object.keys(zones).filter((id) => id !== me);
  return Object.keys(zones);
}

function cardTypesOf(card: any): string[] {
  const tl = String(card?.type_line || card?.card?.type_line || '').toLowerCase().split(/\u2014|-{1,2}/)[0];
  return GY_CARD_TYPES.filter((t) => new RegExp('\\b' + t + '\\b').test(tl));
}

/**
 * Lhurgoyf / -vore family CDAs that count graveyards: card types among cards (Tarmogoyf, Polygoyf, Nethergoyf),
 * or cards of one or two card types (Lhurgoyf, Mortivore, Cognivore, Boneyard Wurm), in all graveyards, your
 * graveyard, or your opponents' graveyards, with an optional "plus N" toughness or each-equal offset.
 */
export function calculateGraveyardCardTypesCDA(
  oracleText: string,
  gameState: any,
  controllerId: unknown,
): { power: number; toughness: number } | undefined {
  const text = String(oracleText || '').toLowerCase().replace(/\u2019/g, "'");
  const split = text.match(GY_SPLIT);
  const each = split ? null : text.match(GY_EACH);
  const m = split || each;
  if (!m) return undefined;
  const [, what, typeA, typeB, zone, plus] = m;
  const zones = gameState?.zones || {};
  const cards: any[] = [];
  for (const id of graveyardOwnerIds(zone, zones, controllerId)) {
    if (Array.isArray(zones[id]?.graveyard)) cards.push(...zones[id].graveyard);
  }
  let n: number;
  if (what === 'card types among cards') {
    n = new Set(cards.flatMap(cardTypesOf)).size;
  } else {
    const wanted = [typeA, typeB].filter(Boolean);
    n = cards.filter((c) => wanted.length === 0 || cardTypesOf(c).some((t) => wanted.includes(t))).length;
  }
  const offset = Number(plus || 0);
  return split ? { power: n, toughness: n + offset } : { power: n + offset, toughness: n + offset };
}

export function calculateControlledCountCDA(
  oracleText: string,
  battlefield: any[],
  controllerId: unknown,
  selfCardId?: unknown,
  gameState?: any,
): { power: number; toughness: number } | undefined {
  const m = String(oracleText || '').toLowerCase()
    .match(/power and toughness are each equal to the number of (other )?([a-z ]+?) (you control|on the battlefield)\./);
  if (!m) return undefined;
  const words = m[2].trim().split(/\s+/);
  const noun = singular(words.pop() || '');
  if (!/^[a-z-]+$/.test(noun) || noun === 'card') return undefined;
  const mods = words;
  if (mods.some((w) => !TYPE_MODS.has(w) && !COLORS[w] && w !== 'tapped' && w !== 'untapped')) return undefined;
  const nounRe = new RegExp('\\b' + (noun === 'permanent' ? '' : noun) + '');
  let count = 0;
  for (const perm of battlefield || []) {
    if (!perm) continue;
    if (m[3] === 'you control' && String(perm.controller) !== String(controllerId)) continue;
    if (m[1] && selfCardId && (perm.card?.id === selfCardId || perm.id === selfCardId)) continue;
    const typeLine = landAwareTypeLine(gameState, perm, String(perm.card?.type_line || ''));
    if (noun !== 'permanent' && !nounRe.test(typeLine) && !(!TYPE_MODS.has(noun) && /\bchangeling\b/.test(String(perm.card?.oracle_text || '').toLowerCase()))) continue;
    if (noun === 'creature' && perm.notCreature === true) continue;
    let ok = true;
    for (const w of mods) {
      if (w === 'tapped') ok = ok && perm.tapped === true;
      else if (w === 'untapped') ok = ok && perm.tapped !== true;
      else if (w === 'nonbasic') ok = ok && !typeLine.includes('basic');
      else if (COLORS[w]) ok = ok && (Array.isArray(perm.card?.colors) ? perm.card.colors : []).includes(COLORS[w]);
      else ok = ok && typeLine.includes(w);
    }
    if (ok) count += 1;
  }
  return { power: count, toughness: count };
}

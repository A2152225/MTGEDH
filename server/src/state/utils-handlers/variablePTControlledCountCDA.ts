// server/src/state/utils-handlers/variablePTControlledCountCDA.ts
// Generic CDA fallback for "~'s power and toughness are each equal to the number of <noun> you control"
// (Nightmare, Squelching Leeches: Swamps; Dungrove Elder-style subtype counts; "untapped lands", "other Elves",
// "... on the battlefield"). Used by calculateVariablePT after its named handlers.
// Also the Lhurgoyf/-vore graveyard family: "~'s power is equal to the number of card types among cards in all graveyards and its
// toughness is equal to that number plus 1" (Polygoyf, Barrowgoyf; "your graveyard" variants too).
// Also devotion: "~'s power is equal to your devotion to green" (Renata; toughness stays printed) and
// "power and toughness are each equal to your devotion to COLOR".
// Also B71 Nighthawk Scavenger: "power is equal to N plus the number of card types among cards in your opponents' graveyards"
// (printed toughness stays).
// Public entry symbols: calculateControlledCountCDA, calculateGraveyardCardTypesCDA, calculateDevotionCDA,
//   calculatePowerPlusOpponentGraveyardCardTypesCDA.

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
  let m = text.match(/power (and toughness are each|is) equal to your devotion to (white|blue|black|red|green)(?: and (white|blue|black|red|green))?/);
  // B83: Primalcrux chroma — "number of green mana symbols in the mana costs of permanents you control"
  if (!m) {
    const chroma = text.match(
      /power and toughness are each equal to the number of (white|blue|black|red|green) mana symbols in the mana costs of permanents you control/,
    );
    if (chroma) m = ['', 'and toughness are each', chroma[1], undefined] as RegExpMatchArray;
  }
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
/** B71: Nighthawk Scavenger — power = N + distinct card types in opponents' graveyards. */
export function calculatePowerPlusOpponentGraveyardCardTypesCDA(
  card: any,
  oracleText: string,
  gameState: any,
  controllerId: unknown,
): { power: number; toughness: number } | undefined {
  const text = String(oracleText || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/power is equal to (\d+) plus the number of card types among cards in your opponents' graveyards/);
  if (!m) return undefined;
  const base = Number(m[1]);
  const toughness = Number(card?.toughness);
  if (!Number.isFinite(base) || !Number.isFinite(toughness)) return undefined;
  if (!String(card?.power ?? '').includes('*')) return undefined;
  const zones = gameState?.zones || {};
  const cards: any[] = [];
  for (const id of graveyardOwnerIds("your opponents' graveyards", zones, controllerId)) {
    if (Array.isArray(zones[id]?.graveyard)) cards.push(...zones[id].graveyard);
  }
  const n = new Set(cards.flatMap(cardTypesOf)).size;
  return { power: base + n, toughness };
}

export function calculateGraveyardCardTypesCDA(
  oracleText: string,
  gameState: any,
  controllerId: unknown,
): { power: number; toughness: number } | undefined {
  const text = String(oracleText || '').toLowerCase().replace(/\u2019/g, "'");
  // B83: Cosmogoyf — cards you own in exile (same split-power / toughness+N shape as Lhurgoyf).
  {
    const exile = text.match(
      /power is equal to the number of cards you own in exile and its toughness is equal to that number(?: plus (\d+))?/,
    );
    if (exile) {
      const zones = gameState?.zones || {};
      const me = String(controllerId ?? '');
      const cards: any[] = Array.isArray(zones[me]?.exile) ? zones[me].exile : [];
      // Also count face-up exile entries owned by you that live under other zone keys.
      for (const id of Object.keys(zones)) {
        if (id === me) continue;
        for (const c of (Array.isArray(zones[id]?.exile) ? zones[id].exile : [])) {
          if (String(c?.owner || c?.card?.owner || '') === me) cards.push(c);
        }
      }
      const n = cards.length;
      const offset = Number(exile[1] || 0);
      return { power: n, toughness: n + offset };
    }
  }
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

/** B84: Living Lore — P/T each equal to the exiled card's mana value. */
export function calculateExiledCardManaValueCDA(
  card: any,
  oracleText: string,
  permanent: any,
  gameState: any,
): { power: number; toughness: number } | undefined {
  const text = String(oracleText || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/power and toughness are each equal to the exiled card'?s mana value/.test(text)) return undefined;
  if (!String(card?.power ?? '').includes('*') || !String(card?.toughness ?? '').includes('*')) return undefined;
  const pool: any[] = [...(Array.isArray(permanent?.exiledCards) ? permanent.exiledCards : [])];
  const selfId = String(permanent?.id || '');
  for (const zone of Object.values<any>(gameState?.zones || {})) {
    if (!Array.isArray(zone?.exile)) continue;
    for (const c of zone.exile) {
      const linked = String(c?.exiledWithSourceId || c?.card?.exiledWithSourceId || c?.exiledWith || '');
      if (selfId && linked === selfId) pool.push(c);
    }
  }
  const first = pool[0];
  if (!first) return { power: 0, toughness: 0 };
  const mv = Number(first?.cmc ?? first?.mana_value ?? first?.card?.cmc ?? first?.card?.mana_value);
  if (Number.isFinite(mv)) return { power: mv, toughness: mv };
  let total = 0;
  for (const sym of String(first?.mana_cost || first?.card?.mana_cost || '').match(/\{[^}]+\}/g) || []) {
    const s = sym.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(s)) total += parseInt(s, 10);
    else if (s !== 'X') total += 1;
  }
  return { power: total, toughness: total };
}

/** B84: Lost Order of Jarkeld — N plus creatures the chosen player controls. */
export function calculateChosenPlayerCreaturesCDA(
  card: any,
  oracleText: string,
  permanent: any,
  battlefield: readonly any[],
): { power: number; toughness: number } | undefined {
  const text = String(oracleText || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /power and toughness are each equal to (\d+) plus the number of creatures the chosen player controls/,
  );
  if (!m) return undefined;
  if (!String(card?.power ?? '').includes('*') || !String(card?.toughness ?? '').includes('*')) return undefined;
  const base = Number(m[1]);
  const chosen = String(
    permanent?.chosenPlayer || permanent?.chosenPlayerId || permanent?.card?.chosenPlayer || '',
  );
  if (!Number.isFinite(base)) return undefined;
  if (!chosen) return { power: base, toughness: base };
  const n = (battlefield || []).filter((p) =>
    String(p?.controller || '') === chosen && /\bcreature\b/i.test(String(p?.card?.type_line || '')),
  ).length;
  return { power: base + n, toughness: base + n };
}

/** B85: Sutured Ghoul — power = total power of exiled cards; toughness = their total toughness. */
export function calculateExiledCardsTotalPTCDA(
  card: any,
  oracleText: string,
  permanent: any,
  gameState: any,
): { power: number; toughness: number } | undefined {
  const text = String(oracleText || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/power is equal to the total power of the exiled cards and its toughness is equal to their total toughness/.test(text)) {
    return undefined;
  }
  if (!/\*/.test(String(card?.power ?? '') + String(card?.toughness ?? ''))) return undefined;
  const pool: any[] = [...(Array.isArray(permanent?.exiledCards) ? permanent.exiledCards : [])];
  const selfId = String(permanent?.id || '');
  for (const zone of Object.values<any>(gameState?.zones || {})) {
    if (!Array.isArray(zone?.exile)) continue;
    for (const c of zone.exile) {
      const linked = String(c?.exiledWithSourceId || c?.card?.exiledWithSourceId || c?.exiledWith || '');
      if (selfId && linked === selfId) pool.push(c);
    }
  }
  let power = 0;
  let toughness = 0;
  for (const c of pool) {
    const p = Number(c?.power ?? c?.card?.power);
    const t = Number(c?.toughness ?? c?.card?.toughness);
    if (Number.isFinite(p)) power += p;
    if (Number.isFinite(t)) toughness += t;
  }
  return { power, toughness };
}

/** B86: Chameleon Spirit — P/T each equal to permanents of the chosen color your opponents control. */
export function calculateChosenColorOpponentsPermanentsCDA(
  card: any,
  oracleText: string,
  permanent: any,
  battlefield: readonly any[],
): { power: number; toughness: number } | undefined {
  const text = String(oracleText || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/power and toughness are each equal to the number of permanents of the chosen color your opponents control/.test(text)) {
    return undefined;
  }
  if (!/\*/.test(String(card?.power ?? '') + String(card?.toughness ?? ''))) return undefined;
  const color = String(
    permanent?.chosenColor
    || permanent?.card?.chosenColor
    || '',
  ).trim().toUpperCase();
  const letter = color.length === 1 ? color
    : ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' } as Record<string, string>)[color.toLowerCase()] || '';
  if (!letter) return { power: 0, toughness: 0 };
  const controller = String(permanent?.controller || card?.controller || '');
  const n = (battlefield || []).filter((p) => {
    if (!p || p.phasedOut) return false;
    if (!controller || String(p.controller || '') === controller) return false;
    const colors = Array.isArray(p?.card?.colors) ? p.card.colors.map((c: any) => String(c).toUpperCase()) : [];
    return colors.includes(letter);
  }).length;
  return { power: n, toughness: n };
}

/** B85: Shapeshifter — power = last chosen number; toughness = 7 minus that number. */
export function calculateLastChosenNumberSplitCDA(
  card: any,
  oracleText: string,
  permanent: any,
): { power: number; toughness: number } | undefined {
  const text = String(oracleText || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /power is equal to the last chosen number and its toughness is equal to (\d+) minus that number/,
  );
  if (!m) return undefined;
  if (!/\*/.test(String(card?.power ?? '') + String(card?.toughness ?? ''))) return undefined;
  const base = Number(m[1]);
  const chosen = Number(
    permanent?.chosenNumber
    ?? permanent?.lastChosenNumber
    ?? permanent?.card?.chosenNumber
    ?? permanent?.card?.lastChosenNumber,
  );
  if (!Number.isFinite(base) || !Number.isFinite(chosen)) return undefined;
  return { power: chosen, toughness: base - chosen };
}

/** B84: Angry Mob — during your turn = N + opponents' Swamps; otherwise printed base. */
export function calculateAngryMobStyleCDA(
  card: any,
  oracleText: string,
  permanent: any,
  battlefield: readonly any[],
  gameState: any,
): { power: number; toughness: number } | undefined {
  const text = String(oracleText || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /during your turn,? (?:~|this creature|[a-z' ,.-]+?)'?s? power and toughness are each equal to (\d+) plus the number of (plains|islands|swamps|mountains|forests) your opponents control/,
  );
  if (!m) return undefined;
  if (!/\*/.test(String(card?.power ?? '') + String(card?.toughness ?? ''))) return undefined;
  const base = Number(m[1]);
  const raw = String(m[2] || 'swamps').toLowerCase();
  const sub = raw === 'plains' ? 'plains' : raw.slice(0, -1);
  const controller = String(permanent?.controller || card?.controller || '');
  const turnPlayer = String(gameState?.turnPlayer || '');
  const offTurn = text.match(
    /during turns other than yours,? (?:~|this creature|[a-z' ,.-]+?)'?s? power and toughness are each (\d+)/,
  );
  if (turnPlayer && controller && turnPlayer !== controller) {
    const flat = Number(offTurn?.[1] ?? base);
    return Number.isFinite(flat) ? { power: flat, toughness: flat } : undefined;
  }
  const n = (battlefield || []).filter((p) =>
    String(p?.controller || '') !== controller
    && new RegExp('\\b' + sub + '\\b').test(String(p?.card?.type_line || '').toLowerCase()),
  ).length;
  return { power: base + n, toughness: base + n };
}

export function calculateControlledCountCDA(
  oracleText: string,
  battlefield: any[],
  controllerId: unknown,
  selfCardId?: unknown,
  gameState?: any,
): { power: number; toughness: number } | undefined {
  const m = String(oracleText || '').toLowerCase()
    .match(/power and toughness are each equal to the number of (other )?([a-z -]+?) (you control|on the battlefield)\./);
  if (!m) return undefined;
  const words = m[2].trim().split(/\s+/);
  const noun = singular(words.pop() || '');
  if (!/^[a-z-]+$/.test(noun) || noun === 'card') return undefined;
  const mods = words;
  if (mods.some((w) => !TYPE_MODS.has(w) && !COLORS[w] && w !== 'tapped' && w !== 'untapped' && w !== 'face-down')) return undefined;
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
      else if (w === 'face-down') ok = ok && (perm.isFaceDown === true || perm.card?.faceDown === true || perm.card?.isFaceDownStub === true);
      else if (w === 'nonbasic') ok = ok && !typeLine.includes('basic');
      else if (COLORS[w]) ok = ok && (Array.isArray(perm.card?.colors) ? perm.card.colors : []).includes(COLORS[w]);
      else ok = ok && typeLine.includes(w);
    }
    if (ok) count += 1;
  }
  return { power: count, toughness: count };
}

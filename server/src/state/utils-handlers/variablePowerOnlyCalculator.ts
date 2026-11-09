// server/src/state/utils-handlers/variablePowerOnlyCalculator.ts
// Characteristic-defining "~'s power is equal to the number of X" (CR 604.3) where only power
// is variable and toughness is printed (Snow Villiers */3, Haughty Djinn */4, Filigree Attendant */3), and the
// toughness-only mirror (People of the Woods 1/*, Treefolk Seedlings 2/*, Tymaret's devotion 2/*).

import { countDifferentlyNamedLands, countFederationCreatureTypes } from '../../../../rules-engine/src/trekCountBases.js';

function typeLineOf(obj: any): string {
  return String(obj?.card?.type_line ?? obj?.type_line ?? '').toLowerCase();
}

/** Count for the "number of ..." phrase, or undefined when the phrase is not recognized. */
export function countPowerOnlyPhrase(phrase: string, battlefield: any[], zones: any, controllerId: string): number | undefined {
  const p = phrase.toLowerCase().trim();
  const mine = (battlefield || []).filter((perm: any) => perm?.controller === controllerId);
  const graveyard: any[] = zones?.[controllerId]?.graveyard || [];

  let   m = p.match(/^(?:(white|blue|black|red|green) )?(creatures|artifacts|enchantments|lands) you control$/);
  if (m) {
    const want = m[2].slice(0, -1);
    return mine.filter((perm: any) => {
      if (!typeLineOf(perm).includes(want)) return false;
      if (!m![1]) return true;
      const letter = m![1] === 'blue' ? 'U' : m![1][0].toUpperCase();
      return (perm?.card?.colors || []).includes(letter);
    }).length;
  }
  // B75: Avalanche of Sector 7 — "artifacts your opponents control"
  m = p.match(/^(artifact|creature|enchantment|land|planeswalker)s? your opponents control$/);
  if (m) {
    const want = m[1];
    return (battlefield || []).filter((perm: any) => {
      if (String(perm?.controller || '') === controllerId) return false;
      return new RegExp('\\b' + want + '\\b').test(typeLineOf(perm));
    }).length;
  }
  // B73: Vile Aggregate — "colorless creatures you control"
  if (/^colorless creatures you control$/.test(p)) {
    return mine.filter((perm: any) => {
      if (!/\bcreature\b/.test(typeLineOf(perm))) return false;
      const colors = Array.isArray(perm?.card?.colors) ? perm.card.colors : [];
      return colors.length === 0;
    }).length;
  }
  // B73: Katilda — "permanents you control that are Spirits and/or enchantments"
  if (/^permanents you control that are spirits and\/or enchantments$/.test(p)) {
    return mine.filter((perm: any) => {
      const tl = typeLineOf(perm);
      return /\bspirit\b/.test(tl) || /\benchantment\b/.test(tl);
    }).length;
  }
  // B69: Yavimaya Kavu — "red creatures on the battlefield" (global, not you-control).
  m = p.match(/^(white|blue|black|red|green) creatures on the battlefield$/);
  if (m) {
    const letter = m[1] === 'blue' ? 'U' : m[1][0].toUpperCase();
    return (battlefield || []).filter((perm: any) => {
      if (!/\bcreature\b/.test(typeLineOf(perm))) return false;
      return (perm?.card?.colors || []).includes(letter);
    }).length;
  }
  // B72: Dauthi Warlord — "creatures on the battlefield with shadow"
  m = p.match(/^creatures on the battlefield with (shadow|flying|trample|haste|vigilance|reach|menace|deathtouch|lifelink|first strike|double strike|hexproof|indestructible)$/);
  if (m) {
    const kw = m[1];
    return (battlefield || []).filter((perm: any) => {
      if (!/\bcreature\b/.test(typeLineOf(perm))) return false;
      const text = String(perm?.card?.oracle_text || '').toLowerCase();
      const kws = Array.isArray(perm?.card?.keywords) ? perm.card.keywords.map((k: any) => String(k).toLowerCase()) : [];
      const granted = Array.isArray(perm?.continuousAbilities) ? perm.continuousAbilities.map((k: any) => String(k).toLowerCase()) : [];
      return kws.includes(kw) || granted.includes(kw) || new RegExp('(?:^|\\n|,\\s*)' + kw + '\\b').test(text);
    }).length;
  }
  // B72: Wilderness Elemental — "nonbasic lands your opponents control"
  if (/^nonbasic lands your opponents control$/.test(p)) {
    return (battlefield || []).filter((perm: any) => {
      if (String(perm?.controller || '') === controllerId) return false;
      const tl = typeLineOf(perm);
      return /\bland\b/.test(tl) && !/\bbasic\b/.test(tl);
    }).length;
  }
  // B70: Toph — "+1/+1 counters on lands you control"
  if (/^\+1\/\+1 counters on lands you control$/.test(p)) {
    return mine.reduce((sum: number, perm: any) => {
      if (!/\bland\b/.test(typeLineOf(perm))) return sum;
      return sum + Math.max(0, Number(perm?.counters?.['+1/+1'] || 0));
    }, 0);
  }
  if (/^instant and sorcery cards in your graveyard$|^instant and\/or sorcery cards in your graveyard$/.test(p)) {
    return graveyard.filter((c: any) => /\b(instant|sorcery)\b/.test(typeLineOf(c))).length;
  }
  m = p.match(/^(creature|artifact|land|enchantment) cards in your graveyard$/);
  if (m) return graveyard.filter((c: any) => typeLineOf(c).includes(m![1])).length;
  // Domain (Fblthp, Knows the Way): basic land types among lands you control.
  if (p === 'basic land types among lands you control') {
    const kinds = ['plains', 'island', 'swamp', 'mountain', 'forest'];
    return kinds.filter((k) => mine.some((perm: any) => new RegExp('\\b' + k + '\\b').test(typeLineOf(perm)))).length;
  }
  // "Forests you control" (People of the Woods, Dakmor Plague-style): basic land subtypes on the type line.
  m = p.match(/^(plains|islands|swamps|mountains|forests) you control$/);
  if (m) {
    const sub = m[1] === 'plains' ? 'plains' : m[1].slice(0, -1);
    return mine.filter((perm: any) => new RegExp('\\b' + sub + '\\b').test(typeLineOf(perm))).length;
  }
  // R32: "the number of artifact creatures you control" (Collective Drone).
  m = p.match(/^(artifact|enchantment|legendary|land) creatures you control$/);
  if (m) return mine.filter((perm: any) => /\bcreature\b/.test(typeLineOf(perm)) && new RegExp('\\b' + m![1] + '\\b').test(typeLineOf(perm))).length;
  // Strange new worlds (The Traveler) / Federation count bases.
  if (p === 'differently named lands you control') return countDifferentlyNamedLands(battlefield, controllerId);
  if (p === 'creature types among non-borg creatures you control') return countFederationCreatureTypes(battlefield, controllerId);
  if (p === 'cards in your hand') return zones?.[controllerId]?.handCount ?? zones?.[controllerId]?.hand?.length ?? 0;
  // B63: Uchuulon ? "the number of Crabs, Oozes, and/or Horrors you control"
  {
    const multi = p.match(/^([a-z]+(?:s)?)(?:, ([a-z]+(?:s)?))*(?:,? and\/?or ([a-z]+(?:s)?)) you control$/);
    if (multi) {
      const raw = p.replace(/ you control$/, '');
      const parts = raw.split(/,? and\/?or |, /).map((w) => w.trim().replace(/s$/, '')).filter(Boolean);
      if (parts.length >= 2) {
        return mine.filter((perm) => {
          const line = typeLineOf(perm);
          return parts.some((sub) => new RegExp('\\b' + sub + 's?\\b').test(line));
        }).length;
      }
    }
  }
  return undefined;
}

const DEVOTION_SYM: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/** Devotion (CR 700.5): coloured mana symbols (hybrid included) in mana costs of permanents you control. */
export function devotionTo(color: string, battlefield: any[], controllerId: string): number {
  const sym = DEVOTION_SYM[color];
  if (!sym) return 0;
  return (battlefield || []).filter((perm: any) => perm?.controller === controllerId).reduce((sum: number, perm: any) => {
    const cost = String(perm?.card?.mana_cost ?? '').toUpperCase();
    return sum + (cost.match(/\{[^}]*\}/g) || []).filter((s) => s.includes(sym)).length;
  }, 0);
}

function variableSideCount(oracleTextLower: string, side: 'power' | 'toughness', battlefield: any[], zones: any, controllerId: string): number | undefined {
  const re = new RegExp('(?:^|\\n|\\. )[^.\\n]*?\\b' + side + ' is equal to (?:the number of ([^.\\n]+?)|your devotion to (white|blue|black|red|green))\\.');
  const match = oracleTextLower.match(re);
  if (!match) return undefined;
  if (match[2]) return devotionTo(match[2], battlefield, controllerId);
  return countPowerOnlyPhrase(match[1], battlefield, zones, controllerId);
}

/** "~'s toughness is equal to ..." with printed numeric power. */
export function calculateToughnessOnlyCDA(card: any, oracleTextLower: string, battlefield: any[], zones: any, controllerId: string): { power: number; toughness: number } | undefined {
  if (!String(card?.toughness ?? '').includes('*') || String(card?.power ?? '').includes('*')) return undefined;
  const power = Number(card?.power);
  if (!Number.isFinite(power)) return undefined;
  const count = variableSideCount(oracleTextLower, 'toughness', battlefield, zones, controllerId);
  return count === undefined ? undefined : { power, toughness: count };
}

export function calculatePowerOnlyCDA(
  card: any,
  oracleTextLower: string,
  battlefield: any[],
  zones: any,
  controllerId: string,
): { power: number; toughness: number } | undefined {
  if (!String(card?.power ?? '').includes('*')) return calculateToughnessOnlyCDA(card, oracleTextLower, battlefield, zones, controllerId);
  const toughness = Number(card?.toughness);
  if (!Number.isFinite(toughness)) return undefined;
  const count = variableSideCount(oracleTextLower, 'power', battlefield, zones, controllerId);
  if (count === undefined) return undefined;
  return { power: count, toughness };
}

/**
 * B69: Yavimaya Kavu — star/star where power and toughness each equal a different
 * "COLOR creatures on the battlefield" count.
 */
export function calculateSplitColorBattlefieldCreatureCDA(
  card: any,
  oracleTextLower: string,
  battlefield: any[],
): { power: number; toughness: number } | undefined {
  if (!String(card?.power ?? '').includes('*') || !String(card?.toughness ?? '').includes('*')) return undefined;
  const power = variableSideCount(oracleTextLower, 'power', battlefield, {}, '');
  const toughness = variableSideCount(oracleTextLower, 'toughness', battlefield, {}, '');
  if (power === undefined || toughness === undefined) return undefined;
  return { power, toughness };
}

/** B69: Caller of the Hunt — star/star equal to creatures of the chosen type on the battlefield. */
export function calculateChosenTypeBattlefieldCreatureCDA(
  card: any,
  permanent: any,
  oracleTextLower: string,
  battlefield: any[],
): { power: number; toughness: number } | undefined {
  if (!String(card?.power ?? '').includes('*') || !String(card?.toughness ?? '').includes('*')) return undefined;
  if (!/creatures of the chosen type on the battlefield/.test(oracleTextLower)) return undefined;
  const chosen = String(
    permanent?.chosenCreatureType
    || permanent?.card?.chosenCreatureType
    || card?.chosenCreatureType
    || '',
  ).trim().toLowerCase();
  if (!chosen) return { power: 0, toughness: 0 };
  const n = (battlefield || []).filter((perm: any) => {
    const line = typeLineOf(perm);
    if (!/\bcreature\b/.test(line)) return false;
    return new RegExp(`\\b${chosen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(line);
  }).length;
  return { power: n, toughness: n };
}
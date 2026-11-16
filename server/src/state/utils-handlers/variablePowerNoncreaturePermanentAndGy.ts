// server/src/state/utils-handlers/variablePowerNoncreaturePermanentAndGy.ts
// CDA: power equal to the greatest mana value among noncreature permanents you control
// and noncreature cards in your graveyard (Dragon Man). Also Souls of the Lost.

function manaValueOf(card: any): number {
  const cmc = Number(card?.cmc ?? card?.mana_value ?? card?.manaValue);
  if (Number.isFinite(cmc)) return cmc;
  let total = 0;
  for (const sym of String(card?.mana_cost || '').match(/\{[^}]+\}/g) || []) {
    const s = sym.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(s)) total += parseInt(s, 10);
    else if (s !== 'X') total += 1;
  }
  return total;
}

function isNoncreature(card: any): boolean {
  const tl = String(card?.type_line || card?.typeLine || '').toLowerCase();
  return !!tl && !/\bcreature\b/.test(tl);
}

function isPermanentCard(card: any): boolean {
  const tl = String(card?.type_line || card?.typeLine || '').toLowerCase();
  return /\b(creature|artifact|enchantment|planeswalker|battle|land|kindred)\b/.test(tl);
}

function graveyardOf(gameState: any, controllerId: string): any[] {
  const zones = gameState?.zones?.[controllerId]?.graveyard;
  if (Array.isArray(zones)) return zones;
  const pl = (Array.isArray(gameState?.players) ? gameState.players : []).find((x: any) => String(x?.id) === controllerId);
  if (Array.isArray(pl?.graveyard)) return pl.graveyard;
  return [];
}

const DRAGON_MAN_RE = /\bpower is equal to the greatest mana value among noncreature permanents you control and noncreature cards in your graveyard\b/;

export function calculateGreatestMvNoncreaturePermanentAndGyCDA(
  card: any,
  oracleTextLower: string,
  battlefield: any[],
  controllerId: string,
  gameState?: any,
): { power: number; toughness: number } | undefined {
  if (!DRAGON_MAN_RE.test(String(oracleTextLower || ''))) return undefined;
  if (!String(card?.power ?? '').includes('*')) return undefined;
  const toughness = Number(card?.toughness);
  let greatest = 0;
  for (const perm of battlefield || []) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== controllerId) continue;
    const c = perm.card || perm;
    if (!isNoncreature(c)) continue;
    greatest = Math.max(greatest, manaValueOf(c));
  }
  for (const gyCard of graveyardOf(gameState, controllerId)) {
    if (!isNoncreature(gyCard?.card || gyCard)) continue;
    greatest = Math.max(greatest, manaValueOf(gyCard?.card || gyCard));
  }
  return { power: greatest, toughness: Number.isFinite(toughness) ? toughness : greatest };
}

const SOULS_RE = /\bpower is equal to the number of permanent cards in your graveyard and its toughness is equal to that number plus (?:one|1)\b/;

export function calculatePermanentCardsInGraveyardPlusOneCDA(
  card: any,
  oracleTextLower: string,
  gameState: any,
  controllerId: string,
): { power: number; toughness: number } | undefined {
  if (!SOULS_RE.test(String(oracleTextLower || ''))) return undefined;
  const n = graveyardOf(gameState, controllerId).filter((c) => isPermanentCard(c?.card || c)).length;
  return { power: n, toughness: n + 1 };
}

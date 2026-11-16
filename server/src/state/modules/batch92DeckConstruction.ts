// server/src/state/modules/batch92DeckConstruction.ts
// B92: Rulebreaker deck-construction exceptions (Grizzlegom: any land cards;
// Maular: creature cards with mana value >= N of any color identity, and any
// basic land cards). The format-legality path in scryfall.validateDeck does
// not enforce color identity, so the apply hook is the AI pregame scorer.
// Public: parseCommanderDeckConstructionException, isCardAllowedByCommanderDeckExceptions.

export type CommanderDeckConstructionException =
  | { kind: 'any-land-cards' }
  | { kind: 'any-basic-land-cards' }
  | { kind: 'creatures-mv-at-least-any-color-identity'; minCmc: number };

const ANY_LAND_RE = /a deck with this commander can have any land cards/i;
const ANY_BASIC_RE = /a deck with this commander can have any basic land cards/i;
const CREATURES_MV_RE =
  /a deck with this commander can have creature cards with mana value (\d+) or greater of any color identity/i;

export function parseCommanderDeckConstructionException(oracle: string): CommanderDeckConstructionException[] {
  const text = String(oracle || '').replace(/\u2019/g, "'");
  const out: CommanderDeckConstructionException[] = [];
  if (ANY_LAND_RE.test(text)) out.push({ kind: 'any-land-cards' });
  const mv = text.match(CREATURES_MV_RE);
  if (mv) {
    const n = parseInt(String(mv[1] || ''), 10);
    if (Number.isFinite(n) && n >= 0) out.push({ kind: 'creatures-mv-at-least-any-color-identity', minCmc: n });
  }
  if (ANY_BASIC_RE.test(text) || /and any basic land cards/i.test(text)) out.push({ kind: 'any-basic-land-cards' });
  return out;
}

function isLand(card: any): boolean {
  return /\bland\b/i.test(String(card?.type_line || card?.typeLine || ''));
}
function isBasicLand(card: any): boolean {
  return isLand(card) && /\bbasic\b/i.test(String(card?.type_line || card?.typeLine || ''));
}
function isCreature(card: any): boolean {
  return /\bcreature\b/i.test(String(card?.type_line || card?.typeLine || ''));
}
function cmcOf(card: any): number {
  const n = Number(card?.cmc ?? card?.mana_value ?? card?.manaValue);
  return Number.isFinite(n) ? n : 0;
}

function colorsOf(card: any): string[] {
  const raw = card?.color_identity ?? card?.colorIdentity ?? card?.colors;
  if (!Array.isArray(raw)) return [];
  return raw.map((c: any) => String(c || '').toUpperCase()).filter(Boolean);
}

function identityContains(commanderColors: string[], cardColors: string[]): boolean {
  const allowed = new Set(commanderColors.map((c) => c.toUpperCase()));
  return cardColors.every((c) => allowed.has(c.toUpperCase()));
}

/**
 * True when `card` is legal in a commander deck headed by `commanders` even if
 * it would otherwise violate color identity (or the listed land/creature exceptions).
 */
export function isCardAllowedByCommanderDeckExceptions(card: any, commanders: any[]): boolean {
  const exceptions = (Array.isArray(commanders) ? commanders : [])
    .flatMap((c) => parseCommanderDeckConstructionException(String(c?.oracle_text || c?.oracleText || c?.card?.oracle_text || '')));
  if (!exceptions.length) return false;
  if (exceptions.some((e) => e.kind === 'any-land-cards') && isLand(card)) return true;
  if (exceptions.some((e) => e.kind === 'any-basic-land-cards') && isBasicLand(card)) return true;
  const mvRules = exceptions.filter((e): e is Extract<CommanderDeckConstructionException, { kind: 'creatures-mv-at-least-any-color-identity' }> =>
    e.kind === 'creatures-mv-at-least-any-color-identity');
  if (mvRules.length && isCreature(card) && mvRules.some((e) => cmcOf(card) >= e.minCmc)) return true;
  void identityContains;
  return false;
}

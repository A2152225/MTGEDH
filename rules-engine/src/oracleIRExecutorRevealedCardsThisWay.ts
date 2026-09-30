/**
 * Goblin Charbelcher: "Reveal cards from the top of your library until you reveal a land card. This artifact
 * deals damage equal to the number of nonland cards revealed this way to any target. If the revealed land card
 * was a Mountain, this artifact deals double that damage instead."
 *
 * Cluster: reading the cards a reveal step just showed.
 *   - "the number of nonland cards revealed this way" / "twice the number of ..." (damage amount)
 *   - "the revealed land card was a Mountain" (condition for the doubled replacement)
 * Both read the cards recorded on the execution context by the reveal_top step (lastRevealedCards, falling
 * back to lastMovedCards), so they only answer when a reveal actually happened first.
 */
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

function readTypeLine(card: any): string {
  return String(card?.type_line ?? card?.card?.type_line ?? card?.typeLine ?? '').toLowerCase();
}

function readRevealedCards(ctx: OracleIRExecutionContext, runtime?: { readonly lastMovedCards?: readonly any[] }): any[] {
  const revealed = (ctx as any)?.lastRevealedCards;
  if (Array.isArray(revealed) && revealed.length > 0) return revealed;
  const runtimeMoved = runtime?.lastMovedCards;
  if (Array.isArray(runtimeMoved) && runtimeMoved.length > 0) return [...runtimeMoved];
  const moved = (ctx as any)?.lastMovedCards;
  return Array.isArray(moved) ? moved : [];
}

function cardIsLand(card: any): boolean {
  return /\bland\b/.test(readTypeLine(card));
}

const REVEALED_THIS_WAY_COUNT =
  /^(twice )?(?:the number of )(nonland|land|creature|noncreature|instant or sorcery|artifact|nonartifact)? ?cards? revealed this way$/;

/** Returns null when the raw text is not a "cards revealed this way" count or nothing was revealed. */
export function resolveRevealedThisWayCount(
  normalizedRaw: string,
  ctx: OracleIRExecutionContext,
  runtime?: { readonly lastMovedCards?: readonly any[] },
): number | null {
  const match = normalizedRaw.match(REVEALED_THIS_WAY_COUNT);
  if (!match) return null;
  const cards = readRevealedCards(ctx, runtime);
  if (cards.length === 0) return null;
  const kind = match[2] || '';
  const counted = cards.filter((card) => {
    const typeLine = readTypeLine(card);
    switch (kind) {
      case 'nonland': return !cardIsLand(card);
      case 'land': return cardIsLand(card);
      case 'creature': return /\bcreature\b/.test(typeLine);
      case 'noncreature': return !/\bcreature\b/.test(typeLine);
      case 'artifact': return /\bartifact\b/.test(typeLine);
      case 'nonartifact': return !/\bartifact\b/.test(typeLine);
      case 'instant or sorcery': return /\b(?:instant|sorcery)\b/.test(typeLine);
      default: return true;
    }
  }).length;
  return match[1] ? counted * 2 : counted;
}

/**
 * "the revealed land card was a Mountain": true when the last revealed land card carries that subtype.
 * Returns undefined for any other clause, null when no land card was revealed to judge.
 */
export function tryEvaluateRevealedLandCardWasSubtype(
  normalizedRaw: string,
  ctx: OracleIRExecutionContext,
): boolean | null | undefined {
  const match = normalizedRaw.match(/^the revealed land card was an? ([a-z]+)$/);
  if (!match) return undefined;
  const subtype = match[1]!;
  const lands = readRevealedCards(ctx).filter(cardIsLand);
  if (lands.length === 0) return null;
  const land = lands[lands.length - 1];
  return new RegExp(`\\b${subtype}\\b`).test(readTypeLine(land));
}
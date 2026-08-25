// server/src/state/modules/can-respond-handlers/canRespondSplitSecondLandPredicates.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: Split Second stack lock plus land type-line predicate used by
// getCastableSpellCandidates and land-play checks.
// Public entry symbols: isSplitSecondLockActive, isLandTypeLine.
// cardHasSplitSecond stays file-private.

function cardHasSplitSecond(card: any): boolean {
  if (!card) return false;
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  const oracleText = String(card.oracle_text || '').toLowerCase();
  return keywords.some((k: any) => String(k).toLowerCase() === 'split second') || oracleText.includes('split second');
}

export function isSplitSecondLockActive(state: any): boolean {
  const stack = state?.stack;
  if (!Array.isArray(stack) || stack.length === 0) return false;

  // Rules-wise, Split Second should be the top-most spell (players can't add to the stack),
  // but be robust and scan the whole stack.
  for (const item of stack) {
    const card = item?.card ?? item?.spell?.card ?? item?.sourceCard ?? item?.source?.card;
    if (cardHasSplitSecond(card)) return true;
  }
  return false;
}

export function isLandTypeLine(typeLine: unknown): boolean {
  return /\bland\b/i.test(String(typeLine || ''));
}

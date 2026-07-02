/**
 * Pure helpers for the oracle snapshot delta audit (task D1).
 *
 * Kept free of heavy imports (no parser / executor / server modules) so unit
 * tests can exercise delta computation without loading the audit machinery.
 */

import crypto from 'node:crypto';

export type OracleDeltaBaseline = {
  meta: {
    generatedAt: string;
    cardCount: number;
  };
  /** oracleId → identity hash of `${name}\n${combined oracle text}`. */
  cards: Record<string, string>;
};

export type OracleDeltaCardIdentity = {
  oracleId: string;
  name: string;
  hash: string;
};

export type OracleDeltaResult = {
  newCards: OracleDeltaCardIdentity[];
  changedCards: OracleDeltaCardIdentity[];
  unchangedCount: number;
};

export function hashOracleIdentity(name: string, oracleText: string): string {
  return crypto
    .createHash('sha1')
    .update(`${String(name || '')}\n${String(oracleText || '')}`, 'utf8')
    .digest('hex');
}

export function oracleIdForCard(card: {
  oracle_id?: string;
  id?: string;
  name?: string;
}): string {
  return String(card.oracle_id || card.id || card.name || '');
}

export function computeOracleDelta(
  cards: readonly OracleDeltaCardIdentity[],
  baseline: OracleDeltaBaseline,
): OracleDeltaResult {
  const newCards: OracleDeltaCardIdentity[] = [];
  const changedCards: OracleDeltaCardIdentity[] = [];
  let unchangedCount = 0;

  for (const card of cards) {
    const baselineHash = baseline.cards[card.oracleId];
    if (baselineHash === undefined) {
      newCards.push(card);
    } else if (baselineHash !== card.hash) {
      changedCards.push(card);
    } else {
      unchangedCount += 1;
    }
  }

  return { newCards, changedCards, unchangedCount };
}

export function buildOracleDeltaBaseline(
  cards: readonly OracleDeltaCardIdentity[],
): OracleDeltaBaseline {
  const entries: Record<string, string> = {};
  for (const card of cards) {
    entries[card.oracleId] = card.hash;
  }
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      cardCount: Object.keys(entries).length,
    },
    cards: entries,
  };
}

export type DeltaGapReasonCode =
  | 'full_card_ir_gap'
  | 'full_card_parse_to_execute'
  | 'trigger_not_detected'
  | 'trigger_effect_ir_gap'
  | 'trigger_event_unknown';

/**
 * Overlay-first decision tree (see docs/oracle-ir-track-e-remaining-work.md §C):
 * unknown IR step kinds → compile an overlay; execute-side skips → probe first
 * (may need executor/queue wiring); trigger detection gaps → detector table work
 * (overlay cannot make a trigger fire).
 */
export function suggestDeltaGapAction(reasons: readonly DeltaGapReasonCode[]): string {
  const set = new Set(reasons);
  if (set.has('trigger_not_detected') || set.has('trigger_event_unknown')) {
    return 'extend trigger detectors (B6/D5) — overlay cannot make a trigger fire';
  }
  if (set.has('full_card_ir_gap') || set.has('trigger_effect_ir_gap')) {
    return 'compile overlay (@OracleIRCompiler → validate → import); parser batch only if phrasing recurs';
  }
  if (set.has('full_card_parse_to_execute')) {
    return 'probe (oracle-ir:overlay:probe) — likely executor/queue wiring (B4/B5) or overlay with wired kinds';
  }
  return 'probe (oracle-ir:overlay:probe)';
}

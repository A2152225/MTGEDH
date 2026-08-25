// Extracted from rules-engine/src/oracleIRParser.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParser.ts: the legacy exile-top-only matcher that used to live as a
// closure inside parseAbilityToIRAbility. clauses is passed in; the body is unchanged.
//
// Public entry points:
//   tryParseExileTopOnlyLegacy

import type { OracleEffectStep, OraclePlayerSelector, OracleQuantity } from './oracleIR';
import {
  isThatOwnerOrControllerSelector,
  isThoseOpponentsPossessiveSource,
  isThoseOpponentsSelector,
  normalizeClauseForParse,
  normalizeOracleText,
  parsePlayerSelector,
  parseQuantity,
} from './oracleIRParserUtils';

export function tryParseExileTopOnlyLegacy(
  clauses: readonly string[],
  idx: number
): { step: OracleEffectStep; consumed: number } | null {
    const first = String(clauses[idx] || '').trim();
    const second = String(clauses[idx + 1] || '').trim();
    if (!first) return null;

    const normalizedFirst = normalizeClauseForParse(first);
    const normalizedSecond = second ? normalizeClauseForParse(second) : null;
    const firstToParse = String(normalizedFirst.clause || '').trim();
    const secondToParse = normalizedSecond ? String(normalizedSecond.clause || '').trim() : '';

    const normalizePossessive = (s: string): string => String(s || '').replace(/’/g, "'").trim().toLowerCase();

    let amount: OracleQuantity | null = null;
    let who: OraclePlayerSelector | null = null;
    let consumed = 1;

    {
      const m = firstToParse.match(
        /^exile\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
      );
      if (m) {
        amount = parseQuantity(m[1]);
        const src = normalizePossessive(m[2]);
        if (src === 'your') who = { kind: 'you' };
        else if (src === "target player's") who = { kind: 'target_player' };
        else if (src === "target opponent's") who = { kind: 'target_opponent' };
        else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
        else if (src === "that opponent's") who = { kind: 'target_opponent' };
        else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
        else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
        else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
      } else {
        const m2 = firstToParse.match(
          /^exile\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
        );
        if (m2) {
          amount = { kind: 'number', value: 1 };
          const src = normalizePossessive(m2[1]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }

      if (!amount) {
        const mExilesMany = firstToParse.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+exiles\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (mExilesMany) {
          amount = parseQuantity(mExilesMany[2]);
          who = parsePlayerSelector(mExilesMany[1]);
        }
      }

      if (!amount) {
        const mExilesOne = firstToParse.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+exiles\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (mExilesOne) {
          amount = { kind: 'number', value: 1 };
          who = parsePlayerSelector(mExilesOne[1]);
        }
      }

      if (!amount) {
        const m3 = firstToParse.match(
          /^put\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m3) {
          amount = parseQuantity(m3[1]);
          const src = normalizePossessive(m3[2]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }
      if (!amount) {
        const m4 = firstToParse.match(
          /^put\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m4) {
          amount = { kind: 'number', value: 1 };
          const src = normalizePossessive(m4[1]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }

      if (!amount) {
        const m5 = firstToParse.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+puts?\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m5) {
          amount = parseQuantity(m5[2]);
          who = parsePlayerSelector(m5[1]);
        }
      }
      if (!amount) {
        const m6 = firstToParse.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+puts?\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m6) {
          amount = { kind: 'number', value: 1 };
          who = parsePlayerSelector(m6[1]);
        }
      }

      // Exile-until variant seen in real oracle text (corpus):
      // "Target opponent exiles cards from the top of their library until they exile an instant or sorcery card."
      // "Each opponent exiles cards from the top of their library until they exile a nonland card."
      // We treat the quantity as unknown in IR.
      if (!amount) {
        const mUntil = firstToParse.match(
          /^(?:(?:when|whenever|if)\s+[^,]+,\s*)?(each player|each opponent|each of those opponents|those opponents|all of those opponents|all those opponents|you|target player|target opponent|that player|that opponent|defending player|the defending player|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+exiles?\s+cards?\s+from\s+the\s+top\s+of\s+(?:their|your|his or her)\s+library\s+until\s+(.+?)(?:\s+face down)?\s*$/i
        );
        if (mUntil) {
          const subj = String(mUntil[1] || '').trim().toLowerCase();
          if (subj === 'you') who = { kind: 'you' };
          else if (subj === 'each player') who = { kind: 'each_player' };
          else if (subj === 'each opponent') who = { kind: 'each_opponent' };
          else if (isThoseOpponentsSelector(subj)) who = { kind: 'each_of_those_opponents' };
          else if (subj === 'target player' || subj === 'that player') who = { kind: 'target_player' };
          else if (subj === 'target opponent' || subj === 'that opponent' || subj === 'defending player' || subj === 'the defending player') who = { kind: 'target_opponent' };
          else if (subj === 'its controller' || subj === 'its owner' || isThatOwnerOrControllerSelector(subj)) {
            who = { kind: 'target_player' };
          }
          else who = { kind: 'unknown', raw: String(mUntil[1] || '').trim() };

          const untilRaw = String(mUntil[2] || '')
            .trim()
            .replace(/[,;]\s*then\b.*$/i, '')
            .replace(/\s+then\b.*$/i, '')
            .trim();

          amount = parseQuantity(`until ${untilRaw}`);
        }
      }

      // Exile-until variant with implied subject (often created by our clause-splitting on "then").
      // Example (corpus: Tibalt's Trickery):
      // "... mills that many cards, then exiles cards from the top of their library until they exile ..."
      if (!amount) {
        const mUntilImplied = firstToParse.match(
          /^(?:(?:when|whenever|if)\s+[^,]+,\s*)?exiles?\s+cards?\s+from\s+the\s+top\s+of\s+(their|your|his or her)\s+library\s+until\s+(.+?)(?:\s+face down)?\s*$/i
        );
        if (mUntilImplied) {
          const src = normalizePossessive(String(mUntilImplied[1] || '').trim());
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else who = { kind: 'unknown', raw: String(mUntilImplied[1] || '').trim() };

          const untilRaw = String(mUntilImplied[2] || '')
            .trim()
            .replace(/[,;]\s*then\b.*$/i, '')
            .replace(/\s+then\b.*$/i, '')
            .trim();

          amount = parseQuantity(`until ${untilRaw}`);
        }
      }

      // 2-clause face-down variant:
      // "Look at the top card(s) of <library>, then exile it/those cards face down."
      if (!amount && second) {
        const clean = (s: string): string =>
          normalizeOracleText(String(s || ''))
            .trim()
            .replace(/^then\b\s*/i, '')
            .replace(/,+\s*$/g, '')
            .trim();
        const firstClean = clean(firstToParse);
        const secondClean = clean(secondToParse);

        const look = firstClean.match(
          /^look at the top (?:(a|an|\d+|x|[a-z]+) cards?|card) of (your|their|his or her|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’]) librar(?:y|ies)\s*$/i
        );
        const exileIt = /^(?:then\s+)?exile\s+(?:it|that card|them|those cards|the cards)(?:\s+face down)?\s*$/i;

        if (look && exileIt.test(secondClean)) {
          amount = look[1] ? parseQuantity(look[1]) : { kind: 'number', value: 1 };
          const src = normalizePossessive(look[2]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
          else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
          consumed = 2;
        }
      }

      // Single-clause look+exile variant:
      // "Look at the top N cards of <library> and exile those cards (face down)."
      // Only supported when it deterministically exiles all looked-at cards.
      if (!amount) {
        const clean = (s: string): string =>
          normalizeOracleText(String(s || ''))
            .trim()
            .replace(/^then\b\s*/i, '')
            .replace(/,+\s*$/g, '')
            .trim();
        const firstClean = clean(firstToParse);

        const srcPattern =
          '(your|target player[\'’]s|target opponent[\'’]s|that player[\'’]s|that opponent[\'’]s|each player[\'’]s|each players[\'’]|each opponent[\'’]s|each opponents[\'’]|each of your opponents[\'’]|each of those opponents[\'’]|those opponents[\'’]|all of those opponents[\'’]|all those opponents[\'’]|their|his or her)';

        const mLookMany = firstClean.match(
          new RegExp(
            `^look at the top (a|an|\\d+|x|[a-z]+) cards? of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:them|those cards|the cards)(?: face down)?\\s*$`,
            'i'
          )
        );
        if (mLookMany) {
          amount = parseQuantity(mLookMany[1]);
          const src = normalizePossessive(mLookMany[2]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
          else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }

        if (!amount) {
          const mLookOne = firstClean.match(
            new RegExp(
              `^look at the top card of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:it|that card|them|those cards|the cards)(?: face down)?\\s*$`,
              'i'
            )
          );
          if (mLookOne) {
            amount = { kind: 'number', value: 1 };
            const src = normalizePossessive(mLookOne[1]);
            if (src === 'your') who = { kind: 'you' };
            else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
            else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
            else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
            else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
            else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
            else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
          }
        }
      }
    }

    if (!amount) return null;
    if (!who) return null;

    const out: any = {
      kind: 'exile_top',
      who,
      amount,
      raw:
        clauses
          .slice(idx, idx + consumed)
          .map(c => String(c || '').trim())
          .filter(Boolean)
          .join('. ') +
        '.',
    };
    if (normalizedFirst.sequence) out.sequence = normalizedFirst.sequence;
    if (normalizedFirst.optional) out.optional = true;

    return {
      step: out,
      consumed,
    };
}

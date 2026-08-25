// Extracted from rules-engine/src/oracleIRParser.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParser.ts: the impulse-plus-exile-top clause matcher that used to live
// as a closure inside parseAbilityToIRAbility. clauses is passed in; the body is unchanged.
//
// Public entry points:
//   tryParseImpulseExileTop

import type { OracleEffectStep, OraclePlayerSelector, OracleQuantity } from './oracleIR';
import { parseEffectLevelImpulsePermissionClause as parseExileTopImpulsePermissionClause } from './oracleIRParserEffectImpulsePermission';
import {
  isIgnorableImpulseReminderClause,
} from './oracleIRParserImpulseClauseUtils';
import {
  isThatOwnerOrControllerSelector,
  isThoseOpponentsPossessiveSource,
  normalizeOracleText,
  parsePlayerSelector,
  parseQuantity,
} from './oracleIRParserUtils';

export function tryParseImpulseExileTop(
  clauses: readonly string[],
  idx: number
): { step: OracleEffectStep; consumed: number } | null {
    const first = String(clauses[idx] || '').trim();
    const second = String(clauses[idx + 1] || '').trim();
    const third = String(clauses[idx + 2] || '').trim();
    const fourth = String(clauses[idx + 3] || '').trim();
    const fifth = String(clauses[idx + 4] || '').trim();
    if (!first || !second) return null;

    const cleanImpulseClause = (s: string): string =>
      normalizeOracleText(String(s || ''))
        .trim()
        .replace(/^[\u2022]\s+/g, '')
        .replace(/^(?:the\s+)?defending player\s+may\b/i, 'that opponent may')
        .replace(/^then\b\s*/i, '')
        .replace(/^if you do,\s*/i, '')
        .replace(/^if you don[’']t,\s*/i, '')
        .replace(/^otherwise,?\s*/i, '')
        .replace(/^if you don[’']t cast (?:it|that card|the exiled card) this way,\s*/i, '')
        .replace(/,+\s*$/g, '')
        .trim();

    const normalizePossessive = (s: string): string => String(s || '').replace(/’/g, "'").trim().toLowerCase();

    // First clause: "Exile the top card(s) of your library"
    // Support both explicit quantity and the common implicit "top card".
    let amount: OracleQuantity | null = null;
    let who: OraclePlayerSelector | null = null;
    let baseConsumed = 1;
    {
      const firstClean = cleanImpulseClause(first);

      // Some templates include a trailing "then choose ..." rider in the same sentence.
      // Strip it before attempting to match the exile seed.
      const firstCleanNoChoose = firstClean
        .replace(/,?\s*then\s+choose\s+(?:a|an|one)\s+(?:card|spell)\s+exiled\s+this\s+way\s*$/i, '')
        // Saga chapter markers prefix effect lines: "I ’", "II ’", etc.
        // Our normalizer maps em-dash to '-', so strip "I -"/"II -"/etc.
        .replace(/^(?:[ivx]+)\s*-\s+/i, '')
        // Modal mode labels and ability-word labels sometimes prefix effect lines: "Interrogate Them ’ Exile ..."
        // / "Mystic Arcanum ’ At the beginning of ...".
        // Strip a short "<Label> -" prefix only when followed by a known deterministic wrapper/seed.
        .replace(
          /^(?:[a-z0-9][a-z0-9\s'’\-.,]{0,80})\s*-\s+(?=(?:at the beginning of|when|whenever|if|exile|put|look)\b)/i,
          ''
        )
        // Wrapper used by many triggered templates.
        .replace(/^at the beginning of (?:the )?[^,]+,\s*/i, '')
        // Common prefix patterns that wrap an exile instruction inside a trigger/condition:
        // "Whenever <thing>, if <predicate>, exile ..."
        // "When/Whenever <thing>, exile ..."
        .replace(/^(?:when|whenever)\s+[^,]+,\s*/i, '')
        .replace(/^if\s+[^,]+,\s*/i, '')
        .trim();

      const m = firstCleanNoChoose.match(
        /^exile\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['???]s|target opponent['???]s|that player['???]s|that opponent['???]s|their|his or her|its owner['???]s|its controller['???]s|each player['???]s|each players['???]|each opponent['???]s|each opponents['???]|each of your opponents['???]|each of those opponents['???]|those opponents['???]|all of those opponents['???]|all those opponents['???])\s+librar(?:y|ies)(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
      );
      if (m) {
        amount = parseQuantity(m[1]);
        const rawSrc = String(m[2] || '').trim();
        const src = normalizePossessive(rawSrc);
        if (src === 'your') who = { kind: 'you' };
        else if (src === "target player's") who = { kind: 'target_player' };
        else if (src === "target opponent's") who = { kind: 'target_opponent' };
        else if (src === "its controller's") who = { kind: 'controller_of_referenced_object' };
        else if (src === "its owner's") who = { kind: 'owner_of_referenced_object' };
        else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
        else if (src === "that opponent's") who = { kind: 'target_opponent' };
        else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
        else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
        else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
      } else {
        const m2 = firstCleanNoChoose.match(
          /^exile\s+the\s+top\s+card\s+of\s+(your|target player['???]s|target opponent['???]s|that player['???]s|that opponent['???]s|their|his or her|its owner['???]s|its controller['???]s|each player['???]s|each players['???]|each opponent['???]s|each opponents['???]|each of your opponents['???]|each of those opponents['???]|those opponents['???]|all of those opponents['???]|all those opponents['???])\s+librar(?:y|ies)(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
        );
        if (m2) {
          amount = { kind: 'number', value: 1 };
          const rawSrc = String(m2[1] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "its controller's") who = { kind: 'controller_of_referenced_object' };
        else if (src === "its owner's") who = { kind: 'owner_of_referenced_object' };
        else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }

      // Variable-quantity form used by real oracle text:
      // "... exile that many cards from the top of your library."
      // We don't attempt to resolve what "that many" refers to here; represent it as an unknown quantity
      // so the impulse permission clause can still be parsed deterministically.
      if (!amount) {
        const mVar = firstCleanNoChoose.match(
          /^exile\s+that\s+many\s+cards?\s+from\s+(?:the\s+)?top\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|its owner['’]s|its controller['’]s)\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
        );
        if (mVar) {
          amount = { kind: 'reference_amount', raw: 'that many' };
          const rawSrc = String(mVar[1] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "its controller's") who = { kind: 'controller_of_referenced_object' };
        else if (src === "its owner's") who = { kind: 'owner_of_referenced_object' };
        else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
        }
      }

      // Alternate subject order: "Each player exiles the top card(s) of their library."
      if (!amount) {
        const m3 = firstCleanNoChoose.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+exiles\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (m3) {
          amount = parseQuantity(m3[2]);
          who = parsePlayerSelector(m3[1]);
        }
      }
      if (!amount) {
        const m4 = firstCleanNoChoose.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+exiles\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (m4) {
          amount = { kind: 'number', value: 1 };
          who = parsePlayerSelector(m4[1]);
        }
      }

      // Alternate verb: "Put the top card(s) of ... library into exile"
      if (!amount) {
        const m5 = firstCleanNoChoose.match(
          /^put\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|its owner['’]s|its controller['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
        );
        if (m5) {
          amount = parseQuantity(m5[1]);
          const rawSrc = String(m5[2] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "its controller's") who = { kind: 'controller_of_referenced_object' };
        else if (src === "its owner's") who = { kind: 'owner_of_referenced_object' };
        else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }
      if (!amount) {
        const m6 = firstCleanNoChoose.match(
          /^put\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|its owner['’]s|its controller['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
        );
        if (m6) {
          amount = { kind: 'number', value: 1 };
          const rawSrc = String(m6[1] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "its controller's") who = { kind: 'controller_of_referenced_object' };
        else if (src === "its owner's") who = { kind: 'owner_of_referenced_object' };
        else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }

      // Subject-order with "put/puts": "Each player puts the top card(s) of their library into exile."
      if (!amount) {
        const m7 = firstCleanNoChoose.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+puts?\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m7) {
          amount = parseQuantity(m7[2]);
          who = parsePlayerSelector(m7[1]);
        }
      }
      if (!amount) {
        const m8 = firstCleanNoChoose.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+puts?\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m8) {
          amount = { kind: 'number', value: 1 };
          who = parsePlayerSelector(m8[1]);
        }
      }

      // Modal/third-person variant:
      // "Its controller may exile that many cards from the top of their library."
      if (!amount) {
        const m9 = firstCleanNoChoose.match(
          /^(its controller|its owner|that [a-z0-9][a-z0-9 -]*(?:'s|[????]s) (?:controller|owner)|that player|that opponent|defending player|the defending player|they|he or she)\s+may\s+exile\s+(that many|a|an|\d+|x|[a-z]+)\s+cards?\s+from\s+the\s+top\s+of\s+(their|his or her|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (m9) {
          amount = parseQuantity(m9[2]);
          const subj = String(m9[1] || '').trim().toLowerCase();
          if (subj === 'that player') who = { kind: 'target_player' };
          else if (subj === 'that opponent' || subj === 'defending player' || subj === 'the defending player') who = { kind: 'target_opponent' };
          else if (subj === 'its controller' || subj === 'its owner' || isThatOwnerOrControllerSelector(subj)) {
            who = { kind: 'target_player' };
          }
          else who = { kind: 'unknown', raw: String(m9[1] || '').trim() };
        }
      }

      // Variable-amount variant seen in real oracle text (corpus):
      // "(When ... ,) exile a number of/that many cards from the top of your library [equal to ...]"
      // Treat bare "a number of" as a reference amount; the optional equal-to tail preserves the source relation in raw text.
      if (!amount) {
        const m10 = firstCleanNoChoose.match(
          /^(?:(?:when|whenever)\s+[^,]+,\s*)?exile\s+(a number of|that many|a|an|\d+|x|[a-z]+)\s+cards?\s+from\s+the\s+top\s+of\s+your\s+library(?:\s+equal\s+to\s+[^,]+)?(?:\s+face down)?\s*$/i
        );
        if (m10) {
          const qtyRaw = String(m10[1] || '').trim().toLowerCase();
          if (qtyRaw === 'a number of') amount = parseQuantity('a number of');
          else amount = parseQuantity(qtyRaw);
          who = { kind: 'you' };
        }
      }

      // Exile-until variant seen in real oracle text (corpus):
      // "Exile cards from the top of your library until you exile a legendary card."
      // Keep the quantity as a structured reference when possible.
      if (!amount) {
        const m10b = firstCleanNoChoose.match(
          /^exile\s+cards?\s+from\s+the\s+top\s+of\s+your\s+library\s+until\s+you\s+exile\s+a\s+legendary\s+card(?:\s+face down)?\s*$/i
        );
        if (m10b) {
          amount = { kind: 'unknown', raw: 'until you exile a legendary card' };
          who = { kind: 'you' };
        }
      }

      // Exile-until variant seen in real oracle text (corpus):
      // "Target opponent exiles cards from the top of their library until they exile an instant or sorcery card."
      // "Each opponent exiles cards from the top of their library until they exile a nonland card."
      // We treat the quantity as unknown in IR.
      if (!amount) {
        const m10c = firstCleanNoChoose.match(
          /^(?:(?:when|whenever|if)\s+[^,]+,\s*)?(each player|each opponent|you|target player|target opponent|that player|that opponent|defending player|the defending player|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+exiles?\s+cards?\s+from\s+the\s+top\s+of\s+(?:their|your|his or her)\s+library\s+until\s+(.+?)(?:\s+face down)?\s*$/i
        );
        if (m10c) {
          const subj = String(m10c[1] || '').trim().toLowerCase();
          if (subj === 'you') who = { kind: 'you' };
          else if (subj === 'each player') who = { kind: 'each_player' };
          else if (subj === 'each opponent') who = { kind: 'each_opponent' };
          else if (subj === 'target player' || subj === 'that player') who = { kind: 'target_player' };
          else if (subj === 'target opponent' || subj === 'that opponent' || subj === 'defending player' || subj === 'the defending player') who = { kind: 'target_opponent' };
          else if (subj === 'its controller' || subj === 'its owner' || isThatOwnerOrControllerSelector(subj)) {
            who = { kind: 'target_player' };
          }
          else who = { kind: 'unknown', raw: String(m10c[1] || '').trim() };

          const untilRaw = String(m10c[2] || '')
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
      // We treat the quantity as unknown in IR and map the pronoun source to our existing selectors.
      if (!amount) {
        const m10c2 = firstCleanNoChoose.match(
          /^(?:(?:when|whenever|if)\s+[^,]+,\s*)?exiles?\s+cards?\s+from\s+the\s+top\s+of\s+(their|your|his or her)\s+library\s+until\s+(.+?)(?:\s+face down)?\s*$/i
        );
        if (m10c2) {
          const src = normalizePossessive(String(m10c2[1] || '').trim());
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else who = { kind: 'unknown', raw: String(m10c2[1] || '').trim() };

          const untilRaw = String(m10c2[2] || '')
            .trim()
            .replace(/[,;]\s*then\b.*$/i, '')
            .replace(/\s+then\b.*$/i, '')
            .trim();

          amount = parseQuantity(`until ${untilRaw}`);
        }
      }

      // Variable-amount variant seen in real oracle text (corpus):
      // "Exile cards equal to <expr> from the top of <player>'s library."
      // We treat the quantity as unknown in IR.
      if (!amount) {
        const srcPattern =
          '(your|target player[\'’]s|target opponent[\'’]s|that player[\'’]s|that opponent[\'’]s|their|his or her|its owner[\'’]s|its controller[\'’]s)';
        const m11 = firstCleanNoChoose.match(
          new RegExp(
            `^exile\\s+cards?\\s+equal\\s+to\\s+(.+?)\\s+from\\s+the\\s+top\\s+of\\s+${srcPattern}\\s+library(?:\\s+face down)?\\s*$`,
            'i'
          )
        );
        if (m11) {
          const rawSrc = String(m11[2] || '').trim();
          const rawAmount = `cards equal to ${String(m11[1] || '').trim()}`;
          amount = /^its\s+owner/i.test(rawSrc)
            ? { kind: 'unknown', raw: rawAmount }
            : parseQuantity(rawAmount);
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "its controller's") who = { kind: 'controller_of_referenced_object' };
          else if (src === "its owner's") who = { kind: 'owner_of_referenced_object' };
          else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
        }
      }

      // 2-clause face-down variant:
      // "Look at the top card of <library>, then exile it face down. You may play/cast ..."
      // This shows up in oracle text for "steal"-style effects (e.g., "that player's library").
      if (!amount) {
        const clean = (s: string): string =>
          normalizeOracleText(String(s || ''))
            .trim()
            .replace(/^then\b\s*/i, '')
            .replace(/,+\s*$/g, '')
            .trim();
        const firstClean = clean(first);
        const secondClean = clean(second);

        const lookMany = firstClean.match(
          /^look at the top (a|an|\d+|x|[a-z]+) cards? of (your|their|his or her|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’]) librar(?:y|ies)\s*$/i
        );
        const look = firstClean.match(
          /^look at the top card of (your|their|his or her|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’]) librar(?:y|ies)\s*$/i
        );
        const exileIt = /^(?:then\s+)?exile\s+(?:it|that card|them|those cards|the cards)(?:\s+face down)?\s*$/i;

        if ((lookMany || look) && exileIt.test(secondClean)) {
          amount = lookMany ? parseQuantity(lookMany[1]) : { kind: 'number', value: 1 };
          const src = normalizePossessive((lookMany ? lookMany[2] : look[1]) as string);
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
          else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
          baseConsumed = 2;
        }
      }

      // Single-clause look+exile variant:
      // "Look at the top N cards of <library> and exile those cards (face down). You may play those cards ..."
      // Only supported when it deterministically exiles all looked-at cards.
      if (!amount) {
        const clean = (s: string): string =>
          normalizeOracleText(String(s || ''))
            .trim()
            .replace(/^then\b\s*/i, '')
            .replace(/,+\s*$/g, '')
            .trim();
        const firstClean = clean(first);

        const srcPattern =
          '(your|target player[\'’]s|target opponent[\'’]s|that player[\'’]s|that opponent[\'’]s|each player[\'’]s|each players[\'’]|each opponent[\'’]s|each opponents[\'’]|each of your opponents[\'’]|each of those opponents[\'’]|those opponents[\'’]|all of those opponents[\'’]|all those opponents[\'’]|their|his or her)';

        // Explicit quantity: "top two cards"
        const m = firstClean.match(
          new RegExp(
            `^look at the top (a|an|\\d+|x|[a-z]+) cards? of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:them|those cards|the cards)(?: face down)?\\s*$`,
            'i'
          )
        );
        if (m) {
          amount = parseQuantity(m[1]);
          const src = normalizePossessive(m[2]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
          else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }

        // Implicit singular: "top card ... and exile it (face down)"
        if (!amount) {
          const m2 = firstClean.match(
            new RegExp(
              `^look at the top card of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:it|that card|them|those cards|the cards)(?: face down)?\\s*$`,
              'i'
            )
          );
          if (m2) {
            amount = { kind: 'number', value: 1 };
            const src = normalizePossessive(m2[1]);
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

    // Allow a small number of intervening reminder/metadata clauses between the exile clause and the permission clause.
    // Be conservative: only specific known reminder/metadata clauses are skippable.
    // We scan up to 4 follow-up clauses to tolerate templates like:
    // exile -> (look reminder) -> (spend-mana reminder) -> (choose one) -> permission
    const candidateClauses = clauses
      .slice(idx + baseConsumed, idx + baseConsumed + 4)
      .map(c => String(c || '').trim())
      .filter(Boolean);
    let permissionInfo: ReturnType<typeof parseExileTopImpulsePermissionClause> | null = null;
    let consumed = 0;
    const maxIgnorableInterveningClauses = 3;
    for (let i = 0; i < candidateClauses.length; i++) {
      const cRaw = candidateClauses[i];
      const c = cleanImpulseClause(cRaw);
      const parsed = parseExileTopImpulsePermissionClause(c);
      if (parsed) {
        if (!permissionInfo || (permissionInfo.duration === 'during_resolution' && parsed.duration !== 'during_resolution')) {
          permissionInfo = parsed;
          consumed = baseConsumed + (i + 1);
        }
        if (parsed.duration !== 'during_resolution') break;
        continue;
      }

      if (i >= maxIgnorableInterveningClauses) break;
      if (!isIgnorableImpulseReminderClause(c)) {
        // As soon as we see a non-permission, non-ignorable clause, abort.
        break;
      }
    }
    if (!permissionInfo) return null;

    return {
      step: {
        kind: 'impulse_exile_top',
        who,
        amount,
        duration: permissionInfo.duration,
        permission: permissionInfo.permission,
        condition: permissionInfo.condition,
        raw: clauses
          .slice(idx, idx + consumed)
          .map(c => String(c || '').trim())
          .filter(Boolean)
          .join('. ') +
          '.',
      },
      consumed,
    };
}

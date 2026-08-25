/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal clauses from "if that player controls more lands
 * than each other player" through "if you didn't attack with a creature this turn"
 * Public: tryEvaluateInterveningIfControlZoneClauses
 */

import { parseCountToken, countByPermanentType, didPlayerAttackThisTurn } from "./intervening-if-this-turn-counts.js";
import { getHandCount, getGraveyardCount, getLibraryCount } from "./intervening-if-zone-lookups.js";
import { countControlledEnteredThisTurn } from "./intervening-if-entered-this-turn.js";
import { getOpponentInfo, getOpponentIds, getAllPlayerIds, getTurnPlayerId, isTiedForExtreme } from "./intervening-if-permanent-and-player.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

export function tryEvaluateInterveningIfControlZoneClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;

  // "if that player controls more lands than each other player" (Rivalry/Greener Pastures)
  if (/^if\s+that\s+player\s+controls\s+more\s+lands\s+than\s+each\s+other\s+player$/i.test(clause)) {
    const that =
      refs?.thatPlayerId ??
      (sourcePermanent as any)?.thatPlayerId ??
      (sourcePermanent as any)?.referencedPlayerId ??
      (sourcePermanent as any)?.targetPlayerId ??
      getTurnPlayerId(ctx);

    if (typeof that !== 'string' || !that) return null;
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return null;

    const thatCount = countByPermanentType(ctx, that, 'land');
    return ids.every((pid) => {
      if (pid === that) return true;
      return thatCount > countByPermanentType(ctx, pid, 'land');
    });
  }

  // "if that player had another land enter the battlefield under their control this turn" (Tunnel Ignus/Conundrum)
  if (/^if\s+that\s+player\s+had\s+another\s+land\s+enter\s+the\s+battlefield\s+under\s+their\s+control\s+this\s+turn$/i.test(clause)) {
    const that =
      (sourcePermanent as any)?.thatPlayerId ??
      (sourcePermanent as any)?.referencedPlayerId ??
      (sourcePermanent as any)?.targetPlayerId;

    if (typeof that !== 'string' || !that) return null;

    // The "another" land is satisfied if total lands entered this turn under that player's control is at least 2.
    const c = countControlledEnteredThisTurn(ctx, that, 'land');
    if (c === null) return null;
    return c >= 2;
  }

  // "if an opponent controls more creatures/lands than you" (fallback for templates that don't use "that player")
  {
    const m = clause.match(
      /^if\s+an\s+opponent\s+(?:controls|has)\s+more\s+(creatures|lands)\s+than\s+you$/i
    );
    if (m) {
      const subject = m[1].toLowerCase();
      const yourCount =
        subject === "creatures"
          ? countByPermanentType(ctx, controllerId, "creature")
          : countByPermanentType(ctx, controllerId, "land");

      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponentIds.length) return false;

      return opponentIds.some((oppId) => {
        const oppCount =
          subject === "creatures"
            ? countByPermanentType(ctx, oppId, "creature")
            : countByPermanentType(ctx, oppId, "land");
        return oppCount > yourCount;
      });
    }
  }

  // Opponent-relative creature/land comparisons
  // - "if no opponent controls more creatures/lands than you"
  // - "if an opponent controls fewer creatures/lands than you"
  {
    const noOppMore = clause.match(
      /^if\s+no\s+opponent\s+(?:controls|has)\s+more\s+(creatures|lands)\s+than\s+you$/i
    );
    if (noOppMore) {
      const subject = noOppMore[1].toLowerCase();
      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return oppCount <= yourCount;
      });
    }

    const oppFewer = clause.match(
      /^if\s+an\s+opponent\s+(?:controls|has)\s+fewer\s+(creatures|lands)\s+than\s+you$/i
    );
    if (oppFewer) {
      const subject = oppFewer[1].toLowerCase();
      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponentIds.length) return false;
      return opponentIds.some((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return oppCount < yourCount;
      });
    }

    const noOppFewer = clause.match(
      /^if\s+no\s+opponent\s+(?:controls|has)\s+fewer\s+(creatures|lands)\s+than\s+you$/i
    );
    if (noOppFewer) {
      const subject = noOppFewer[1].toLowerCase();
      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return oppCount >= yourCount;
      });
    }
  }

  // "if you control fewer/more creatures/lands than an opponent" / "... than each opponent" / "... than each other player"
  {
    const m = clause.match(
      /^if\s+you\s+(?:control|have)\s+(fewer|more)\s+(creatures|lands)\s+than\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmp = m[1].toLowerCase();
      const subject = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      if (scope === 'an opponent') {
        const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
        if (unknown) return null;
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, oppId, 'creature')
              : countByPermanentType(ctx, oppId, 'land');
          return cmp === 'fewer' ? yourCount < oppCount : yourCount > oppCount;
        });
      }

      if (scope === 'each other player') {
        const others = getOpponentIds(ctx, controllerId);
        if (!others.length) return true;
        return others.every((pid) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, pid, 'creature')
              : countByPermanentType(ctx, pid, 'land');
          return cmp === 'fewer' ? yourCount < oppCount : yourCount > oppCount;
        });
      }

      // "each opponent"
      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return cmp === 'fewer' ? yourCount < oppCount : yourCount > oppCount;
      });
    }
  }

  // "if you control no more/no fewer creatures/lands than an opponent" / "... than each opponent" / "... than each other player"
  {
    const m = clause.match(
      /^if\s+you\s+(?:control|have)\s+no\s+(more|fewer|less)\s+(creatures|lands)\s+than\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmpWord = m[1].toLowerCase();
      const subject = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const satisfies = (a: number, b: number) => (cmpWord === 'more' ? a <= b : a >= b);

      if (scope === 'an opponent') {
        const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
        if (unknown) return null;
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, oppId, 'creature')
              : countByPermanentType(ctx, oppId, 'land');
          return satisfies(yourCount, oppCount);
        });
      }

      if (scope === 'each other player') {
        const others = getOpponentIds(ctx, controllerId);
        if (!others.length) return true;
        return others.every((pid) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, pid, 'creature')
              : countByPermanentType(ctx, pid, 'land');
          return satisfies(yourCount, oppCount);
        });
      }

      // "each opponent"
      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return satisfies(yourCount, oppCount);
      });
    }
  }

  // "if you control as many / at least as many creatures/lands as an opponent" / "... as each opponent" / "... as each other player"
  {
    const m = clause.match(
      /^if\s+you\s+(?:control|have)\s+(as\s+many|at\s+least\s+as\s+many|at\s+most\s+as\s+many)\s+(creatures|lands)\s+as\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmpRaw = m[1].toLowerCase().replace(/\s+/g, ' ');
      const subject = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const cmpKind: 'eq' | 'gte' | 'lte' = cmpRaw.startsWith('at least')
        ? 'gte'
        : cmpRaw.startsWith('at most')
          ? 'lte'
          : 'eq';

      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const satisfies = (a: number, b: number) =>
        cmpKind === 'gte' ? a >= b : cmpKind === 'lte' ? a <= b : a === b;

      if (scope === 'an opponent') {
        const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
        if (unknown) return null;
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, oppId, 'creature')
              : countByPermanentType(ctx, oppId, 'land');
          return satisfies(yourCount, oppCount);
        });
      }

      if (scope === 'each other player') {
        const others = getOpponentIds(ctx, controllerId);
        if (!others.length) return true;
        return others.every((pid) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, pid, 'creature')
              : countByPermanentType(ctx, pid, 'land');
          return satisfies(yourCount, oppCount);
        });
      }

      // "each opponent"
      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return satisfies(yourCount, oppCount);
      });
    }
  }

  // "if you have fewer/more cards in hand/graveyard/library than an opponent" / "... than each opponent" / "... than each other player"
  {
    const m = clause.match(
      /^if\s+you\s+have\s+(fewer|less|more)\s+cards?\s+in\s+(?:your\s+)?(hand|graveyard|library)\s+than\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmp = m[1].toLowerCase();
      const zone = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);

      if (scope === 'an opponent') {
        const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
        if (unknown) return null;
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return cmp === 'more' ? yourCount > oppCount : yourCount < oppCount;
        });
      }

      if (scope === 'each other player') {
        const others = getOpponentIds(ctx, controllerId);
        if (!others.length) return true;
        return others.every((pid) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, pid)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, pid)
                : getLibraryCount(ctx, pid);
          return cmp === 'more' ? yourCount > oppCount : yourCount < oppCount;
        });
      }

      // "each opponent"
      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);
        return cmp === 'more' ? yourCount > oppCount : yourCount < oppCount;
      });
    }
  }

  // "if you have no more/no fewer cards in hand/graveyard/library than an opponent" / "... than each opponent" / "... than each other player"
  {
    const m = clause.match(
      /^if\s+you\s+have\s+no\s+(more|fewer|less)\s+cards?\s+in\s+(?:your\s+)?(hand|graveyard|library)\s+than\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmpWord = m[1].toLowerCase();
      const zone = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);
      const satisfies = (a: number, b: number) => (cmpWord === 'more' ? a <= b : a >= b);

      if (scope === 'an opponent') {
        const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
        if (unknown) return null;
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return satisfies(yourCount, oppCount);
        });
      }

      if (scope === 'each other player') {
        const others = getOpponentIds(ctx, controllerId);
        if (!others.length) return true;
        return others.every((pid) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, pid)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, pid)
                : getLibraryCount(ctx, pid);
          return satisfies(yourCount, oppCount);
        });
      }

      // "each opponent"
      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);
        return satisfies(yourCount, oppCount);
      });
    }
  }

  // Superlatives: zone sizes (ties count)
  // - "if you have the most cards in hand/graveyard/library"
  // - "if you have the least/fewest cards in hand/graveyard/library"
  // - Optional: "... or are tied for ..."
  {
    const m = clause.match(
      /^if\s+you\s+have\s+the\s+(most|least|fewest)\s+cards?\s+in\s+(?:your\s+)?(hand|graveyard|library)(?:\s+or\s+are\s+tied\s+for\s+(?:the\s+)?\1\s+cards?\s+in\s+(?:your\s+)?\2)?$/i
    );
    if (m) {
      const kind = m[1].toLowerCase();
      const zone = m[2].toLowerCase();
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;

      const getCount = (pid: string) =>
        zone === 'hand'
          ? getHandCount(ctx, pid)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, pid)
            : getLibraryCount(ctx, pid);

      const yourCount = getCount(controllerId);
      if (kind === 'most') return ids.every((pid) => getCount(pid) <= yourCount);
      return ids.every((pid) => getCount(pid) >= yourCount);
    }

    const m2 = clause.match(
      /^if\s+you\s+(?:are|have)\s+tied\s+for\s+(?:the\s+)?(most|least|fewest)\s+cards?\s+in\s+(?:your\s+)?(hand|graveyard|library)$/i
    );
    if (m2) {
      const kind = m2[1].toLowerCase();
      const extreme: 'most' | 'least' = kind === 'most' ? 'most' : 'least';
      const zone = m2[2].toLowerCase();
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;

      const getCount = (pid: string) =>
        zone === 'hand'
          ? getHandCount(ctx, pid)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, pid)
            : getLibraryCount(ctx, pid);

      return isTiedForExtreme(ids, controllerId, getCount, extreme);
    }
  }

  // "if you have as many / at least as many cards in hand/graveyard/library as an opponent" / "... as each opponent" / "... as each other player"
  {
    const m = clause.match(
      /^if\s+you\s+have\s+(as\s+many|at\s+least\s+as\s+many|at\s+most\s+as\s+many)\s+cards?\s+in\s+(?:your\s+)?(hand|graveyard|library)\s+as\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmpRaw = m[1].toLowerCase().replace(/\s+/g, ' ');
      const zone = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const cmpKind: 'eq' | 'gte' | 'lte' = cmpRaw.startsWith('at least')
        ? 'gte'
        : cmpRaw.startsWith('at most')
          ? 'lte'
          : 'eq';

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);
      const satisfies = (a: number, b: number) =>
        cmpKind === 'gte' ? a >= b : cmpKind === 'lte' ? a <= b : a === b;

      if (scope === 'an opponent') {
        const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
        if (unknown) return null;
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return satisfies(yourCount, oppCount);
        });
      }

      if (scope === 'each other player') {
        const others = getOpponentIds(ctx, controllerId);
        if (!others.length) return true;
        return others.every((pid) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, pid)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, pid)
                : getLibraryCount(ctx, pid);
          return satisfies(yourCount, oppCount);
        });
      }

      // "each opponent"
      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);
        return satisfies(yourCount, oppCount);
      });
    }
  }

  // "if an opponent controls/has as many / at least as many creatures/lands as you" / "if no opponent controls/has ... as you"
  {
    const m = clause.match(
      /^if\s+(no\s+opponent|an\s+opponent)\s+(?:controls|has)\s+(as\s+many|at\s+least\s+as\s+many|at\s+most\s+as\s+many)\s+(creatures|lands)\s+as\s+you$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmpRaw = m[2].toLowerCase().replace(/\s+/g, ' ');
      const subject = m[3].toLowerCase();

      const cmpKind: 'eq' | 'gte' | 'lte' = cmpRaw.startsWith('at least')
        ? 'gte'
        : cmpRaw.startsWith('at most')
          ? 'lte'
          : 'eq';

      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      const satisfies = (oppCount: number) =>
        cmpKind === 'gte' ? oppCount >= yourCount : cmpKind === 'lte' ? oppCount <= yourCount : oppCount === yourCount;

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, oppId, 'creature')
              : countByPermanentType(ctx, oppId, 'land');
          return satisfies(oppCount);
        });
      }

      // "no opponent" => universal negation (vacuously true if there are no opponents)
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return !satisfies(oppCount);
      });
    }
  }

  // "if an opponent has as many / at least as many cards in hand/graveyard/library as you" / "if no opponent has ... as you"
  {
    const m = clause.match(
      /^if\s+(no\s+opponent|an\s+opponent)\s+has\s+(as\s+many|at\s+least\s+as\s+many|at\s+most\s+as\s+many)\s+cards?\s+in\s+(?:their\s+)?(hand|graveyard|library)\s+as\s+you$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmpRaw = m[2].toLowerCase().replace(/\s+/g, ' ');
      const zone = m[3].toLowerCase();

      const cmpKind: 'eq' | 'gte' | 'lte' = cmpRaw.startsWith('at least')
        ? 'gte'
        : cmpRaw.startsWith('at most')
          ? 'lte'
          : 'eq';

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);

      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      const satisfies = (oppCount: number) =>
        cmpKind === 'gte' ? oppCount >= yourCount : cmpKind === 'lte' ? oppCount <= yourCount : oppCount === yourCount;

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return satisfies(oppCount);
        });
      }

      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);
        return !satisfies(oppCount);
      });
    }
  }

  // "if an opponent/no opponent controls/has no more/no fewer creatures/lands than you"
  {
    const m = clause.match(
      /^if\s+(no\s+opponent|an\s+opponent)\s+(?:controls|has)\s+no\s+(more|fewer|less)\s+(creatures|lands)\s+than\s+you$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmpWord = m[2].toLowerCase();
      const subject = m[3].toLowerCase();

      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      const satisfies = (oppCount: number) => (cmpWord === 'more' ? oppCount <= yourCount : oppCount >= yourCount);

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, oppId, 'creature')
              : countByPermanentType(ctx, oppId, 'land');
          return satisfies(oppCount);
        });
      }

      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return !satisfies(oppCount);
      });
    }
  }

  // "if an opponent/no opponent has no more/no fewer cards in hand/graveyard/library than you"
  {
    const m = clause.match(
      /^if\s+(no\s+opponent|an\s+opponent)\s+has\s+no\s+(more|fewer|less)\s+cards?\s+in\s+(?:their\s+)?(hand|graveyard|library)\s+than\s+you$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmpWord = m[2].toLowerCase();
      const zone = m[3].toLowerCase();

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);

      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      const satisfies = (oppCount: number) => (cmpWord === 'more' ? oppCount <= yourCount : oppCount >= yourCount);

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return satisfies(oppCount);
        });
      }

      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);
        return !satisfies(oppCount);
      });
    }
  }

  // "if an opponent has fewer/more cards in hand/graveyard/library than you" / "if no opponent has fewer/more ... than you"
  {
    const m = clause.match(
      /^if\s+(no\s+opponent|an\s+opponent)\s+has\s+(fewer|less|more)\s+cards?\s+in\s+(?:their\s+)?(hand|graveyard|library)\s+than\s+you$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmp = m[2].toLowerCase();
      const zone = m[3].toLowerCase();

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);

      const { opponents: opponentIds, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return cmp === 'more' ? oppCount > yourCount : oppCount < yourCount;
        });
      }

      // "no opponent" => universal negation (vacuously true if there are no opponents)
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);

        return cmp === 'more' ? oppCount <= yourCount : oppCount >= yourCount;
      });
    }
  }

  // Opponent numeric zone thresholds
  // - "if an opponent has at least/at most/no more/no fewer than N cards in hand/graveyard/library"
  // - "if each opponent has ..."
  // - "if no opponent has ..." (universal negation, vacuously true if no opponents)
  {
    const m = clause.match(
      /^if\s+(an\s+opponent|each\s+opponent|each\s+other\s+player|no\s+opponent)\s+has\s+(at\s+least|at\s+most|no\s+more\s+than|no\s+(?:fewer|less)\s+than)\s+([a-z0-9]+)\s+cards?\s+in\s+(?:their\s+)?(hand|graveyard|library)$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmpRaw = m[2].toLowerCase().replace(/\s+/g, ' ');
      const n = parseCountToken(m[3]);
      if (n === null) return null;
      const zone = m[4].toLowerCase();

      const otherPlayerIds = scope === 'each other player' ? getOpponentIds(ctx, controllerId) : null;
      const opponentInfo = scope === 'each other player' ? null : getOpponentInfo(ctx, controllerId);
      if (opponentInfo?.unknown) return null;
      const opponentIds = scope === 'each other player' ? otherPlayerIds ?? [] : opponentInfo?.opponents ?? [];

      const satisfies = (oppId: string) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);

        if (cmpRaw === 'at least' || cmpRaw.startsWith('no fewer') || cmpRaw.startsWith('no less')) return oppCount >= n;
        return oppCount <= n;
      };

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => satisfies(oppId));
      }

      if (scope === 'no opponent') {
        if (!opponentIds.length) return true;
        return opponentIds.every((oppId) => !satisfies(oppId));
      }

      // "each opponent" / "each other player" (for "you" these are equivalent)
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => satisfies(oppId));
    }
  }

  // "if you attacked this turn" (Raid and similar)
  if (/^if\s+you\s+attacked\s+this\s+turn$/i.test(clause)) {
    return didPlayerAttackThisTurn(ctx, controllerId);
  }

  // "if you didn't attack with a creature this turn" / "if you did not attack with a creature this turn"
  if (
    /^if\s+you\s+did\s+not\s+attack\s+with\s+a\s+creature\s+this\s+turn$/i.test(clause) ||
    /^if\s+you\s+didn't\s+attack\s+with\s+a\s+creature\s+this\s+turn$/i.test(clause)
  ) {
    return !didPlayerAttackThisTurn(ctx, controllerId);
  }

  return undefined;
}

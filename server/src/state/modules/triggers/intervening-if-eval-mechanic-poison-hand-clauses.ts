/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal mechanic-specific clauses from poison counters
 * through defending-player hand comparisons
 * Public: tryEvaluateInterveningIfMechanicPoisonHandClauses
 */

import {
  parseCountToken,
  countByPermanentType,
  countBasicLands,
  countLandsWithSubtype,
  getSpellsCastThisTurnCount,
  getPlayerLifeMaybe,
  getLibraryCountMaybe,
  getPoisonCounters,
} from "./intervening-if-this-turn-counts.js";
import { getPlayerLife, getHandCount } from "./intervening-if-zone-lookups.js";
import { getManaValue } from "./intervening-if-mana-spent.js";
import { getOpponentInfo, getAllPlayerIds } from "./intervening-if-permanent-and-player.js";
import { getDefendingPlayerIdForInterveningIf } from "./intervening-if-eval-support.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

export function tryEvaluateInterveningIfMechanicPoisonHandClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;
  // ===== Mechanic-specific =====
  // "if an opponent has three or more poison counters" (corrupted)
  if (/^if\s+an\s+opponent\s+has\s+([a-z0-9]+)\s+or\s+more\s+poison\s+counters$/i.test(clause)) {
    const m = clause.match(/^if\s+an\s+opponent\s+has\s+([a-z0-9]+)\s+or\s+more\s+poison\s+counters$/i);
    const n = m ? parseCountToken(m[1]) : null;
    if (n === null) return null;
    const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (!opps.length) return false;
    return opps.some((oid) => getPoisonCounters(ctx, oid) >= n);
  }

  // "if you control a permanent with mana value X or greater"
  {
    const m = clause.match(/^if\s+you\s+control\s+a\s+permanent\s+with\s+mana\s+value\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const battlefield = (ctx as any).state?.battlefield || [];
      return (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
        if (!p || p.controller !== controllerId) return false;
        const mv = getManaValue(p);
        return typeof mv === 'number' && mv >= n;
      });
    }
  }

  // "if you control the artifact with the greatest mana value or tied for the greatest mana value" (Padeem)
  if (
    /^if\s+you\s+control\s+the\s+artifact\s+with\s+the\s+greatest\s+mana\s+value\s+or\s+tied\s+for\s+the\s+greatest\s+mana\s+value$/i.test(
      clause
    )
  ) {
    const battlefield = (ctx as any).state?.battlefield || [];
    const artifacts = (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
      if (!p) return false;
      const tl = String(p?.card?.type_line ?? '').toLowerCase();
      return tl.includes('artifact');
    });

    if (artifacts.length === 0) return false;

    const entries: Array<{ controller: string; mv: number | null }> = [];
    let maxKnown = -Infinity;
    let hasUnknown = false;
    let unknownControlledByOpponent = false;

    for (const p of artifacts) {
      const mv = getManaValue(p);
      const mvNum = typeof mv === 'number' ? mv : null;
      const controller = String((p as any)?.controller ?? '');
      entries.push({ controller, mv: mvNum });

      if (mvNum === null) {
        hasUnknown = true;
        if (controller !== String(controllerId)) unknownControlledByOpponent = true;
        continue;
      }

      if (mvNum > maxKnown) maxKnown = mvNum;
    }

    if (maxKnown === -Infinity) return null;

    const controllerHasMaxKnown = entries.some(
      (e) => e.controller === String(controllerId) && typeof e.mv === 'number' && e.mv === maxKnown
    );

    if (!hasUnknown) return controllerHasMaxKnown;

    // Conservative: unknown mana values might hide an opponent's larger artifact.
    // If all unknown artifacts are controlled by you AND you already control a known max artifact,
    // then you will still control the greatest-mana-value artifact.
    if (controllerHasMaxKnown && !unknownControlledByOpponent) return true;

    return null;
  }

  // "if its mana value was N or greater" (best-effort; prefers triggering stackItem card)
  {
    const m = clause.match(/^if\s+its\s+mana\s+value\s+was\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const refStackItemCard = (refs as any)?.stackItem?.card;
      const stackId =
        refs?.triggeringStackItemId ??
        (sourcePermanent as any)?.triggeringStackItemId ??
        (sourcePermanent as any)?.triggeringSpellStackItemId;
      const stack: any[] = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : [];
      const triggeringStackItem = !refStackItemCard && stackId ? stack.find((it: any) => it && String(it.id) === String(stackId)) : null;
      const triggeringCard = refStackItemCard ?? triggeringStackItem?.card ?? sourcePermanent?.card ?? sourcePermanent;

      const mv = getManaValue(triggeringCard);
      if (typeof mv !== 'number') return null;
      return mv >= n;
    }
  }

  // "if N or more spells were cast this turn" (Archenemy/Planechase and similar)
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+spells\s+were\s+cast\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getSpellsCastThisTurnCount(ctx) >= n;
    }
  }

  // "if you control your commander" / "if you control a commander"
  // Best-effort based on commander card IDs stored in command zone metadata.
  {
    const wantsYour = /^if\s+you\s+control\s+your\s+commander$/i.test(clause);
    const wantsAny = /^if\s+you\s+control\s+a\s+commander$/i.test(clause);
    if (wantsYour || wantsAny) {
      const cz = (ctx as any).commandZone ?? (ctx as any).state?.commandZone;
      if (!cz || typeof cz !== 'object') return null;

      const yourCommanderIds = cz?.[controllerId]?.commanderIds;
      if (!Array.isArray(yourCommanderIds)) return null;

      const commanderIdSet = new Set<string>();
      if (wantsYour) {
        for (const id of yourCommanderIds) commanderIdSet.add(String(id));
      } else {
        for (const pid of Object.keys(cz)) {
          const ids = cz?.[pid]?.commanderIds;
          if (Array.isArray(ids)) for (const id of ids) commanderIdSet.add(String(id));
        }
      }

      const battlefield = (ctx as any).state?.battlefield || [];
      return (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
        if (!p || p.controller !== controllerId) return false;
        const cid = p.card?.id;
        return cid ? commanderIdSet.has(String(cid)) : false;
      });
    }
  }

  // "if <Name> is in the command zone" / "if <Name> is in the command zone or on the battlefield"
  // Best-effort: prefers commandZone[controllerId].commanderCards (id+name) so we can map name -> id.
  {
    const mz = clause.match(
      /^if\s+(.+?)\s+is\s+in\s+the\s+command\s+zone(?:\s+or\s+on\s+the\s+battlefield)?$/i
    );
    if (mz) {
      const cardNameRaw = mz[1].trim().replace(/\s+/g, ' ');
      const wantsOrBattlefield = /\s+or\s+on\s+the\s+battlefield$/i.test(clause);

      const cz = (ctx as any).commandZone ?? (ctx as any).state?.commandZone;
      const info = cz?.[controllerId];
      if (!info || typeof info !== 'object') return null;

      const commanderCards = Array.isArray((info as any).commanderCards) ? (info as any).commanderCards : null;
      const inCZ: string[] = Array.isArray((info as any).inCommandZone) ? (info as any).inCommandZone : [];

      const normalizeName = (s: string) =>
        String(s || '')
          .toLowerCase()
          .replace(/["“”]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

      const targetName = normalizeName(cardNameRaw);

      let targetId: string | null = null;
      if (commanderCards) {
        const hit = commanderCards.find((c: any) => {
          if (!c) return false;
          const n = normalizeName(c.name);
          if (!n) return false;
          if (n === targetName) return true;
          // Some oracle templates use abbreviated legendary names (e.g., "Arahbo")
          // while command-zone metadata stores full names (e.g., "Arahbo, Roar of the World").
          return n.startsWith(`${targetName},`) || n.startsWith(`${targetName} `);
        });
        if (hit?.id) targetId = String(hit.id);
      }

      // Fallback: if this clause refers to the source card by name, use its id.
      if (!targetId) {
        const sourceName = sourcePermanent?.card?.name ?? (sourcePermanent as any)?.name;
        const sourceId = sourcePermanent?.card?.id ?? (sourcePermanent as any)?.id;
        if (sourceId && normalizeName(String(sourceName || '')) === targetName) {
          targetId = String(sourceId);
        }
      }

      if (!targetId) return null;

      const isInCommandZone = inCZ.includes(targetId);
      if (isInCommandZone) return true;

      if (!wantsOrBattlefield) return false;

      const battlefield = (ctx as any).state?.battlefield || [];
      if (!Array.isArray(battlefield)) return null;
      return battlefield.some((p: any) => {
        const cid = p?.card?.id;
        return cid ? String(cid) === targetId : false;
      });
    }
  }

  // "if you don't control ..." / "if you do not control ..." (common negative existence)
  {
    const m = clause.match(/^if\s+you\s+(?:do\s+not|don't)\s+control\s+(?:(?:a|an)\s+)?(?:any\s+)?([a-z0-9\-\s']+)$/i);
    if (m) {
      const subjectRaw = m[1].trim().replace(/\s+/g, " ");
      const subjectLower = subjectRaw.toLowerCase();

      if (subjectLower === 'cards in hand') return getHandCount(ctx, controllerId) === 0;
      if (subjectLower === 'your commander') {
        const cz = (ctx as any).commandZone ?? (ctx as any).state?.commandZone;
        const ids = cz?.[controllerId]?.commanderIds;
        if (!Array.isArray(ids)) return null;
        const idSet = new Set(ids.map((id: any) => String(id)));
        const battlefield = (ctx as any).state?.battlefield || [];
        const controlsCommander = (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
          if (!p || p.controller !== controllerId) return false;
          const cid = p.card?.id;
          return cid ? idSet.has(String(cid)) : false;
        });
        return !controlsCommander;
      }
      if (subjectLower === 'basic lands') return countBasicLands(ctx, controllerId) === 0;

      const subjectToken = subjectLower.endsWith('s') ? subjectLower.slice(0, -1) : subjectLower;
      return countByPermanentType(ctx, controllerId, subjectToken) === 0;
    }
  }

  // "if you control no other X" (requires source permanent to exclude itself)
  {
    const m = clause.match(/^if\s+you\s+control\s+no\s+other\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const selfId = String(
        (sourcePermanent as any)?.id ??
          (refs as any)?.thisPermanentId ??
          (refs as any)?.thisCreatureId ??
          (refs as any)?.thisEnchantmentId ??
          (refs as any)?.thisArtifactId ??
          (refs as any)?.sourcePermanentId ??
          ''
      ).trim();
      if (!selfId) return null;
      const subjectRaw = m[1].trim().replace(/\s+/g, " ");
      const subjectLower = subjectRaw.toLowerCase();

      if (subjectLower === 'cards in hand') return getHandCount(ctx, controllerId) === 0;
      if (subjectLower === 'basic lands') {
        const battlefield = (ctx as any).state?.battlefield || [];
        let count = 0;
        for (const perm of Array.isArray(battlefield) ? battlefield : []) {
          if (!perm || perm.controller !== controllerId) continue;
          if (String(perm.id) === selfId) continue;
          const tl = String(perm.card?.type_line || '').toLowerCase();
          if (tl.includes('basic') && tl.includes('land')) count++;
        }
        return count === 0;
      }

      const subjectToken = subjectLower.endsWith('s') ? subjectLower.slice(0, -1) : subjectLower;
      const battlefield = (ctx as any).state?.battlefield || [];
      let count = 0;
      for (const perm of Array.isArray(battlefield) ? battlefield : []) {
        if (!perm || perm.controller !== controllerId) continue;
        if (String(perm.id) === selfId) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (tl.includes(subjectToken)) count++;
      }
      return count === 0;
    }
  }

  // "if you control no X"
  {
    const m = clause.match(/^if\s+you\s+control\s+no\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const nounRaw = m[1].trim();
      const nounLower = nounRaw.toLowerCase();

      // Avoid swallowing numeric-comparison phrases like "no fewer than ...".
      if (nounLower.startsWith('fewer than ') || nounLower.startsWith('less than ') || nounLower.startsWith('more than ')) {
        // fall through
      } else {

      // Let the more-specific tapped/untapped templates handle these.
      if (nounLower.startsWith('untapped ') || nounLower.startsWith('tapped ')) {
        // fall through
      } else {
      if (nounLower === "cards in hand") {
        return getHandCount(ctx, controllerId) === 0;
      }

      // Special case: "no basic lands" / "no lands" etc.
      if (nounLower === "basic lands") return countBasicLands(ctx, controllerId) === 0;

      const noun = nounLower.replace(/\s+/g, " ");
      const nounSingular = noun.endsWith("s") ? noun.slice(0, -1) : noun;

      // Heuristic: check type line contains the noun (covers permanent types and creature types).
      return countByPermanentType(ctx, controllerId, nounSingular) === 0;
      }
      }
    }
  }

  // "if you control no untapped/tapped lands" (and creatures)
  {
    const m = clause.match(/^if\s+you\s+control\s+no\s+(untapped|tapped)\s+(lands|land|creatures|creature)$/i);
    if (m) {
      const wantsUntapped = String(m[1]).toLowerCase() === 'untapped';
      const subject = String(m[2]).toLowerCase();
      const typeToken = subject.startsWith('land') ? 'land' : 'creature';

      const battlefield = (ctx as any).state?.battlefield || [];
      const found = (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
        if (!p || p.controller !== controllerId) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        if (!tl.includes(typeToken)) return false;
        const tapped = p.tapped === true;
        return wantsUntapped ? !tapped : tapped;
      });

      return !found;
    }
  }

  // "if you control an untapped/tapped land" (and creature)
  {
    const m = clause.match(/^if\s+you\s+control\s+(?:an?|a)\s+(untapped|tapped)\s+(land|creature)$/i);
    if (m) {
      const wantsUntapped = String(m[1]).toLowerCase() === 'untapped';
      const typeToken = String(m[2]).toLowerCase();

      const battlefield = (ctx as any).state?.battlefield || [];
      return (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
        if (!p || p.controller !== controllerId) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        if (!tl.includes(typeToken)) return false;
        const tapped = p.tapped === true;
        return wantsUntapped ? !tapped : tapped;
      });
    }
  }

  // "if an opponent controls no X" / "if no opponent controls a/an X"
  {
    const m1 = clause.match(/^if\s+an\s+opponent\s+controls\s+no\s+([a-z0-9\-\s']+)$/i);
    if (m1) {
      const noun = String(m1[1] || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const nounToken = noun.endsWith('s') ? noun.slice(0, -1) : noun;
      const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opps.length) return true;
      return opps.every((oid) => countByPermanentType(ctx, oid, nounToken) === 0);
    }

    const m2 = clause.match(/^if\s+no\s+opponent\s+controls\s+an?\s+([a-z0-9\-\s']+)$/i);
    if (m2) {
      const noun = String(m2[1] || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const nounToken = noun.endsWith('s') ? noun.slice(0, -1) : noun;
      const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opps.length) return true;
      return opps.every((oid) => countByPermanentType(ctx, oid, nounToken) === 0);
    }
  }

  // "if your opponents control no creatures" (Kezzerdrix)
  if (/^if\s+your\s+opponents\s+control\s+no\s+creatures$/i.test(clause)) {
    const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (!opps.length) return true;
    return opps.every((oid) => countByPermanentType(ctx, oid, 'creature') === 0);
  }

  // "if you control another X"
  {
    const m = clause.match(/^if\s+you\s+control\s+another\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const nounRaw = m[1].trim().replace(/\s+/g, " ");
      // Heuristic: count permanents whose type line includes the noun token.
      // For creature subtypes (e.g., Knight), this works because type lines include it.
      // "another" means at least 2 (the source permanent itself counts as one).
      const noun = nounRaw.endsWith("s") ? nounRaw.slice(0, -1) : nounRaw;
      return countByPermanentType(ctx, controllerId, noun) >= 2;
    }
  }

  // "if you control a/an X" (existence)
  {
    const m = clause.match(/^if\s+you\s+control\s+(?:a|an)\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const nounRaw = m[1].trim().replace(/\s+/g, " ");
      const nounLower = nounRaw.toLowerCase();

      // Let the more-specific templates handle these.
      if (nounLower.startsWith('untapped ') || nounLower.startsWith('tapped ') || nounLower.includes('with power ')) {
        // fall through
      } else {
      const noun = nounRaw.endsWith("s") ? nounRaw.slice(0, -1) : nounRaw;
      return countByPermanentType(ctx, controllerId, noun) >= 1;
      }
    }
  }

  // "if you control N or more X"
  {
    const m = clause.match(/^if\s+you\s+control\s+([a-z0-9]+)\s+or\s+more\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      // Land subtypes (Plains, Islands, etc.)
      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) >= n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) >= n;

      // Generic permanent-type counts: lands, creatures, artifacts, enchantments, etc.
      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) >= n;
    }
  }

  // "if you control at least N X"
  {
    const m = clause.match(/^if\s+you\s+control\s+at\s+least\s+([a-z0-9]+)\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) >= n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) >= n;

      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) >= n;
    }
  }

  // "if you control at most N X" / "if you control no more than N X"
  {
    const m = clause.match(
      /^if\s+you\s+control\s+(?:at\s+most|no\s+more\s+than)\s+([a-z0-9]+)\s+([a-z0-9\-\s']+)$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) <= n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) <= n;

      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) <= n;
    }
  }

  // "if you control no fewer/less than N X"
  {
    const m = clause.match(/^if\s+you\s+control\s+no\s+(?:fewer|less)\s+than\s+([a-z0-9]+)\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) >= n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) >= n;

      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) >= n;
    }
  }

  // "if you control exactly N X"
  {
    const m = clause.match(/^if\s+you\s+control\s+exactly\s+([a-z0-9]+)\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) === n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) === n;

      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) === n;
    }
  }

  // "if you control N or fewer X"
  {
    const m = clause.match(/^if\s+you\s+control\s+([a-z0-9]+)\s+or\s+fewer\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) <= n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) <= n;

      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) <= n;
    }
  }

  // "if you have N or more life"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+more\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) >= n;
    }
  }

  // "if each player has 10 or less life" (Cryptolith Fragment // Aurora of Emrakul)
  if (/^if\s+each\s+player\s+has\s+10\s+or\s+less\s+life$/i.test(clause)) {
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return true;

    let unknown = false;
    for (const pid of ids) {
      const v = getPlayerLifeMaybe(ctx, pid);
      if (v === null) {
        unknown = true;
        continue;
      }
      if (v > 10) return false;
    }

    return unknown ? null : true;
  }

  // "if each player has an empty library" (Platinum Persecutor)
  if (/^if\s+each\s+player\s+has\s+an\s+empty\s+library$/i.test(clause)) {
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return true;

    let unknown = false;
    for (const pid of ids) {
      const c = getLibraryCountMaybe(ctx, pid);
      if (c === null) {
        unknown = true;
        continue;
      }
      if (c !== 0) return false;
    }

    return unknown ? null : true;
  }

  // "if you have at least N life" / "if you have no fewer/less than N life"
  {
    const m = clause.match(/^if\s+you\s+have\s+(?:at\s+least|no\s+(?:fewer|less)\s+than)\s+([a-z0-9]+)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) >= n;
    }
  }

  // "if you have N or less/fewer life"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+(?:less|fewer)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) <= n;
    }
  }

  // "if you have at most N life" / "if you have no more than N life"
  {
    const m = clause.match(/^if\s+you\s+have\s+(?:at\s+most|no\s+more\s+than)\s+([a-z0-9]+)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) <= n;
    }
  }

  // "if you have less than N life"
  {
    const m = clause.match(/^if\s+you\s+have\s+less\s+than\s+([a-z0-9]+)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) < n;
    }
  }

  // "if you have more than N life"
  {
    const m = clause.match(/^if\s+you\s+have\s+more\s+than\s+([a-z0-9]+)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) > n;
    }
  }

  // "if you have exactly N life"
  {
    const m = clause.match(/^if\s+you\s+have\s+exactly\s+([a-z0-9]+)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) === n;
    }
  }

  // "if you have no cards in hand"
  if (/^if\s+you\s+have\s+no\s+cards\s+in\s+hand$/i.test(clause)) {
    return getHandCount(ctx, controllerId) === 0;
  }

  // "if that player has no cards in hand" (requires that-player ref)
  if (/^if\s+that\s+player\s+has\s+no\s+cards\s+in\s+hand$/i.test(clause)) {
    const thatPlayerId =
      refs?.thatPlayerId ??
      refs?.referencedPlayerId ??
      refs?.theirPlayerId ??
      (sourcePermanent as any)?.thatPlayerId ??
      (sourcePermanent as any)?.referencedPlayerId ??
      (sourcePermanent as any)?.theirPlayerId;
    if (typeof thatPlayerId !== 'string' || !thatPlayerId) return null;
    return getHandCount(ctx, String(thatPlayerId)) === 0;
  }

  // "if that player has N or fewer/less cards in hand" (requires that-player ref)
  {
    const m = clause.match(/^if\s+that\s+player\s+has\s+([a-z0-9]+)\s+or\s+(?:fewer|less)\s+cards?\s+in\s+hand$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const thatPlayerId =
        refs?.thatPlayerId ??
        refs?.referencedPlayerId ??
        refs?.theirPlayerId ??
        (sourcePermanent as any)?.thatPlayerId ??
        (sourcePermanent as any)?.referencedPlayerId ??
        (sourcePermanent as any)?.theirPlayerId;
      if (typeof thatPlayerId !== 'string' || !thatPlayerId) return null;
      return getHandCount(ctx, String(thatPlayerId)) <= n;
    }
  }

  // "if defending player has N or fewer/less cards in hand" (requires defending-player ref)
  {
    const m = clause.match(/^if\s+defending\s+player\s+has\s+([a-z0-9]+)\s+or\s+(?:fewer|less)\s+cards?\s+in\s+hand$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const defending = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
      if (!defending) return null;
      return getHandCount(ctx, defending) <= n;
    }
  }

  // "if defending player has more cards in hand than you" (requires defending-player ref)
  if (/^if\s+defending\s+player\s+has\s+more\s+cards\s+in\s+hand\s+than\s+you$/i.test(clause)) {
    const defending = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defending) return null;
    return getHandCount(ctx, defending) > getHandCount(ctx, controllerId);
  }

  return undefined;
}

/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal additional targeted handlers (own-and-control
 * through Gitrog/Hex shorthand)
 * Public: tryEvaluateInterveningIfOwnControlNamedClauses
 */

import {
  findBattlefieldPermanent,
  parseMaybeNumber,
  findBattlefieldPermanentsByName,
  typeLineHasWord,
  nameMatchesClauseName,
  getCounterCountCaseInsensitiveFromPerm,
} from "./intervening-if-zone-lookups.js";
import {
  getPermanentPowerMaybe,
  getPermanentToughnessMaybe,
  getControlledCreatures,
  getOpponentInfo,
} from "./intervening-if-permanent-and-player.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/[’]/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toLower(text: string): string {
  return normalizeText(text).toLowerCase();
}

export function tryEvaluateInterveningIfOwnControlNamedClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;

  // "if you both own and control <X> and a creature named <Y>" (best-effort)
  {
    const m = clause.match(/^if\s+you\s+both\s+own\s+and\s+control\s+(this\s+creature|[a-z0-9][a-z0-9'’\- ]+)\s+and\s+a\s+creature\s+named\s+(.+)$/i);
    if (m) {
      const leftRaw = toLower(m[1]);
      const rightNameLower = toLower(m[2]).replace(/^"|"$/g, '').trim();
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;

      const evalSide = (candidates: any[]): boolean | null => {
        if (!candidates.length) return false;

        let anyControlled = false;
        let anyOwnedAndControlled = false;
        let sawUnknownOwner = false;

        for (const p of candidates) {
          if (!p) continue;
          if (String(p.controller || '') !== String(controllerId)) continue;
          anyControlled = true;
          const owner = (p as any).owner;
          if (typeof owner !== 'string') {
            sawUnknownOwner = true;
            continue;
          }
          if (String(owner) === String(controllerId)) {
            anyOwnedAndControlled = true;
            break;
          }
        }

        if (anyOwnedAndControlled) return true;
        if (!anyControlled) return false;
        return sawUnknownOwner ? null : false;
      };

      const leftCandidates: any[] = [];
      if (leftRaw === 'this creature') {
        const thisId = String(
          (sourcePermanent as any)?.id ??
            (refs as any)?.thisCreatureId ??
            (refs as any)?.thisPermanentId ??
            (refs as any)?.sourcePermanentId ??
            ''
        ).trim();
        const self = sourcePermanent ?? (thisId ? findBattlefieldPermanent(ctx, thisId) : null);
        if (!self) return null;
        leftCandidates.push(self);
      } else {
        leftCandidates.push(...findBattlefieldPermanentsByName(ctx, leftRaw));
      }
      const rightCandidates = findBattlefieldPermanentsByName(ctx, rightNameLower);

      const leftVal = evalSide(leftCandidates);
      if (leftVal === false) return false;
      const rightVal = evalSide(rightCandidates);
      if (rightVal === false) return false;

      if (leftVal === true && rightVal === true) return true;
      return null;
    }
  }

  // "if you chose a creature other than <Name> as your Ring-bearer" (best-effort; requires explicit refs)
  {
    const m = clause.match(/^if\s+you\s+chose\s+a\s+creature\s+other\s+than\s+([a-z0-9][a-z0-9'’\- ]+)\s+as\s+your\s+ring-bearer$/i);
    if (m) {
      const forbiddenNameLower = toLower(m[1]);
      const rawName = (refs as any)?.ringBearerName;
      const rawId = (refs as any)?.ringBearerId;
      let chosenNameLower = typeof rawName === 'string' ? toLower(rawName) : '';
      if (!chosenNameLower && typeof rawId === 'string' && rawId) {
        const p = findBattlefieldPermanent(ctx, rawId);
        chosenNameLower = p ? toLower(p?.card?.name || p?.name || '') : '';
      }
      if (!chosenNameLower) return null;
      return !nameMatchesClauseName(chosenNameLower, forbiddenNameLower);
    }
  }

  // "if you control a creature with power greater than its base power"
  if (/^if\s+you\s+control\s+a\s+creature\s+with\s+power\s+greater\s+than\s+its\s+base\s+power$/i.test(clause)) {
    const creatures = getControlledCreatures(ctx, controllerId);
    if (!creatures.length) return null;
    let sawComparable = false;
    let sawUnknown = false;
    for (const c of creatures) {
      const baseRaw = parseMaybeNumber((c as any)?.basePower) ?? parseMaybeNumber((c as any)?.card?.power);
      const cur = getPermanentPowerMaybe(c, ctx);
      if (baseRaw === null || cur === null) {
        sawUnknown = true;
        continue;
      }
      sawComparable = true;
      if (cur > baseRaw) return true;
    }
    if (!sawComparable) return null;
    return sawUnknown ? null : false;
  }

  // "if you control each creature on the battlefield with the greatest power"
  if (/^if\s+you\s+control\s+each\s+creature\s+on\s+the\s+battlefield\s+with\s+the\s+greatest\s+power$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const creatures = battlefield.filter((p: any) => p && String(p?.card?.type_line || '').toLowerCase().includes('creature'));
    if (!creatures.length) return null;
    const powers: number[] = [];
    for (const c of creatures) {
      const p = getPermanentPowerMaybe(c, ctx);
      if (p === null) return null;
      powers.push(p);
    }
    const max = Math.max(...powers);
    for (let i = 0; i < creatures.length; i++) {
      if (powers[i] === max && String(creatures[i]?.controller || '') !== String(controllerId)) return false;
    }
    return true;
  }

  // "if you haven't cast a spell from your hand this turn and this creature doesn't have a flying counter on it"
  if (/^if\s+you\s+haven'?t\s+cast\s+a\s+spell\s+from\s+your\s+hand\s+this\s+turn\s+and\s+this\s+creature\s+doesn'?t\s+have\s+a\s+flying\s+counter\s+on\s+it$/i.test(clause)) {
    const thisId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const p = sourcePermanent ?? (thisId ? findBattlefieldPermanent(ctx, thisId) : null);
    if (!p) return null;
    const map = (ctx as any).state?.spellsCastFromHandThisTurn;
    if (!map || typeof map !== 'object') return null;
    const v = (map as any)[controllerId];
    if (typeof v !== 'number') return null;
    const flying = getCounterCountCaseInsensitiveFromPerm(p, 'flying');
    if (flying === null) return null;
    return v === 0 && flying === 0;
  }

  // "if you haven't cast a spell from your hand this turn and this enchantment isn't a creature"
  if (/^if\s+you\s+haven'?t\s+cast\s+a\s+spell\s+from\s+your\s+hand\s+this\s+turn\s+and\s+this\s+enchantment\s+isn'?t\s+a\s+creature$/i.test(clause)) {
    const thisId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisEnchantmentId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const p = sourcePermanent ?? (thisId ? findBattlefieldPermanent(ctx, thisId) : null);
    if (!p) return null;
    const map = (ctx as any).state?.spellsCastFromHandThisTurn;
    if (!map || typeof map !== 'object') return null;
    const v = (map as any)[controllerId];
    if (typeof v !== 'number') return null;
    const tl = String((p as any)?.card?.type_line || '').toLowerCase();
    if (!tl.includes('enchantment')) return null;
    return v === 0 && !tl.includes('creature');
  }

  // "if your devotion to white and black is seven or greater"
  if (/^if\s+your\s+devotion\s+to\s+white\s+and\s+black\s+is\s+seven\s+or\s+greater$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    let devotion = 0;
    for (const p of battlefield) {
      if (!p || String(p.controller || '') !== String(controllerId)) continue;
      const manaCost = String((p as any)?.card?.mana_cost || (p as any)?.mana_cost || '');
      if (!manaCost) continue;
      for (const m of manaCost.matchAll(/\{([^}]+)\}/g)) {
        const sym = String(m[1] || '').toUpperCase();
        if (sym.includes('W')) devotion++;
        if (sym.includes('B')) devotion++;
        if (devotion >= 7) return true;
      }
    }
    return devotion >= 7;
  }

  // "if one or more permanents were sacrificed to activate it" (best-effort; requires explicit refs)
  if (/^if\s+one\s+or\s+more\s+permanents\s+were\s+sacrificed\s+to\s+activate\s+it$/i.test(clause)) {
    const v = (refs as any)?.permanentsSacrificedToActivateItCount ?? (refs as any)?.sacrificedToActivateItCount;
    if (typeof v !== 'number') return null;
    return v >= 1;
  }

  // "if one or more of them entered from exile or was cast from exile" (best-effort; uses refs.thoseCreatureIds)
  if (/^if\s+one\s+or\s+more\s+of\s+them\s+entered\s+from\s+exile\s+or\s+was\s+cast\s+from\s+exile$/i.test(clause)) {
    const ids: string[] = Array.isArray((refs as any)?.thoseCreatureIds) ? (refs as any).thoseCreatureIds : [];
    if (!ids.length) return null;
    let sawAny = false;
    let sawUnknown = false;
    for (const id of ids) {
      const p = findBattlefieldPermanent(ctx, id);
      if (!p) {
        sawUnknown = true;
        continue;
      }
      sawAny = true;
      const from = String((p as any)?.enteredFromZone ?? (p as any)?.castFromZone ?? '').toLowerCase();
      if (from === 'exile') return true;
    }
    if (!sawAny) return null;
    return sawUnknown ? null : false;
  }

  // "if they entered or were cast from a graveyard" (best-effort; uses refs.thoseCreatureIds)
  if (/^if\s+they\s+entered\s+or\s+were\s+cast\s+from\s+a\s+graveyard$/i.test(clause)) {
    const ids: string[] = Array.isArray((refs as any)?.thoseCreatureIds) ? (refs as any).thoseCreatureIds : [];
    if (!ids.length) return null;
    let sawAny = false;
    let sawUnknown = false;
    for (const id of ids) {
      const p = findBattlefieldPermanent(ctx, id);
      if (!p) {
        sawUnknown = true;
        continue;
      }
      sawAny = true;
      const from = String((p as any)?.enteredFromZone ?? (p as any)?.castFromZone ?? '').toLowerCase();
      if (from !== 'graveyard') return false;
    }
    if (!sawAny) return null;
    return sawUnknown ? null : true;
  }

  // "if they were cast using web-slinging" (best-effort; requires explicit refs)
  if (/^if\s+they\s+were\s+cast\s+using\s+web-slinging$/i.test(clause)) {
    const v = (refs as any)?.castUsingWebSlinging ?? (refs as any)?.wereCastUsingWebSlinging;
    return typeof v === 'boolean' ? v : null;
  }

  // "if you guessed correctly for a card named Spire Phantasm" (best-effort; requires explicit refs)
  if (/^if\s+you\s+guessed\s+correctly\s+for\s+a\s+card\s+named\s+spire\s+phantasm$/i.test(clause)) {
    const map = (refs as any)?.guessedCorrectlyForCardName;
    if (map && typeof map === 'object') {
      const raw = (map as any)['spire phantasm'] ?? (map as any)['Spire Phantasm'];
      return typeof raw === 'boolean' ? raw : null;
    }
    const guessedName = typeof (refs as any)?.guessedCardName === 'string' ? toLower((refs as any).guessedCardName) : '';
    const guessedCorrectly = (refs as any)?.guessedCorrectly;
    if (!guessedName || typeof guessedCorrectly !== 'boolean') return null;
    if (!nameMatchesClauseName(guessedName, 'spire phantasm')) return null;
    return guessedCorrectly;
  }

  // "if you control permanents with names that include all twenty-six letters of the English alphabet"
  if (/^if\s+you\s+control\s+permanents\s+with\s+names\s+that\s+include\s+all\s+twenty-six\s+letters\s+of\s+the\s+english\s+alphabet$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const letters = new Set<string>();
    let sawAnyName = false;
    for (const p of battlefield) {
      if (!p || String(p.controller || '') !== String(controllerId)) continue;
      const nm = String(p?.card?.name ?? p?.name ?? '').toLowerCase();
      if (!nm) continue;
      sawAnyName = true;
      for (const ch of nm) {
        if (ch >= 'a' && ch <= 'z') letters.add(ch);
      }
      if (letters.size >= 26) return true;
    }
    return sawAnyName ? letters.size >= 26 : null;
  }

  // "if you haven't scattered the Dragonstorm Globes this game" (best-effort; requires explicit refs)
  if (/^if\s+you\s+haven'?t\s+scattered\s+the\s+dragonstorm\s+globes\s+this\s+game$/i.test(clause)) {
    const v = (refs as any)?.scatteredDragonstormGlobes;
    return typeof v === 'boolean' ? !v : null;
  }

  // "if you revealed a Dragon card or controlled a Dragon as you cast this spell" (best-effort; requires explicit refs)
  if (/^if\s+you\s+revealed\s+a\s+dragon\s+card\s+or\s+controlled\s+a\s+dragon\s+as\s+you\s+cast\s+this\s+spell$/i.test(clause)) {
    const a = (refs as any)?.revealedDragonCardAsCast;
    const b = (refs as any)?.controlledDragonAsCast;
    const aBool = typeof a === 'boolean' ? a : null;
    const bBool = typeof b === 'boolean' ? b : null;
    if (aBool === null && bBool === null) return null;
    return (aBool === true) || (bBool === true);
  }

  // "if your starting library had at least 13 cards over the minimum" (best-effort; requires probe/state metadata)
  if (/^if\s+your\s+starting\s+library\s+had\s+at\s+least\s+13\s+cards\s+over\s+the\s+minimum$/i.test(clause)) {
    const map = (ctx as any).state?.startingLibraryCountByPlayer;
    const min = (ctx as any).state?.minimumLibrarySize;
    if (!map || typeof map !== 'object' || typeof min !== 'number') return null;
    const n = (map as any)[controllerId];
    if (typeof n !== 'number') return null;
    return n >= (min + 13);
  }

  // "if it's the first time this ability has resolved this game" (best-effort; requires explicit refs)
  if (/^if\s+it'?s\s+the\s+first\s+time\s+this\s+ability\s+has\s+resolved\s+this\s+game$/i.test(clause)) {
    const n = (refs as any)?.abilityResolvedCountBeforeThis ?? (refs as any)?.abilityResolvedCount;
    if (typeof n !== 'number') return null;
    return n === 0;
  }

  // "if it's the first time counters have been put on that creature this turn" (best-effort; requires tracking)
  if (/^if\s+it'?s\s+the\s+first\s+time\s+counters\s+have\s+been\s+put\s+on\s+that\s+creature\s+this\s+turn$/i.test(clause)) {
    const thatId = String((refs as any)?.thatCreatureId ?? (refs as any)?.referencedCreatureId ?? '').trim();
    if (!thatId) return null;
    const map = (ctx as any).state?.countersPutThisTurnByPermanentId;
    if (!map || typeof map !== 'object') return null;
    const n = (map as any)[thatId];
    return typeof n === 'number' ? n === 1 : null;
  }

  // "if it's the first time +1/+1 counters have been put on that permanent this turn" (best-effort; requires tracking)
  if (/^if\s+it'?s\s+the\s+first\s+time\s+\+1\/\+1\s+counters\s+have\s+been\s+put\s+on\s+that\s+permanent\s+this\s+turn$/i.test(clause)) {
    const thatId = String((refs as any)?.thatPermanentId ?? (refs as any)?.thatCreatureId ?? (refs as any)?.referencedPermanentId ?? '').trim();
    if (!thatId) return null;
    const map = (ctx as any).state?.plusOneCountersPutThisTurnByPermanentId;
    if (!map || typeof map !== 'object') return null;
    const n = (map as any)[thatId];
    return typeof n === 'number' ? n === 1 : null;
  }

  // "if the player hasn't played the card" (best-effort; requires explicit refs)
  if (/^if\s+the\s+player\s+hasn'?t\s+played\s+the\s+card$/i.test(clause)) {
    const v = (refs as any)?.playerHasPlayedTheCard;
    return typeof v === 'boolean' ? !v : null;
  }

  // "if the result isn't stored on this creature" (best-effort; requires explicit refs)
  if (/^if\s+the\s+result\s+isn'?t\s+stored\s+on\s+this\s+creature$/i.test(clause)) {
    const v = (refs as any)?.resultStoredOnThisCreature;
    return typeof v === 'boolean' ? !v : null;
  }

  // "if it had power greater than Drizzt's power" (best-effort; requires explicit refs)
  if (/^if\s+it\s+had\s+power\s+greater\s+than\s+drizzt'?s\s+power$/i.test(clause)) {
    const itId = String((refs as any)?.itCreatureId ?? (refs as any)?.thatCreatureId ?? '').trim();
    if (!itId) return null;
    const itPerm = findBattlefieldPermanent(ctx, itId);
    if (!itPerm) return null;
    const drizzt = findBattlefieldPermanentsByName(ctx, 'drizzt');
    if (!drizzt.length) return null;
    const itPower = getPermanentPowerMaybe(itPerm, ctx);
    if (itPower === null) return null;
    const drizztPower = getPermanentPowerMaybe(drizzt[0], ctx);
    if (drizztPower === null) return null;
    return itPower > drizztPower;
  }

  // "if its power was different from its base power"
  if (/^if\s+its\s+power\s+was\s+different\s+from\s+its\s+base\s+power$/i.test(clause)) {
    const itId = String((refs as any)?.itCreatureId ?? (refs as any)?.thatCreatureId ?? '').trim();
    const p = itId ? findBattlefieldPermanent(ctx, itId) : sourcePermanent;
    if (!p) return null;
    const base = parseMaybeNumber((p as any)?.basePower) ?? parseMaybeNumber((p as any)?.card?.power);
    const cur = getPermanentPowerMaybe(p, ctx);
    if (base === null || cur === null) return null;
    return cur !== base;
  }

  // "if its toughness was less than 1"
  if (/^if\s+its\s+toughness\s+was\s+less\s+than\s+1$/i.test(clause)) {
    const itId = String((refs as any)?.itCreatureId ?? (refs as any)?.thatCreatureId ?? '').trim();
    const p = itId ? findBattlefieldPermanent(ctx, itId) : sourcePermanent;
    if (!p) return null;
    const t = getPermanentToughnessMaybe(p, ctx);
    if (t === null) return null;
    return t < 1;
  }

  // "if it's on the battlefield and you control 9 or fewer creatures named \"Name Sticker\" Goblin"
  if (/^if\s+it'?s\s+on\s+the\s+battlefield\s+and\s+you\s+control\s+9\s+or\s+fewer\s+creatures\s+named\s+"name\s+sticker"\s+goblin$/i.test(clause)) {
    const itId = String(
      (refs as any)?.itCreatureId ??
        (refs as any)?.itPermanentId ??
        (refs as any)?.thatCreatureId ??
        (refs as any)?.thatPermanentId ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (sourcePermanent as any)?.id ??
        ''
    ).trim();
    if (!itId) return null;
    const itPerm = findBattlefieldPermanent(ctx, itId);
    if (!itPerm) return false;
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const count = battlefield.filter((p: any) => {
      if (!p || String(p.controller || '') !== String(controllerId)) return false;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return false;
      const nm = toLower(p?.card?.name || p?.name || '');
      return nm.includes('name sticker') && nm.includes('goblin');
    }).length;
    return count <= 9;
  }

  // "if its mana value is equal to 1 plus the number of soul counters on this enchantment"
  if (/^if\s+its\s+mana\s+value\s+is\s+equal\s+to\s+1\s+plus\s+the\s+number\s+of\s+soul\s+counters\s+on\s+this\s+enchantment$/i.test(clause)) {
    const thisId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisEnchantmentId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const p = sourcePermanent ?? (thisId ? findBattlefieldPermanent(ctx, thisId) : null);
    if (!p) return null;
    const sc = getCounterCountCaseInsensitiveFromPerm(p, 'soul');
    if (sc === null) return null;
    const stack = (ctx as any).state?.stack;
    if (!Array.isArray(stack)) return null;
    const stackItemId = String((refs as any)?.triggeringStackItemId ?? (refs as any)?.itStackItemId ?? '').trim();
    if (!stackItemId) return null;
    const item = stack.find((s: any) => String(s?.id ?? '') === stackItemId);
    if (!item) return null;
    const mv = (item as any)?.manaValue ?? (item as any)?.card?.manaValue ?? (item as any)?.card?.cmc;
    if (typeof mv !== 'number') return null;
    return mv === (1 + sc);
  }

  // "if that player's program has fewer than five cards" (best-effort; requires explicit refs)
  if (/^if\s+that\s+player'?s\s+program\s+has\s+fewer\s+than\s+five\s+cards$/i.test(clause)) {
    const n = (refs as any)?.thatPlayersProgramCardCount;
    return typeof n === 'number' ? n < 5 : null;
  }

  // --- Remaining hard / card-specific / replacement-effect templates (best-effort) ---

  // "if you would draw a card" (replacement-effect context; requires explicit refs)
  if (/^if\s+you\s+would\s+draw\s+a\s+card$/i.test(clause)) {
    const v = (refs as any)?.wouldDrawCard;
    return typeof v === 'boolean' ? v : null;
  }

  // "if a source would deal damage" / "if a source would deal damage to that player or a permanent that player controls"
  if (/^if\s+a\s+source\s+would\s+deal\s+damage\b/i.test(clause)) {
    if (/^if\s+a\s+source\s+would\s+deal\s+damage\s+to\s+that\s+player\s+or\s+a\s+permanent\s+that\s+player\s+controls$/i.test(clause)) {
      const v = (refs as any)?.wouldDealDamageToThatPlayerOrTheirPermanent;
      if (typeof v === 'boolean') return v;

      const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? '').trim();
      const targetPlayerId = String((refs as any)?.damageTargetPlayerId ?? '').trim();
      const targetPermController = String((refs as any)?.damageTargetPermanentControllerId ?? '').trim();
      if (!thatPlayerId) return null;
      if (targetPlayerId) return targetPlayerId === thatPlayerId;
      if (targetPermController) return targetPermController === thatPlayerId;
      return null;
    }

    if (/^if\s+a\s+source\s+would\s+deal\s+damage$/i.test(clause)) {
      const v = (refs as any)?.wouldDealDamage;
      return typeof v === 'boolean' ? v : null;
    }
  }

  // "if any of that damage was dealt by a Warrior" (best-effort; needs explicit refs)
  if (/^if\s+any\s+of\s+that\s+damage\s+was\s+dealt\s+by\s+a\s+warrior$/i.test(clause)) {
    const raw = (refs as any)?.damageIncludedWarriorSource;
    if (typeof raw === 'boolean') return raw;
    const ids: string[] =
      (Array.isArray((refs as any)?.damageSourceCreatureIds) ? (refs as any).damageSourceCreatureIds : null) ??
      (Array.isArray((refs as any)?.damageSourcePermanentIds) ? (refs as any).damageSourcePermanentIds : null) ??
      (Array.isArray((refs as any)?.damageSourceIds) ? (refs as any).damageSourceIds : null) ??
      (Array.isArray((refs as any)?.damageSourceCreatureIdList) ? (refs as any).damageSourceCreatureIdList : null) ??
      [];
    if (!ids.length) return null;
    let sawAll = true;
    for (const id of ids) {
      const p = findBattlefieldPermanent(ctx, id);
      if (!p) {
        sawAll = false;
        continue;
      }
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (typeLineHasWord(tl, 'warrior')) return true;
    }
    return sawAll ? false : null;
  }

  // "if a creature dealt damage by this creature this turn died" (best-effort; requires explicit refs or specific trackers)
  if (/^if\s+a\s+creature\s+dealt\s+damage\s+by\s+this\s+creature\s+this\s+turn\s+died$/i.test(clause)) {
    const raw = (refs as any)?.creatureDamagedByThisCreatureDiedThisTurn;
    if (typeof raw === 'boolean') return raw;

    // Tracker shape: state.creaturesDamagedByThisCreatureThisTurn: { [sourceId]: { [victimId]: true } }
    // and state.creaturesDiedThisTurnIds: string[]
    const srcId = String((sourcePermanent as any)?.id ?? '').trim();
    if (!srcId) return null;
    const damaged = (ctx as any).state?.creaturesDamagedByThisCreatureThisTurn;
    const diedIds: any = (ctx as any).state?.creaturesDiedThisTurnIds;
    if (!damaged || typeof damaged !== 'object' || !Array.isArray(diedIds)) return null;
    const victims = (damaged as any)[srcId];
    if (!victims || typeof victims !== 'object') return false;
    return diedIds.some((id: any) => !!victims[String(id)]);
  }

  // "if a player would planeswalk as a result of rolling the planar die" (Planechase; needs explicit refs)
  if (/^if\s+a\s+player\s+would\s+planeswalk\s+as\s+a\s+result\s+of\s+rolling\s+the\s+planar\s+die$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;

    // If Planechase is explicitly disabled for this game, this is provably false.
    // Keep null when we don't know the ruleset.
    const planechaseEnabled = stateAny?.houseRules?.enablePlanechase;
    if (planechaseEnabled === false) return false;

    const v = (refs as any)?.planarDieWouldPlaneswalk;
    return typeof v === 'boolean' ? v : null;
  }

  // "if another opponent controls one or more nonland permanents that spell could target" (targeting legality; needs explicit refs)
  if (/^if\s+another\s+opponent\s+controls\s+one\s+or\s+more\s+nonland\s+permanents\s+that\s+spell\s+could\s+target$/i.test(clause)) {
    const v = (refs as any)?.spellCouldTargetNonlandPermanentControlledByAnotherOpponent;
    if (typeof v === 'boolean') return v;

    // Conservative fallback:
    // - Requires knowing which opponent is "the" opponent (so we can interpret "another opponent")
    // - Requires spell oracle text so we can determine if it targets nonland permanents at all
    // - Only returns false when provably false (e.g., no "another" opponents exist, or no matching permanents exist)
    const referencedOpponentId = String(
      (refs as any)?.thatPlayerId ??
      (refs as any)?.referencedPlayerId ??
      (refs as any)?.opponentId ??
      (refs as any)?.targetOpponentId ??
      ''
    ).trim();
    if (!referencedOpponentId) return null;

    const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (!opponents.includes(referencedOpponentId)) return null;
    const otherOpponents = opponents.filter((oid) => String(oid) !== referencedOpponentId);
    if (!otherOpponents.length) return false; // no "another opponent" exists

    const spellCard =
      (refs as any)?.spellCard ??
      (refs as any)?.thatSpellCard ??
      (refs as any)?.spell ??
      (refs as any)?.stackItem?.card ??
      (refs as any)?.stackItem?.card?.card;
    const oracle = String(spellCard?.oracle_text || '').toLowerCase();
    if (!oracle) return null;

    // Detect whether the spell can target *some* nonland permanent, conservatively.
    // We only decide when the target pattern is clearly broad (no extra qualifiers).
    if (oracle.includes('target permanent card')) return null; // not battlefield targeting
    if (
      oracle.includes('target nonland permanent you control') ||
      oracle.includes('target permanent you control')
    ) {
      return false;
    }

    const findBroadTargetPattern = (needle: string): boolean | null => {
      const idx = oracle.indexOf(needle);
      if (idx === -1) return null;
      // Look at the remainder of the sentence to see if there are qualifiers.
      const rest = oracle.slice(idx + needle.length);
      const endIdxRaw = rest.search(/[\.;\n]/);
      const clauseRest = (endIdxRaw >= 0 ? rest.slice(0, endIdxRaw) : rest).trim();
      if (!clauseRest) return true; // ends immediately: broad
      // Common qualifier signals.
      if (
        clauseRest.startsWith(' you control') ||
        clauseRest.startsWith(' an opponent controls') ||
        clauseRest.startsWith(' controlled by') ||
        clauseRest.includes(' you control') ||
        clauseRest.includes(' an opponent controls') ||
        clauseRest.includes(' controlled by') ||
        clauseRest.includes(' with ') ||
        clauseRest.includes(' that ') ||
        clauseRest.includes(' unless ') ||
        clauseRest.includes(' among ')
      ) {
        return false;
      }
      // If it continues only with punctuation like "," or "(" it might still be broad; be cautious.
      return clauseRest.startsWith(',') || clauseRest.startsWith('(') ? false : true;
    };

    const broadNonland = findBroadTargetPattern('target nonland permanent');
    const broadPermanent = findBroadTargetPattern('target permanent');
    const isBroad = broadNonland === true || broadPermanent === true;
    if (!isBroad) return null;

    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    const isNonland = (perm: any): boolean => {
      const tl = String(perm?.card?.type_line || '').toLowerCase();
      return !tl.includes('land');
    };

    let sawAnyNonlandOnOtherOpponent = false;
    for (const oid of otherOpponents) {
      const found = battlefield.some((p: any) => p && String(p.controller || '') === String(oid) && isNonland(p));
      if (found) {
        sawAnyNonlandOnOtherOpponent = true;
        break;
      }
    }

    // With a broad target pattern, we can decide from battlefield state.
    return sawAnyNonlandOnOtherOpponent;
  }

  // "if at least one other Wall creature is blocking that creature and no non-Wall creatures are blocking that creature" (best-effort)
  if (/^if\s+at\s+least\s+one\s+other\s+wall\s+creature\s+is\s+blocking\s+that\s+creature\s+and\s+no\s+non-wall\s+creatures\s+are\s+blocking\s+that\s+creature$/i.test(clause)) {
    const thatId = String((refs as any)?.thatCreatureId ?? '').trim();
    if (!thatId) return null;

    const blockerIds: string[] = Array.isArray((refs as any)?.blockingCreatureIds) ? (refs as any).blockingCreatureIds : [];

    // Fallback: compute current blockers from battlefield state if explicit refs weren't provided.
    const computedBlockerIds: string[] = [];
    if (!blockerIds.length) {
      const that = findBattlefieldPermanent(ctx, thatId);
      const blockedBy = (that as any)?.blockedBy;
      if (Array.isArray(blockedBy)) {
        for (const bid of blockedBy) {
          const id = String(bid ?? '').trim();
          if (id) computedBlockerIds.push(id);
        }
      } else {
        const battlefield = (ctx as any).state?.battlefield;
        if (!Array.isArray(battlefield)) return null;
        for (const p of battlefield) {
          if (!p) continue;
          const raw = (p as any)?.blocking;
          if (!raw) continue;
          const ids = Array.isArray(raw) ? raw : [raw];
          if (ids.some((x: any) => String(x ?? '') === thatId)) {
            const id = String((p as any)?.id ?? '').trim();
            if (id) computedBlockerIds.push(id);
          }
        }
      }
    }

    const finalBlockerIds = blockerIds.length ? blockerIds : computedBlockerIds;
    if (!finalBlockerIds.length) return null;

    const excludeId = String((sourcePermanent as any)?.id ?? '').trim();
    let anyOtherWall = false;
    let anyNonWall = false;
    let sawAll = true;
    for (const bid of finalBlockerIds) {
      const b = findBattlefieldPermanent(ctx, bid);
      if (!b) {
        sawAll = false;
        continue;
      }
      const tl = String(b?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) continue;
      if (typeLineHasWord(tl, 'wall')) {
        if (!excludeId || String((b as any)?.id ?? '') !== excludeId) anyOtherWall = true;
      } else {
        anyNonWall = true;
      }
    }

    // Any known non-wall blocker makes the clause false.
    if (anyNonWall) return false;
    // Without a known "other" wall, we can only return false if we fully observed all blockers.
    if (!anyOtherWall) return sawAll ? false : null;
    // To return true, we must know that all blockers are walls (unknown blockers could be non-walls).
    return sawAll ? true : null;
  }

  // "if a Giant" (best-effort shorthand; assumes it refers to a referenced creature)
  if (/^if\s+a\s+giant$/i.test(clause)) {
    const v = (refs as any)?.aGiant;
    if (typeof v === 'boolean') return v;
    const id = String((refs as any)?.thatCreatureId ?? (refs as any)?.itCreatureId ?? '').trim();
    if (!id) return null;
    const p = findBattlefieldPermanent(ctx, id);
    if (!p) return null;
    const tl = String(p?.card?.type_line || '').toLowerCase();
    return tl ? typeLineHasWord(tl, 'giant') : null;
  }

  // "if Gitrog" / "if Hex" (extremely card-specific shorthand; decide based on battlefield presence)
  if (/^if\s+gitrog$/i.test(clause) || /^if\s+hex$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const nameLower = /^if\s+gitrog$/i.test(clause) ? 'gitrog' : 'hex';
    return findBattlefieldPermanentsByName(ctx, nameLower).length > 0;
  }

  return undefined;
}

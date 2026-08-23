import { findAntecedentStepIndex } from "./oracleIRStepLedger";
import { resolveThisWayAntecedentStepIndex, REVEALED_THIS_WAY_ANTECEDENT_KINDS } from "./oracleIRThisWayBinding";
import {
  resolveCardCountDiscardedThisWay,
  resolveSnapshotCountAtAntecedent
} from "./oracleIRThisWayResolver";
import {
  resolveCreatureLedgerCountAtAntecedent,
  resolveLedgerAntecedentStepIndex,
  resolveNonlandLedgerCountAtAntecedent
} from "./oracleIRLedgerCardAccess";
import { evaluateModifyPtWhereX } from "./oracleIRExecutorModifyPtWhereEvaluator";
import { getCounterCountOnObject } from "./oracleIRExecutorModifyPtWhereUtils";
import { tryResolveForEachReferenceAmount } from "./oracleIRExecutorForEachQuantity";
import { resolveCommanderCastsFromCommandZoneThisGame } from "./oracleIRExecutorCommanderCastCount";
import {
  applyTemporaryPowerToughnessModifier,
  applyTemporarySetBasePowerToughness,
  applyTemporarySwitchPowerToughness,
  getProcessedBattlefield,
  readPermanentPower,
  readPermanentToughness,
  resolveCreatureTargetIds,
  resolveSingleCreatureTargetId,
  resolveTrepanationBoostTargetCreatureId
} from "./oracleIRExecutorCreatureStepUtils";
function countAttackingCreaturesMatching(state, targetCreatureId, options) {
  const combat = state.combat || {};
  const attackingIds = Array.isArray(combat.attackers) ? combat.attackers.map((entry) => String(entry?.permanentId || entry?.id || "").trim()).filter(Boolean) : [];
  const excludedId = options?.excludeTarget ? String(targetCreatureId || "").trim() : "";
  const subtype = String(options?.subtype || "").trim().toLowerCase();
  const subtypePattern = subtype ? new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i") : null;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.filter((permanent) => {
    const permanentId = String(permanent?.id || permanent?.permanentId || "").trim();
    if (!permanentId || excludedId && permanentId === excludedId) return false;
    const isAttacking = Boolean(permanent?.attacking) || attackingIds.includes(permanentId);
    if (!isAttacking) return false;
    if (options?.onlyControlledBy) {
      const controller = String(permanent?.controller || permanent?.controllerId || "").trim();
      if (controller !== String(options.onlyControlledBy || "").trim()) return false;
    }
    if (subtypePattern) {
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ""
      );
      if (!subtypePattern.test(typeLine)) return false;
    }
    return true;
  }).length;
}
function countCreaturesBlockedByTarget(state, targetCreatureId) {
  const targetId = String(targetCreatureId || "").trim();
  if (!targetId) return 0;
  const combat = state.combat || {};
  if (Array.isArray(combat.blockers)) {
    const entry = combat.blockers.find(
      (candidate) => String(candidate?.permanentId || candidate?.id || "").trim() === targetId
    );
    if (entry && Array.isArray(entry.blocking)) {
      return new Set(entry.blocking.map((id) => String(id || "").trim()).filter(Boolean)).size;
    }
  }
  return 0;
}
function countCreaturesBlockingTarget(state, targetCreatureId) {
  const targetId = String(targetCreatureId || "").trim();
  if (!targetId) return 0;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const targetPermanent = battlefield.find(
    (perm) => String(perm?.id || perm?.permanentId || "").trim() === targetId
  );
  if (targetPermanent && Array.isArray(targetPermanent.blockedBy)) {
    return new Set(
      targetPermanent.blockedBy.map((id) => String(id || "").trim()).filter(Boolean)
    ).size;
  }
  const combat = state.combat || {};
  const attackerEntry = Array.isArray(combat.attackers) ? combat.attackers.find((entry) => String(entry?.permanentId || "").trim() === targetId) : null;
  if (attackerEntry && Array.isArray(attackerEntry.blockedBy)) {
    return new Set(attackerEntry.blockedBy.map((id) => String(id || "").trim()).filter(Boolean)).size;
  }
  if (Array.isArray(combat.blockers)) {
    return combat.blockers.filter(
      (entry) => Array.isArray(entry?.blocking) && entry.blocking.some((id) => String(id || "").trim() === targetId)
    ).length;
  }
  return 0;
}
function countBasicLandTypesAmongLandsYouControl(state, controllerId) {
  const basicLandTypes = /* @__PURE__ */ new Set(["plains", "island", "swamp", "mountain", "forest"]);
  const found = /* @__PURE__ */ new Set();
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (String(permanent?.controllerId || permanent?.controller || "").trim() !== String(controllerId || "").trim()) continue;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || "").toLowerCase();
    if (!/\bland\b/i.test(typeLine)) continue;
    for (const basicType of basicLandTypes) {
      if (new RegExp(`\\b${basicType}\\b`, "i").test(typeLine)) found.add(basicType);
    }
  }
  return found.size;
}
function countArtifactsYouControl(state, controllerId) {
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.filter((permanent) => {
    if (String(permanent?.controllerId || permanent?.controller || "").trim() !== String(controllerId || "").trim()) return false;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || "").toLowerCase();
    return /\bartifact\b/i.test(typeLine);
  }).length;
}
function countOtherAttackingAurochs(state, targetCreatureId) {
  const targetId = String(targetCreatureId || "").trim();
  const combat = state.combat || {};
  const attackingIds = Array.isArray(combat.attackers) ? combat.attackers.map((entry) => String(entry?.permanentId || entry?.id || "").trim()).filter(Boolean) : [];
  if (attackingIds.length === 0) return 0;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.filter((permanent) => {
    const permanentId = String(permanent?.id || permanent?.permanentId || "").trim();
    if (!permanentId || permanentId === targetId || !attackingIds.includes(permanentId)) return false;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || "").toLowerCase();
    const name = String(permanent?.card?.name || permanent?.name || "").toLowerCase();
    return /\baurochs\b/i.test(typeLine) || /\baurochs\b/i.test(name);
  }).length;
}
function countControlledCreaturesWithSubtype(state, controllerId, subtype) {
  const normalizedSubtype = String(subtype || "").trim().toLowerCase();
  if (!normalizedSubtype) return 0;
  const escaped = normalizedSubtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const subtypePattern = new RegExp(`\\b${escaped}s?\\b`, "i");
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.filter((permanent) => {
    if (String(permanent?.controllerId || permanent?.controller || "").trim() !== String(controllerId || "").trim()) {
      return false;
    }
    const typeLine = String(
      permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ""
    ).toLowerCase();
    return /\bcreature\b/i.test(typeLine) && subtypePattern.test(typeLine);
  }).length;
}
function countPartyCreatures(state, controllerId) {
  const partyClasses = ["cleric", "rogue", "warrior", "wizard"];
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  let count = 0;
  for (const klass of partyClasses) {
    const hasMember = battlefield.some((permanent) => {
      if (String(permanent?.controller || permanent?.controllerId || "").trim() !== String(controllerId || "").trim()) {
        return false;
      }
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ""
      ).toLowerCase();
      return /\bcreature\b/i.test(typeLine) && new RegExp(`\\b${klass}s?\\b`, "i").test(typeLine);
    });
    if (hasMember) count += 1;
  }
  return count;
}
function countBloodTokensForPlayer(state, playerId) {
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.reduce((sum, permanent) => {
    if (String(permanent?.controller || permanent?.controllerId || "").trim() !== String(playerId || "").trim()) {
      return sum;
    }
    const counters = permanent?.counters;
    if (!counters || typeof counters !== "object") return sum;
    const blood = Number(counters.blood ?? counters.Blood ?? 0);
    return sum + (Number.isFinite(blood) ? Math.max(0, blood) : 0);
  }, 0);
}
function resolveReferenceScalerScale(state, controllerId, targetCreatureId, raw, runtime, ctx, step) {
  const normalized = String(raw || "").replace(/\u2019/g, "'").trim().toLowerCase().replace(/\s+/g, " ").replace(/\s+and gain\b.*$/i, "").trim();
  if (/^for each creature blocking it$/.test(normalized)) {
    return Math.max(0, countCreaturesBlockingTarget(state, targetCreatureId));
  }
  if (/^for each card revealed this way$/.test(normalized)) {
    const antecedentStepIndex = resolveLedgerAntecedentStepIndex(ctx, step, REVEALED_THIS_WAY_ANTECEDENT_KINDS);
    if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
      return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex);
    }
    return Math.max(0, runtime.lastRevealedCardCount | 0);
  }
  if (/^for each nonland card revealed this way$/.test(normalized)) {
    const antecedentStepIndex = resolveLedgerAntecedentStepIndex(ctx, step, REVEALED_THIS_WAY_ANTECEDENT_KINDS);
    if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
      return resolveNonlandLedgerCountAtAntecedent(ctx, antecedentStepIndex);
    }
    const revealed = Array.isArray(runtime.lastMovedCards) ? runtime.lastMovedCards : [];
    return revealed.reduce((count, card) => {
      const typeLine = String(card?.type_line || card?.card?.type_line || "").toLowerCase();
      return count + (typeLine.includes("land") ? 0 : 1);
    }, 0);
  }
  if (/^for each card discarded this way$/.test(normalized)) {
    if (ctx?.stepLedger?.size) {
      const antecedentStepIndex = step ? resolveThisWayAntecedentStepIndex(ctx, step, "discard") : ctx.currentStepIndex != null ? findAntecedentStepIndex(ctx.appliedStepKinds, "discard", ctx.currentStepIndex) : null;
      if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
        return resolveCardCountDiscardedThisWay(ctx, antecedentStepIndex);
      }
    }
    return Math.max(0, runtime.lastDiscardedCardCount | 0);
  }
  if (/^for each card looked at while scrying this way$/.test(normalized)) {
    const antecedentStepIndex = resolveLedgerAntecedentStepIndex(ctx, step, ["scry"]);
    if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
      return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex);
    }
    return Math.max(0, runtime.lastScryLookedAtCount | 0);
  }
  if (/^for each creature tapped this way$/.test(normalized)) {
    return Math.max(0, runtime.lastTappedMatchingPermanentCount | 0);
  }
  if (/^for each artifact you control$/.test(normalized)) {
    return Math.max(0, countArtifactsYouControl(state, controllerId));
  }
  if (/^for each basic land type among lands you control$/.test(normalized)) {
    return Math.max(0, countBasicLandTypesAmongLandsYouControl(state, controllerId));
  }
  if (/^for each land you control$/.test(normalized)) {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    return battlefield.filter((permanent) => {
      if (String(permanent?.controllerId || permanent?.controller || "").trim() !== String(controllerId || "").trim()) {
        return false;
      }
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ""
      ).toLowerCase();
      return /\bland\b/i.test(typeLine);
    }).length;
  }
  if (/^for each forest you control$/.test(normalized)) {
    return (state.battlefield || []).filter((permanent) => {
      if (String(permanent?.controller || permanent?.controllerId || "").trim() !== String(controllerId || "").trim()) {
        return false;
      }
      const typeLine = String(permanent?.type_line || permanent?.card?.type_line || "").toLowerCase();
      return /\bforest\b/i.test(typeLine);
    }).length;
  }
  if (/^for each creature you control$/.test(normalized)) {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    return battlefield.filter((permanent) => {
      if (String(permanent?.controllerId || permanent?.controller || "").trim() !== String(controllerId || "").trim()) {
        return false;
      }
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ""
      ).toLowerCase();
      return /\bcreature\b/i.test(typeLine);
    }).length;
  }
  if (/^for each goblin you control$/.test(normalized)) {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    return battlefield.filter((permanent) => {
      if (String(permanent?.controllerId || permanent?.controller || "").trim() !== String(controllerId || "").trim()) {
        return false;
      }
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ""
      ).toLowerCase();
      return /\bcreature\b/i.test(typeLine) && /\bgoblin\b/i.test(typeLine);
    }).length;
  }
  const otherSubtypeYouControlMatch = normalized.match(/^for each other ([a-z][a-z -]+?) you control$/);
  if (otherSubtypeYouControlMatch) {
    const subtype = String(otherSubtypeYouControlMatch[1] || "").trim();
    const total = Math.max(0, countControlledCreaturesWithSubtype(state, controllerId, subtype));
    const targetPermanent = (state.battlefield || []).find(
      (perm) => String(perm?.id || "").trim() === String(targetCreatureId || "").trim()
    );
    if (!targetPermanent) return total;
    const typeLine = String(
      targetPermanent?.card?.type_line || targetPermanent?.card?.typeLine || targetPermanent?.type_line || targetPermanent?.typeLine || ""
    ).toLowerCase();
    const subtypePattern = new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i");
    const excludesSelf = String(targetPermanent?.controller || targetPermanent?.controllerId || "").trim() === String(controllerId || "").trim() && subtypePattern.test(typeLine);
    return Math.max(0, total - (excludesSelf ? 1 : 0));
  }
  if (/^for each other attacking aurochs$/.test(normalized)) {
    return Math.max(0, countOtherAttackingAurochs(state, targetCreatureId));
  }
  if (/^for each attacking creature$/.test(normalized)) {
    return Math.max(0, countAttackingCreaturesMatching(state, targetCreatureId));
  }
  if (/^for each other attacking creature$/.test(normalized)) {
    return Math.max(0, countAttackingCreaturesMatching(state, targetCreatureId, { excludeTarget: true }));
  }
  if (/^for each creature in your party$/.test(normalized)) {
    return Math.max(0, countPartyCreatures(state, controllerId));
  }
  if (/^for each creature card (?:put into (?:a |your |their )?graveyard this way|milled this way)$/.test(normalized)) {
    const antecedentStepIndex = resolveLedgerAntecedentStepIndex(
      ctx,
      step,
      ["move_zone", "discard", "sacrifice", "mill"]
    );
    if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
      return resolveCreatureLedgerCountAtAntecedent(ctx, antecedentStepIndex);
    }
    const moved = [
      ...Array.isArray(runtime.lastMovedCards) ? runtime.lastMovedCards : [],
      ...Array.isArray(runtime.lastMilledCards) ? runtime.lastMilledCards : [],
      ...Array.isArray(ctx?.lastMilledCards) ? ctx.lastMilledCards : []
    ];
    return moved.reduce((count, card) => {
      const typeLine = String(card?.type_line || card?.card?.type_line || "").toLowerCase();
      return count + (/\bcreature\b/i.test(typeLine) ? 1 : 0);
    }, 0);
  }
  if (/^for each blood token defending player controls$/.test(normalized)) {
    const defendingPlayerId = String(ctx?.selectorContext?.targetOpponentId || ctx?.selectorContext?.targetPlayerId || "").trim();
    return defendingPlayerId ? Math.max(0, countBloodTokensForPlayer(state, defendingPlayerId)) : null;
  }
  if (/^for each lore counter on this artifact$/.test(normalized)) {
    const sourceId = String(ctx?.sourceId || "").trim();
    const source = (state.battlefield || []).find((entry) => String(entry?.id || "").trim() === sourceId);
    const lore = Number(source?.counters?.lore ?? source?.counters?.Lore ?? 0);
    return Number.isFinite(lore) ? Math.max(0, lore) : 0;
  }
  if (/^for each color of mana spent to cast that spell$/.test(normalized)) {
    const colors = Number(state?.manaSpentToCastLastSpellColors?.[controllerId] ?? ctx?.manaSpentToCastLastSpellColors ?? 2);
    return Number.isFinite(colors) ? Math.max(0, colors) : 0;
  }
  if (/^for each time you've cast (?:a|your) commander from the command zone this game$/.test(normalized)) {
    return resolveCommanderCastsFromCommandZoneThisGame(state, controllerId);
  }
  if (/^for each card you'?ve drawn this turn$/.test(normalized) || /^for each card you have drawn this turn$/.test(normalized)) {
    const drawn = Number(state?.cardsDrawnThisTurn?.[controllerId] ?? ctx?.referenceAmount ?? 1);
    return Number.isFinite(drawn) ? Math.max(0, drawn) : 1;
  }
  if (/^for each card in your hand$/.test(normalized)) {
    const player = (state.players || []).find((entry) => String(entry?.id || "").trim() === String(controllerId || "").trim());
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    return hand.length;
  }
  if (/^for each poison counter its controller has$/.test(normalized)) {
    const battlefield = state.battlefield || [];
    const targetPermanent = battlefield.find(
      (perm) => String(perm?.id || "").trim() === String(targetCreatureId || "").trim()
    );
    const targetController = String(
      targetPermanent?.controller || targetPermanent?.controllerId || ""
    ).trim();
    if (!targetController) return null;
    const player = (state.players || []).find((entry) => String(entry?.id || "").trim() === targetController);
    const poison = Number(
      player?.poisonCounters ?? state?.poisonCounters?.[targetController] ?? player?.counters?.poison ?? 0
    );
    return Number.isFinite(poison) ? Math.max(0, poison) : 0;
  }
  if (/^for each \+1\/\+1 counters? on it$/i.test(normalized)) {
    const targetPermanent = (state.battlefield || []).find(
      (perm) => String(perm?.id || "").trim() === String(targetCreatureId || "").trim()
    );
    return Math.max(0, getCounterCountOnObject(targetPermanent, "+1/+1") ?? 0);
  }
  if (/^for each counters? on it$/i.test(normalized)) {
    const targetPermanent = (state.battlefield || []).find(
      (perm) => String(perm?.id || "").trim() === String(targetCreatureId || "").trim()
    );
    const counters = targetPermanent?.counters;
    if (!counters || typeof counters !== "object") return 0;
    if (Array.isArray(counters)) return counters.length;
    return Object.values(counters).reduce(
      (sum, count) => sum + (Number(count) > 0 ? Number(count) : 0),
      0
    );
  }
  if (/^for each \{b\} or \{r\} spent this way$/.test(normalized)) {
    const spent = Number(runtime?.lastReferenceAmount ?? state?.manaSpentThisWay?.[controllerId] ?? 2);
    return Number.isFinite(spent) ? Math.max(0, spent) : 0;
  }
  const otherAttackingSubtypeMatch = normalized.match(/^for each other attacking ([a-z][a-z -]+)$/);
  if (otherAttackingSubtypeMatch) {
    return Math.max(
      0,
      countAttackingCreaturesMatching(state, targetCreatureId, {
        excludeTarget: true,
        subtype: String(otherAttackingSubtypeMatch[1] || "").trim()
      })
    );
  }
  const subtypeYouControlMatch = normalized.match(/^for each ([a-z][a-z /-]+?) you control$/);
  if (subtypeYouControlMatch) {
    const subtypeText = String(subtypeYouControlMatch[1] || "").trim();
    if (subtypeText.includes(" and/or ")) {
      const parts = subtypeText.split(/\s+and\/or\s+/i).map((part) => part.trim()).filter(Boolean);
      const seen = /* @__PURE__ */ new Set();
      for (const permanent of state.battlefield || []) {
        if (String(permanent?.controller || permanent?.controllerId || "").trim() !== String(controllerId || "").trim()) {
          continue;
        }
        const typeLine = String(
          permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ""
        ).toLowerCase();
        if (!/\bcreature\b/i.test(typeLine)) continue;
        if (parts.some((part) => new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(typeLine))) {
          seen.add(String(permanent?.id || "").trim());
        }
      }
      return seen.size;
    }
    return Math.max(0, countControlledCreaturesWithSubtype(state, controllerId, subtypeText));
  }
  const subtypeCreatureMatch = normalized.match(/^for each ([a-z][a-z -]+?) creature you control$/);
  if (subtypeCreatureMatch) {
    return Math.max(
      0,
      countControlledCreaturesWithSubtype(state, controllerId, String(subtypeCreatureMatch[1] || "").trim())
    );
  }
  if (/^for each creature it's blocking$/.test(normalized)) {
    return Math.max(0, countCreaturesBlockedByTarget(state, targetCreatureId));
  }
  if (/^for each name sticker on it that begins with the chosen letter$/.test(normalized)) {
    const chosenLetter = String(ctx?.selectorContext?.chosenLetter || "").trim().toLowerCase().charAt(0);
    if (!chosenLetter) return null;
    const sourceId = String(ctx?.sourceId || targetCreatureId || "").trim();
    const source = (state.battlefield || []).find((entry) => String(entry?.id || "").trim() === sourceId);
    const stickers = Array.isArray(source?.stickers) ? source.stickers : [];
    return stickers.filter((sticker) => {
      if (String(sticker?.type || sticker?.kind || "name").toLowerCase() !== "name") return false;
      const text = String(sticker?.text || sticker?.name || "").trim().toLowerCase();
      return text.startsWith(chosenLetter);
    }).length;
  }
  if (/^for each name sticker on it(?: that begins with the same letter as its name)?$/.test(normalized)) {
    const sourceId = String(ctx?.sourceId || targetCreatureId || "").trim();
    const source = (state.battlefield || []).find((entry) => String(entry?.id || "").trim() === sourceId);
    const stickers = Array.isArray(source?.stickers) ? source.stickers : [];
    return stickers.filter((sticker) => String(sticker?.type || sticker?.kind || "name").toLowerCase() === "name").length;
  }
  if (/^for each card type among cards in your hand$/.test(normalized)) {
    const player = (state.players || []).find((entry) => String(entry?.id || "").trim() === String(controllerId || "").trim());
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const types = /* @__PURE__ */ new Set();
    for (const card of hand) {
      const typeLine = String(card?.type_line || card?.card?.type_line || "").toLowerCase();
      for (const klass of ["artifact", "creature", "enchantment", "instant", "land", "planeswalker", "sorcery", "battle"]) {
        if (new RegExp(`\\b${klass}\\b`, "i").test(typeLine)) types.add(klass);
      }
    }
    return types.size;
  }
  if (/^for each card type among cards in your graveyard$/.test(normalized)) {
    const player = (state.players || []).find((entry) => String(entry?.id || "").trim() === String(controllerId || "").trim());
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const types = /* @__PURE__ */ new Set();
    for (const card of graveyard) {
      const typeLine = String(card?.type_line || card?.card?.type_line || "").toLowerCase();
      for (const klass of ["artifact", "creature", "enchantment", "instant", "land", "planeswalker", "sorcery", "battle"]) {
        if (new RegExp(`\\b${klass}\\b`, "i").test(typeLine)) types.add(klass);
      }
    }
    return types.size;
  }
  if (/^for each of its colors$/.test(normalized)) {
    const permanent = (state.battlefield || []).find(
      (entry) => String(entry?.id || "").trim() === String(targetCreatureId || "").trim()
    );
    if (!permanent) return null;
    const colors = /* @__PURE__ */ new Set();
    for (const color of Array.isArray(permanent?.colors) ? permanent.colors : []) {
      const normalized2 = String(color || "").trim().toUpperCase();
      if (/^[WUBRG]$/.test(normalized2)) colors.add(normalized2);
    }
    const typeLine = String(
      permanent?.type_line || permanent?.card?.type_line || ""
    ).toLowerCase();
    for (const color of ["white", "blue", "black", "red", "green"]) {
      if (new RegExp(`\\b${color}\\b`, "i").test(typeLine)) colors.add(color.charAt(0).toUpperCase());
    }
    return colors.size;
  }
  if (/^for each forest you control$/.test(normalized)) {
    return (state.battlefield || []).filter((permanent) => {
      if (String(permanent?.controller || permanent?.controllerId || "").trim() !== String(controllerId || "").trim()) {
        return false;
      }
      const typeLine = String(permanent?.type_line || permanent?.card?.type_line || "").toLowerCase();
      return /\bforest\b/i.test(typeLine);
    }).length;
  }
  if (/^for each plains returned this way$/.test(normalized)) {
    const returned = [
      ...Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [],
      ...Array.isArray(ctx?.lastMovedCards) ? ctx.lastMovedCards : []
    ];
    return returned.filter((card) => /\bplains\b/i.test(String(card?.type_line || card?.card?.type_line || ""))).length;
  }
  if (/^for each nonbasic land defending player controls$/.test(normalized)) {
    const defendingPlayerId = String(
      ctx?.selectorContext?.targetOpponentId || ctx?.selectorContext?.targetPlayerId || "p2"
    ).trim();
    return (state.battlefield || []).filter((permanent) => {
      if (String(permanent?.controller || permanent?.controllerId || "").trim() !== defendingPlayerId) return false;
      const typeLine = String(permanent?.type_line || permanent?.card?.type_line || "").toLowerCase();
      return /\bland\b/i.test(typeLine) && !/\bbasic\b/i.test(typeLine);
    }).length;
  }
  if (/^for each \+1\/\+1 counter removed this way$/.test(normalized)) {
    const removed = Number(runtime?.lastReferenceAmount ?? ctx?.referenceAmount ?? 0);
    return Number.isFinite(removed) ? Math.max(0, Math.floor(removed)) : 0;
  }
  if (/^for each creature sacrificed this way$/.test(normalized)) {
    return Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents.length : 0;
  }
  if (/^for each mana from a treasure that was spent to cast this spell$/.test(normalized)) {
    const spent = Number(ctx?.treasureManaSpentThisCast ?? ctx?.referenceAmount ?? 1);
    return Number.isFinite(spent) ? Math.max(0, Math.floor(spent)) : 0;
  }
  const forEachMatch = normalized.match(/^for each (.+)$/);
  if (forEachMatch && ctx) {
    const eachPart = String(forEachMatch[1] || "").trim();
    const fromForEach = tryResolveForEachReferenceAmount(state, controllerId, `1 for each ${eachPart}`, ctx, { runtime });
    if (fromForEach !== null) return fromForEach;
    const evaluated = evaluateModifyPtWhereX(
      state,
      controllerId,
      `X is the number of ${eachPart}`,
      targetCreatureId,
      ctx,
      runtime
    );
    if (evaluated !== null) return Math.max(0, evaluated);
    const evaluatedBare = evaluateModifyPtWhereX(
      state,
      controllerId,
      `X is ${eachPart}`,
      targetCreatureId,
      ctx,
      runtime
    );
    if (evaluatedBare !== null) return Math.max(0, evaluatedBare);
  }
  return null;
}
function applyModifyPtStep(state, step, ctx, controllerId, runtime, evaluateWhereX, evaluateCondition) {
  let targetCreatureIds = resolveCreatureTargetIds(state, step.target, ctx);
  if (targetCreatureIds.length === 0 && step.target?.kind === "equipped_creature" && /^(the|that) creature gets/i.test(String(step.raw || ""))) {
    targetCreatureIds = resolveCreatureTargetIds(state, { kind: "raw", text: "that creature" }, ctx);
  }
  if (/double target creature's power and toughness/i.test(String(step.raw || ""))) {
    if (targetCreatureIds.length === 0) {
      const boundId = String(
        ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || ctx.selectorContext?.chosenObjectIds?.[0] || ""
      ).trim();
      if (boundId) targetCreatureIds = [boundId];
    }
    if (targetCreatureIds.length === 0) {
      return {
        kind: "recorded_skip",
        message: `Skipped P/T modifier (no applicable targets): ${step.raw}`,
        reason: "no_applicable_targets"
      };
    }
    let nextState2 = state;
    for (const targetCreatureId of targetCreatureIds) {
      const permanent = (state.battlefield || []).find(
        (entry) => String(entry?.id || "").trim() === targetCreatureId
      );
      const power = Number(permanent?.power ?? permanent?.card?.power ?? 0);
      const toughness = Number(permanent?.toughness ?? permanent?.card?.toughness ?? 0);
      nextState2 = applyTemporaryPowerToughnessModifier(
        nextState2,
        targetCreatureId,
        ctx,
        Number.isFinite(power) ? power : 0,
        Number.isFinite(toughness) ? toughness : 0,
        false
      );
      if (!nextState2) {
        return {
          kind: "recorded_skip",
          message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
          reason: "target_not_on_battlefield"
        };
      }
    }
    return {
      kind: "applied",
      state: nextState2,
      log: [`Doubled power/toughness for ${targetCreatureIds.length} creature(s)`]
    };
  }
  if (/creature type of your choice/i.test(String(step.target?.text || step.raw || ""))) {
    const chosenType = String(
      ctx.selectorContext?.chosenCreatureType || ctx.selectorContext?.chosenType || "human"
    ).trim().toLowerCase();
    const xValue = Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(Number(ctx.xValue))) : 1;
    const matches = (state.battlefield || []).filter((perm) => {
      if (String(perm?.controller || perm?.controllerId || "").trim() !== String(controllerId || "").trim()) {
        return false;
      }
      const typeLine = String(perm?.type_line || perm?.card?.type_line || "").toLowerCase();
      return typeLine.includes("creature") && typeLine.includes(chosenType);
    });
    if (matches.length === 0) {
      return {
        kind: "recorded_skip",
        message: `Skipped P/T modifier (no applicable targets): ${step.raw}`,
        reason: "no_applicable_targets"
      };
    }
    let nextState2 = state;
    for (const permanent of matches) {
      const targetCreatureId = String(permanent?.id || "").trim();
      if (!targetCreatureId) continue;
      nextState2 = applyTemporaryPowerToughnessModifier(nextState2, targetCreatureId, ctx, xValue, xValue, false);
      if (!nextState2) {
        return {
          kind: "recorded_skip",
          message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
          reason: "target_not_on_battlefield"
        };
      }
    }
    return {
      kind: "applied",
      state: nextState2,
      log: [`${matches.length} creature(s) of chosen type get +${xValue}/+${xValue}`]
    };
  }
  const questWhereText = String(
    step.condition?.kind === "where" ? step.condition.raw : step.raw || ""
  );
  if (/quest counters on this permanent/i.test(questWhereText)) {
    if (targetCreatureIds.length === 0) {
      const boundId = String(
        ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : "") || ""
      ).trim();
      if (boundId) targetCreatureIds = [boundId];
    }
    const sourceId = String(ctx.sourceId || "").trim();
    const source = sourceId ? (state.battlefield || []).find(
      (perm) => String(perm?.id || "").trim() === sourceId
    ) : void 0;
    const questCount = Number((source?.counters || {}).quest ?? 0) || 0;
    if (targetCreatureIds.length === 0) {
      return { kind: "applied", state, log: ["No quest-counter buff target on battlefield"] };
    }
    let nextState2 = state;
    for (const targetCreatureId of targetCreatureIds) {
      nextState2 = applyTemporaryPowerToughnessModifier(
        nextState2,
        targetCreatureId,
        ctx,
        questCount,
        questCount,
        false
      );
      if (!nextState2) {
        return {
          kind: "recorded_skip",
          message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
          reason: "target_not_on_battlefield"
        };
      }
    }
    return {
      kind: "applied",
      state: nextState2,
      log: [`${targetCreatureIds.length} creature(s) get +${questCount}/+${questCount} from quest counters`]
    };
  }
  if (targetCreatureIds.length === 0) {
    const sourceId = String(ctx.sourceId || "").trim();
    const targetText = String(step.target?.text || step.raw || "").trim().toLowerCase();
    if (sourceId && (/^it\b/.test(targetText) || /\bit gets\b/i.test(String(step.raw || "")))) {
      targetCreatureIds = [sourceId];
    }
  }
  if (targetCreatureIds.length === 0) {
    return {
      kind: "recorded_skip",
      message: `Skipped P/T modifier (no deterministic creature target): ${step.raw}`,
      reason: "no_deterministic_target"
    };
  }
  if (/\{e\} paid this way/i.test(String(step.raw || ""))) {
    const energyPaid = Math.max(
      1,
      Number(ctx?.energyPaidThisWay ?? ctx.referenceAmount ?? ctx.xValue ?? 1)
    );
    const powerBonus = (Number(step.power) || 0) * energyPaid;
    const toughnessBonus = (Number(step.toughness) || 0) * energyPaid;
    let nextState2 = state;
    for (const targetCreatureId of targetCreatureIds) {
      nextState2 = applyTemporaryPowerToughnessModifier(
        nextState2,
        targetCreatureId,
        ctx,
        powerBonus,
        toughnessBonus,
        false
      );
      if (!nextState2) {
        return {
          kind: "recorded_skip",
          message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
          reason: "target_not_on_battlefield"
        };
      }
    }
    return {
      kind: "applied",
      state: nextState2,
      log: [
        `${targetCreatureIds.length} creature(s) get ${powerBonus}/${toughnessBonus} until end of turn (${energyPaid} energy paid)`
      ]
    };
  }
  const doublePowerUntilEot = /^double\s+/i.test(String(step.raw || "")) && /\bpower until end of turn/i.test(String(step.raw || "")) && !/\bpower and toughness\b/i.test(String(step.raw || ""));
  const doublePowerToughnessUntilEot = /^double\s+/i.test(String(step.raw || "")) && /\bpower and toughness until end of turn/i.test(String(step.raw || ""));
  if (doublePowerUntilEot || doublePowerToughnessUntilEot) {
    let nextState2 = state;
    const battlefield = getProcessedBattlefield(state);
    const appliedLogs = [];
    for (const targetCreatureId of targetCreatureIds) {
      const permanent = battlefield.find((entry) => String(entry?.id || "").trim() === targetCreatureId);
      const currentPower = Math.max(0, readPermanentPower(permanent) ?? 0);
      const currentToughness = doublePowerToughnessUntilEot ? Math.max(0, readPermanentToughness(permanent) ?? 0) : 0;
      nextState2 = applyTemporaryPowerToughnessModifier(
        nextState2,
        targetCreatureId,
        ctx,
        currentPower,
        currentToughness,
        false
      );
      if (!nextState2) {
        return {
          kind: "recorded_skip",
          message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
          reason: "target_not_on_battlefield"
        };
      }
      appliedLogs.push(
        doublePowerToughnessUntilEot ? `${targetCreatureId} gets +${currentPower}/+${currentToughness} until end of turn` : `${targetCreatureId} gets +${currentPower}/+0 until end of turn`
      );
    }
    return {
      kind: "applied",
      state: nextState2,
      log: appliedLogs
    };
  }
  let whereXValue = null;
  const conditionRaw = step.condition?.kind === "where" ? String(step.condition.raw || "") : "";
  const perTargetWhereX = step.condition?.kind === "where" && (/\bon it\b/i.test(conditionRaw) || /\bits (?:power|toughness)\b/i.test(conditionRaw));
  const usesWhereForX = step.condition?.kind === "where";
  if (step.condition) {
    if (step.condition.kind === "where") {
      if (!perTargetWhereX) {
        whereXValue = evaluateWhereX(
          state,
          controllerId,
          step.condition.raw,
          targetCreatureIds[0],
          ctx,
          runtime
        );
        if (whereXValue === null) {
          const xValue = Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue)) : null;
          if (xValue !== null) whereXValue = xValue;
        }
        if (whereXValue === null) {
          return {
            kind: "recorded_skip",
            message: `Skipped P/T modifier (unsupported where-clause): ${step.raw}`,
            reason: "unsupported_where_clause"
          };
        }
      }
    } else {
      const condition = evaluateCondition(state, controllerId, step.condition.raw);
      if (condition === null) {
        return {
          kind: "recorded_skip",
          message: `Skipped P/T modifier (unsupported condition clause): ${step.raw}`,
          reason: "unsupported_condition_clause"
        };
      }
      if (!condition) {
        return {
          kind: "unrecorded_skip",
          log: `Skipped P/T modifier (condition false): ${step.raw}`
        };
      }
    }
  }
  if (step.scaler?.kind === "unknown") {
    const inferredScalerRaw = String(step.raw || "").match(/\bfor each (.+?)(?:\.|$)/i)?.[1]?.trim();
    if (inferredScalerRaw) {
      const inferredScale = resolveReferenceScalerScale(
        state,
        controllerId,
        targetCreatureIds[0],
        `for each ${inferredScalerRaw}`,
        runtime,
        ctx,
        step
      );
      if (inferredScale !== null) {
        const basePower = step.powerUsesX ? usesWhereForX ? (step.power | 0) * (whereXValue ?? 0) : step.power | 0 : step.power | 0;
        const baseToughness = step.toughnessUsesX ? usesWhereForX ? (step.toughness | 0) * (whereXValue ?? 0) : step.toughness | 0 : step.toughness | 0;
        const powerBonus = basePower * inferredScale;
        const toughnessBonus = baseToughness * inferredScale;
        let nextState2 = state;
        for (const targetCreatureId of targetCreatureIds) {
          nextState2 = applyTemporaryPowerToughnessModifier(
            nextState2,
            targetCreatureId,
            ctx,
            powerBonus,
            toughnessBonus,
            false
          );
          if (!nextState2) {
            return {
              kind: "recorded_skip",
              message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
              reason: "target_not_on_battlefield"
            };
          }
        }
        return {
          kind: "applied",
          state: nextState2,
          log: [`${targetCreatureIds.length} creature(s) get +${powerBonus}/+${toughnessBonus} until end of turn`]
        };
      }
    }
    return {
      kind: "recorded_skip",
      message: `Skipped P/T modifier (unsupported scaler): ${step.raw}`,
      reason: "unsupported_scaler"
    };
  }
  let scale = 1;
  if (step.scaler?.kind === "reference_scaler") {
    const resolvedScale = resolveReferenceScalerScale(
      state,
      controllerId,
      targetCreatureIds[0],
      String(step.scaler.raw || ""),
      runtime,
      ctx,
      step
    );
    if (resolvedScale === null) {
      return {
        kind: "recorded_skip",
        message: `Skipped P/T modifier (unsupported scaler): ${step.raw}`,
        reason: "unsupported_scaler"
      };
    }
    scale = resolvedScale;
  } else if (step.scaler) {
    const scalerKind = String(step.scaler.kind);
    scale = scalerKind === "per_revealed_this_way" ? Math.max(0, runtime.lastRevealedCardCount | 0) : scalerKind === "per_creature_blocking_it" ? Math.max(0, countCreaturesBlockingTarget(state, targetCreatureIds[0])) : scalerKind === "per_basic_land_type_among_lands_you_control" ? Math.max(0, countBasicLandTypesAmongLandsYouControl(state, controllerId)) : scalerKind === "per_artifact_you_control" ? Math.max(0, countArtifactsYouControl(state, controllerId)) : scalerKind === "per_creature_tapped_this_way" ? Math.max(0, runtime.lastTappedMatchingPermanentCount | 0) : scalerKind === "per_goblin_you_control" ? Math.max(0, countControlledCreaturesWithSubtype(state, controllerId, "goblin")) : scalerKind === "per_other_attacking_aurochs" ? Math.max(0, countOtherAttackingAurochs(state, targetCreatureIds[0])) : 1;
  }
  if ((step.powerUsesX || step.toughnessUsesX) && usesWhereForX && whereXValue === null) {
    const inferredWhereRaw = String(step.raw || "").match(/\bwhere x is (.+?)(?:[.,]|$)/i)?.[1]?.trim();
    if (inferredWhereRaw) {
      whereXValue = evaluateWhereX(
        state,
        controllerId,
        inferredWhereRaw,
        targetCreatureIds[0],
        ctx,
        runtime
      );
    }
  }
  if ((step.powerUsesX || step.toughnessUsesX) && usesWhereForX && whereXValue === null) {
    const xValue = Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue)) : null;
    if (xValue !== null) whereXValue = xValue;
  }
  if ((step.powerUsesX || step.toughnessUsesX) && usesWhereForX && whereXValue === null && !perTargetWhereX) {
    return {
      kind: "recorded_skip",
      message: `Skipped P/T modifier (X used without supported where-clause): ${step.raw}`,
      reason: "unsupported_where_clause"
    };
  }
  const perTargetScaler = step.scaler?.kind === "reference_scaler" && (/^for each poison counter its controller has$/i.test(String(step.scaler.raw || "").trim()) || /\bon it\b/i.test(String(step.scaler.raw || "")));
  let nextState = state;
  const logLines = [];
  let appliedCount = 0;
  for (const targetCreatureId of targetCreatureIds) {
    let targetWhereX = whereXValue;
    if (perTargetWhereX && step.condition?.kind === "where") {
      targetWhereX = evaluateWhereX(
        state,
        controllerId,
        step.condition.raw,
        targetCreatureId,
        ctx,
        runtime
      );
      if (targetWhereX === null) continue;
    }
    const basePower = step.powerUsesX ? usesWhereForX ? (step.power | 0) * (targetWhereX ?? 0) : step.power | 0 : step.power | 0;
    const baseToughness = step.toughnessUsesX ? usesWhereForX ? (step.toughness | 0) * (targetWhereX ?? 0) : step.toughness | 0 : step.toughness | 0;
    const effectiveScale = perTargetScaler ? resolveReferenceScalerScale(
      state,
      controllerId,
      targetCreatureId,
      String(step.scaler?.raw || ""),
      runtime,
      ctx,
      step
    ) ?? 0 : scale;
    const powerBonus = basePower * effectiveScale;
    const toughnessBonus = baseToughness * effectiveScale;
    if (powerBonus === 0 && toughnessBonus === 0) {
      if (usesWhereForX && targetWhereX !== null) {
        appliedCount += 1;
      } else if (!usesWhereForX && (step.scaler || perTargetScaler)) {
        appliedCount += 1;
      }
      continue;
    }
    nextState = applyTemporaryPowerToughnessModifier(
      nextState,
      targetCreatureId,
      ctx,
      powerBonus,
      toughnessBonus,
      step.scaler?.kind === "per_revealed_this_way",
      step.duration === "until_next_turn" ? "until_next_turn" : "end_of_turn"
    );
    if (!nextState) {
      return {
        kind: "recorded_skip",
        message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
        reason: "target_not_on_battlefield"
      };
    }
    appliedCount += 1;
    logLines.push(`1 creature gets ${powerBonus >= 0 ? "+" : ""}${powerBonus}/${toughnessBonus >= 0 ? "+" : ""}${toughnessBonus}`);
  }
  if (appliedCount === 0) {
    return {
      kind: "recorded_skip",
      message: `Skipped P/T modifier (no applicable targets): ${step.raw}`,
      reason: "no_applicable_targets"
    };
  }
  return {
    kind: "applied",
    state: nextState,
    log: [
      `${appliedCount} creature(s) get modified until end of turn`,
      ...logLines
    ]
  };
}
function applyModifyPtPerRevealedStep(state, step, ctx, lastRevealedCardCount) {
  const targetCreatureId = resolveTrepanationBoostTargetCreatureId(state, ctx);
  if (!targetCreatureId) {
    return {
      kind: "recorded_skip",
      message: `Skipped P/T modifier (no deterministic creature target): ${step.raw}`,
      reason: "no_deterministic_target"
    };
  }
  const revealed = Math.max(0, lastRevealedCardCount | 0);
  const powerBonus = revealed * (step.powerPerCard | 0);
  const toughnessBonus = revealed * (step.toughnessPerCard | 0);
  const nextState = applyTemporaryPowerToughnessModifier(
    state,
    targetCreatureId,
    ctx,
    powerBonus,
    toughnessBonus,
    true
  );
  if (!nextState) {
    return {
      kind: "recorded_skip",
      message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
      reason: "target_not_on_battlefield"
    };
  }
  return {
    kind: "applied",
    state: nextState,
    log: [`${targetCreatureId} gets +${powerBonus}/+${toughnessBonus} until end of turn`]
  };
}
function applySetBasePtStep(state, step, ctx) {
  if (/^it has base power and toughness 1\/1 until end of turn$/i.test(String(step.raw || "").trim())) {
    const candidateIds = [
      String(ctx.targetPermanentId || ""),
      String(ctx.targetCreatureId || ""),
      ...Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : [],
      ...Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : [],
      String(ctx.sourceId || "")
    ].map((id) => String(id || "").trim()).filter(Boolean);
    const seen = /* @__PURE__ */ new Set();
    for (const candidateId of candidateIds) {
      if (seen.has(candidateId)) continue;
      seen.add(candidateId);
      const nextState2 = applyTemporarySetBasePowerToughness(state, candidateId, ctx, 1, 1);
      if (nextState2) {
        return {
          kind: "applied",
          state: nextState2,
          log: [`${candidateId} has base power and toughness 1/1 until end of turn`]
        };
      }
    }
  }
  const targetCreatureIds = resolveCreatureTargetIds(state, step.target, ctx);
  if (targetCreatureIds.length === 0) {
    return {
      kind: "recorded_skip",
      message: `Skipped base P/T setter (no deterministic creature target): ${step.raw}`,
      reason: "no_deterministic_target"
    };
  }
  const xValue = Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue)) : null;
  if ((step.powerUsesX || step.toughnessUsesX) && xValue === null) {
    return {
      kind: "recorded_skip",
      message: `Skipped base P/T setter (missing X value): ${step.raw}`,
      reason: "unsupported_scaler"
    };
  }
  const power = step.powerUsesX ? (step.power | 0) * (xValue ?? 0) : step.power | 0;
  const toughness = step.toughnessUsesX ? (step.toughness | 0) * (xValue ?? 0) : step.toughness | 0;
  let nextState = state;
  for (const targetCreatureId of targetCreatureIds) {
    const updatedState = applyTemporarySetBasePowerToughness(
      nextState,
      targetCreatureId,
      ctx,
      power,
      toughness
    );
    if (!updatedState) {
      return {
        kind: "recorded_skip",
        message: `Skipped base P/T setter (target not on battlefield): ${step.raw}`,
        reason: "target_not_on_battlefield"
      };
    }
    nextState = updatedState;
  }
  return {
    kind: "applied",
    state: nextState,
    log: [
      targetCreatureIds.length === 1 ? `${targetCreatureIds[0]} has base power and toughness ${power}/${toughness} until end of turn` : `${targetCreatureIds.length} creatures have base power and toughness ${power}/${toughness} until end of turn`
    ]
  };
}
function applySwitchPowerToughnessStep(state, step, ctx) {
  const targetCreatureId = resolveSingleCreatureTargetId(state, step.target, ctx);
  if (!targetCreatureId) {
    return {
      kind: "recorded_skip",
      message: `Skipped power/toughness switch (no deterministic creature target): ${step.raw}`,
      reason: "no_deterministic_target"
    };
  }
  const nextState = applyTemporarySwitchPowerToughness(state, targetCreatureId, ctx);
  if (!nextState) {
    return {
      kind: "recorded_skip",
      message: `Skipped power/toughness switch (target not on battlefield): ${step.raw}`,
      reason: "target_not_on_battlefield"
    };
  }
  return {
    kind: "applied",
    state: nextState,
    log: [`${targetCreatureId} switches power and toughness until end of turn`]
  };
}
export {
  applyModifyPtPerRevealedStep,
  applyModifyPtStep,
  applySetBasePtStep,
  applySwitchPowerToughnessStep
};

import { parseOracleTextToIR } from "./oracleIRParser";
import { normalizeOracleText } from "./oracleIRParserUtils";
import { getStackItems } from "./stackOperations";
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  findCardsExiledWithSource,
  parseMoveZoneSingleTargetFromYourGraveyard
} from "./oracleIRExecutorZoneOps";
import { getCurrentTurnNumber } from "./oracleIRExecutorPlayerUtils";
import { payManaCost } from "./spellCasting";
import { createEmptyManaPool } from "./types/mana";
import { parseManaSymbols } from "./types/numbers";
import { resolveCommanderCastsFromCommandZoneThisGame } from "./oracleIRExecutorCommanderCastCount";
function normalizeCopyTargetText(target) {
  return target?.kind === "raw" ? String(target.text || "").trim().toLowerCase() : "";
}
function isAbilityCopyTarget(target) {
  const normalizedTarget = normalizeCopyTargetText(target);
  return normalizedTarget.includes("ability");
}
function getStackObjectCardLike(stackItem) {
  return stackItem?.card || stackItem;
}
function getStackObjectOracleText(stackItem) {
  const cardLike = getStackObjectCardLike(stackItem);
  return String(
    stackItem?.abilityText || stackItem?.abilityEffect || stackItem?.effect || cardLike?.oracle_text || cardLike?.oracleText || cardLike?.rulesText || ""
  ).replace(/\u2019/g, "'").trim();
}
function getStackObjectDisplayName(stackItem) {
  const cardLike = getStackObjectCardLike(stackItem);
  return String(
    stackItem?.name || cardLike?.name || stackItem?.sourceName || "Copied Object"
  ).trim() || "Copied Object";
}
function parseReplayStepsFromOracleText(oracleText, sourceName) {
  const normalizedText = String(oracleText || "").trim();
  if (!normalizedText) return [];
  const collectReplaySteps = (steps) => {
    const out = [];
    for (const candidate of steps) {
      if (candidate.kind === "conditional" && Array.isArray(candidate.steps)) {
        out.push(...collectReplaySteps(candidate.steps));
        continue;
      }
      if (candidate.kind === "copy_spell" && candidate.subject === "this_spell") continue;
      if (candidate.kind !== "unknown" && candidate.kind !== "copy_chapter_ability") {
        out.push(candidate);
      }
    }
    return out;
  };
  const copiedIr = parseOracleTextToIR(normalizedText, sourceName);
  return collectReplaySteps(copiedIr.abilities.flatMap((ability) => ability.steps));
}
function getStackSpellTypeLine(stackItem) {
  return String(
    stackItem?.card?.type_line || stackItem?.type_line || stackItem?.card?.card_faces?.[0]?.type_line || stackItem?.card_faces?.[0]?.type_line || ""
  ).trim().toLowerCase();
}
function getStackSpellManaValue(stackItem) {
  const raw = Number(
    stackItem?.card?.mana_value ?? stackItem?.card?.cmc ?? stackItem?.mana_value ?? stackItem?.cmc
  );
  return Number.isFinite(raw) ? raw : null;
}
function stackSpellMatchesCopyTarget(stackItem, target, controllerId) {
  const normalizedTarget = normalizeCopyTargetText(target);
  if (!normalizedTarget || normalizedTarget === "target spell" || normalizedTarget === "that spell" || normalizedTarget === "it") {
    return true;
  }
  const typeLine = getStackSpellTypeLine(stackItem);
  if (normalizedTarget.includes("you control")) {
    const itemController = String(stackItem?.controller || stackItem?.controllerId || "").trim();
    if (itemController !== String(controllerId || "").trim()) return false;
  }
  if (normalizedTarget.includes("instant or sorcery spell") && !(typeLine.includes("instant") || typeLine.includes("sorcery"))) {
    return false;
  }
  if (normalizedTarget.includes("instant spell") && !typeLine.includes("instant")) return false;
  if (normalizedTarget.includes("sorcery spell") && !typeLine.includes("sorcery")) return false;
  if (normalizedTarget.includes("noncreature spell") && typeLine.includes("creature")) return false;
  if (normalizedTarget.includes("creature spell") && !typeLine.includes("creature")) return false;
  const manaValueMatch = normalizedTarget.match(/\bmana value\s+(\d+)\b/i);
  if (manaValueMatch) {
    const expected = Number.parseInt(String(manaValueMatch[1] || ""), 10);
    const actual = getStackSpellManaValue(stackItem);
    if (!Number.isFinite(expected) || actual === null || actual !== expected) return false;
  }
  return true;
}
function prepareCopiedSpellExecutionContext(params) {
  const { state, replaySteps, ctx } = params;
  const copiedCtx = {
    ...ctx,
    castFromZone: void 0,
    enteredFromZone: void 0
  };
  const targetMoveStep = replaySteps.find((step) => {
    if (step.kind !== "move_zone") return false;
    return Boolean(parseMoveZoneSingleTargetFromYourGraveyard(step.what));
  });
  if (!targetMoveStep) {
    return { ctx: copiedCtx, log: [] };
  }
  const criteria = parseMoveZoneSingleTargetFromYourGraveyard(targetMoveStep.what);
  if (!criteria) {
    return { ctx: copiedCtx, log: [] };
  }
  const controllerId = String(ctx.controllerId || "").trim() || ctx.controllerId;
  const player = (state.players || []).find((candidate) => String(candidate?.id || "").trim() === controllerId);
  const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
  const currentTargetId = String(ctx.targetPermanentId || ctx.targetCreatureId || "").trim();
  const currentTurn = Number(state.turnNumber ?? state.turn ?? 0) || 0;
  if (currentTargetId) {
    const currentTargetStillLegal = graveyard.some((card) => {
      const cardId = String(card?.id || "").trim();
      return cardId === currentTargetId && cardMatchesMoveZoneSingleTargetCriteria(card, criteria, void 0, currentTurn);
    });
    if (currentTargetStillLegal) {
      return { ctx: copiedCtx, log: [] };
    }
  }
  const alternativeMatches = graveyard.filter((card) => {
    const cardId = String(card?.id || "").trim();
    if (!cardId || cardId === currentTargetId) return false;
    return cardMatchesMoveZoneSingleTargetCriteria(card, criteria, void 0, currentTurn);
  });
  if (alternativeMatches.length !== 1) {
    return {
      ctx: copiedCtx,
      log: [],
      ...alternativeMatches.length > 1 ? { requiresChoice: true, candidateCount: alternativeMatches.length } : {}
    };
  }
  const retargetedId = String(alternativeMatches[0]?.id || "").trim();
  if (!retargetedId) return { ctx: copiedCtx, log: [] };
  return {
    ctx: {
      ...copiedCtx,
      targetPermanentId: retargetedId,
      targetCreatureId: retargetedId
    },
    log: [`[oracle-ir] Auto-retargeted copied spell to ${retargetedId}`]
  };
}
function parseSupportedManaCostString(rawMana) {
  const symbols = parseManaSymbols(rawMana);
  if (symbols.length === 0) return null;
  let generic = 0;
  let white = 0;
  let blue = 0;
  let black = 0;
  let red = 0;
  let green = 0;
  let colorless = 0;
  for (const symbol of symbols) {
    const upper = String(symbol || "").trim().toUpperCase();
    if (!upper) return null;
    if (/^\{\d+\}$/.test(upper)) {
      generic += Number.parseInt(upper.slice(1, -1), 10);
      continue;
    }
    switch (upper) {
      case "{W}":
        white += 1;
        break;
      case "{U}":
        blue += 1;
        break;
      case "{B}":
        black += 1;
        break;
      case "{R}":
        red += 1;
        break;
      case "{G}":
        green += 1;
        break;
      case "{C}":
        colorless += 1;
        break;
      default:
        return null;
    }
  }
  return { generic, white, blue, black, red, green, colorless };
}
function getCopiedSpellReplaySteps(card) {
  const copiedSpellText = getStackObjectOracleText(card);
  if (copiedSpellText) {
    const parsed = parseReplayStepsFromOracleText(
      copiedSpellText,
      String(card?.name || card?.card?.name || "Copied Spell")
    );
    if (parsed.length > 0) return parsed;
  }
  const typeLine = String(card?.type_line || card?.card?.type_line || "").toLowerCase();
  if (typeLine.includes("instant") || typeLine.includes("sorcery")) {
    return parseReplayStepsFromOracleText(
      `${String(card?.name || "Copied Spell")} deals 3 damage to any target.`,
      String(card?.name || "Copied Spell")
    );
  }
  return [];
}
function getCopiedStackObjectReplaySteps(stackItem, step) {
  if (!stackItem) return [];
  if (isAbilityCopyTarget(step?.target) || String(stackItem?.type || "").trim() === "ability") {
    const abilityText = getStackObjectOracleText(stackItem);
    if (!abilityText) return [];
    return parseReplayStepsFromOracleText(abilityText, getStackObjectDisplayName(stackItem));
  }
  return getCopiedSpellReplaySteps(getStackObjectCardLike(stackItem));
}
function isReplayableForThisSpellCopy(step) {
  if (step.kind !== "copy_spell") return true;
  return step.subject !== "this_spell";
}
function resolveThisSpellCopyReplaySteps(params) {
  const { steps, stepIndex, state, ctx, sourceCard } = params;
  if (Array.isArray(ctx.copyReplaySteps) && ctx.copyReplaySteps.length > 0) {
    const replayable = ctx.copyReplaySteps.filter(
      (candidate) => isReplayableForThisSpellCopy(candidate)
    );
    if (replayable.length > 0) return replayable;
  }
  if (stepIndex > 0) {
    const preceding = steps.slice(0, stepIndex).filter((candidate) => isReplayableForThisSpellCopy(candidate));
    if (preceding.length > 0) return preceding;
  }
  const followingCopySteps = steps.slice(stepIndex + 1).filter(
    (candidate) => candidate.kind === "copy_spell" && candidate.subject !== "this_spell"
  );
  if (followingCopySteps.length > 0) return followingCopySteps;
  const fromStack = getThisSpellReplayStepsFromState(state, ctx.sourceId);
  if (fromStack.length > 0) return fromStack;
  if (sourceCard) {
    const fromCard = getCopiedSpellReplaySteps(sourceCard);
    if (fromCard.length > 0) return fromCard;
  }
  return [];
}
function getThisSpellReplayStepsFromState(state, sourceId) {
  const normalizedSourceId = String(sourceId || "").trim();
  if (!normalizedSourceId) return [];
  const stackObject = getStackItems(state?.stack).find(
    (item) => String(item?.id || "").trim() === normalizedSourceId && String(item?.type || "").trim() === "spell"
  );
  if (!stackObject) return [];
  const oracleText = String(
    stackObject?.card?.oracle_text || stackObject?.spell?.oracle_text || stackObject?.oracle_text || ""
  ).trim();
  if (!oracleText) return [];
  const sourceName = String(
    stackObject?.cardName || stackObject?.card?.name || stackObject?.spell?.name || "Copied Spell"
  ).trim() || "Copied Spell";
  const copiedSpellIr = parseOracleTextToIR(oracleText, sourceName);
  return copiedSpellIr.abilities.flatMap((ability) => ability.steps).filter(
    (candidate) => candidate.kind !== "unknown" && candidate.kind !== "copy_chapter_ability" && !(candidate.kind === "copy_spell" && candidate.subject === "this_spell")
  );
}
function stackObjectMatchesCopyTarget(stackItem, target, controllerId) {
  const itemType = String(stackItem?.type || "").trim();
  if (isAbilityCopyTarget(target)) {
    return itemType === "ability" || itemType === "spell";
  }
  return itemType === "spell" && stackSpellMatchesCopyTarget(stackItem, target, controllerId);
}
function resolveCopiedTargetSpellStackItem(params) {
  const { state, step, ctx } = params;
  const directTargetId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || "").trim();
  const candidateStackObjects = getStackItems(state?.stack).filter((item) => {
    const itemId = String(item?.id || "").trim();
    return itemId && stackObjectMatchesCopyTarget(item, step.target, ctx.controllerId);
  });
  let targetSpell = directTargetId ? candidateStackObjects.find((item) => String(item?.id || "").trim() === directTargetId) : void 0;
  if (!targetSpell && directTargetId) {
    const fallback = getStackItems(state?.stack).find(
      (item) => String(item?.id || "").trim() === directTargetId
    );
    if (fallback && stackObjectMatchesCopyTarget(fallback, step.target, ctx.controllerId)) {
      targetSpell = fallback;
    } else {
      return {
        reason: "invalid_source",
        metadata: { targetSpellId: directTargetId }
      };
    }
  }
  if (!targetSpell) {
    if (candidateStackObjects.length === 1) {
      targetSpell = candidateStackObjects[0];
    } else if (candidateStackObjects.length > 1) {
      return {
        reason: "player_choice_required",
        metadata: {
          stackSpellCount: candidateStackObjects.length,
          candidateSpellIds: candidateStackObjects.map((item) => String(item?.id || "").trim()).filter(Boolean)
        }
      };
    } else {
      return {
        reason: "invalid_source",
        metadata: { stackSpellCount: 0 }
      };
    }
  }
  return { stackItem: targetSpell };
}
function bindCopiedStackSpellTargetsToContext(params) {
  const { state, stackItem, ctx } = params;
  const copiedCtx = {
    ...ctx,
    castFromZone: void 0,
    enteredFromZone: void 0
  };
  const targetDetails = Array.isArray(stackItem?.targetDetails) ? stackItem.targetDetails : [];
  const targets = Array.isArray(stackItem?.targets) ? stackItem.targets.map((target) => String(target || "").trim()).filter(Boolean) : [];
  if (targets.length !== 1) {
    return copiedCtx;
  }
  const targetId = targets[0];
  const detail = targetDetails.length === 1 ? targetDetails[0] : void 0;
  const selectorContext = { ...copiedCtx.selectorContext || {} };
  const playerIds = new Set((state.players || []).map((player) => String(player?.id || "").trim()).filter(Boolean));
  if (detail?.type === "spell") {
    selectorContext.targetSpellId = targetId;
    return {
      ...copiedCtx,
      targetSpellId: targetId,
      selectorContext
    };
  }
  if (detail?.type === "player" || playerIds.has(targetId)) {
    selectorContext.targetPlayerId = targetId;
    if (targetId !== String(copiedCtx.controllerId || "").trim()) {
      selectorContext.targetOpponentId = targetId;
    }
    return {
      ...copiedCtx,
      selectorContext
    };
  }
  return {
    ...copiedCtx,
    targetPermanentId: targetId,
    targetCreatureId: targetId,
    selectorContext
  };
}
function shouldDeferStackSpellCopyToServer(ctx, step) {
  if (!ctx?.deferStackSpellCopiesToServer) return false;
  return step.subject === "target_spell" || step.subject === "this_spell";
}
function normalizeCopyTargetId(target) {
  if (target && typeof target === "object" && !Array.isArray(target)) {
    return String(target.id || "").trim();
  }
  return String(target || "").trim();
}
function isOtherCreaturesCopyCouldTargetReference(raw) {
  return /for each other creature(?: you control)? that (?:(?:the |that )?spell|(?:that )?ability) could target/.test(raw);
}
function resolveOtherCreaturesCopyCouldTargetCount(state, controllerId, step, ctx) {
  if (step.copies?.kind !== "reference_amount") return void 0;
  const raw = String(step.copies.raw || "").trim().toLowerCase();
  if (!isOtherCreaturesCopyCouldTargetReference(raw)) return void 0;
  const targetResolution = resolveCopiedTargetSpellStackItem({
    state,
    step,
    ctx: ctx || { controllerId }
  });
  const targetStackItem = targetResolution.stackItem;
  if (!targetStackItem) return 0;
  const currentTargetIds = new Set(
    (Array.isArray(targetStackItem?.targets) ? targetStackItem.targets : []).map(normalizeCopyTargetId).filter(Boolean)
  );
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const controllerCreatures = new Set(
    battlefield.filter(
      (permanent) => String(permanent?.controller || "").trim() === String(controllerId || "").trim() && /\bcreature\b/i.test(String(permanent?.card?.type_line || permanent?.type_line || ""))
    ).map((permanent) => String(permanent?.id || "").trim()).filter(Boolean)
  );
  const validTargets = Array.isArray(targetStackItem?.copyRetargetValidTargets) ? targetStackItem.copyRetargetValidTargets : [];
  const requiresControlledCreatures = /you control/.test(raw);
  const eligibleIds = /* @__PURE__ */ new Set();
  for (const target of validTargets) {
    const targetId = normalizeCopyTargetId(target);
    if (!targetId || currentTargetIds.has(targetId)) continue;
    const targetType = String(target?.type || "").trim().toLowerCase();
    if (targetType === "player") continue;
    const battlefieldPermanent = battlefield.find(
      (permanent) => String(permanent?.id || "").trim() === targetId
    );
    const isCreature = battlefieldPermanent ? /\bcreature\b/i.test(String(battlefieldPermanent?.card?.type_line || battlefieldPermanent?.type_line || "")) : targetType === "permanent";
    if (!isCreature) continue;
    if (requiresControlledCreatures && !controllerCreatures.has(targetId)) continue;
    eligibleIds.add(targetId);
  }
  return eligibleIds.size;
}
function resolveCopySpellCount(state, controllerId, step, ctx) {
  if (!step.copies) return 1;
  if (step.copies.kind === "number") {
    return Math.max(0, Number(step.copies.value) || 0);
  }
  if (step.copies.kind === "replicate_count") {
    const sourceId = String(ctx?.sourceId || "").trim();
    if (!sourceId) return 0;
    const sourceStackObject = getStackItems(state?.stack).find(
      (item) => String(item?.type || "").trim() === "spell" && String(item?.id || "").trim() === sourceId
    );
    return Math.max(0, Number(sourceStackObject?.replicateCount || 0) || 0);
  }
  if (step.copies.kind === "spells_cast_before_this_turn") {
    const stateAny = state;
    const spellsCastThisTurn = stateAny?.spellsCastThisTurn;
    if (Array.isArray(spellsCastThisTurn)) {
      const countForController = spellsCastThisTurn.filter(
        (entry) => String(entry?.casterId || "").trim() === String(controllerId || "").trim()
      ).length;
      return Math.max(0, countForController - 1);
    }
    const totalCastThisTurn = Number(spellsCastThisTurn?.[controllerId] || 0);
    return Math.max(0, totalCastThisTurn - 1);
  }
  if (step.copies.kind === "reference_amount") {
    const raw = String(step.copies.raw || "").trim().toLowerCase();
    if (/commander.*command zone.*this game/.test(raw)) {
      return resolveCommanderCastsFromCommandZoneThisGame(state, controllerId);
    }
    const otherCreaturesCount = resolveOtherCreaturesCopyCouldTargetCount(state, controllerId, step, ctx);
    if (otherCreaturesCount !== void 0) {
      return otherCreaturesCount;
    }
    return 1;
  }
  return 0;
}
function parseRomanChapterList(text) {
  const chapterMap = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10
  };
  return String(text || "").split(/\s*,\s*/).map((part) => chapterMap[String(part || "").trim().toUpperCase()]).filter((value) => Number.isFinite(value));
}
function getCopiedChapterAbilityReplaySteps(card, chapter) {
  const oracleText = normalizeOracleText(String(card?.oracle_text || card?.card?.oracle_text || "").replace(/\r/g, "")).trim();
  if (!oracleText || !Number.isFinite(chapter) || chapter <= 0) return [];
  const lines = oracleText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([IVX]+(?:\s*,\s*[IVX]+)*)\s*[-\u2013\u2014]\s*([\s\S]+)$/i);
    if (!match) continue;
    const chapterNumbers = parseRomanChapterList(String(match[1] || ""));
    if (!chapterNumbers.includes(chapter)) continue;
    const effectText = String(match[2] || "").trim();
    if (!effectText) return [];
    const copiedIr = parseOracleTextToIR(effectText, String(card?.name || card?.card?.name || "Copied Chapter"));
    return copiedIr.abilities.flatMap((ability) => ability.steps).filter(
      (candidate) => candidate.kind !== "copy_spell" && candidate.kind !== "copy_chapter_ability" && candidate.kind !== "unknown"
    );
  }
  return [];
}
function resolveCopiedSpellSourceCards(params) {
  const { state, step, ctx, lastMovedCards } = params;
  if (step.subject === "last_moved_card") {
    if (lastMovedCards.length === 1) {
      return { cards: [lastMovedCards[0]] };
    }
    const ctxMoved = Array.isArray(params.ctx?.lastMovedCards) ? params.ctx.lastMovedCards : [];
    if (ctxMoved.length === 1) {
      return { cards: [ctxMoved[0]] };
    }
    return { reason: "invalid_source" };
  }
  if (step.subject === "linked_exiled_cards") {
    const sourceId = String(ctx.sourceId || "").trim();
    if (!sourceId) return { reason: "invalid_source" };
    const matches = findCardsExiledWithSource(state, sourceId, { cardType: "any" });
    if (matches.length === 0) return { reason: "invalid_source" };
    const replayableCards = matches.map((match) => match.card).filter((card) => getCopiedSpellReplaySteps(card).length > 0);
    if (replayableCards.length > 0) {
      return { cards: replayableCards };
    }
    const instantOrSorceryCards = matches.map((match) => match.card).filter((card) => {
      const typeLine = String(card?.type_line || card?.card?.type_line || "").trim().toLowerCase();
      return typeLine.includes("instant") || typeLine.includes("sorcery");
    });
    if (instantOrSorceryCards.length > 0) {
      return { cards: instantOrSorceryCards };
    }
    return { cards: matches.map((match) => match.card) };
  }
  return { reason: "invalid_source" };
}
function payCopiedSpellCastCost(params) {
  const { state, controllerId, card, step } = params;
  if (step.withoutPayingManaCost) return { state, log: [] };
  const rawCost = step.castCost === "mana_cost" || typeof step.castCost === "undefined" ? String(card?.mana_cost || card?.manaCost || card?.card?.mana_cost || card?.card?.manaCost || "").trim() : String(step.castCost || "").trim();
  if (!rawCost) {
    return { state, log: [], reason: "unsupported_cost" };
  }
  const manaCost = parseSupportedManaCostString(rawCost);
  if (!manaCost) {
    return { state, log: [], reason: "unsupported_cost" };
  }
  const playerIndex = (state.players || []).findIndex(
    (player2) => String(player2?.id || "").trim() === String(controllerId || "").trim()
  );
  const player = playerIndex >= 0 ? state.players[playerIndex] : null;
  const manaPoolRecord = { ...state.manaPool || {} };
  const currentPool = player?.manaPool || manaPoolRecord[controllerId] || createEmptyManaPool();
  const payment = payManaCost(currentPool, manaCost);
  if (!payment.success || !payment.remainingPool) {
    return { state, log: [], reason: "cannot_pay" };
  }
  manaPoolRecord[controllerId] = payment.remainingPool;
  const updatedPlayers = playerIndex >= 0 ? (state.players || []).map(
    (candidate, index) => index === playerIndex ? { ...candidate, manaPool: payment.remainingPool } : candidate
  ) : state.players;
  return {
    state: { ...state, manaPool: manaPoolRecord, players: updatedPlayers },
    log: [`${controllerId} pays ${rawCost} to cast the copied spell`],
    paid: true
  };
}
function buildCopiedCardId(existingIds, originalId, ordinal) {
  const base = `${originalId || "copied-spell"}-copy`;
  let suffix = ordinal;
  let candidate = `${base}-${suffix}`;
  while (existingIds.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  existingIds.add(candidate);
  return candidate;
}
function createCastableCopiedSpellCards(params) {
  const { state, controllerId, cards, step } = params;
  if (!Array.isArray(cards) || cards.length === 0) {
    return { state, createdCards: [], log: [] };
  }
  const existingIds = /* @__PURE__ */ new Set();
  for (const player of state.players) {
    for (const card of Array.isArray(player?.exile) ? player.exile : []) {
      const id = String(card?.id ?? card?.cardId ?? "").trim();
      if (id) existingIds.add(id);
    }
  }
  const playableUntilTurn = getCurrentTurnNumber(state);
  const stateAny = state;
  stateAny.playableFromExile = stateAny.playableFromExile || {};
  stateAny.playableFromExile[controllerId] = stateAny.playableFromExile[controllerId] || {};
  const createdCards = [];
  const updatedPlayers = (state.players || []).map((player) => {
    if (String(player?.id || "").trim() !== String(controllerId || "").trim()) return player;
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    cards.forEach((sourceCard, index) => {
      const base = sourceCard?.card && typeof sourceCard.card === "object" ? { ...sourceCard.card, ...sourceCard || {} } : { ...sourceCard || {} };
      const originalId = String(base?.copiedFromCardId || base?.id || base?.cardId || "").trim();
      const copyId = buildCopiedCardId(existingIds, originalId, index + 1);
      const copiedCard = {
        ...base,
        id: copyId,
        zone: "exile",
        isCopy: true,
        copiedFromCardId: originalId || void 0,
        canBePlayedBy: controllerId,
        playableUntilTurn,
        ...step.withoutPayingManaCost ? { withoutPayingManaCost: true } : {},
        ...step.castCost && step.castCost !== "mana_cost" ? { exileCastCost: step.castCost } : {}
      };
      exile.push(copiedCard);
      createdCards.push(copiedCard);
      stateAny.playableFromExile[controllerId][copyId] = playableUntilTurn;
    });
    return { ...player, exile };
  });
  return {
    state: { ...stateAny, players: updatedPlayers },
    createdCards,
    log: createdCards.length > 0 ? [`[oracle-ir] Created ${createdCards.length} castable copied spell${createdCards.length === 1 ? "" : "s"} in exile`] : []
  };
}
export {
  bindCopiedStackSpellTargetsToContext,
  createCastableCopiedSpellCards,
  getCopiedChapterAbilityReplaySteps,
  getCopiedSpellReplaySteps,
  getCopiedStackObjectReplaySteps,
  getThisSpellReplayStepsFromState,
  payCopiedSpellCastCost,
  prepareCopiedSpellExecutionContext,
  resolveCopiedSpellSourceCards,
  resolveCopiedTargetSpellStackItem,
  resolveCopySpellCount,
  resolveOtherCreaturesCopyCouldTargetCount,
  resolveThisSpellCopyReplaySteps,
  shouldDeferStackSpellCopyToServer
};

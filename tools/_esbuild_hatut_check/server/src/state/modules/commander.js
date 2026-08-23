import { shuffleLibrary, drawCards } from "./zones";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
const COLOR_SYMBOLS = ["W", "U", "B", "R", "G"];
function normalizeColorIdentitySymbols(values) {
  if (!Array.isArray(values)) return [];
  const out = /* @__PURE__ */ new Set();
  for (const raw of values) {
    const color = String(raw || "").trim().toUpperCase();
    if (COLOR_SYMBOLS.includes(color)) {
      out.add(color);
    }
  }
  return COLOR_SYMBOLS.filter((color) => out.has(color));
}
function deriveColorIdentityFromManaCost(manaCost) {
  const symbols = /* @__PURE__ */ new Set();
  const normalized = String(manaCost || "");
  for (const match of normalized.matchAll(/\{([wubrg])\}/gi)) {
    symbols.add(String(match[1] || "").toUpperCase());
  }
  return COLOR_SYMBOLS.filter((color) => symbols.has(color));
}
function deriveColorIdentityFromOracleText(oracleText) {
  const symbols = /* @__PURE__ */ new Set();
  const normalized = String(oracleText || "");
  for (const match of normalized.matchAll(/\{([wubrg])\}/gi)) {
    symbols.add(String(match[1] || "").toUpperCase());
  }
  return COLOR_SYMBOLS.filter((color) => symbols.has(color));
}
function deriveCardColorIdentity(src) {
  const explicit = normalizeColorIdentitySymbols(
    src?.color_identity ?? src?.colorIdentity ?? src?.scryfall?.color_identity
  );
  if (explicit.length > 0) return explicit;
  const fromColors = normalizeColorIdentitySymbols(src?.colors);
  if (fromColors.length > 0) return fromColors;
  const manaCost = getFrontFaceValue(src, "mana_cost") ?? src?.mana_cost;
  const fromManaCost = deriveColorIdentityFromManaCost(manaCost);
  if (fromManaCost.length > 0) return fromManaCost;
  const oracleText = getFrontFaceValue(src, "oracle_text") ?? src?.oracle_text ?? src?.text;
  return deriveColorIdentityFromOracleText(oracleText);
}
function getFrontFaceValue(src, key) {
  if (!src || typeof src !== "object") return void 0;
  if (src[key] !== void 0) return src[key];
  const frontFace = src?.card_faces?.[0] ?? src?.scryfall?.card_faces?.[0];
  if (frontFace && frontFace[key] !== void 0) return frontFace[key];
  return void 0;
}
function getCommanderImageUris(src) {
  if (!src || typeof src !== "object") return void 0;
  return src?.image_uris || src?.imageUris || src?.scryfall?.image_uris || src?.card_faces?.[0]?.image_uris || src?.scryfall?.card_faces?.[0]?.image_uris || void 0;
}
function buildCommanderCardSnapshot(src, fallbackName) {
  const cardFaces = Array.isArray(src?.card_faces) ? src.card_faces : Array.isArray(src?.scryfall?.card_faces) ? src.scryfall.card_faces : void 0;
  const layout = src?.layout ?? src?.scryfall?.layout;
  const colorIdentity = deriveCardColorIdentity(src);
  const colors = normalizeColorIdentitySymbols(src?.colors);
  return {
    id: src?.id,
    name: src?.name ?? getFrontFaceValue(src, "name") ?? fallbackName ?? src?.id,
    type_line: getFrontFaceValue(src, "type_line"),
    oracle_text: getFrontFaceValue(src, "oracle_text"),
    image_uris: getCommanderImageUris(src),
    mana_cost: getFrontFaceValue(src, "mana_cost"),
    power: getFrontFaceValue(src, "power"),
    toughness: getFrontFaceValue(src, "toughness"),
    loyalty: getFrontFaceValue(src, "loyalty"),
    card_faces: cardFaces,
    layout,
    colors: colors.length > 0 ? colors : colorIdentity.length > 0 ? colorIdentity : void 0,
    color_identity: colorIdentity.length > 0 ? colorIdentity : void 0
  };
}
function setCommander(ctx, playerId, commanderNames, commanderIds = [], colorIdentity) {
  const { commandZone, libraries, pendingInitialDraw, bumpSeq, state } = ctx;
  const zones = state.zones = state.zones || {};
  const info = commandZone[playerId] ?? { commanderIds: [], commanderNames: [], tax: 0, taxById: {}, inCommandZone: [] };
  const commanderIdsInput = Array.isArray(commanderIds) ? commanderIds : typeof commanderIds === "string" ? [commanderIds] : [];
  const commanderNamesInput = Array.isArray(commanderNames) ? commanderNames : typeof commanderNames === "string" ? [commanderNames] : [];
  const cleanCommanderIds = commanderIdsInput.filter((id) => id && typeof id === "string" && id.trim() !== "");
  const cleanCommanderNames = commanderNamesInput.filter((name) => name && typeof name === "string" && name.trim() !== "");
  if (cleanCommanderIds.length !== commanderIdsInput.length) {
    const originalCount = commanderIdsInput.length;
    const cleanedCount = cleanCommanderIds.length;
    const sample = commanderIdsInput.slice(0, 5).map((v) => typeof v === "string" ? v : `{${typeof v}}`);
    debugWarn(1, `[setCommander] Filtered out ${originalCount - cleanedCount} invalid commander IDs`, {
      originalCount,
      cleanedCount,
      originalSample: sample,
      cleaned: cleanCommanderIds
    });
  }
  info.commanderIds = cleanCommanderIds.slice();
  info.commanderNames = cleanCommanderNames.slice();
  const existingInCZ = info.inCommandZone;
  if (!existingInCZ || existingInCZ.length === 0) {
    info.inCommandZone = cleanCommanderIds.slice();
    debug(1, `[setCommander] Initialized inCommandZone for ${playerId}:`, cleanCommanderIds);
  } else {
    const updatedInCZ = existingInCZ.filter((id) => cleanCommanderIds.includes(id));
    for (const id of cleanCommanderIds) {
      if (!existingInCZ.includes(id)) {
        updatedInCZ.push(id);
      }
    }
    info.inCommandZone = updatedInCZ;
    debug(1, `[setCommander] Preserved inCommandZone for ${playerId}:`, {
      previous: existingInCZ,
      updated: updatedInCZ,
      commanderIds: cleanCommanderIds
    });
  }
  if (!info.taxById) info.taxById = {};
  for (const cid of cleanCommanderIds) {
    if (info.taxById[cid] === void 0) info.taxById[cid] = 0;
  }
  info.tax = Object.values(info.taxById || {}).reduce((a, b) => a + b, 0);
  const built = [];
  const prevCards = info.commanderCards;
  const lib = libraries.get(playerId) || [];
  for (const [index, cid] of (info.commanderIds || []).entries()) {
    let src = prevCards?.find((pc) => pc && pc.id === cid) || lib.find((c) => c?.id === cid) || (ctx.state.battlefield || []).find((b) => b.card?.id === cid)?.card;
    if (src) {
      built.push(buildCommanderCardSnapshot(src, commanderNames?.[index] ?? cid));
    } else {
      const placeholderName = commanderNames?.[index] ?? cid;
      const placeholder = { id: cid, name: placeholderName };
      const fromParam = normalizeColorIdentitySymbols(colorIdentity);
      if (fromParam.length > 0) {
        placeholder.color_identity = fromParam;
        placeholder.colors = fromParam;
      }
      built.push(placeholder);
    }
  }
  if (Array.isArray(colorIdentity) && colorIdentity.length > 0) {
    const fromParam = normalizeColorIdentitySymbols(colorIdentity);
    for (const card of built) {
      if (!card.color_identity?.length) {
        card.color_identity = fromParam;
        card.colors = card.colors?.length ? card.colors : fromParam;
      }
    }
  }
  if (lib && lib.length) {
    let changed = false;
    const indicesToRemove = [];
    debug(2, `[setCommander] Library size before commander removal: ${lib.length}, Commander IDs to remove:`, info.commanderIds);
    for (const cid of info.commanderIds || []) {
      const idx = lib.findIndex((c) => c && c.id === cid);
      if (idx >= 0) {
        const cardName = lib[idx]?.name || "unknown";
        debug(2, `[setCommander] Found commander "${cardName}" (${cid}) in library at index ${idx}`);
        indicesToRemove.push(idx);
      } else {
        debugWarn(2, `[setCommander] Commander ${cid} not found in library (library size: ${lib.length}). This may indicate a card ID mismatch.`);
        const sample = lib.slice(0, 5).map((c) => ({ id: c?.id, name: c?.name }));
        debugWarn(2, `[setCommander] First 5 cards in library:`, JSON.stringify(sample));
      }
    }
    const uniqueIndices = Array.from(new Set(indicesToRemove));
    if (uniqueIndices.length !== indicesToRemove.length) {
      debugError(1, `[setCommander] Duplicate indices detected! Original:`, indicesToRemove, `Unique:`, uniqueIndices);
      indicesToRemove.length = 0;
      indicesToRemove.push(...uniqueIndices);
    }
    if (indicesToRemove.length > 0) {
      indicesToRemove.sort((a, b) => b - a);
      debug(2, `[setCommander] Removing ${indicesToRemove.length} commander(s) from library at indices:`, indicesToRemove, `library size before: ${lib.length}`);
      for (const idx of indicesToRemove) {
        const removed = lib.splice(idx, 1)[0];
        debug(2, `[setCommander] Removed card at index ${idx}: ${removed?.name} (${removed?.id})`);
        changed = true;
      }
      debug(2, `[setCommander] Library size after removal: ${lib.length}`);
    } else {
      debugWarn(2, `[setCommander] No commanders found in library to remove. Commanders may have already been removed or IDs don't match.`);
    }
    if (changed) {
      libraries.set(playerId, lib);
      zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: lib.length, graveyard: [], graveyardCount: 0 };
      zones[playerId].libraryCount = lib.length;
      debug(2, `[setCommander] Updated zones[${playerId}].libraryCount to ${lib.length}`);
    }
  } else {
    debug(2, `[setCommander] Library is empty or null for player ${playerId}`);
  }
  try {
    const stateAny = state;
    if (String(stateAny?.phase) === "pre_game") {
      stateAny.startingLibraryCountByPlayer = stateAny.startingLibraryCountByPlayer || {};
      if (typeof stateAny.startingLibraryCountByPlayer[playerId] !== "number") {
        const z = zones[playerId] || null;
        const handCount = z ? typeof z.handCount === "number" ? z.handCount : Array.isArray(z.hand) ? z.hand.length : 0 : 0;
        if (handCount === 0) {
          stateAny.startingLibraryCountByPlayer[playerId] = (libraries.get(playerId) || []).length;
        }
      }
      if (typeof stateAny.minimumLibrarySize !== "number") {
        const fmt = String(stateAny?.format ?? "commander").toLowerCase();
        stateAny.minimumLibrarySize = fmt === "commander" ? 99 : 60;
      }
    }
  } catch {
  }
  info.commanderCards = built;
  commandZone[playerId] = info;
  if (state && state.commandZone) {
    state.commandZone[playerId] = info;
  }
  if (!ctx.isReplaying) {
    if (pendingInitialDraw && pendingInitialDraw.has(playerId)) {
      try {
        const z = zones[playerId] || null;
        const handCount = z ? typeof z.handCount === "number" ? z.handCount : Array.isArray(z.hand) ? z.hand.length : 0 : 0;
        if (handCount === 0) {
          shuffleLibrary(ctx, playerId);
          const drawn = drawCards(ctx, playerId, 7);
          pendingInitialDraw.delete(playerId);
          bumpSeq();
        } else {
          pendingInitialDraw.delete(playerId);
          bumpSeq();
        }
      } catch (err) {
        debugWarn(1, "setCommander: failed to perform opening draw for", playerId, err);
      }
    } else {
      try {
        const stateAny = state;
        const phase = String(stateAny?.phase || "").trim().toLowerCase();
        const isPreGame = phase === "" || phase === "pre_game" || phase.includes("pre");
        if (isPreGame) {
          const z = zones[playerId] || null;
          const handCount = z ? typeof z.handCount === "number" ? z.handCount : Array.isArray(z.hand) ? z.hand.length : 0 : 0;
          const libraryCount = (libraries.get(playerId) || []).length;
          if (handCount === 0 && libraryCount > 0) {
            shuffleLibrary(ctx, playerId);
            drawCards(ctx, playerId, 7);
          }
        }
      } catch (err) {
        debugWarn(1, "setCommander: pre-game opening draw safety net failed for", playerId, err);
      }
      bumpSeq();
    }
  } else {
    bumpSeq();
  }
}
function castCommander(ctx, playerId, commanderId) {
  debug(1, `[castCommander] Called with playerId: ${playerId}, commanderId: ${commanderId}`);
  const { commandZone, bumpSeq, state } = ctx;
  const stateCommandZone = state?.commandZone || {};
  const info = commandZone[playerId] ?? stateCommandZone[playerId] ?? { commanderIds: [], tax: 0, taxById: {}, inCommandZone: [] };
  debug(1, `[castCommander] Commander info for player ${playerId}:`, {
    commanderIds: info.commanderIds,
    inCommandZone: info.inCommandZone,
    tax: info.tax,
    taxById: info.taxById
  });
  const inCZ = info.inCommandZone || [];
  if (!inCZ.includes(commanderId)) {
    debugWarn(1, `[castCommander] Commander ${commanderId} is not in command zone for player ${playerId}. inCommandZone:`, inCZ);
    return;
  }
  info.inCommandZone = inCZ.filter((id) => id !== commanderId);
  debug(1, `[castCommander] Removed commander ${commanderId} from command zone. Remaining in CZ:`, info.inCommandZone);
  if (!info.taxById) info.taxById = {};
  info.taxById[commanderId] = (info.taxById[commanderId] ?? 0) + 2;
  info.tax = Object.values(info.taxById).reduce((a, b) => a + b, 0);
  commandZone[playerId] = info;
  if (state && state.commandZone) {
    state.commandZone[playerId] = info;
  }
  if (state) {
    const castsMap = state.commanderCastsFromCommandZoneThisGame ||= {};
    castsMap[playerId] = (Number(castsMap[playerId]) || 0) + 1;
  }
  debug(1, `[castCommander] Updated tax for ${commanderId}: ${info.taxById[commanderId]}, total tax: ${info.tax}`);
  bumpSeq();
}
function moveCommanderToCZ(ctx, playerId, commanderId) {
  const { commandZone, bumpSeq, state } = ctx;
  const stateCommandZone = state?.commandZone || {};
  const info = commandZone[playerId] ?? stateCommandZone[playerId] ?? { commanderIds: [], tax: 0, taxById: {}, inCommandZone: [] };
  if (!info.commanderIds.includes(commanderId)) {
    debugWarn(2, `[moveCommanderToCZ] ${commanderId} is not a commander for player ${playerId}`);
    return;
  }
  const inCZ = info.inCommandZone || [];
  if (!inCZ.includes(commanderId)) {
    inCZ.push(commanderId);
    info.inCommandZone = inCZ;
    debug(2, `[moveCommanderToCZ] Added commander ${commanderId} back to command zone for player ${playerId}`);
  }
  commandZone[playerId] = info;
  if (state && state.commandZone) {
    state.commandZone[playerId] = info;
  }
  if (state && Array.isArray(state.battlefield)) {
    const before = state.battlefield.length;
    state.battlefield = state.battlefield.filter((perm) => {
      const cardId = String(perm?.card?.id || "").trim();
      if (cardId && cardId === String(commanderId)) {
        debugWarn(1, `[moveCommanderToCZ] Removed BF permanent for commander returned to CZ`, {
          playerId,
          commanderId,
          permanentId: perm?.id,
          name: perm?.card?.name
        });
        return false;
      }
      return true;
    });
    if (state.battlefield.length !== before) {
      debug(1, `[moveCommanderToCZ] Purged ${before - state.battlefield.length} BF ghost(s) for ${commanderId}`);
    }
  }
  ctx.bumpSeq();
}
function reconcileCommandZoneZoneConsistency(state) {
  let removedBattlefield = 0;
  let removedStack = 0;
  if (!state || typeof state !== "object") {
    return { removedBattlefield, removedStack };
  }
  const commandZone = state.commandZone;
  if (!commandZone || typeof commandZone !== "object") {
    return { removedBattlefield, removedStack };
  }
  const idsInCommandZone = /* @__PURE__ */ new Set();
  for (const entry of Object.values(commandZone)) {
    const inCZ = Array.isArray(entry?.inCommandZone) ? entry.inCommandZone : [];
    for (const id of inCZ) {
      const normalized = String(id || "").trim();
      if (normalized) idsInCommandZone.add(normalized);
    }
  }
  if (idsInCommandZone.size === 0) {
    return { removedBattlefield, removedStack };
  }
  const idsOf = (entry) => {
    const entryCard = entry?.card || entry?.spell?.card;
    return [
      String(entry?.id || "").trim(),
      String(entryCard?.id || "").trim()
    ].filter(Boolean);
  };
  if (Array.isArray(state.battlefield)) {
    const before = state.battlefield.length;
    state.battlefield = state.battlefield.filter((entry) => {
      const ids = idsOf(entry);
      if (ids.some((id) => idsInCommandZone.has(id))) {
        debugWarn(1, `[reconcileCommandZoneZoneConsistency] Removing BF ghost also listed inCommandZone`, {
          permanentId: entry?.id,
          cardId: entry?.card?.id,
          name: entry?.card?.name || entry?.name,
          isCommander: entry?.isCommander === true,
          isToken: entry?.isToken === true
        });
        return false;
      }
      return true;
    });
    removedBattlefield = before - state.battlefield.length;
  }
  if (Array.isArray(state.stack)) {
    const before = state.stack.length;
    state.stack = state.stack.filter((entry) => {
      const entryType = String(entry?.type || "").toLowerCase();
      if (entryType && entryType !== "spell") return true;
      const ids = idsOf(entry);
      if (ids.some((id) => idsInCommandZone.has(id))) {
        debugWarn(1, `[reconcileCommandZoneZoneConsistency] Removing stack spell ghost also listed inCommandZone`, {
          stackId: entry?.id,
          cardId: entry?.card?.id || entry?.spell?.card?.id,
          name: entry?.card?.name || entry?.spell?.card?.name
        });
        return false;
      }
      return true;
    });
    removedStack = before - state.stack.length;
  }
  return { removedBattlefield, removedStack };
}
export {
  buildCommanderCardSnapshot,
  castCommander,
  deriveCardColorIdentity,
  getCommanderImageUris,
  moveCommanderToCZ,
  reconcileCommandZoneZoneConsistency,
  setCommander
};

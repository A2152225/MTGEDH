import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { debug } from "../../../utils/debug.js";
import { getActualPowerToughness, uid } from "../../utils.js";
import { drawCards as drawCardsFromZone, movePermanentToHand, movePermanentToLibrary } from "../../modules/zones.js";
import { createToken, movePermanentToExile, movePermanentToGraveyard, updateCounters } from "../../modules/counters_tokens.js";
import { applyTemporaryLandBonus } from "../../modules/game-state-effects.js";
import { addExtraTurn, nextTurn } from "../../modules/turn.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";
import { permanentHasCreatureTypeNow } from "../../creatureTypeNow.js";
import { getPlaneswalkerTemplateMatch } from "./registry.js";
import { getBattlefield, getGameId, getPlaneswalkerX, getTargets, modifyLifeLikeStack, normalizeOracleEffectText, parseCountTokenWord, parseCreateTokenDescriptor } from "./utils.js";

function shuffleInPlace<T>(arr: T[], rng: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

function isNonAuraPermanentCard(card: any): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (!typeLine) return false;

  // Explicitly exclude Auras.
  if (typeLine.includes('aura')) return false;

  // Permanent types.
  return (
    typeLine.includes('artifact') ||
    typeLine.includes('creature') ||
    typeLine.includes('enchantment') ||
    typeLine.includes('land') ||
    typeLine.includes('planeswalker') ||
    typeLine.includes('battle')
  );
}

function restartGameWithKarnExemptions(
  ctx: GameContext,
  restartingPlayer: PlayerID,
  sourcePermanentId: string
): { preservedCount: number } {
  const state = (ctx as any).state;
  if (!state) return { preservedCount: 0 };

  const gameId = getGameId(ctx);
  if (gameId && gameId !== 'unknown') {
    try {
      // Restart should clear any pending interactions.
      ResolutionQueueManager.clearAllSteps(gameId);
    } catch {
      // best-effort
    }
  }

  // Clear runtime scheduled steps.
  (ctx as any)._scheduledStepsAfterCurrent = [];
  (ctx as any)._scheduledEndOfTurnSteps = [];

  // Reset stack and combat / misc flags.
  state.stack = [];
  state.emblems = [];
  state.pendingFlickerReturns = [];
  state.extraTurns = [];
  state.playableFromExile = {};
  state.blockersDeclaredBy = undefined;
  delete (state as any).pendingCommanderZoneChoice;
  state.stepAdvanceBlocked = undefined;
  state.noncreatureSpellsCastThisTurn = {};
  state.autoPassForTurn = {};
  state.landsPlayedThisTurn = {};
  (ctx as any).landsPlayedThisTurn = state.landsPlayedThisTurn;
  (ctx as any).manaPool = {};
  if ((ctx as any).passesInRow && typeof (ctx as any).passesInRow === 'object') {
    (ctx as any).passesInRow.value = 0;
  }

  // Reset inactive / hasLost flags.
  if ((ctx as any).inactive instanceof Set) {
    (ctx as any).inactive = new Set();
  }
  for (const p of state.players || []) {
    if (p) (p as any).hasLost = false;
  }

  const zones = (state.zones = state.zones || {});
  const libraries = (ctx as any).libraries as Map<PlayerID, any[]>;
  const commandZone = (ctx as any).commandZone || (state.commandZone = state.commandZone || {});

  const playerIds: PlayerID[] = Array.isArray(state.players)
    ? (state.players.map((p: any) => p?.id).filter(Boolean) as PlayerID[])
    : [];

  // Collect and remove exempted cards from exile.
  const preserved: Array<{ ownerId: PlayerID; card: any }> = [];
  for (const pid of playerIds) {
    const z = zones[pid] || (zones[pid] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
    const exile: any[] = Array.isArray((z as any).exile) ? (z as any).exile : [];
    const remaining: any[] = [];
    for (const c of exile) {
      const exiledWith = String((c as any)?.exiledWithSourceId || '');
      if (exiledWith && exiledWith === sourcePermanentId && isNonAuraPermanentCard(c)) {
        preserved.push({ ownerId: pid, card: c });
        continue;
      }
      remaining.push(c);
    }
    (z as any).exile = remaining;
    (z as any).exileCount = remaining.length;
  }

  // Commander IDs to keep out of libraries.
  const commanderIdsByPlayer: Record<string, Set<string>> = {};
  for (const pid of playerIds) {
    const info = commandZone?.[pid];
    const commanderIds: string[] = Array.isArray(info?.commanderIds) ? info.commanderIds : [];
    commanderIdsByPlayer[pid] = new Set(commanderIds.filter(Boolean));

    // On restart, all commanders are back in the command zone and tax resets.
    if (info) {
      (info as any).inCommandZone = commanderIds.slice();
      (info as any).taxById = {};
      (info as any).tax = 0;
    }
  }

  // Sweep battlefield into libraries (tokens cease).
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const toLibraryByPlayer: Record<string, any[]> = {};
  for (const pid of playerIds) toLibraryByPlayer[pid] = [];

  for (const perm of battlefield) {
    if (!perm?.card) continue;
    if ((perm as any).isToken === true) continue;

    const ownerId = perm.owner as PlayerID;
    if (!ownerId || !toLibraryByPlayer[ownerId]) continue;

    const cid = String((perm.card as any).id || '');
    if (cid && commanderIdsByPlayer[ownerId]?.has(cid)) {
      continue; // commanders return to command zone
    }

    toLibraryByPlayer[ownerId].push({ ...(perm.card as any), zone: 'library' });
  }

  // Clear battlefield.
  state.battlefield = [];

  // Sweep zones + existing library into libraries.
  for (const pid of playerIds) {
    const z = zones[pid] || (zones[pid] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
    const commanderIds = commanderIdsByPlayer[pid] || new Set<string>();

    const existingLib: any[] = Array.isArray(libraries?.get?.(pid)) ? (libraries.get(pid) as any[]) : [];
    for (const c of existingLib) {
      const cid = String((c as any)?.id || '');
      if (cid && commanderIds.has(cid)) continue;
      toLibraryByPlayer[pid].push({ ...(c as any), zone: 'library' });
    }

    const sweepZone = (zoneName: 'hand' | 'graveyard' | 'exile') => {
      const arr: any[] = Array.isArray((z as any)[zoneName]) ? (z as any)[zoneName] : [];
      for (const c of arr) {
        const cid = String((c as any)?.id || '');
        if (cid && commanderIds.has(cid)) continue;
        toLibraryByPlayer[pid].push({ ...(c as any), zone: 'library' });
      }
      (z as any)[zoneName] = [];
      (z as any)[`${zoneName}Count`] = 0;
    };

    sweepZone('hand');
    sweepZone('graveyard');
    sweepZone('exile');

    // Set and shuffle new library.
    const newLib = toLibraryByPlayer[pid];
    shuffleInPlace(newLib, typeof (ctx as any).rng === 'function' ? (ctx as any).rng : Math.random);
    libraries.set(pid, newLib);
    (z as any).libraryCount = newLib.length;
  }

  // Reset life/poison/experience.
  state.life = state.life || {};
  const startingLife = state.startingLife ?? 40;
  for (const pid of playerIds) {
    state.life[pid] = startingLife;
    const playerObj = (state.players || []).find((p: any) => p?.id === pid);
    if (playerObj) (playerObj as any).life = startingLife;

    if ((ctx as any).poison) (ctx as any).poison[pid] = 0;
    if ((ctx as any).experience) (ctx as any).experience[pid] = 0;

    // New opening hands: 7 cards.
    drawCardsFromZone(ctx as any, pid, 7);
  }

  // Starting player takes the first turn of the restarted game.
  state.turnNumber = 0;
  const idx = playerIds.indexOf(restartingPlayer);
  const prev = idx > 0 ? playerIds[idx - 1] : playerIds[playerIds.length - 1];
  state.turnPlayer = prev;
  state.priority = null;

  // Initialize beginning of first turn via engine's nextTurn.
  try {
    nextTurn(ctx as any);
  } catch {
    // If something goes wrong, at least keep the game out of pre_game.
    state.phase = 'beginning';
    state.step = 'UPKEEP';
    state.turnPlayer = restartingPlayer;
    state.priority = restartingPlayer;
  }

  // Put preserved non-Aura permanents onto battlefield under restarting player's control.
  for (const entry of preserved) {
    const card = entry.card;
    const typeLineLower = String(card?.type_line || '').toLowerCase();
    const isCreature = typeLineLower.includes('creature');
    const isPlaneswalker = typeLineLower.includes('planeswalker');

    const newPermanent: any = {
      id: uid('perm'),
      card: { ...(card as any), zone: 'battlefield' },
      controller: restartingPlayer,
      owner: entry.ownerId,
      tapped: false,
      summoning_sickness: isCreature,
      counters: {},
      attachedTo: undefined,
    };

    if (isPlaneswalker && (card as any)?.loyalty) {
      const loyaltyValue = parseInt((card as any).loyalty, 10);
      if (!Number.isNaN(loyaltyValue)) {
        newPermanent.counters = { ...newPermanent.counters, loyalty: loyaltyValue };
        newPermanent.loyalty = loyaltyValue;
        newPermanent.baseLoyalty = loyaltyValue;
      }
    }

    state.battlefield.push(newPermanent);
  }

  ;(ctx as any).bumpSeq?.();
  return { preservedCount: preserved.length };
}

function parseTokenDescriptorToTypeLineAndColors(rawDescriptor: string): {
  typeLine: string;
  colors: string[];
  isArtifact: boolean;
} {
  const d = String(rawDescriptor || "");
  const lower = d.toLowerCase();

  const colors: string[] = [];
  if (lower.includes("white")) colors.push("W");
  if (lower.includes("blue")) colors.push("U");
  if (lower.includes("black")) colors.push("B");
  if (lower.includes("red")) colors.push("R");
  if (lower.includes("green")) colors.push("G");
  // "colorless" => no color symbols

  const parts: string[] = ["Token"];
  if (lower.includes("legendary")) parts.push("Legendary");

  const typeOrder: Array<{ key: string; label: string }> = [
    { key: "artifact", label: "Artifact" },
    { key: "enchantment", label: "Enchantment" },
    { key: "creature", label: "Creature" },
    { key: "planeswalker", label: "Planeswalker" },
    { key: "land", label: "Land" },
  ];

  for (const t of typeOrder) {
    if (lower.includes(t.key)) parts.push(t.label);
  }

  const isArtifact = lower.includes("artifact");

  let typeLine = parts.join(" ");

  // Preserve explicit subtypes if present (em dash)
  const dashIdx = d.indexOf("—");
  if (dashIdx >= 0) {
    const sub = d.slice(dashIdx + 1).trim();
    if (sub) typeLine = `${typeLine} — ${sub}`;
  }

  return { typeLine, colors, isArtifact };
}

function extractQuotedAbilities(text: string): string[] {
  const abilities: string[] = [];
  const rx = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    const a = String(m[1] || "").trim();
    if (a) abilities.push(a);
  }
  return abilities;
}

function getPlayerById(ctx: GameContext, playerId: PlayerID): any {
  const players = ((ctx as any).state?.players as any[]) || [];
  return players.find((p: any) => p?.id === playerId) || null;
}

function getOpponents(ctx: GameContext, controller: PlayerID): PlayerID[] {
  const players = ((ctx as any).state?.players as any[]) || [];
  return players.map((p: any) => p?.id).filter((id: any) => id && id !== controller);
}

function getOrInitManaPool(state: any, playerId: PlayerID): any {
  state.manaPool = state.manaPool || {};
  const pool = (state.manaPool[playerId] = state.manaPool[playerId] || {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
    generic: 0,
    restricted: [],
  });
  if (!Array.isArray((pool as any).restricted)) (pool as any).restricted = [];
  return pool;
}

function addRestrictedMana(
  state: any,
  playerId: PlayerID,
  color: "white" | "blue" | "black" | "red" | "green" | "colorless",
  amount: number,
  restriction: any,
  sourceId?: string,
  sourceName?: string
) {
  if (amount <= 0) return;
  const pool = getOrInitManaPool(state, playerId);
  const restricted: any[] = (pool as any).restricted;
  const existing = restricted.find(
    (e) => e?.type === color && e?.restriction === restriction && e?.sourceId === sourceId
  );
  if (existing) {
    existing.amount = (existing.amount || 0) + amount;
  } else {
    restricted.push({ type: color, amount, restriction, sourceId, sourceName });
  }
}

function addUnrestrictedManaSymbols(state: any, playerId: PlayerID, symbols: string) {
  const pool = getOrInitManaPool(state, playerId);
  const parts = String(symbols || "")
    .trim()
    .match(/\{[WUBRGC]\}/g);
  if (!parts) return;

  for (const sym of parts) {
    switch (sym) {
      case "{W}":
        pool.white++;
        break;
      case "{U}":
        pool.blue++;
        break;
      case "{B}":
        pool.black++;
        break;
      case "{R}":
        pool.red++;
        break;
      case "{G}":
        pool.green++;
        break;
      case "{C}":
        pool.colorless++;
        break;
    }
  }
}

function isCreatureOfSubtype(perm: any, subtypeLower: string): boolean {
  const typeLine = String(perm?.card?.type_line || "").toLowerCase();
  if (!typeLine.includes("creature")) return false;
  // Very simple subtype check: match substring after em dash.
  return typeLine.includes(subtypeLower);
}

function millCards(ctx: GameContext, playerId: PlayerID, count: number): any[] {
  const state = (ctx as any).state;
  const zones = state?.zones || {};
  const lib: any[] = zones[playerId]?.library || [];
  const gy: any[] = zones[playerId]?.graveyard || [];
  const actual = Math.max(0, Math.min(count | 0, lib.length));
  const milled = lib.splice(0, actual);
  gy.unshift(...milled);
  zones[playerId].libraryCount = lib.length;
  zones[playerId].graveyardCount = gy.length;
  return milled;
}

function destroyPermanents(ctx: GameContext, permanentIds: string[]) {
  for (const id of permanentIds) {
    movePermanentToGraveyard(ctx, id, true);
  }
}

function exilePermanents(ctx: GameContext, permanentIds: string[]) {
  for (const id of permanentIds) {
    movePermanentToExile(ctx, id);
  }
}

function applyDamageToPlayer(ctx: GameContext, playerId: PlayerID, amount: number) {
  modifyLifeLikeStack(ctx, playerId, -Math.max(0, amount | 0));
}

function applyDamageToPermanent(ctx: GameContext, permanentId: string, amount: number) {
  const battlefield = getBattlefield(ctx);
  const perm = battlefield.find((p: any) => p?.id === permanentId);
  if (!perm) return;

  const dmg = Math.max(0, amount | 0);
  // Track excess damage (best-effort): damage beyond remaining toughness in this event.
  try {
    const stateAny = (ctx as any).state as any;
    const tl = String(perm?.card?.type_line || '').toLowerCase();
    const isCreature = tl.includes('creature');
    if (isCreature) {
      const toughness = parseInt(String((perm as any).baseToughness ?? perm?.card?.toughness ?? '0'), 10) || 0;
      const prev = (perm as any).damageMarked || 0;
      const remaining = Math.max(0, toughness - prev);
      if (remaining > 0 && dmg > remaining) {
        stateAny.excessDamageThisTurnByCreatureId = stateAny.excessDamageThisTurnByCreatureId || {};
        stateAny.excessDamageThisTurnByCreatureId[String(permanentId)] = true;
        (perm as any).wasDealtExcessDamageThisTurn = true;
      }
    }
  } catch {}
  (perm as any).damageMarked = ((perm as any).damageMarked || 0) + dmg;
  (perm as any).damageThisTurn = ((perm as any).damageThisTurn || 0) + dmg;
  (perm as any).tookDamageThisTurn = true;
}

function permanentHasKeyword(perm: any, keywordLower: string): boolean {
  const kw = String(keywordLower || '').toLowerCase().trim();
  if (!kw) return false;

  const cardKeywords: any[] = Array.isArray(perm?.card?.keywords) ? perm.card.keywords : [];
  if (cardKeywords.some((k: any) => String(k || '').toLowerCase().trim() === kw)) return true;

  const granted: any[] = Array.isArray(perm?.grantedAbilities) ? perm.grantedAbilities : [];
  if (granted.some((a: any) => String(a || '').toLowerCase().includes(kw))) return true;

  const temporary: any[] = Array.isArray(perm?.temporaryAbilities) ? perm.temporaryAbilities : [];
  if (temporary.some((t: any) => String(t?.ability || '').toLowerCase().includes(kw))) return true;

  // Best-effort fallback: oracle text contains the keyword as a word.
  const oracle = String(perm?.card?.oracle_text || '').toLowerCase();
  if (oracle && new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(oracle)) return true;

  return false;
}

function getControlConstraint(effectTextLower: string): 'you' | 'not_you' | null {
  if (effectTextLower.includes('you control')) return 'you';
  if (effectTextLower.includes("you don't control") || effectTextLower.includes('an opponent controls') || effectTextLower.includes('opponent controls')) {
    return 'not_you';
  }
  return null;
}

function getManaValueConstraint(effectTextLower: string): { op: '<=' | '>='; value: number } | null {
  const m = effectTextLower.match(/mana value (\d+) or (less|greater)/i);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  if (!Number.isFinite(value)) return null;
  const op = m[2].toLowerCase() === 'less' ? '<=' : '>=';
  return { op, value };
}

function satisfiesManaValueConstraint(cardOrPerm: any, mv: { op: '<=' | '>='; value: number } | null): boolean {
  if (!mv) return true;
  const raw = (cardOrPerm as any)?.card?.cmc ?? (cardOrPerm as any)?.cmc;
  const cmc = typeof raw === 'number' ? raw : Number(raw ?? NaN);
  if (!Number.isFinite(cmc)) return false;
  return mv.op === '<=' ? cmc <= mv.value : cmc >= mv.value;
}

function normalizeCardNameForCompare(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toAvailableCard(card: any) {
  return {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    power: (card as any).power,
    toughness: (card as any).toughness,
    loyalty: (card as any).loyalty,
  };
}

/**
 * Best-effort lookup of the planeswalker's color set (Scryfall-style `colors`/`color_identity`).
 * Used for templates like "shares a color with this planeswalker".
 */
function getSourcePlaneswalkerColors(ctx: GameContext, controller: PlayerID, sourceName: string, triggerItem: any): string[] {
  const battlefield = getBattlefield(ctx);
  const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || triggerItem?.source;

  const sourcePerm =
    (sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null) ||
    battlefield.find((p: any) =>
      p?.controller === controller &&
      String(p?.card?.name || '').toLowerCase() === String(sourceName || '').toLowerCase() &&
      String(p?.card?.type_line || '').toLowerCase().includes('planeswalker')
    );

  const rawColors: unknown = sourcePerm?.card?.colors ?? sourcePerm?.card?.color_identity;
  const colors = Array.isArray(rawColors) ? rawColors.map(c => String(c || '').toUpperCase()).filter(Boolean) : [];
  return Array.from(new Set(colors));
}

const predefinedArtifactTokens: Record<
  string,
  { name: string; typeLine: string; abilities: string[]; colors: string[] }
> = {
  food: {
    name: "Food",
    typeLine: "Token Artifact — Food",
    abilities: ["{2}, {T}, Sacrifice this artifact: You gain 3 life."],
    colors: [],
  },
  treasure: {
    name: "Treasure",
    typeLine: "Token Artifact — Treasure",
    abilities: ["{T}, Sacrifice this artifact: Add one mana of any color."],
    colors: [],
  },
  clue: {
    name: "Clue",
    typeLine: "Token Artifact — Clue",
    abilities: ["{2}, Sacrifice this artifact: Draw a card."],
    colors: [],
  },
  map: {
    name: "Map",
    typeLine: "Token Artifact — Map",
    abilities: ["{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery."],
    colors: [],
  },
  blood: {
    name: "Blood",
    typeLine: "Token Artifact — Blood",
    abilities: ["{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card."],
    colors: [],
  },
  gold: {
    name: "Gold",
    typeLine: "Token Artifact — Gold",
    abilities: ["Sacrifice this artifact: Add one mana of any color."],
    colors: [],
  },
  powerstone: {
    name: "Powerstone",
    typeLine: "Token Artifact — Powerstone",
    abilities: ["{T}: Add {C}. This mana can't be spent to cast a nonartifact spell."],
    colors: [],
  },
  shard: {
    name: "Shard",
    typeLine: "Token Artifact — Shard",
    abilities: ["{2}, {T}, Sacrifice this artifact: Draw a card."],
    colors: [],
  },
};

export function tryResolvePlaneswalkerLoyaltyTemplate(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  effectText: string,
  triggerItem: any
): boolean {
  const match = getPlaneswalkerTemplateMatch(effectText);
  if (!match) return false;

  const state = (ctx as any).state;
  const text = normalizeOracleEffectText(effectText);

  switch (match.id) {
    case "FALLBACK_MANUAL_RESOLUTION": {
      const gameId = getGameId(ctx);
      const sourceId = String((triggerItem as any)?.source || "");
      const description = `[Manual planeswalker resolution] ${sourceName}: ${text}`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown') {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceId,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        });
      }

      return true;
    }

    case "HEAD_TO_ASKURZA_COM_AND_CLICK_N": {
      const m = text.match(/^head to askurza\.com and click ([+-]\d+)\.?$/i);
      if (!m) return false;

      const click = String(m[1] || '').trim();
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Head to AskUrza.com and click ${click}.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "ACCEPT_ONE_OF_DAVRIELS_OFFERS_THEN_ACCEPT_ONE_OF_DAVRIELS_CONDITIONS": {
      const m = text.match(/^accept one of davriel's offers, then accept one of davriel's conditions\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Accept one of Davriel's offers, then accept one of Davriel's conditions.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "CHOOSE_LEFT_OR_RIGHT_UNTIL_YOUR_NEXT_TURN_ATTACK_NEAREST_OPPONENT": {
      const m = text.match(
        /^choose left or right\. until your next turn, each player may attack only the nearest opponent in the last chosen direction and planeswalkers controlled by that opponent\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Choose left or right, then apply the attack restriction until your next turn.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MODAL_CHOICE,
          playerId: controller,
          description,
          mandatory: true,
          sourceName,
          promptTitle: 'Choose Direction',
          promptDescription: 'Choose left or right (manual rules enforcement).',
          options: [
            { id: 'left', label: 'Left' },
            { id: 'right', label: 'Right' },
          ],
          minSelections: 1,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "CHOOSE_LEFT_OR_RIGHT_EACH_PLAYER_GAINS_CONTROL_NONLAND_PERMANENTS": {
      const m = text.match(
        /^choose left or right\. each player gains control of all nonland permanents other than [a-z0-9 ,'-]+ controlled by the next player in the chosen direction\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Choose left or right, then each player gains control of all nonland permanents (except ${sourceName}) as described.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MODAL_CHOICE,
          playerId: controller,
          description,
          mandatory: true,
          sourceName,
          promptTitle: 'Choose Direction',
          promptDescription: 'Choose left or right (manual rules enforcement).',
          options: [
            { id: 'left', label: 'Left' },
            { id: 'right', label: 'Right' },
          ],
          minSelections: 1,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "TARGET_CREATURE_AN_OPPONENT_CONTROLS_PERPETUALLY_GETS_MINUS3_MINUS3": {
      const m = text.match(/^target creature an opponent controls perpetually gets -3\/-3\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Target creature an opponent controls perpetually gets -3/-3.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "UNTAP_UP_TO_ONE_TARGET_ELF_THAT_ELF_AND_RANDOM_ELF_IN_HAND_PERPETUALLY_GET_P1P1": {
      const m = text.match(
        /^untap up to one target elf\. that elf and a random elf creature card in your hand perpetually get \+1\/\+1\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Untap up to one target Elf. That Elf and a random Elf creature card in your hand perpetually get +1/+1.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "SEEK_AN_ELF_CARD": {
      const m = text.match(/^seek an elf card\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Seek an Elf card.`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "CONJURE_A_CARD_NAMED_ONTO_THE_BATTLEFIELD": {
      const m = text.match(/^conjure a card named ([^\.]+?) onto the battlefield\.?$/i);
      if (!m) return false;

      const cardName = String(m[1] || '').trim();
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Conjure a card named ${cardName} onto the battlefield.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "CONJURE_A_CARD_NAMED_INTO_YOUR_HAND": {
      const m = text.match(/^conjure a card named ([^\.]+?) into your hand\.?$/i);
      if (!m) return false;

      const cardName = String(m[1] || '').trim();
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Conjure a card named ${cardName} into your hand.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "DRAFT_A_CARD_FROM_SPELLBOOK_AND_PUT_IT_ONTO_THE_BATTLEFIELD": {
      const m = text.match(/^draft a card from [a-z0-9 ,'-]+(?:'|’)s spellbook and put it onto the battlefield\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Draft a card from a spellbook and put it onto the battlefield.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "ADD_RR_DRAFT_A_CARD_FROM_SPELLBOOK_THEN_EXILE_YOU_MAY_CAST_IT_THIS_TURN": {
      const m = text.match(
        /^add \{r\}\{r\}\. draft a card from [a-z0-9 ,'-]+(?:'|’)s spellbook, then exile it\. until end of turn, you may cast that card\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Add {R}{R}. Draft a card from a spellbook, exile it, then you may cast it this turn.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "ROLL_A_D20_SKIP_NEXT_TURN_OR_DRAW_A_CARD": {
      const m = text.match(/^roll a d20\. if you roll a 1, skip your next turn\. if you roll a 12 or higher, draw a card\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Roll a d20 (manual). On 1: skip your next turn. On 12+: draw a card.`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "OPEN_SEALED_KAMIGAWA_BOOSTER_PACK_AND_DRAFT_TWO": {
      const m = text.match(
        /^open up to one sealed kamigawa booster pack and shuffle those cards into your booster pile\. look at the top four cards of your booster pile\. put two of those cards into your hand and the rest into your graveyard\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Open a sealed Kamigawa booster pack (manual booster pile), then put two of the top four into hand and the rest into graveyard.`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "CHOOSE_CREATURE_CARD_IN_HAND_PERPETUALLY_GETS_P1P1_AND_COSTS_1_LESS": {
      const m = text.match(
        /^choose a creature card in your hand\. it perpetually gets \+1\/\+1 and perpetually gains "this spell costs \{1\} less to cast\."\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Choose a creature card in your hand. It perpetually gets +1/+1 and costs {1} less to cast.`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "DRAGON_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X": {
      const m = text.match(
        /^dragon cards in your hand perpetually gain "this spell costs \{1\} less to cast," and "you may pay \{x\} rather than pay this spell(?:'|’)s mana cost, where x is its mana value\."\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Dragon cards in your hand gain perpetual cost modifications (Arena-only).`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "UP_TO_ONE_TARGET_CREATURE_BASE_POWER_PERPETUALLY_BECOMES_TOUGHNESS_AND_GAINS_ATTACK_NO_DEFENDER": {
      const m = text.match(
        /^up to one target creature(?:'|’)s base power perpetually becomes equal to its toughness\. it perpetually gains "this creature can attack as though it didn(?:'|’)t have defender\."\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Up to one target creature gets perpetual base power/toughness and attack permission changes (Arena-only).`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "WHENEVER_A_CREATURE_ATTACKS_THIS_TURN_PUT_A_P1P1_COUNTER_ON_IT": {
      const stateAny = state as any;
      const turnApplied = stateAny.turnNumber || 0;

      // Stackable: multiple effects can exist in a turn.
      const existingTurn = stateAny.pendingAttackP1P1CounterThisTurnTurnApplied;
      if (typeof existingTurn !== "number" || existingTurn !== turnApplied) {
        stateAny.pendingAttackP1P1CounterThisTurn = 0;
      }

      stateAny.pendingAttackP1P1CounterThisTurn = (stateAny.pendingAttackP1P1CounterThisTurn || 0) + 1;
      stateAny.pendingAttackP1P1CounterThisTurnTurnApplied = turnApplied;

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (count=${stateAny.pendingAttackP1P1CounterThisTurn})`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_WHENEVER_A_CREATURE_DEALS_COMBAT_DAMAGE_TO_VRASKA_DESTROY_THAT_CREATURE": {
      const battlefield = getBattlefield(ctx);
      const sourcePermanentId = String((triggerItem as any)?.source || "");
      const sourcePerm = battlefield.find((p: any) => p?.id === sourcePermanentId);
      if (!sourcePerm) return false;

      const typeLine = String(sourcePerm?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("planeswalker")) return false;

      const stateAny = state as any;
      const turnApplied = stateAny.turnNumber || 0;

      (sourcePerm as any).untilNextTurnGrants = Array.isArray((sourcePerm as any).untilNextTurnGrants)
        ? (sourcePerm as any).untilNextTurnGrants
        : [];

      (sourcePerm as any).untilNextTurnGrants.push({
        kind: "vraska_destroy_creature_that_dealt_combat_damage",
        controllerId: controller,
        turnApplied,
        sourceName,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_WHENEVER_A_CREATURE_AN_OPPONENT_CONTROLS_ATTACKS_IT_GETS_MINUS1_MINUS0_UNTIL_END_OF_TURN": {
      const m = text.match(
        /^until your next turn, whenever a creature an opponent controls attacks, it gets -1\/-0 until end of turn\.?$/i
      );
      if (!m) return false;

      const stateAny = state as any;
      stateAny.untilNextTurnPlayerGrants = Array.isArray(stateAny.untilNextTurnPlayerGrants) ? stateAny.untilNextTurnPlayerGrants : [];
      stateAny.untilNextTurnPlayerGrants.push({
        kind: "opponents_attackers_get_minus1_minus0_eot",
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        powerMod: -1,
        toughnessMod: 0,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "THE_NEXT_SPELL_YOU_CAST_THIS_TURN_HAS_AFFINITY_FOR_ARTIFACTS": {
      const m = text.match(/^the next spell you cast this turn has affinity for artifacts\./i);
      if (!m) return false;

      const stateAny = state as any;
      const turnApplied = stateAny.turnNumber || 0;
      stateAny.delayedAffinityForArtifactsNextCast = Array.isArray(stateAny.delayedAffinityForArtifactsNextCast)
        ? stateAny.delayedAffinityForArtifactsNextCast
        : [];

      stateAny.delayedAffinityForArtifactsNextCast.push({
        kind: "affinity_for_artifacts",
        controllerId: controller,
        turnApplied,
        sourceName,
        used: false,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_VAMPIRE_P1P1": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;
      if (perm.controller !== controller) return false;

      (perm as any).temporaryAbilities = (perm as any).temporaryAbilities || [];
      (perm as any).temporaryAbilities.push({
        ability: "deathtouch",
        source: sourceName,
        expiresAt: "end_of_turn",
        turnApplied: state.turnNumber || 0,
      });
      (perm as any).temporaryAbilities.push({
        ability: "lifelink",
        source: sourceName,
        expiresAt: "end_of_turn",
        turnApplied: state.turnNumber || 0,
      });

      if (isCreatureOfSubtype(perm, "vampire")) {
        updateCounters(ctx as any, targetId, { "+1/+1": 1 });
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "REVEAL_CARDS_UNTIL_CREATURE_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed: any[] = [];
      let foundCreature: any | null = null;

      while (lib.length > 0) {
        const c = lib.shift();
        if (!c) continue;
        const typeLine = String((c as any).type_line || "").toLowerCase();
        if (typeLine.includes("creature")) {
          foundCreature = c;
          break;
        }
        revealed.push(c);
      }

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.hand = Array.isArray(z.hand) ? z.hand : [];

      if (foundCreature) {
        (foundCreature as any).zone = "hand";
        z.hand.push(foundCreature);
      }
      z.handCount = z.hand.length;

      // Shuffle the non-creature revealed cards and put them on the bottom.
      if (revealed.length > 1) {
        const rng = (ctx as any).rng;
        for (let i = revealed.length - 1; i > 0; i--) {
          const r = typeof rng === "function" ? rng() : Math.random();
          const j = Math.floor(r * (i + 1));
          [revealed[i], revealed[j]] = [revealed[j], revealed[i]];
        }
      }
      for (const c of revealed) {
        (c as any).zone = "library";
        lib.push(c);
      }

      (ctx as any).libraries?.set(controller, lib);
      z.libraryCount = lib.length;
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "REVEAL_CARDS_UNTIL_ARTIFACT_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed: any[] = [];
      let foundArtifact: any | null = null;

      while (lib.length > 0) {
        const c = lib.shift();
        if (!c) continue;
        const typeLine = String((c as any).type_line || "").toLowerCase();
        if (typeLine.includes("artifact")) {
          foundArtifact = c;
          break;
        }
        revealed.push(c);
      }

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.hand = Array.isArray(z.hand) ? z.hand : [];

      if (foundArtifact) {
        (foundArtifact as any).zone = "hand";
        z.hand.push(foundArtifact);
      }
      z.handCount = z.hand.length;

      // Shuffle the non-artifact revealed cards and put them on the bottom.
      if (revealed.length > 1) {
        const rng = (ctx as any).rng;
        for (let i = revealed.length - 1; i > 0; i--) {
          const r = typeof rng === "function" ? rng() : Math.random();
          const j = Math.floor(r * (i + 1));
          [revealed[i], revealed[j]] = [revealed[j], revealed[i]];
        }
      }
      for (const c of revealed) {
        (c as any).zone = "library";
        lib.push(c);
      }

      (ctx as any).libraries?.set(controller, lib);
      z.libraryCount = lib.length;
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TOP_N_CREATURE_CARDS_GAIN_CAST_FROM_EXILE_WHILE_YOU_CONTROL_A_LUKKA_PLANESWALKER": {
      const m = text.match(
        /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*creature cards exiled this way gain "you may cast this card from exile as long as you control a lukka planeswalker\."\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const stateAny = state as any;
      stateAny.playableFromExile = stateAny.playableFromExile || {};
      const pfe = (stateAny.playableFromExile[controller] = stateAny.playableFromExile[controller] || {});

      const toExileCount = Math.min(n, lib.length);
      for (let i = 0; i < toExileCount; i++) {
        const c = lib.shift();
        if (!c) continue;

        const exiledCard: any = {
          ...(c as any),
          zone: 'exile',
          // Additional gating: only playable while you control a Lukka planeswalker.
          playFromExileRequiresControllerPlaneswalkerNameIncludes: 'lukka',
        };
        z.exile.push(exiledCard);

        const typeLine = String(exiledCard?.type_line || '').toLowerCase();
        const isCreatureCard = typeLine.includes('creature');
        if (isCreatureCard && exiledCard?.id) {
          pfe[String(exiledCard.id)] = true;
        }
      }

      z.exileCount = z.exile.length;
      z.libraryCount = lib.length;
      (ctx as any).libraries?.set(controller, lib);
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TARGET_CREATURE_YOU_CONTROL_REVEAL_UNTIL_CREATURE_GREATER_MV_PUT_BATTLEFIELD_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^exile target creature you control, then reveal cards from the top of your library until you reveal a creature card with greater mana value\.\s*put that card onto the battlefield and the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const candidates = battlefield.filter((p: any) => {
        if (!p) return false;
        if (String(p.controller || '') !== String(controller)) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        return tl.includes('creature');
      });
      if (candidates.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller as any,
        description: `${sourceName}: Exile a creature you control` ,
        mandatory: true,
        sourceName,
        validTargets: candidates.map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Creature',
          description: p.card?.type_line || 'creature',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        })),
        targetTypes: ['creature_you_control'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'a creature you control',
        action: 'pw_lukka_exile_upgrade',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_SEVEN_MAY_PUT_PERMANENT_MV3_OR_LESS_ONTO_BATTLEFIELD_WITH_SHIELD_COUNTER_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top seven cards of your library\.\s*you may put a permanent card with mana value 3 or less from among them onto the battlefield with a shield counter on it\.\s*put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, 7);
      if (revealed.length === 0) return true;

      const isPermanent = (c: any): boolean => {
        const tl = String(c?.type_line || '').toLowerCase();
        return (
          tl.includes('artifact') ||
          tl.includes('creature') ||
          tl.includes('enchantment') ||
          tl.includes('land') ||
          tl.includes('planeswalker') ||
          tl.includes('battle')
        );
      };

      const selectable = revealed.filter((c: any) => {
        if (!isPermanent(c)) return false;
        const mv = Number((c as any)?.cmc);
        return Number.isFinite(mv) && mv <= 3;
      });
      const nonSelectable = revealed.filter((c: any) => !selectable.includes(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may put a permanent with MV 3 or less onto the battlefield with a shield counter)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to 1 permanent card with mana value 3 or less` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        addCounters: { shield: 1 },
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_NONCREATURE_NONLAND_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may reveal a noncreature, nonland card from among them and put it into your hand\.\s*put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.min(n, lib.length));
      if (revealed.length === 0) return true;

      const isSelectable = (c: any): boolean => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl) return false;
        return !tl.includes('creature') && !tl.includes('land');
      };

      const selectable = revealed.filter(isSelectable);
      const nonSelectable = revealed.filter((c: any) => !selectable.includes(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal a noncreature, nonland card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to 1 noncreature, nonland card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ENCHANTMENT_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may reveal an? enchantment card from among them and put (?:it|that card) into your hand\.\s*put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.min(n, lib.length));
      if (revealed.length === 0) return true;

      const isSelectable = (c: any): boolean => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('enchantment');
      };

      const selectable = revealed.filter(isSelectable);
      const nonSelectable = revealed.filter((c: any) => !selectable.includes(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal an enchantment card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to 1 enchantment card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may put any number of creature and\/or land cards from among them onto the battlefield\.\s*put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.min(n, lib.length));
      if (revealed.length === 0) return true;

      const isSelectable = (c: any): boolean => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('creature') || tl.includes('land');
      };

      const selectable = revealed.filter(isSelectable);
      const nonSelectable = revealed.filter((c: any) => !selectable.includes(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may put any number of creature and/or land cards onto the battlefield)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `any number of creature and/or land cards` ,
        minSelections: 0,
        maxSelections: selectable.length,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_TWO_CARDS_THEN_DISCARD_TWO_UNLESS_DISCARD_AN_ARTIFACT_CARD": {
      const m = text.match(/^draw two cards\.\s*then discard two cards unless you discard an artifact card\.?$/i);
      if (!m) return false;

      // Draw happens up-front, then the player chooses how to satisfy the discard.
      drawCardsFromZone(ctx, controller, 2);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (drawn; discard choice skipped)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller as any,
        description: `${sourceName}: Choose discard option` ,
        mandatory: true,
        sourceName,
        options: [
          { id: 'discard_artifact', label: 'Discard an artifact card' },
          { id: 'discard_two', label: 'Discard two cards' },
        ],
        minSelections: 1,
        maxSelections: 1,
        pwDrawTwoDiscardTwoUnlessArtifact: true,
        pwDrawTwoDiscardTwoUnlessArtifactSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "EACH_PLAYER_SACRIFICES_TWO_CREATURES": {
      const m = text.match(/^each player sacrifices two creatures of their choice\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      for (const p of players) {
        const pid = String(p?.id || '');
        if (!pid) continue;

        const creatures = battlefield.filter((perm: any) => {
          if (!perm) return false;
          if (String(perm.controller || '') !== pid) return false;
          const tl = String(perm.card?.type_line || '').toLowerCase();
          return tl.includes('creature');
        });

        const required = Math.min(2, creatures.length);
        if (required <= 0) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as any,
          description: `${sourceName}: Choose ${required} creature${required === 1 ? '' : 's'} to sacrifice` ,
          mandatory: true,
          sourceName,
          validTargets: creatures.map((perm: any) => ({
            id: perm.id,
            label: perm.card?.name || 'Creature',
            description: perm.card?.type_line || 'creature',
            imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          })),
          targetTypes: ['creature_you_control'],
          minTargets: required,
          maxTargets: required,
          targetDescription: 'creatures to sacrifice',
          action: 'sacrifice_selected_permanents',
        } as any);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "RETURN_UP_TO_ONE_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_TO_OWNERS_HAND_DRAW_A_CARD": {
      const [targetId] = getTargets(triggerItem);

      // "Up to one" means the player may choose no target; if so, still draw.
      if (targetId) {
        const battlefield = getBattlefield(ctx);
        const perm = battlefield.find((p: any) => p?.id === targetId);
        const typeLine = String(perm?.card?.type_line || "").toLowerCase();
        const isValid =
          !!perm &&
          (typeLine.includes("artifact") || typeLine.includes("creature") || typeLine.includes("enchantment"));
        if (!isValid) return false;

        movePermanentToHand(ctx, targetId);
      }

      drawCardsFromZone(ctx, controller, 1);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_TARGET_CREATURE_TO_OWNERS_HAND": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      movePermanentToHand(ctx, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || triggerItem?.source;
      const isAnother = String(text || '').toLowerCase().includes('return another target');
      if (isAnother && sourceId && targetId === sourceId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm) return false;
      if (!typeLine) return false;
      if (typeLine.includes('land')) return false;

      movePermanentToHand(ctx, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND_THEN_THAT_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND": {
      const m = text.match(
        /^return target nonland permanent to its owner(?:'|’)s hand, then that player exiles a card from their hand\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm) return false;
      if (!typeLine) return false;
      if (typeLine.includes('land')) return false;

      const ownerId = String((perm as any).owner || "");

      movePermanentToHand(ctx, targetId);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (returned; exile-from-hand skipped)`);
        return true;
      }

      if (!ownerId) return true;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones[ownerId]?.hand || [];
      if (hand.length <= 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (returned; no cards to exile)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: ownerId as any,
        description: `${sourceName}: Exile 1 card from hand`,
        mandatory: true,
        sourceName: sourceName,
        discardCount: 1,
        destination: "exile",
        exileTag: triggerItem?.planeswalker?.oracleId
          ? {
              exiledWithSourceId: triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id,
              exiledWithOracleId: triggerItem?.planeswalker?.oracleId,
              exiledWithSourceName: sourceName,
            }
          : undefined,
        hand: hand.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "RETURN_UP_TO_TWO_TARGET_LAND_CARDS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD": {
      const m = text.match(/^return up to two target land cards from your graveyard to the battlefield\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      if (gy.length === 0) return true;

      const validTargets = gy
        .filter((c: any) => {
          const tl = String(c?.type_line || '').toLowerCase();
          if (!tl) return false;
          return tl.includes('land');
        })
        .map((c: any) => ({
          id: c.id,
          label: c.name || 'Card',
          description: c.type_line || 'card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        }));

      if (validTargets.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose up to two land cards in your graveyard to return to the battlefield`,
        mandatory: true,
        sourceName,
        minTargets: 0,
        maxTargets: 2,
        action: 'move_graveyard_card_to_battlefield',
        fromPlayerId: controller,
        validTargets,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued: choices=${validTargets.length})`);
      return true;
    }

    case "DISCARD_A_CARD_THEN_DRAW_A_CARD_IF_LAND_DISCARDED_DRAW_AN_ADDITIONAL_CARD": {
      const m = text.match(
        /^discard a card, then draw a card\. if a land card is discarded this way, draw an additional card\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones[controller]?.hand || [];
      if (hand.length <= 0) {
        // Nothing to discard; still draw 1.
        drawCardsFromZone(ctx, controller, 1);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no discard; drew 1)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controller,
        description: `${sourceName}: Discard 1 card`,
        mandatory: true,
        sourceName,
        discardCount: 1,
        destination: 'graveyard',
        afterDiscardDrawCount: 1,
        afterDiscardDrawCountIfDiscardedLand: 1,
        hand: hand.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DISCARD_A_CARD_THEN_DRAW_A_CARD": {
      const m = text.match(/^discard a card, then draw a card\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones[controller]?.hand || [];
      if (hand.length <= 0) {
        // Discard isn't possible; still draw 1.
        drawCardsFromZone(ctx, controller, 1);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no discard; drew 1)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controller,
        description: `${sourceName}: Discard 1 card`,
        mandatory: true,
        sourceName,
        discardCount: 1,
        destination: 'graveyard',
        afterDiscardDrawCount: 1,
        hand: hand.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "EACH_PLAYER_SHUFFLES_HAND_AND_GRAVEYARD_INTO_LIBRARY_YOU_DRAW_SEVEN": {
      const m = text.match(/^each player shuffles their hand and graveyard into their library\. you draw seven cards\.?$/i);
      if (!m) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      const rng = (ctx as any).rng;

      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;

        const z = (zones[pid] = zones[pid] || {
          hand: [],
          handCount: 0,
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        });

        const hand: any[] = Array.isArray(z.hand) ? z.hand : [];
        const gy: any[] = Array.isArray((z as any).graveyard) ? (z as any).graveyard : [];
        const lib: any[] = Array.isArray((ctx as any).libraries?.get(pid)) ? (ctx as any).libraries.get(pid) : [];

        for (const c of hand) {
          (c as any).zone = 'library';
          lib.push(c);
        }
        for (const c of gy) {
          (c as any).zone = 'library';
          lib.push(c);
        }

        // Clear zones.
        z.hand = [];
        z.handCount = 0;
        (z as any).graveyard = [];
        (z as any).graveyardCount = 0;

        // Shuffle library.
        if (lib.length > 1) {
          for (let i = lib.length - 1; i > 0; i--) {
            const r = typeof rng === 'function' ? rng() : Math.random();
            const j = Math.floor(r * (i + 1));
            [lib[i], lib[j]] = [lib[j], lib[i]];
          }
        }

        (ctx as any).libraries?.set(pid, lib);
        z.libraryCount = lib.length;
      }

      drawCardsFromZone(ctx, controller, 7);
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "ATTACH_THIS_EQUIPMENT_TO_UP_TO_ONE_TARGET_CREATURE_YOU_CONTROL": {
      const m = text.match(/^attach this equipment to up to one target creature you control\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no target)`);
        return true;
      }

      const battlefield = getBattlefield(ctx);
      const sourceId =
        triggerItem?.sourceId ||
        triggerItem?.sourcePermanentId ||
        triggerItem?.planeswalker?.id ||
        triggerItem?.source;
      if (!sourceId) return false;

      const equipment = battlefield.find((p: any) => p?.id === sourceId);
      const targetCreature = battlefield.find((p: any) => p?.id === targetId);
      const equipmentTypeLine = String(equipment?.card?.type_line || '').toLowerCase();
      const targetTypeLine = String(targetCreature?.card?.type_line || '').toLowerCase();
      if (!equipment || !equipmentTypeLine.includes('equipment')) return false;
      if (!targetCreature || !targetTypeLine.includes('creature')) return false;
      if (targetCreature.controller !== controller) return false;

      const equipmentId = String(equipment.id);
      const prevAttachedTo = String((equipment as any).attachedTo || '');
      if (prevAttachedTo) {
        const prevCreature = battlefield.find((p: any) => p?.id === prevAttachedTo);
        if (prevCreature) {
          (prevCreature as any).attachedEquipment = Array.isArray((prevCreature as any).attachedEquipment)
            ? (prevCreature as any).attachedEquipment.filter((id: string) => id !== equipmentId)
            : [];
        }
      }

      (equipment as any).attachedTo = targetId;
      (targetCreature as any).attachedEquipment = Array.isArray((targetCreature as any).attachedEquipment)
        ? (targetCreature as any).attachedEquipment
        : [];
      if (!(targetCreature as any).attachedEquipment.includes(equipmentId)) {
        (targetCreature as any).attachedEquipment.push(equipmentId);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_PLAY_IT_THIS_TURN": {
      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const topCard = lib.shift();
      (ctx as any).libraries?.set(controller, lib);

      const cardId = String((topCard as any)?.id || uid("c"));

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const exiled = {
        ...topCard,
        id: cardId,
        zone: "exile",
        exiledBy: sourceName,
        canBePlayedBy: controller,
        playableUntilTurn: (state as any).turnNumber ?? 0,
      };
      z.exile.push(exiled);

      z.libraryCount = lib.length;
      if (typeof z.exileCount === "number") z.exileCount = z.exile.length;

      // Mark as playable-from-exile for the current turn.
      // Support boolean and numeric formats; we use numeric expiry for better correctness.
      (state as any).playableFromExile = (state as any).playableFromExile || {};
      const pfe = ((state as any).playableFromExile[controller] = (state as any).playableFromExile[controller] || {});
      pfe[cardId] = (state as any).turnNumber ?? 0;

      (ctx as any).bumpSeq?.();
      debug(
        2,
        `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${topCard?.name || "card"})`
      );
      return true;
    }

    case "EXILE_TOP_CARD_OF_YOUR_LIBRARY_IF_ITS_RED_YOU_MAY_CAST_IT_THIS_TURN": {
      const m = text.match(/^exile the top card of your library\.\s*if it(?:'|’)s red, you may cast it this turn\.?$/i);
      if (!m) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const topCard = lib.shift();
      (ctx as any).libraries?.set(controller, lib);

      const cardId = String((topCard as any)?.id || uid("c"));

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const exiled = {
        ...topCard,
        id: cardId,
        zone: "exile",
        exiledBy: sourceName,
        canBePlayedBy: controller,
        playableUntilTurn: (state as any).turnNumber ?? 0,
      };
      z.exile.push(exiled);

      z.libraryCount = lib.length;
      if (typeof z.exileCount === "number") z.exileCount = z.exile.length;

      const colors: string[] = Array.isArray((topCard as any)?.colors)
        ? (topCard as any).colors.map((c: any) => String(c).toUpperCase())
        : [];
      const colorIdentity: string[] = Array.isArray((topCard as any)?.color_identity)
        ? (topCard as any).color_identity.map((c: any) => String(c).toUpperCase())
        : [];
      const isRed = colors.includes("R") || colorIdentity.includes("R");

      if (isRed) {
        // Mark as playable-from-exile for the current turn.
        (state as any).playableFromExile = (state as any).playableFromExile || {};
        const pfe =
          ((state as any).playableFromExile[controller] = (state as any).playableFromExile[controller] || {});
        pfe[cardId] = (state as any).turnNumber ?? 0;
      }

      (ctx as any).bumpSeq?.();
      debug(
        2,
        `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${topCard?.name || "card"}${isRed ? ", red" : ""})`
      );
      return true;
    }

    case "EXILE_TOP_N_CARDS_OF_YOUR_LIBRARY_YOU_MAY_PLAY_THEM_THIS_TURN": {
      const m = text.match(
        /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may play them this turn\.?$/i
      );
      if (!m) return false;

      const count = parseCountTokenWord(m[1]);
      if (!count || count <= 0) return true;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      (state as any).playableFromExile = (state as any).playableFromExile || {};
      const pfe = ((state as any).playableFromExile[controller] = (state as any).playableFromExile[controller] || {});

      const actual = Math.max(0, Math.min(count, lib.length));
      for (let i = 0; i < actual; i++) {
        const topCard = lib.shift();
        const cardId = String((topCard as any)?.id || uid("c"));
        const exiled = {
          ...topCard,
          id: cardId,
          zone: "exile",
          exiledBy: sourceName,
          canBePlayedBy: controller,
          playableUntilTurn: (state as any).turnNumber ?? 0,
        };
        z.exile.push(exiled);
        pfe[cardId] = (state as any).turnNumber ?? 0;
      }

      (ctx as any).libraries?.set(controller, lib);
      z.libraryCount = lib.length;
      if (typeof z.exileCount === "number") z.exileCount = z.exile.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${actual})`);
      return true;
    }

    case "EXILE_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD": {
      const m = text.match(
        /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may put any number of creature and\/or land cards from among them onto the battlefield\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const actual = Math.max(0, Math.min(n, lib.length));
      const exiledNow: any[] = [];
      for (let i = 0; i < actual; i++) {
        const c = lib.shift();
        if (!c) continue;
        const cardId = String((c as any)?.id || uid('c'));
        const exiled = {
          ...(c as any),
          id: cardId,
          zone: 'exile',
          exiledBy: sourceName,
        };
        z.exile.push(exiled);
        exiledNow.push(exiled);
      }

      z.exileCount = z.exile.length;
      z.libraryCount = lib.length;
      (ctx as any).libraries?.set(controller, lib);
      (ctx as any).bumpSeq?.();

      if (exiledNow.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no cards exiled)`);
        return true;
      }

      const isSelectable = (c: any): boolean => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('creature') || tl.includes('land');
      };
      const selectable = exiledNow.filter(isSelectable);
      const nonSelectable = exiledNow.filter((c: any) => !selectable.includes(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: From the exiled cards, you may put any number of creature and/or land cards onto the battlefield` ,
        mandatory: false,
        sourceName,
        searchZone: 'exile',
        searchCriteria: `any number of creature and/or land cards` ,
        minSelections: 0,
        maxSelections: selectable.length,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        remainderRandomOrder: false,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${exiledNow.length}; queued)`);
      return true;
    }

    case "EXILE_TOP_N_PUT_ALL_ARTIFACT_CARDS_ONTO_BATTLEFIELD": {
      const m = text.match(
        /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*put all artifact cards from among them onto the battlefield\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const actual = Math.max(0, Math.min(n, lib.length));
      const exiledNow: any[] = [];
      for (let i = 0; i < actual; i++) {
        const c = lib.shift();
        if (!c) continue;
        const cardId = String((c as any)?.id || uid('c'));
        const exiled = {
          ...(c as any),
          id: cardId,
          zone: 'exile',
          exiledBy: sourceName,
        };
        z.exile.push(exiled);
        exiledNow.push(exiled);
      }

      z.exileCount = z.exile.length;
      z.libraryCount = lib.length;
      (ctx as any).libraries?.set(controller, lib);
      (ctx as any).bumpSeq?.();

      if (exiledNow.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no cards exiled)`);
        return true;
      }

      const isArtifact = (c: any): boolean => String(c?.type_line || '').toLowerCase().includes('artifact');
      const artifacts = exiledNow.filter(isArtifact);
      const nonArtifacts = exiledNow.filter((c: any) => !artifacts.includes(c));

      if (artifacts.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no artifacts)`);
        return true;
      }

      // Deterministic but handled via the generic LIBRARY_SEARCH to reuse ETB/counter logic.
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Put all artifact cards exiled this way onto the battlefield` ,
        mandatory: true,
        sourceName,
        searchZone: 'exile',
        searchCriteria: `all artifact cards` ,
        minSelections: artifacts.length,
        maxSelections: artifacts.length,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        remainderRandomOrder: false,
        availableCards: artifacts.map(toAvailableCard),
        nonSelectableCards: nonArtifacts.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${exiledNow.length}; queued ${artifacts.length} artifact(s))`);
      return true;
    }

    case "EXILE_TOP_TWO_CARDS_OF_YOUR_LIBRARY_CHOOSE_ONE_YOU_MAY_PLAY_IT_THIS_TURN": {
      const m = text.match(
        /^exile the top two cards of your library\.\s*choose one of them\.\s*you may play that card this turn\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const exiledCards: any[] = [];
      const exiledCardIds: string[] = [];

      const actual = Math.max(0, Math.min(2, lib.length));
      for (let i = 0; i < actual; i++) {
        const topCard = lib.shift();
        const cardId = String((topCard as any)?.id || uid("c"));
        const exiled = {
          ...topCard,
          id: cardId,
          zone: "exile",
          exiledBy: sourceName,
          canBePlayedBy: controller,
          playableUntilTurn: (state as any).turnNumber ?? 0,
        };
        z.exile.push(exiled);
        exiledCards.push(exiled);
        exiledCardIds.push(cardId);
      }

      (ctx as any).libraries?.set(controller, lib);
      z.libraryCount = lib.length;
      if (typeof z.exileCount === "number") z.exileCount = z.exile.length;

      if (exiledCardIds.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose an exiled card. You may play it this turn.`,
        mandatory: true,
        sourceName,
        options: exiledCards.map((c: any) => ({
          id: String(c.id),
          label: String(c.name || "Exiled card"),
          description: String(c.type_line || ""),
        })),
        minSelections: 1,
        maxSelections: 1,
        pwExileTopTwoChooseOnePlay: true,
        pwExileTopTwoChooseOnePlayController: controller,
        pwExileTopTwoChooseOnePlaySourceName: sourceName,
        pwExileTopTwoChooseOnePlayCardIds: exiledCardIds,
      } as any);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_A_CARD_THEN_ADD_ONE_MANA_OF_ANY_COLOR": {
      const m = text.match(/^draw a card, then add one mana of any color\.?$/i);
      if (!m) return false;

      drawCardsFromZone(ctx, controller, 1);

      const pool = getOrInitManaPool(state, controller);
      (pool as any).anyColor = ((pool as any).anyColor || 0) + 1;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DRAW_A_CARD_THEN_SCRY_N": {
      const m = text.match(/^draw a card, then scry (\d+)\.?$/i);
      if (!m) return false;

      const scryCount = parseInt(m[1], 10) || 0;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      drawCardsFromZone(ctx, controller, 1);

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `${sourceName}: Scry ${scryCount}`,
        mandatory: true,
        sourceName: sourceName,
        scryCount,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_A_CARD_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_TOP_OF_YOUR_LIBRARY": {
      const m = text.match(/^draw a card, then put a card from your hand on top of your library\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      drawCardsFromZone(ctx, controller, 1);

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.handCount = z.hand.length;

      if (z.hand.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no hand cards)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a card from your hand to put on top of your library.`,
        mandatory: true,
        sourceName,
        options: (z.hand as any[]).map((c: any) => ({
          id: String(c.id),
          label: String(c.name || "Card"),
          description: String(c.type_line || ""),
        })),
        minSelections: 1,
        maxSelections: 1,
        pwDrawThenHandToTop: true,
        pwDrawThenHandToTopController: controller,
        pwDrawThenHandToTopSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_N_CARDS_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_THE_BOTTOM_OF_YOUR_LIBRARY": {
      const m = text.match(
        /^draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?, then put a card from your hand on the bottom of your library\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      drawCardsFromZone(ctx, controller, n);

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.handCount = z.hand.length;

      if (z.hand.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no hand cards)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a card from your hand to put on the bottom of your library.`,
        mandatory: true,
        sourceName,
        options: (z.hand as any[]).map((c: any) => ({
          id: String(c.id),
          label: String(c.name || 'Card'),
          description: String(c.type_line || ''),
        })),
        minSelections: 1,
        maxSelections: 1,
        pwDrawThenHandToBottom: true,
        pwDrawThenHandToBottomController: controller,
        pwDrawThenHandToBottomSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "EACH_PLAYER_DISCARDS_THEIR_HAND_THEN_DRAWS_THREE_CARDS": {
      const m = text.match(/^each player discards their hand, then draws three cards\.?$/i);
      if (!m) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const players = ((state as any).players as any[]) || [];

      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;

        const z = (zones[pid] = zones[pid] || {
          hand: [],
          handCount: 0,
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        });
        z.hand = Array.isArray(z.hand) ? z.hand : [];
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

        if (z.hand.length > 0) {
          const moved = z.hand.map((c: any) => ({ ...c, zone: "graveyard" }));
          z.graveyard.push(...moved);
          z.hand = [];
        }

        z.handCount = (z.hand as any[]).length;
        z.graveyardCount = (z.graveyard as any[]).length;

        drawCardsFromZone(ctx, pid, 3);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EACH_PLAYER_DRAWS_A_CARD": {
      const m = text.match(/^each player draws a card\.?$/i);
      if (!m) return false;

      const players = ((state as any).players as any[]) || [];
      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;
        drawCardsFromZone(ctx, pid, 1);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "IF_TARGET_PLAYER_HAS_FEWER_THAN_NINE_POISON_COUNTERS_THEY_GET_DIFFERENCE": {
      const m = text.match(
        /^if target player has fewer than nine poison counters, they get a number of poison counters equal to the difference\.?$/i
      );
      if (!m) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      (ctx as any).poison = (ctx as any).poison || {};
      const poison = (ctx as any).poison as Record<string, number>;
      const current = poison[targetPlayerId] ?? 0;
      if (current < 9) {
        poison[targetPlayerId] = current + (9 - current);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${current} -> ${poison[targetPlayerId] ?? current})`);
      return true;
    }

    case "CREATE_X_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_WHERE_X_IS_HIGHEST_LIFE_TOTAL": {
      const m = text.match(
        /^create x 1\/1 black vampire knight creature tokens with lifelink, where x is the highest life total among all players\.?$/i
      );
      if (!m) return false;

      const players = ((state as any).players as any[]) || [];
      const life = ((ctx as any).life as Record<string, number>) || {};
      let highest = 0;
      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;
        const v = life[pid] ?? 40;
        if (typeof v === 'number' && v > highest) highest = v;
      }
      const count = Math.max(0, highest | 0);
      if (count === 0) return true;

      createToken(ctx, controller, 'Vampire Knight', count, 1, 1, {
        colors: ['B'],
        typeLine: 'Token Creature — Vampire Knight',
        abilities: ['Lifelink'],
        isArtifact: false,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count})`);
      return true;
    }

    case "CREATE_A_NUMBER_OF_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_EQUAL_TO_HIGHEST_LIFE_TOTAL": {
      const m = text.match(
        /^create a number of 1\/1 black vampire knight creature tokens with lifelink equal to the highest life total among all players\.?$/i
      );
      if (!m) return false;

      const players = ((state as any).players as any[]) || [];
      const life = ((ctx as any).life as Record<string, number>) || {};
      let highest = 0;
      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;
        const v = life[pid] ?? 40;
        if (typeof v === 'number' && v > highest) highest = v;
      }
      const count = Math.max(0, highest | 0);
      if (count === 0) return true;

      createToken(ctx, controller, 'Vampire Knight', count, 1, 1, {
        colors: ['B'],
        typeLine: 'Token Creature — Vampire Knight',
        abilities: ['Lifelink'],
        isArtifact: false,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count})`);
      return true;
    }

    case "CREATE_X_2_2_WHITE_CAT_TOKENS_WHERE_X_IS_YOUR_LIFE_TOTAL": {
      const m = text.match(/^create x 2\/2 white cat creature tokens, where x is your life total\.?$/i);
      if (!m) return false;

      const life = ((ctx as any).life as Record<string, number>) || {};
      const count = Math.max(0, (life[controller] ?? 0) | 0);
      if (count === 0) return true;

      createToken(ctx, controller, 'Cat', count, 2, 2, {
        colors: ['W'],
        typeLine: 'Token Creature — Cat',
        abilities: [],
        isArtifact: false,
      });

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count})`);
      return true;
    }

    case "DEALS_DAMAGE_EQUAL_TO_TWICE_THE_NUMBER_OF_WARRIORS_AND_EQUIPMENT_YOU_CONTROL_TO_TARGET_PLAYER_OR_PLANESWALKER": {
      const m = text.match(
        /^[a-z0-9 ,'-]+ deals damage(?: to target (?:creature|player) or planeswalker)? equal to twice the number of warriors and equipment you control(?: to target (?:creature|player) or planeswalker)?\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      let warriors = 0;
      let equipment = 0;
      for (const perm of battlefield) {
        if (!perm || perm.controller !== controller) continue;
        const tl = String(perm?.card?.type_line || '').toLowerCase();
        if (tl.includes('creature') && tl.includes('warrior')) warriors++;
        if (tl.includes('equipment')) equipment++;
      }
      const damage = 2 * (warriors + equipment);

      const players = ((state as any).players as any[]) || [];
      const isPlayer = players.some((p: any) => p?.id === targetId);
      if (isPlayer) {
        applyDamageToPlayer(ctx, targetId, damage);
      } else {
        applyDamageToPermanent(ctx, targetId, damage);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${damage})`);
      return true;
    }

    case "RETURN_ALL_NONLAND_PERMANENT_CARDS_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD": {
      const m = text.match(
        /^return all nonland permanent cards with mana value (\d+) or less from your graveyard to the battlefield\.?$/i
      );
      if (!m) return false;

      const maxMV = parseInt(m[1], 10);
      if (!Number.isFinite(maxMV)) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      const graveyard: any[] = z.graveyard as any[];
      const toReturn: any[] = [];
      for (const c of graveyard) {
        const tl = String((c as any)?.type_line || '').toLowerCase();
        if (tl.includes('land')) continue;
        const isPermanent = tl.includes('artifact') || tl.includes('creature') || tl.includes('enchantment') || tl.includes('planeswalker') || tl.includes('battle');
        if (!isPermanent) continue;
        const cmc = typeof (c as any)?.cmc === 'number' ? (c as any).cmc : Number((c as any)?.cmc ?? NaN);
        if (!Number.isFinite(cmc) || cmc > maxMV) continue;
        toReturn.push(c);
      }

      if (toReturn.length === 0) return true;

      // Remove returned cards from graveyard (by id when possible)
      const returnIds = new Set(toReturn.map((c: any) => String(c?.id || '')));
      z.graveyard = graveyard.filter((c: any) => !returnIds.has(String(c?.id || '')));
      z.graveyardCount = (z.graveyard as any[]).length;

      state.battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
      const battlefieldArr: any[] = (state as any).battlefield;

      for (const card of toReturn) {
        const tl = String((card as any)?.type_line || '').toLowerCase();
        const isCreature = tl.includes('creature');
        const basePower = isCreature ? parseInt(String((card as any)?.power ?? '0'), 10) : undefined;
        const baseToughness = isCreature ? parseInt(String((card as any)?.toughness ?? '0'), 10) : undefined;

        battlefieldArr.push({
          id: uid('perm'),
          controller,
          owner: controller,
          tapped: false,
          counters: {},
          attachments: [],
          ...(Number.isFinite(basePower as any) ? { basePower } : {}),
          ...(Number.isFinite(baseToughness as any) ? { baseToughness } : {}),
          card: { ...(card as any), zone: 'battlefield' },
        } as any);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${toReturn.length})`);
      return true;
    }

    case "EXILE_TARGET_NONLAND_PERMANENT_CARD_WITH_MANA_VALUE_X_FROM_YOUR_GRAVEYARD_CREATE_TOKEN_COPY": {
      const m = text.match(
        /^exile target nonland permanent card with mana value x from your graveyard\. create a token that['’]s a copy of that card\.?$/i
      );
      if (!m) return false;

      const [targetCardId] = getTargets(triggerItem);
      if (!targetCardId) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const graveyard: any[] = z.graveyard as any[];
      const idx = graveyard.findIndex((c: any) => String(c?.id) === String(targetCardId));
      if (idx < 0) return true;

      const [card] = graveyard.splice(idx, 1);
      const tl = String((card as any)?.type_line || '').toLowerCase();
      if (tl.includes('land')) {
        // Put it back; spec says nonland
        graveyard.splice(idx, 0, card);
        return true;
      }
      const isPermanent = tl.includes('artifact') || tl.includes('creature') || tl.includes('enchantment') || tl.includes('planeswalker') || tl.includes('battle');
      if (!isPermanent) {
        graveyard.splice(idx, 0, card);
        return true;
      }

      const exiled = { ...(card as any), zone: 'exile', exiledBy: sourceName, faceDown: false };
      (z.exile as any[]).push(exiled);
      z.graveyardCount = (z.graveyard as any[]).length;
      z.exileCount = (z.exile as any[]).length;

      const isCreature = tl.includes('creature');
      const basePower = isCreature ? parseInt(String((card as any)?.power ?? '0'), 10) : undefined;
      const baseToughness = isCreature ? parseInt(String((card as any)?.toughness ?? '0'), 10) : undefined;

      const colors = Array.isArray((card as any)?.colors)
        ? (card as any).colors.map((c: any) => String(c || '').toUpperCase()).filter(Boolean)
        : [];
      const keywords = Array.isArray((card as any)?.keywords)
        ? (card as any).keywords.map((k: any) => String(k || '').trim()).filter(Boolean)
        : [];
      const typeLine = `Token ${String((card as any)?.type_line || '').trim()}`.trim();

      createToken(ctx, controller, String((card as any)?.name || 'Token Copy'), 1, basePower, baseToughness, {
        colors,
        typeLine,
        abilities: keywords,
        isArtifact: tl.includes('artifact'),
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTAP_TARGET_PERMANENT": {
      const m = text.match(/^untap target permanent\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      perm.tapped = false;
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTAP_ALL_CREATURES_YOU_CONTROL_THEY_GET_PT_EOT": {
      const m = text.match(/^untap all creatures you control\. those creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10) || 0;
      const toughnessMod = parseInt(m[2], 10) || 0;

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        perm.tapped = false;
        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });
        affected++;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "UNTAP_TARGET_LAND_YOU_CONTROL_MAY_BECOME_3_3_ELEMENTAL_HASTE_MENACE_EOT": {
      const m = text.match(
        /^untap target land you control\.\s*you may have it become a 3\/3 elemental creature with haste and menace until end of turn\.\s*it's still a land\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('land')) return true;
      if (perm.controller !== controller) return true;

      // Untap
      perm.tapped = false;

      // Animate until end of turn (track original type line for cleanup)
      const originalTypeLine = String(perm.card?.type_line || 'Land');
      (perm as any).untilEndOfTurn = (perm as any).untilEndOfTurn || {};
      const u = (perm as any).untilEndOfTurn as any;
      if (typeof u.originalTypeLine !== 'string') u.originalTypeLine = originalTypeLine;

      let newTypeLine = originalTypeLine;
      if (!/\bCreature\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} Creature`;
      if (!/\bElemental\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} — Elemental`;
      perm.card.type_line = newTypeLine;

      // P/T until end of turn (lands usually have 0/0 baseline here)
      (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
      (perm as any).ptModsEOT.push({ power: 3, toughness: 3, sourceName });

      // Grant abilities until end of turn
      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      u.grantedAbilitiesToRemove = Array.isArray(u.grantedAbilitiesToRemove) ? u.grantedAbilitiesToRemove : [];

      for (const ability of ['Haste', 'Menace']) {
        if (!perm.grantedAbilities.includes(ability)) perm.grantedAbilities.push(ability);
        if (!u.grantedAbilitiesToRemove.includes(ability)) u.grantedAbilitiesToRemove.push(ability);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTAP_TARGET_MOUNTAIN_BECOMES_4_4_RED_ELEMENTAL_EOT": {
      const m = text.match(
        /^untap target mountain\.\s*it becomes a 4\/4 red elemental creature until end of turn\.\s*it's still a land\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('land') || !tl.includes('mountain')) return true;
      if (perm.controller !== controller) return true;

      perm.tapped = false;

      const originalTypeLine = String(perm.card?.type_line || 'Land');
      (perm as any).untilEndOfTurn = (perm as any).untilEndOfTurn || {};
      const u = (perm as any).untilEndOfTurn as any;
      if (typeof u.originalTypeLine !== 'string') u.originalTypeLine = originalTypeLine;

      let newTypeLine = originalTypeLine;
      if (!/\bCreature\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} Creature`;
      if (!/\bElemental\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} — Elemental`;
      perm.card.type_line = newTypeLine;

      (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
      (perm as any).ptModsEOT.push({ power: 4, toughness: 4, sourceName });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_LAND_YOU_CONTROL_BECOMES_4_4_ELEMENTAL_TRAMPLE": {
      const m = text.match(/^target land you control becomes a 4\/4 elemental creature with trample\.(?:\s*it's still a land\.)?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('land')) return true;
      if (perm.controller !== controller) return true;

      // Permanent animation (no duration specified)
      const originalTypeLine = String(perm.card?.type_line || 'Land');
      let newTypeLine = originalTypeLine;
      if (!/\bCreature\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} Creature`;
      if (!/\bElemental\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} — Elemental`;
      perm.card.type_line = newTypeLine;

      perm.basePower = 4;
      perm.baseToughness = 4;
      perm.card.power = '4';
      perm.card.toughness = '4';

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.includes('Trample')) perm.grantedAbilities.push('Trample');

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_N_N": {
      const m = text.match(/^target artifact becomes an artifact creature with base power and toughness (\d+)\/(\d+)\.?$/i);
      if (!m) return false;

      const power = parseInt(m[1], 10);
      const toughness = parseInt(m[2], 10);
      if (!Number.isFinite(power) || !Number.isFinite(toughness)) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('artifact')) return true;

      // Permanent animation (no duration specified)
      const originalTypeLine = String(perm.card?.type_line || 'Artifact');
      let newTypeLine = originalTypeLine;
      if (!/\bCreature\b/i.test(newTypeLine)) {
        if (newTypeLine.includes('—')) {
          const parts = newTypeLine.split('—');
          const left = (parts[0] || '').trim();
          const right = parts.slice(1).join('—').trim();
          newTypeLine = right.length > 0 ? `${left} Creature — ${right}` : `${left} Creature`;
        } else {
          newTypeLine = `${newTypeLine} Creature`;
        }
      }
      perm.card.type_line = newTypeLine;

      perm.basePower = power;
      perm.baseToughness = toughness;
      perm.card.power = String(power);
      perm.card.toughness = String(toughness);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${power}/${toughness})`);
      return true;
    }

    case "TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_IF_IT_ISNT_A_VEHICLE_IT_HAS_BASE_POWER_AND_TOUGHNESS_N_N": {
      const m = text.match(
        /^target artifact becomes an artifact creature\.\s*if it isn't a vehicle, it has base power and toughness (\d+)\/(\d+)\.?$/i
      );
      if (!m) return false;

      const power = parseInt(m[1], 10);
      const toughness = parseInt(m[2], 10);
      if (!Number.isFinite(power) || !Number.isFinite(toughness)) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const typeLineLower = String(perm.card?.type_line || '').toLowerCase();
      if (!typeLineLower.includes('artifact')) return true;

      // Permanent animation (no duration specified)
      const originalTypeLine = String(perm.card?.type_line || 'Artifact');
      let newTypeLine = originalTypeLine;
      if (!/\bCreature\b/i.test(newTypeLine)) {
        if (newTypeLine.includes('—')) {
          const parts = newTypeLine.split('—');
          const left = (parts[0] || '').trim();
          const right = parts.slice(1).join('—').trim();
          newTypeLine = right.length > 0 ? `${left} Creature — ${right}` : `${left} Creature`;
        } else {
          newTypeLine = `${newTypeLine} Creature`;
        }
      }
      perm.card.type_line = newTypeLine;

      // Vehicles already have printed P/T; this clause only sets P/T for non-Vehicles.
      if (!typeLineLower.includes('vehicle')) {
        perm.basePower = power;
        perm.baseToughness = toughness;
        perm.card.power = String(power);
        perm.card.toughness = String(toughness);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${power}/${toughness})`);
      return true;
    }

    case "UNTIL_END_OF_TURN_SOURCE_PLANESWALKER_BECOMES_N_N_CREATURE_PREVENT_ALL_DAMAGE_TO_IT": {
      const m = text.match(
        /^until end of turn,\s*[a-z0-9 ,'-]+ becomes a (\d+)\/(\d+) ([a-z0-9 ,'-]+) creature(?: with indestructible)? that's still a planeswalker\.\s*prevent all damage that would be dealt to (?:him|her|it) this turn\.(?:\s*\(he can't attack if he was cast this turn\.\))?$/i
      );
      if (!m) return false;

      const power = parseInt(m[1], 10);
      const toughness = parseInt(m[2], 10);
      const rawCreatureDescriptor = String(m[3] || '').trim();
      const hasIndestructible = /\bwith indestructible\b/i.test(text) || /\bgains indestructible\b/i.test(text);

      if (!Number.isFinite(power) || !Number.isFinite(toughness)) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || triggerItem?.source;

      const sourcePerm =
        (sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null) ||
        battlefield.find((p: any) =>
          p?.controller === controller &&
          String(p?.card?.name || '').toLowerCase() === String(sourceName || '').toLowerCase() &&
          String(p?.card?.type_line || '').toLowerCase().includes('planeswalker')
        );

      if (!sourcePerm?.card) return false;

      const typeLineLower = String(sourcePerm.card?.type_line || '').toLowerCase();
      if (!typeLineLower.includes('planeswalker')) return true;

      // Track original type line so turn cleanup can restore it.
      const originalTypeLine = String(sourcePerm.card?.type_line || 'Planeswalker');
      (sourcePerm as any).untilEndOfTurn = (sourcePerm as any).untilEndOfTurn || {};
      const u = (sourcePerm as any).untilEndOfTurn as any;
      if (typeof u.originalTypeLine !== 'string') u.originalTypeLine = originalTypeLine;

      // Ensure it's a creature.
      let left = originalTypeLine;
      let right = '';
      if (originalTypeLine.includes('—')) {
        const parts = originalTypeLine.split('—');
        left = parts[0]?.trim() || originalTypeLine;
        right = parts.slice(1).join('—').trim();
      }
      if (!/\bCreature\b/i.test(left)) left = `${left} Creature`;

      // Append creature types (best-effort; ignore color adjectives).
      const colorWords = new Set(['white', 'blue', 'black', 'red', 'green', 'colorless']);
      const creatureTypes = rawCreatureDescriptor
        .split(/\s+/)
        .map(t => String(t || '').trim())
        .filter(Boolean)
        .filter(t => !colorWords.has(t.toLowerCase()));

      const rightCombined = [right, creatureTypes.join(' ')].map(x => String(x || '').trim()).filter(Boolean).join(' ');
      sourcePerm.card.type_line = rightCombined ? `${left} — ${rightCombined}` : left;

      // P/T until end of turn.
      (sourcePerm as any).ptModsEOT = Array.isArray((sourcePerm as any).ptModsEOT) ? (sourcePerm as any).ptModsEOT : [];
      (sourcePerm as any).ptModsEOT.push({ power, toughness, sourceName });

      // Grant indestructible if present in the oracle text (until EOT).
      sourcePerm.grantedAbilities = Array.isArray(sourcePerm.grantedAbilities) ? sourcePerm.grantedAbilities : [];
      u.grantedAbilitiesToRemove = Array.isArray(u.grantedAbilitiesToRemove) ? u.grantedAbilitiesToRemove : [];
      if (hasIndestructible) {
        if (!sourcePerm.grantedAbilities.includes('Indestructible')) sourcePerm.grantedAbilities.push('Indestructible');
        if (!u.grantedAbilitiesToRemove.includes('Indestructible')) u.grantedAbilitiesToRemove.push('Indestructible');
      }

      // Prevent damage to this permanent (until end of turn).
      const stateAny = ctx.state as any;
      const preventText = 'Prevent all damage to this permanent (until end of turn)';

      if (!sourcePerm.grantedAbilities.includes(preventText)) sourcePerm.grantedAbilities.push(preventText);
      if (!u.grantedAbilitiesToRemove.includes(preventText)) u.grantedAbilitiesToRemove.push(preventText);

      (sourcePerm as any).untilNextTurnGrants = Array.isArray((sourcePerm as any).untilNextTurnGrants)
        ? (sourcePerm as any).untilNextTurnGrants
        : [];
      (sourcePerm as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: [preventText],
        sourceName,
        kind: 'prevent_all_damage_to',
        expiresAtCleanup: true,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE": {
      const m = text.match(/^untap up to one target artifact or creature\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("artifact") && !tl.includes("creature")) return true;

      perm.tapped = false;
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTAP_UP_TO_N_TARGET_ARTIFACTS": {
      const m = text.match(
        /^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target artifacts?\.?$/i
      );
      if (!m) return false;

      const maxN = parseCountTokenWord(m[1]);
      const targets = getTargets(triggerItem).slice(0, Math.max(0, maxN));
      if (!targets.length) return true;

      const battlefield = getBattlefield(ctx);
      let untapped = 0;
      for (const id of targets) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('artifact')) continue;
        perm.tapped = false;
        untapped++;
      }
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${untapped})`);
      return true;
    }

    case "UNTAP_UP_TO_N_TARGET_CREATURES": {
      const m = text.match(
        /^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target creatures?\.?$/i
      );
      if (!m) return false;

      const maxN = parseCountTokenWord(m[1]);
      const targets = getTargets(triggerItem).slice(0, Math.max(0, maxN));
      if (!targets.length) return true;

      const battlefield = getBattlefield(ctx);
      let untapped = 0;
      for (const id of targets) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        perm.tapped = false;
        untapped++;
      }
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${untapped})`);
      return true;
    }

    case "UNTAP_UP_TO_N_TARGET_LANDS_WITH_SUBTYPE": {
      const m = text.match(
        /^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target (plains?|islands?|swamps?|mountains?|forests?)\.?$/i
      );
      if (!m) return false;

      const maxN = parseCountTokenWord(m[1]);
      const landWord = String(m[2] || '').toLowerCase();
      const subtype = landWord.endsWith('s') ? landWord.slice(0, -1) : landWord;

      const targets = getTargets(triggerItem).slice(0, Math.max(0, maxN));
      if (!targets.length) return true;

      const battlefield = getBattlefield(ctx);
      let untapped = 0;
      for (const id of targets) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('land')) continue;
        if (!tl.includes(subtype)) continue;
        perm.tapped = false;
        untapped++;
      }
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${untapped})`);
      return true;
    }

    case "TARGET_CREATURE_CANT_BE_BLOCKED_THIS_TURN": {
      const m = text.match(/^target creature can't be blocked this turn\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes('creature')) return true;

      // Use tempAbilities so cleanup-step removal is automatic.
      perm.tempAbilities = Array.isArray(perm.tempAbilities) ? perm.tempAbilities : [];
      if (!perm.tempAbilities.some((a: any) => String(a).toLowerCase().includes("can't be blocked"))) {
        perm.tempAbilities.push("Can't be blocked");
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_CANT_BE_BLOCKED_THIS_TURN": {
      const m = text.match(/^creatures you control can't be blocked this turn\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);

      let changed = false;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (perm.controller !== controller) continue;

        const tl = String(perm?.card?.type_line || "").toLowerCase();
        if (!tl.includes("creature")) continue;

        perm.tempAbilities = Array.isArray(perm.tempAbilities) ? perm.tempAbilities : [];
        if (!perm.tempAbilities.some((a: any) => String(a).toLowerCase().includes("can't be blocked"))) {
          perm.tempAbilities.push("Can't be blocked");
          changed = true;
        }
      }

      if (changed) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATURES_CANT_BE_BLOCKED_THIS_TURN": {
      const m = text.match(/^creatures (?:can't|cannot) be blocked this turn\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);

      let changed = false;
      for (const perm of battlefield) {
        if (!perm?.card) continue;

        const tl = String(perm?.card?.type_line || "").toLowerCase();
        if (!tl.includes("creature")) continue;

        // Use tempAbilities so cleanup-step removal is automatic.
        perm.tempAbilities = Array.isArray(perm.tempAbilities) ? perm.tempAbilities : [];
        if (!perm.tempAbilities.some((a: any) => String(a).toLowerCase().includes("can't be blocked"))) {
          perm.tempAbilities.push("Can't be blocked");
          changed = true;
        }
      }

      if (changed) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_GAINS_FLYING_AND_DOUBLE_STRIKE_EOT": {
      const m = text.match(/^target creature gains flying and double strike until end of turn\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const tl = String(perm?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.some((a: any) => String(a).toLowerCase().includes('flying'))) {
        perm.grantedAbilities.push('Flying');
      }
      if (!perm.grantedAbilities.some((a: any) => String(a).toLowerCase().includes('double strike'))) {
        perm.grantedAbilities.push('Double strike');
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === 'object' ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Flying')) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Flying');
      }
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Double strike')) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Double strike');
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER": {
      const m = text.match(/^[a-z0-9 ,'-]+ deals (\d+) damage to target creature or planeswalker\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[1], 10);
      if (!Number.isFinite(amount)) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      applyDamageToPermanent(ctx, targetId, amount);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount})`);
      return true;
    }

    case "ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_TARGET_PLAYER": {
      const m = text.match(/^add (\{[wubrgc]\}(?:\{[wubrgc]\})*)\.?\s*[a-z0-9 ,'-]+ deals (\d+) damage to target player\.?$/i);
      if (!m) return false;

      const symbols = String(m[1] || '').toUpperCase();
      const amount = parseInt(m[2], 10);
      if (!Number.isFinite(amount)) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      addUnrestrictedManaSymbols(state, controller, symbols);
      applyDamageToPlayer(ctx, targetId as any, amount);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${symbols}, ${amount} dmg)`);
      return true;
    }

    case "ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_UP_TO_ONE_TARGET_PLAYER_OR_PLANESWALKER": {
      const m = text.match(
        /^add (\{[wubrgc]\}(?:\{[wubrgc]\})*)\.?\s*[a-z0-9 ,'-]+ deals (\d+) damage to up to one target player or planeswalker\.?$/i
      );
      if (!m) return false;

      const symbols = String(m[1] || '').toUpperCase();
      const amount = parseInt(m[2], 10);
      if (!Number.isFinite(amount)) return false;

      const [targetId] = getTargets(triggerItem);

      addUnrestrictedManaSymbols(state, controller, symbols);

      // Up to one target: can be omitted.
      if (targetId) {
        const player = getPlayerById(ctx, targetId as any);
        if (player) {
          applyDamageToPlayer(ctx, targetId as any, amount);
        } else {
          const battlefield = getBattlefield(ctx);
          const perm = battlefield.find((p: any) => p?.id === targetId);
          if (perm) {
            const tl = String(perm?.card?.type_line || "").toLowerCase();
            if (tl.includes('planeswalker')) {
              applyDamageToPermanent(ctx, targetId, amount);
            }
          }
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${symbols}, ${amount} dmg)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_UP_TO_M_CREATURE_CARDS_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) creature cards? from among them and put them into your hand\. put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const maxCreatures = parseCountTokenWord(m[2]);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const selectable = revealed.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('creature'));
      const nonSelectable = revealed.filter((c: any) => !String(c?.type_line || '').toLowerCase().includes('creature'));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal up to ${Math.min(maxCreatures, revealed.length)} creature card(s) and put them into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to ${maxCreatures} creature card(s)` ,
        minSelections: 0,
        maxSelections: Math.min(Math.max(0, maxCreatures | 0), selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_CARD_AND_OR_A_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal a ([a-zA-Z][a-zA-Z\-]*) card and\/or an? ([a-zA-Z][a-zA-Z\-]*) card from among them and put them into your hand\. put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const type1 = String(m[2] || '').trim();
      const type2 = String(m[3] || '').trim();
      const type1Lower = type1.toLowerCase();
      const type2Lower = type2.toLowerCase();
      if (!type1Lower || !type2Lower) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const matchesEither = (c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes(type1Lower) || tl.includes(type2Lower);
      };

      const selectable = revealed.filter(matchesEither);
      const nonSelectable = revealed.filter((c: any) => !matchesEither(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal a ${type1} card and/or an ${type2} card and put them into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `a ${type1} card and/or an ${type2} card` ,
        minSelections: 0,
        maxSelections: Math.min(2, selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        maxTypes: {
          [type1Lower]: 1,
          [type2Lower]: 1,
        },
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? ([a-zA-Z][a-zA-Z\-]*) card from among them and put it into your hand\. put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const type1 = String(m[2] || '').trim();
      const type1Lower = type1.toLowerCase();
      if (!type1Lower) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const matchesType = (c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes(type1Lower);
      };

      const selectable = revealed.filter(matchesType);
      const nonSelectable = revealed.filter((c: any) => !matchesType(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal an ${type1} card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `an ${type1} card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        maxTypes: {
          [type1Lower]: 1,
        },
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_OR_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? ([a-zA-Z][a-zA-Z\-]*) or ([a-zA-Z][a-zA-Z\-]*) card from among them and put it into your hand\. put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const type1 = String(m[2] || '').trim();
      const type2 = String(m[3] || '').trim();
      const type1Lower = type1.toLowerCase();
      const type2Lower = type2.toLowerCase();
      if (!type1Lower || !type2Lower) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const matchesEither = (c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes(type1Lower) || tl.includes(type2Lower);
      };

      const selectable = revealed.filter(matchesEither);
      const nonSelectable = revealed.filter((c: any) => !matchesEither(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal an ${type1} or ${type2} card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `an ${type1} or ${type2} card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        maxTypes: {
          [type1Lower]: 1,
          [type2Lower]: 1,
        },
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_PUT_K_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put (one|two|three|four|five|six|seven|eight|nine|ten|\d+) of them into your hand and the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const k = parseCountTokenWord(m[2]);
      if (!Number.isFinite(n) || !Number.isFinite(k)) return false;
      if (n <= 0 || k < 0) return false;
      if (k > n) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const maxPick = Math.min(Math.max(0, k | 0), revealed.length);

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (put ${maxPick} into your hand)` ,
        mandatory: true,
        sourceName,
        searchCriteria: `${maxPick} card(s)` ,
        minSelections: maxPick,
        maxSelections: maxPick,
        destination: "hand",
        reveal: false,
        shuffleAfter: false,
        remainderDestination: "bottom",
        remainderRandomOrder: true,
        availableCards: revealed.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_PUT_ONE_INTO_HAND_REST_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put one of them into your hand and the rest on the bottom of your library in any order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (put 1 into your hand)` ,
        mandatory: true,
        sourceName,
        searchCriteria: `1 card` ,
        minSelections: 1,
        maxSelections: 1,
        destination: "hand",
        reveal: false,
        shuffleAfter: false,
        remainderDestination: "bottom",
        remainderPlayerChoosesOrder: true,
        availableCards: revealed.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ARTIFACT_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? artifact card from among them and put it into your hand\. put the rest on the bottom of your library in any order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const isArtifact = (c: any) => String(c?.type_line || '').toLowerCase().includes('artifact');
      const selectable = revealed.filter(isArtifact);
      const nonSelectable = revealed.filter((c: any) => !isArtifact(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal an artifact card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to 1 artifact card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: "hand",
        reveal: true,
        shuffleAfter: false,
        remainderDestination: "bottom",
        remainderPlayerChoosesOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_TWO_EXILE_ONE_PUT_OTHER_INTO_HAND": {
      const m = text.match(
        /^look at the top two cards of your library\. exile one of them and put the other into your hand\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.min(2, lib.length));
      if (revealed.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (exile 1, put the other into your hand)` ,
        mandatory: true,
        sourceName,
        searchCriteria: `1 card` ,
        minSelections: 1,
        maxSelections: 1,
        destination: 'exile',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'hand',
        remainderRandomOrder: false,
        availableCards: revealed.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_EXILE_ONE_FACE_DOWN_REST_BOTTOM_ANY_ORDER_YOU_MAY_CAST_IT_IF_CREATURE": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. exile one face down and put the rest on the bottom of your library in any order\. for as long as it remains exiled, you may cast it if it(?:'|’)s a creature spell\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (exile 1 face down)` ,
        mandatory: true,
        sourceName,
        searchCriteria: `1 card` ,
        minSelections: 1,
        maxSelections: 1,
        destination: 'exile',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderPlayerChoosesOrder: true,
        destinationFaceDown: true,
        grantPlayableFromExileToController: true,
        playableFromExileTypeKey: 'creature',
        availableCards: revealed.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_AURA_CREATURE_OR_PLANESWALKER_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? aura, creature, or planeswalker card from among them and put it into your hand\. put the rest on the bottom of your library in any order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const typeKeys = ['aura', 'creature', 'planeswalker'];
      const isMatch = (c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return typeKeys.some((k) => tl.includes(k));
      };

      const selectable = revealed.filter(isMatch);
      const nonSelectable = revealed.filter((c: any) => !isMatch(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal an Aura, creature, or planeswalker card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to 1 Aura, creature, or planeswalker card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderPlayerChoosesOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_CARDS_SELF": {
      const m = text.match(/(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i);
      const n = parseCountTokenWord(m?.[1] || "0");
      drawCardsFromZone(ctx, controller, n);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${n})`);
      return true;
    }

    case "DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL": {
      const m = text.match(/^draw cards equal to the greatest power among creatures you control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let maxPower = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        const power = getActualPowerToughness(perm, (ctx as any).state).power;
        if (Number.isFinite(power)) maxPower = Math.max(maxPower, power);
      }

      drawCardsFromZone(ctx, controller, maxPower);
      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${maxPower})`);
      return true;
    }

    case "DISCARD_YOUR_HAND_THEN_DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL": {
      const m = text.match(/^discard your hand, then draw cards equal to the greatest power among creatures you control\.?$/i);
      if (!m) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      if (z.hand.length > 0) {
        const moved = z.hand.map((c: any) => ({ ...c, zone: 'graveyard' }));
        z.graveyard.push(...moved);
        z.hand = [];
      }
      z.handCount = (z.hand as any[]).length;
      z.graveyardCount = (z.graveyard as any[]).length;

      const battlefield = getBattlefield(ctx);
      let maxPower = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        const power = getActualPowerToughness(perm, (ctx as any).state).power;
        if (Number.isFinite(power)) maxPower = Math.max(maxPower, power);
      }

      drawCardsFromZone(ctx, controller, maxPower);
      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (drew ${maxPower})`);
      return true;
    }

    case "DISCARD_YOUR_HAND_THEN_EXILE_TOP_THREE_CARDS_OF_YOUR_LIBRARY_UNTIL_END_OF_TURN_YOU_MAY_PLAY_CARDS_EXILED_THIS_WAY": {
      const m = text.match(
        /^discard your hand, then exile the top three cards of your library\.\s*until end of turn, you may play cards exiled this way\.?$/i
      );
      if (!m) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      // Discard your hand.
      if (z.hand.length > 0) {
        const moved = z.hand.map((c: any) => ({ ...c, zone: 'graveyard' }));
        z.graveyard.push(...moved);
        z.hand = [];
      }
      z.handCount = (z.hand as any[]).length;
      z.graveyardCount = (z.graveyard as any[]).length;

      // Exile the top three cards of your library.
      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) {
        ;(ctx as any).bumpSeq?.();
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled 0)`);
        return true;
      }

      (state as any).playableFromExile = (state as any).playableFromExile || {};
      const pfe = ((state as any).playableFromExile[controller] = (state as any).playableFromExile[controller] || {});

      const actual = Math.max(0, Math.min(3, lib.length));
      for (let i = 0; i < actual; i++) {
        const topCard = lib.shift();
        const cardId = String((topCard as any)?.id || uid('c'));
        const exiled = {
          ...topCard,
          id: cardId,
          zone: 'exile',
          exiledBy: sourceName,
          exiledWithSourceId: triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id,
          exiledWithOracleId: triggerItem?.planeswalker?.oracleId,
          exiledWithSourceName: sourceName,
          canBePlayedBy: controller,
          playableUntilTurn: (state as any).turnNumber ?? 0,
        };
        z.exile.push(exiled);
        pfe[cardId] = (state as any).turnNumber ?? 0;
      }

      (ctx as any).libraries?.set(controller, lib);
      z.libraryCount = lib.length;
      if (typeof z.exileCount === 'number') z.exileCount = z.exile.length;

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${actual})`);
      return true;
    }

    case "YOU_GAIN_LIFE_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL": {
      const m = text.match(/^you gain life equal to the greatest power among creatures you control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let maxPower = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        const power = getActualPowerToughness(perm, (ctx as any).state).power;
        if (Number.isFinite(power)) maxPower = Math.max(maxPower, power);
      }

      if (maxPower > 0) modifyLifeLikeStack(ctx, controller, maxPower);
      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${maxPower})`);
      return true;
    }

    case "LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_BOTTOM": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || {};
      const lib: any[] = Array.isArray(z.library) ? z.library : [];
      const topTwo = lib.slice(0, 2);
      if (topTwo.length < 2) return true;

      const options = topTwo.map((c: any) => ({
        id: c.id,
        label: c.name || "Unknown",
        description: c.type_line,
        imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Put one into your hand and the other on the bottom of your library`,
        mandatory: true,
        sourceName: sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        pwLook2Pick1HandBottom: true,
        pwLook2Controller: controller,
        pwLook2SourceName: sourceName,
        pwLook2TopCardIds: topTwo.map((c: any) => c.id),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_INTO_GRAVEYARD": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || {};
      const lib: any[] = Array.isArray(z.library) ? z.library : [];
      const topTwo = lib.slice(0, 2);
      if (topTwo.length < 2) return true;

      const options = topTwo.map((c: any) => ({
        id: c.id,
        label: c.name || "Unknown",
        description: c.type_line,
        imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Put one into your hand and the other into your graveyard`,
        mandatory: true,
        sourceName: sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        pwLook2Pick1HandOtherGraveyard: true,
        pwLook2Controller: controller,
        pwLook2SourceName: sourceName,
        pwLook2TopCardIds: topTwo.map((c: any) => c.id),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_TWO_PUT_ONE_INTO_GRAVEYARD": {
      const m = text.match(/^look at the top two cards of your library\. put one of them into your graveyard\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || {};
      const lib: any[] = Array.isArray(z.library) ? z.library : [];
      const topTwo = lib.slice(0, 2);

      if (topTwo.length === 0) return true;
      if (topTwo.length === 1) {
        const moved = lib.splice(0, 1).map((c: any) => ({ ...c, zone: 'graveyard' }));
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.graveyard.unshift(...moved);
        z.libraryCount = lib.length;
        z.graveyardCount = z.graveyard.length;
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (1 card)`);
        return true;
      }

      const options = topTwo.map((c: any) => ({
        id: c.id,
        label: c.name || 'Unknown',
        description: c.type_line,
        imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Put one into your graveyard`,
        mandatory: true,
        sourceName: sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        pwLook2Put1Graveyard: true,
        pwLook2Controller: controller,
        pwLook2SourceName: sourceName,
        pwLook2TopCardIds: topTwo.map((c: any) => c.id),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "REVEAL_TOP_THREE_OPPONENT_SEPARATES_INTO_TWO_PILES_PUT_ONE_INTO_HAND_OTHER_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^reveal the top three cards of your library\.\s*an opponent separates those cards into two piles\.\s*put one pile into your hand and the other on the bottom of your library in any order\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const z = (zones[controller] = zones[controller] || {
        library: [],
        libraryCount: 0,
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });

      const lib: any[] = Array.isArray(z.library) ? z.library : [];
      const revealed: any[] = lib.splice(0, Math.min(3, lib.length));
      z.library = lib;
      z.libraryCount = lib.length;
      if (revealed.length === 0) return true;

      const opponents = (state as any)?.players
        ? (state as any).players.filter((p: any) => p?.id !== controller && !p?.eliminated)
        : [];

      // No opponent in the game => put all revealed into hand.
      if (!opponents.length) {
        const hand: any[] = Array.isArray(z.hand) ? z.hand : [];
        for (const c of revealed) hand.push({ ...c, zone: 'hand' });
        z.hand = hand;
        z.handCount = hand.length;
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no opponents)`);
        return true;
      }

      const topCardIds = revealed.map((c: any) => c?.id).filter(Boolean);

      const twoPileStep = (opponentId: string) => {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TWO_PILE_SPLIT,
          playerId: opponentId as any,
          description: `${sourceName}: Separate the revealed cards into two piles`,
          mandatory: true,
          sourceName,
          items: revealed.map((c: any) => ({
            id: c.id,
            label: c.name || 'Unknown',
            description: c.type_line,
            imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
          })),
          minPerPile: 0,
          pwJaceTop3TwoPiles: true,
          pwJaceControllerId: controller,
          pwJaceSourceName: sourceName,
          pwJaceTopCards: revealed,
          pwJaceTopCardIds: topCardIds,
        } as any);
      };

      if (opponents.length === 1) {
        twoPileStep(String(opponents[0].id));
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller as any,
        description: `${sourceName}: Choose an opponent to separate the revealed cards into two piles`,
        mandatory: true,
        sourceName,
        options: opponents.map((p: any) => ({ id: p.id, label: p.name || p.id })),
        minSelections: 1,
        maxSelections: 1,
        pwJaceTop3ChooseOpponent: true,
        pwJaceControllerId: controller,
        pwJaceSourceName: sourceName,
        pwJaceTopCards: revealed,
        pwJaceTopCardIds: topCardIds,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_DISCARD_A_CARD_IF_YOU_DO_DRAW_A_CARD": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[controller]?.hand || [];
      if (!hand.length) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: You may discard a card. If you do, draw a card.`,
        mandatory: true,
        sourceName: sourceName,
        options: [
          { id: "discard", label: "Discard a card", description: "Then draw a card." },
          { id: "dont", label: "Don't discard", description: "Do nothing." },
        ],
        minSelections: 1,
        maxSelections: 1,
        pwMayDiscardThenDraw: true,
        pwMayDiscardThenDrawStage: "ask",
        pwMayDiscardThenDrawPlayerId: controller,
        pwMayDiscardThenDrawSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_A_CARD_THEN_DISCARD_A_CARD": {
      drawCardsFromZone(ctx, controller, 1);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[controller]?.hand || [];
      if (!hand.length) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controller,
        description: `${sourceName}: Discard 1 card`,
        mandatory: true,
        sourceName: sourceName,
        discardCount: 1,
        hand: hand.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued discard)`);
      return true;
    }

    case "DRAW_A_CARD_THEN_DISCARD_A_CARD_AT_RANDOM": {
      const m = text.match(/^draw a card, then discard a card at random\.?$/i);
      if (!m) return false;

      drawCardsFromZone(ctx, controller, 1);

      const zones = (state as any)?.zones || {};
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      if (z.hand.length > 0) {
        const rng = typeof (ctx as any).rng === 'function' ? (ctx as any).rng : Math.random;
        const r = typeof rng === 'function' ? rng() : Math.random();
        const idx = Math.max(0, Math.min(z.hand.length - 1, Math.floor(r * z.hand.length)));
        const [discarded] = z.hand.splice(idx, 1);
        if (discarded) {
          z.graveyard.push({ ...discarded, zone: 'graveyard' });
        }
      }

      z.handCount = z.hand.length;
      z.graveyardCount = z.graveyard.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DRAW_TWO_CARDS_THEN_DISCARD_A_CARD": {
      drawCardsFromZone(ctx, controller, 2);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[controller]?.hand || [];
      if (!hand.length) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controller,
        description: `${sourceName}: Discard 1 card`,
        mandatory: true,
        sourceName: sourceName,
        discardCount: 1,
        hand: hand.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued discard)`);
      return true;
    }

    case "DRAW_A_CARD_YOU_MAY_PLAY_AN_ADDITIONAL_LAND_THIS_TURN": {
      const m = text.match(/^draw a card\. you may play an additional land this turn\.?$/i);
      if (!m) return false;

      drawCardsFromZone(ctx, controller, 1);
      applyTemporaryLandBonus(ctx, controller, 1);
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_PLAYER_DISCARDS_A_CARD": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      const m = text.match(
        /^target player discards (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i
      );
      if (!m) return false;
      const discardCount = parseCountTokenWord(m[1]);
      if (discardCount <= 0) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[targetId]?.hand || [];
      if (!hand.length) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: targetId as any,
        description: `${sourceName}: Discard ${discardCount} card${discardCount === 1 ? '' : 's'}`,
        mandatory: true,
        sourceName: sourceName,
        discardCount,
        hand: hand.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId})`);
      return true;
    }

    case "TARGET_PLAYERS_LIFE_TOTAL_BECOMES_1": {
      const m = text.match(/^target player's life total becomes 1\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      const startingLife = (state as any)?.startingLife || 40;
      (state as any).life = (state as any).life || {};
      const currentLife = (state as any).life[targetId] ?? player.life ?? startingLife;
      const delta = 1 - Number(currentLife || 0);
      modifyLifeLikeStack(ctx, targetId as any, delta);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId})`);
      return true;
    }

    case "TARGET_PLAYERS_LIFE_TOTAL_BECOMES_N": {
      const m = text.match(
        /^target (player's|opponent's) life total becomes (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+)\.?$/i
      );
      if (!m) return false;

      const isOpponent = String(m[1] || '').toLowerCase().includes('opponent');
      const targetLife = parseCountTokenWord(m[2]);
      if (targetLife <= 0) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      if (isOpponent && targetId === controller) return false;

      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      const startingLife = (state as any)?.startingLife || 40;
      (state as any).life = (state as any).life || {};
      const currentLife = (state as any).life[targetId] ?? player.life ?? startingLife;
      const delta = targetLife - Number(currentLife || 0);
      modifyLifeLikeStack(ctx, targetId as any, delta);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, life=${targetLife})`);
      return true;
    }

    case "TARGET_PLAYER_DRAWS_N_CARDS": {
      const m = text.match(
        /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (n <= 0) return true;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      drawCardsFromZone(ctx, targetId as any, n);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, draw ${n})`);
      return true;
    }

    case "TARGET_PLAYER_DRAWS_N_CARDS_AND_LOSES_N_LIFE": {
      const m = text.match(
        /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards? and loses (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) life\.?$/i
      );
      if (!m) return false;

      const drawN = parseCountTokenWord(m[1]);
      const loseN = parseCountTokenWord(m[2]);

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      if (drawN > 0) drawCardsFromZone(ctx, targetId as any, drawN);
      if (loseN > 0) modifyLifeLikeStack(ctx, targetId as any, -loseN);

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, draw ${drawN}, lose ${loseN})`);
      return true;
    }

    case "TARGET_PLAYER_DRAWS_N_CARDS_THEN_DISCARDS_M_CARDS": {
      const m = text.match(
        /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?, then discards (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const drawN = parseCountTokenWord(m[1]);
      const discardM = parseCountTokenWord(m[2]);

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      if (drawN > 0) {
        drawCardsFromZone(ctx, targetId as any, drawN);
      }

      if (discardM <= 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, draw ${drawN})`);
        return true;
      }

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[targetId]?.hand || [];
      const actualDiscard = Math.max(0, Math.min(discardM, hand.length));
      if (actualDiscard <= 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, no discard)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: targetId as any,
        description: `${sourceName}: Discard ${actualDiscard} card${actualDiscard === 1 ? '' : 's'}`,
        mandatory: true,
        sourceName: sourceName,
        discardCount: actualDiscard,
        hand: hand.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, draw ${drawN}, queued discard ${actualDiscard})`);
      return true;
    }

    case "ANY_NUMBER_OF_TARGET_PLAYERS_EACH_DRAW_N_CARDS": {
      const m = text.match(
        /^any number of target players each draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (n <= 0) return true;

      const targets = getTargets(triggerItem);
      if (!targets.length) return false;

      for (const targetId of targets) {
        const player = getPlayerById(ctx, targetId as any);
        if (!player) continue;
        drawCardsFromZone(ctx, targetId as any, n);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (targets=${targets.length}, draw ${n})`);
      return true;
    }

    case "ADD_MANA_SYMBOLS": {
      const m = text.match(/^add (\{[WUBRGC]\}(?:\{[WUBRGC]\})*)\.?$/i);
      if (!m) return false;
      addUnrestrictedManaSymbols(state, controller, m[1]);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${m[1]})`);
      return true;
    }

    case "ADD_MANA_SYMBOL_FOR_EACH_PLANESWALKER_YOU_CONTROL": {
      const m = text.match(/^add (\{[WUBRGC]\}) for each planeswalker you control\.?$/i);
      if (!m) return false;

      const symbol = String(m[1] || "").toUpperCase();
      const battlefield = getBattlefield(ctx);

      let count = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (String((perm as any).controller || "") !== String(controller)) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || "").toLowerCase();
        if (typeLineLower.includes("planeswalker")) count++;
      }

      if (count > 0) {
        switch (symbol) {
          case "{W}":
            getOrInitManaPool(state, controller).white += count;
            break;
          case "{U}":
            getOrInitManaPool(state, controller).blue += count;
            break;
          case "{B}":
            getOrInitManaPool(state, controller).black += count;
            break;
          case "{R}":
            getOrInitManaPool(state, controller).red += count;
            break;
          case "{G}":
            getOrInitManaPool(state, controller).green += count;
            break;
          case "{C}":
            getOrInitManaPool(state, controller).colorless += count;
            break;
          default:
            return false;
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${symbol} x${count})`);
      return true;
    }

    case "ADD_MANA_SYMBOL_FOR_EACH_BASIC_LAND_TYPE_YOU_CONTROL": {
      const m = text.match(/^add (\{[WUBRGC]\}) for each (plains|island|swamp|mountain|forest) you control\.?$/i);
      if (!m) return false;

      const symbol = String(m[1] || '').toUpperCase();
      const landType = String(m[2] || '').toLowerCase();
      const battlefield = getBattlefield(ctx);

      let count = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (String((perm as any).controller || '') !== String(controller)) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || '').toLowerCase();
        if (!typeLineLower.includes('land')) continue;
        if (typeLineLower.includes(landType)) count++;
      }

      if (count > 0) {
        switch (symbol) {
          case '{W}':
            getOrInitManaPool(state, controller).white += count;
            break;
          case '{U}':
            getOrInitManaPool(state, controller).blue += count;
            break;
          case '{B}':
            getOrInitManaPool(state, controller).black += count;
            break;
          case '{R}':
            getOrInitManaPool(state, controller).red += count;
            break;
          case '{G}':
            getOrInitManaPool(state, controller).green += count;
            break;
          case '{C}':
            getOrInitManaPool(state, controller).colorless += count;
            break;
          default:
            return false;
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${symbol} x${count} for ${landType})`);
      return true;
    }

    case "ADD_TWO_MANA_ANY_COMBINATION": {
      const m = text.match(/^add two mana in any combination of colors\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const colorOptions = [
        { id: "white", label: "White" },
        { id: "blue", label: "Blue" },
        { id: "black", label: "Black" },
        { id: "red", label: "Red" },
        { id: "green", label: "Green" },
      ];

      // Reuse the existing two-step chooser flow, but mark it as unrestricted.
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a color for the first mana`,
        mandatory: true,
        sourceName: sourceName,
        options: colorOptions,
        minSelections: 1,
        maxSelections: 1,
        pwAddTwoManaAnyCombination: true,
        pwAddTwoManaStage: "first",
        pwAddTwoManaController: controller,
        pwAddTwoManaSourceName: sourceName,
        pwAddTwoManaSourceId: sourceId,
        pwAddTwoManaRestriction: "unrestricted",
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "ADD_TEN_MANA_ANY_ONE_COLOR": {
      const m = text.match(/^add ten mana of any one color\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const colorOptions = [
        { id: "white", label: "White" },
        { id: "blue", label: "Blue" },
        { id: "black", label: "Black" },
        { id: "red", label: "Red" },
        { id: "green", label: "Green" },
      ];

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a color to add ten mana`,
        mandatory: true,
        sourceName: sourceName,
        options: colorOptions,
        minSelections: 1,
        maxSelections: 1,
        pwAddTenManaOneColor: true,
        pwAddTenManaController: controller,
        pwAddTenManaSourceName: sourceName,
        pwAddTenManaSourceId: sourceId,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DEALS_DAMAGE_TO_TARGET_CREATURE": {
      const m = text.match(/^([a-z0-9 ,'-]+) deals (\d+) damage to target creature\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[2], 10) || 0;
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      applyDamageToPermanent(ctx, targetId, amount);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount})`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_CREATURE_AND_M_DAMAGE_TO_THAT_CREATURES_CONTROLLER": {
      const m = text.match(
        /^([a-z0-9 ,'-]+) deals (\d+) damage to target creature and (\d+) damage to that creature's controller\.?$/i
      );
      if (!m) return false;

      const dmgToCreature = parseInt(m[2], 10);
      const dmgToController = parseInt(m[3], 10);
      if (!Number.isFinite(dmgToCreature) || !Number.isFinite(dmgToController)) return false;

      const [targetCreatureId] = getTargets(triggerItem);
      if (!targetCreatureId) return false;

      const battlefield = getBattlefield(ctx);
      const creature = battlefield.find((p: any) => p?.id === targetCreatureId);
      if (!creature) return false;

      applyDamageToPermanent(ctx, targetCreatureId, dmgToCreature);

      const creatureController = (creature as any)?.controller as PlayerID | undefined;
      if (creatureController) {
        applyDamageToPlayer(ctx, creatureController, dmgToController);
      }

      (ctx as any).bumpSeq?.();
      debug(
        2,
        `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${dmgToCreature} to creature, ${dmgToController} to controller)`
      );
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_THAT_PLAYER_CONTROLS": {
      const m = text.match(
        /^([a-z0-9 ,'-]+) deals (\d+) damage to target player and each creature that player controls\.?$/i
      );
      if (!m) return false;

      const amount = parseInt(m[2], 10);
      if (!Number.isFinite(amount)) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      const targetPlayer = getPlayerById(ctx, targetPlayerId as any);
      if (!targetPlayer) return false;

      applyDamageToPlayer(ctx, targetPlayerId as any, amount);

      const battlefield = getBattlefield(ctx);
      for (const perm of battlefield) {
        if (!perm?.id) continue;
        if (String((perm as any).controller || '') !== String(targetPlayerId)) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || '').toLowerCase();
        if (!typeLineLower.includes('creature')) continue;
        applyDamageToPermanent(ctx, perm.id, amount);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount})`);
      return true;
    }

    case "DEALS_X_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS": {
      const m = text.match(
        /^([a-z0-9 ,'-]+) deals x damage to each of up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) targets?\.?$/i
      );
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const maxTargets = parseCountTokenWord(m[2]);
      const targetIds = getTargets(triggerItem).filter(Boolean).slice(0, Math.max(0, maxTargets | 0));
      if (!targetIds.length) return false;

      for (const targetId of targetIds) {
        const player = getPlayerById(ctx, targetId as any);
        if (player) {
          applyDamageToPlayer(ctx, targetId as any, x);
        } else {
          applyDamageToPermanent(ctx, targetId, x);
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x} to ${targetIds.length})`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS": {
      const m = text.match(
        /^([a-z0-9 ,'-]+) deals (\d+) damage to each of up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) targets?\.?$/i
      );
      if (!m) return false;

      const amount = parseInt(m[2], 10);
      if (!Number.isFinite(amount)) return false;

      const maxTargets = parseCountTokenWord(m[3]);
      const targetIds = getTargets(triggerItem).filter(Boolean).slice(0, Math.max(0, maxTargets | 0));
      if (!targetIds.length) return false;

      for (const targetId of targetIds) {
        const player = getPlayerById(ctx, targetId as any);
        if (player) {
          applyDamageToPlayer(ctx, targetId as any, amount);
        } else {
          applyDamageToPermanent(ctx, targetId, amount);
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to ${targetIds.length})`);
      return true;
    }

    case "YOU_DEAL_X_DAMAGE_TO_ANY_TARGET": {
      const m = text.match(/^you deal x damage to any target\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const player = getPlayerById(ctx, targetId as any);
      if (player) {
        applyDamageToPlayer(ctx, targetId as any, x);
        (ctx as any).bumpSeq?.();
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x} to player)`);
        return true;
      }

      applyDamageToPermanent(ctx, targetId, x);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x} to permanent)`);
      return true;
    }

    case "TARGET_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_OR_PLANESWALKER": {
      const m = text.match(/^target creature you control deals damage equal to its power to target creature or planeswalker\.?$/i);
      if (!m) return false;

      const targets = getTargets(triggerItem);
      const [sourceCreatureId, targetPermanentId] = targets;
      if (!sourceCreatureId || !targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);

      const sourcePerm = battlefield.find((p: any) => p?.id === sourceCreatureId);
      if (!sourcePerm) return false;
      if (String((sourcePerm as any).controller || "") !== String(controller)) return false;
      const sourceTypeLineLower = String((sourcePerm as any)?.card?.type_line || "").toLowerCase();
      if (!sourceTypeLineLower.includes("creature")) return false;

      const targetPerm = battlefield.find((p: any) => p?.id === targetPermanentId);
      if (!targetPerm) return false;
      const targetTypeLineLower = String((targetPerm as any)?.card?.type_line || "").toLowerCase();
      if (!targetTypeLineLower.includes("creature") && !targetTypeLineLower.includes("planeswalker")) return false;

      const pt = getActualPowerToughness(sourcePerm, (ctx as any).state);
      const power = Math.max(0, (pt as any).power | 0);
      if (power <= 0) {
        (ctx as any).bumpSeq?.();
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (power=${power})`);
        return true;
      }

      applyDamageToPermanent(ctx, targetPermanentId, power);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${power})`);
      return true;
    }

    case "EXILE_TARGET_CREATURE": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      movePermanentToExile(ctx, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TARGET_CREATURE_YOU_CONTROL_FOR_EACH_OTHER_PLAYER_EXILE_UP_TO_ONE_TARGET_CREATURE_THAT_PLAYER_CONTROLS": {
      const m = text.match(
        /^exile target creature you control\. for each other player, exile up to one target creature that player controls\.?$/i
      );
      if (!m) return false;

      const targets = getTargets(triggerItem);
      if (!targets.length) return false;

      const battlefield = getBattlefield(ctx);
      for (const targetId of targets) {
        const perm = battlefield.find((p: any) => p?.id === targetId);
        const typeLine = String(perm?.card?.type_line || '').toLowerCase();
        if (!perm || !typeLine.includes('creature')) continue;
        movePermanentToExile(ctx, targetId);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (targets=${targets.length})`);
      return true;
    }

    case "EXILE_TARGET_CREATURE_WITH_POWER_N_OR_GREATER": {
      const m = text.match(/^exile target creature with power (\d+) or greater\.?$/i);
      if (!m) return false;

      const threshold = parseInt(m[1], 10) || 0;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      const power = getActualPowerToughness(perm, (ctx as any).state).power | 0;
      if (power < threshold) return false;

      movePermanentToExile(ctx, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (power=${power}, threshold=${threshold})`);
      return true;
    }

    case "EXILE_TARGET_ENCHANTMENT_TAPPED_ARTIFACT_OR_TAPPED_CREATURE": {
      const m = text.match(/^exile target enchantment, tapped artifact, or tapped creature\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return false;

      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      const isEnchantment = typeLine.includes('enchantment');
      const isTappedArtifact = !!(perm as any).tapped && typeLine.includes('artifact');
      const isTappedCreature = !!(perm as any).tapped && typeLine.includes('creature');

      if (!isEnchantment && !isTappedArtifact && !isTappedCreature) return false;

      movePermanentToExile(ctx, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_ARTIFACT_OR_ENCHANTMENT": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || (!typeLine.includes("artifact") && !typeLine.includes("enchantment"))) return false;

      movePermanentToGraveyard(ctx, targetId, true);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_CREATE_A_TREASURE_TOKEN": {
      const m = text.match(
        /^destroy target artifact, creature, or enchantment\.\s*create a treasure token\.?(?:\s*\([^)]*\))*\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || (!typeLine.includes('artifact') && !typeLine.includes('creature') && !typeLine.includes('enchantment'))) return false;

      movePermanentToGraveyard(ctx, targetId, true);

      const spec = (predefinedArtifactTokens as any).treasure;
      if (spec) {
        createToken(ctx, controller, spec.name, 1, undefined, undefined, {
          colors: spec.colors,
          typeLine: spec.typeLine,
          abilities: spec.abilities,
          isArtifact: true,
        });
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_DRAW_A_CARD": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      movePermanentToGraveyard(ctx, targetId, true);
      drawCardsFromZone(ctx, controller, 1);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_PUT_LOYALTY_COUNTERS_ON_SOURCE_EQUAL_TO_THAT_CREATURES_TOUGHNESS": {
      const m = text.match(
        /^destroy target creature\.\s*put loyalty counters on [a-z0-9 ,'-]+ equal to that creature's toughness\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const targetPerm = battlefield.find((p: any) => p?.id === targetId);
      const targetTypeLine = String(targetPerm?.card?.type_line || "").toLowerCase();
      if (!targetPerm || !targetTypeLine.includes("creature")) return false;

      const toughness = Math.max(0, (getActualPowerToughness(targetPerm, (ctx as any).state) as any).toughness | 0);

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || triggerItem?.source;
      const sourcePerm = sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null;
      if (!sourcePerm) return false;
      const sourceTypeLine = String(sourcePerm?.card?.type_line || "").toLowerCase();
      if (!sourceTypeLine.includes('planeswalker')) return false;

      movePermanentToGraveyard(ctx, targetId, true);

      if (toughness > 0) {
        (sourcePerm as any).counters = (sourcePerm as any).counters || {};
        (sourcePerm as any).counters.loyalty = ((sourcePerm as any).counters.loyalty || 0) + toughness;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${toughness})`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_WITH_A_MINUS1_MINUS1_COUNTER_ON_IT": {
      const m = text.match(/^destroy target creature with a -1\/\-1 counter on it\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      const counters = (perm as any).counters || {};
      const hasMinusCounter = (counters['-1/-1'] || counters['minus1minus1'] || counters['m1m1'] || 0) > 0;
      if (!hasMinusCounter) return false;

      movePermanentToGraveyard(ctx, targetId, true);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_YOU_GAIN_LIFE_EQUAL_TO_ITS_TOUGHNESS": {
      const m = text.match(/^destroy target creature\.\s*you gain life equal to its toughness\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      const toughness = Math.max(0, (getActualPowerToughness(perm, (ctx as any).state) as any).toughness | 0);
      movePermanentToGraveyard(ctx, targetId, true);
      if (toughness > 0) modifyLifeLikeStack(ctx, controller, toughness);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${toughness})`);
      return true;
    }

    case "DESTROY_TARGET_ARTIFACT_ENCHANTMENT_OR_CREATURE_WITH_FLYING": {
      const m = text.match(/^destroy target artifact, enchantment, or creature with flying\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return false;

      const typeLine = String(perm?.card?.type_line || '').toLowerCase();
      const isArtifact = typeLine.includes('artifact');
      const isEnchantment = typeLine.includes('enchantment');
      const isCreature = typeLine.includes('creature');

      let hasFlying = false;
      if (isCreature) {
        const oracleTextLower = String(perm?.card?.oracle_text || '').toLowerCase();
        const granted = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        hasFlying = oracleTextLower.includes('flying') || granted.some((a: any) => String(a).toLowerCase().includes('flying'));
      }

      if (!isArtifact && !isEnchantment && !(isCreature && hasFlying)) return false;

      movePermanentToGraveyard(ctx, targetId, true);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_ITS_CONTROLLER_LOSES_2_LIFE": {
      const m = text.match(/^destroy target creature\.\s*its controller loses 2 life\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      const destroyedController = String((perm as any).controller || "");

      movePermanentToGraveyard(ctx, targetId, true);
      if (destroyedController) {
        modifyLifeLikeStack(ctx, destroyedController as any, -2);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_ITS_CONTROLLER_DRAWS_N_CARDS": {
      const m = text.match(
        /^destroy target creature\. its controller draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      const drawCount = parseCountTokenWord(m[1]);
      const destroyedController = String((perm as any).controller || "");

      movePermanentToGraveyard(ctx, targetId, true);
      if (drawCount > 0 && destroyedController) {
        drawCardsFromZone(ctx, destroyedController as any, drawCount);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${drawCount})`);
      return true;
    }

    case "YOU_GAIN_LIFE_AND_DRAW_A_CARD": {
      const m = text.match(/^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life and draw a card\.?$/i);
      if (!m) return false;
      const n = parseCountTokenWord(m[1]);
      modifyLifeLikeStack(ctx, controller, n);
      drawCardsFromZone(ctx, controller, 1);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${n})`);
      return true;
    }

    case "YOU_GAIN_N_LIFE_AND_DRAW_M_CARDS": {
      const m = text.match(
        /^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) life and draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;
      const lifeGain = parseCountTokenWord(m[1]);
      const drawCount = parseCountTokenWord(m[2]);
      if (lifeGain > 0) modifyLifeLikeStack(ctx, controller, lifeGain);
      if (drawCount > 0) drawCardsFromZone(ctx, controller, drawCount);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${lifeGain}, draw ${drawCount})`);
      return true;
    }

    case "YOU_GAIN_LIFE_FOR_EACH_CREATURE_YOU_CONTROL": {
      const m = text.match(/^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life for each creature you control\.?$/i);
      if (!m) return false;

      const per = parseCountTokenWord(m[1]);
      const battlefield = getBattlefield(ctx);
      let count = 0;
      for (const p of battlefield) {
        if (p?.controller !== controller) continue;
        const typeLine = String(p?.card?.type_line || "").toLowerCase();
        if (typeLine.includes("creature")) count++;
      }
      modifyLifeLikeStack(ctx, controller, per * count);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${per}x${count})`);
      return true;
    }

    case "CREATE_3_3_GREEN_BEAST_TOKEN_THEN_IF_OPPONENT_CONTROLS_MORE_CREATURES_PUT_LOYALTY_COUNTER_ON_SOURCE": {
      const m = text.match(
        /^create a 3\/3 green beast creature token\.\s*then if an opponent controls more creatures than you, put a loyalty counter on [a-z0-9 ,'-]+\.?$/i
      );
      if (!m) return false;

      const { colors } = parseCreateTokenDescriptor("green Beast creature token");
      createToken(ctx, controller, "Beast", 1, 3, 3, {
        colors,
        typeLine: "Token Creature — Beast",
      });

      const battlefield = getBattlefield(ctx);
      const countCreatures = (pid: any): number => {
        let n = 0;
        for (const perm of battlefield) {
          if (!perm?.card) continue;
          if ((perm as any).controller !== pid) continue;
          const tl = String((perm as any).card?.type_line || "").toLowerCase();
          if (tl.includes("creature")) n++;
        }
        return n;
      };

      const youCount = countCreatures(controller);
      const opponents = getOpponents(ctx, controller);
      const anyOpponentMore = opponents.some((oppId: any) => countCreatures(oppId) > youCount);

      if (anyOpponentMore) {
        const sourceId =
          triggerItem?.sourceId ||
          triggerItem?.sourcePermanentId ||
          triggerItem?.planeswalker?.id ||
          triggerItem?.source;

        const sourcePerm =
          (sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null) ||
          battlefield.find(
            (p: any) =>
              p?.controller === controller &&
              String(p?.card?.name || "").toLowerCase() === String(sourceName || "").toLowerCase() &&
              String(p?.card?.type_line || "").toLowerCase().includes("planeswalker")
          );

        if (sourcePerm) {
          (sourcePerm as any).counters = (sourcePerm as any).counters || {};
          (sourcePerm as any).counters.loyalty = ((sourcePerm as any).counters.loyalty || 0) + 1;
          (ctx as any).bumpSeq?.();
        }
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (oppMore=${anyOpponentMore})`);
      return true;
    }

    case "CREATE_3_3_GREEN_BEAST_TOKEN_CHOOSE_VIGILANCE_REACH_TRAMPLE_COUNTER": {
      const m = text.match(
        /^create a 3\/3 green beast creature token\.\s*put your choice of a vigilance counter, a reach counter, or a trample counter on it\.?$/i
      );
      if (!m) return false;

      const { colors } = parseCreateTokenDescriptor("green Beast creature token");
      const [tokenPermanentId] = createToken(ctx, controller, "Beast", 1, 3, 3, {
        colors,
        typeLine: "Token Creature — Beast",
      });

      // Best-effort fallback if we can't ask the player.
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying || !tokenPermanentId) {
        const battlefield = getBattlefield(ctx);
        const tokenPerm = battlefield.find((p: any) => p?.id === tokenPermanentId);
        if (tokenPerm) {
          tokenPerm.counters = tokenPerm.counters || {};
          tokenPerm.counters.vigilance = (tokenPerm.counters.vigilance || 0) + 1;
          tokenPerm.grantedAbilities = Array.isArray(tokenPerm.grantedAbilities) ? tokenPerm.grantedAbilities : [];
          if (!tokenPerm.grantedAbilities.includes("vigilance")) tokenPerm.grantedAbilities.push("vigilance");
          tokenPerm.card = tokenPerm.card || {};
          tokenPerm.card.keywords = tokenPerm.card.keywords || [];
          if (!tokenPerm.card.keywords.includes("Vigilance")) tokenPerm.card.keywords.push("Vigilance");
          (ctx as any).bumpSeq?.();
        }

        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (fallback=vigilance)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MODAL_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a counter type to put on the Beast token`,
        mandatory: true,
        sourceName,
        sourceImage: triggerItem?.card?.image_uris?.small || triggerItem?.card?.image_uris?.normal,
        promptTitle: "Choose Counter Type",
        promptDescription: "Put which keyword counter on the Beast token?",
        options: [
          { id: "vigilance", label: "Vigilance" },
          { id: "reach", label: "Reach" },
          { id: "trample", label: "Trample" },
        ],
        minSelections: 1,
        maxSelections: 1,
        pwBeastKeywordCounterData: {
          tokenPermanentId,
          tokenName: "Beast",
        },
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "CREATE_GREEN_TREEFOLK_TOKEN_REACH_PT_EQUALS_LANDS_YOU_CONTROL": {
      const m = text.match(
        /^create a green treefolk creature token with reach and "this token(?:'|’)s power and toughness are each equal to the number of lands you control\."\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const landsYouControl = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || "").toLowerCase();
        return tl.includes('land');
      }).length;

      const { name, colors, abilities } = parseCreateTokenDescriptor('green Treefolk creature token with reach');
      createToken(ctx, controller, name, 1, landsYouControl, landsYouControl, { colors, abilities });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${landsYouControl}/${landsYouControl} ${name})`);
      return true;
    }

    case "CREATE_BLUE_DOG_ILLUSION_TOKEN_PT_EQUALS_TWICE_CARDS_IN_HAND": {
      const m = text.match(
        /^create a blue dog illusion creature token with "this token(?:'|’)s power and toughness are each equal to twice the number of cards in your hand\."\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const z = zones?.[controller] || {};
      const handCountRaw = (z as any).handCount;
      const handCount = Number.isFinite(handCountRaw)
        ? Number(handCountRaw)
        : Array.isArray((z as any).hand)
          ? ((z as any).hand as any[]).length
          : 0;
      const pt = Math.max(0, 2 * handCount);

      const { name, colors, abilities } = parseCreateTokenDescriptor(
        'blue Dog Illusion creature token with "This token\'s power and toughness are each equal to twice the number of cards in your hand."'
      );
      createToken(ctx, controller, name, 1, pt, pt, { colors, abilities });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${pt}/${pt} ${name})`);
      return true;
    }

    case "CREATE_WHITE_AVATAR_TOKEN_PT_EQUALS_YOUR_LIFE_TOTAL": {
      const m = text.match(
        /^create a white avatar creature token\. it has "this token(?:'|’)s power and toughness are each equal to your life total\."\.?$/i
      );
      if (!m) return false;

      const startingLife = (state as any)?.startingLife ?? 40;
      const lifeTotal = ((state as any)?.life && (state as any).life[controller] != null)
        ? Number((state as any).life[controller])
        : Number((state as any)?.players?.find?.((p: any) => p?.id === controller)?.life ?? startingLife);
      const pt = Number.isFinite(lifeTotal) ? Math.max(0, lifeTotal) : startingLife;

      const { name, colors } = parseCreateTokenDescriptor('white Avatar creature token');
      createToken(ctx, controller, name, 1, pt, pt, {
        colors,
        abilities: ["This token's power and toughness are each equal to your life total."],
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${pt}/${pt} ${name})`);
      return true;
    }

    case "CREATE_MASK_AURA_TOKEN_ATTACHED_TO_TARGET_PERMANENT": {
      const m = text.match(
        /^create a white aura enchantment token named mask attached to another target permanent\. the token has enchant permanent and umbra armor\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const createdIds = createToken(ctx, controller, 'Mask', 1, undefined, undefined, {
        colors: ['W'],
        typeLine: 'Token Enchantment — Aura',
        abilities: ['Enchant permanent', 'Umbra armor'],
      });

      const battlefield = getBattlefield(ctx);
      const tokenId = createdIds[0];
      if (tokenId) {
        const auraPerm = battlefield.find((p: any) => p?.id === tokenId);
        if (auraPerm) (auraPerm as any).attachedTo = targetId;
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATE_STONEFORGED_BLADE_EQUIPMENT_TOKEN": {
      const m = text.match(
        /^create a colorless equipment artifact token named stoneforged blade\. it has indestructible, "equipped creature gets \+5\/\+5 and has double strike," and equip \{0\}\.?$/i
      );
      if (!m) return false;

      createToken(ctx, controller, 'Stoneforged Blade', 1, undefined, undefined, {
        colors: [],
        typeLine: 'Token Artifact — Equipment',
        abilities: ['Indestructible', 'Equipped creature gets +5/+5 and has double strike', 'Equip {0}'],
        isArtifact: true,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATE_TWO_NONLEGENDARY_TOKEN_COPIES_OF_SOURCE_PLANESWALKER": {
      const m = text.match(/^create two tokens that are copies of jace, except they(?:'|’)re not legendary\.?$/i);
      if (!m) return false;

      const sourceCard = triggerItem?.card;
      const sourceTypeLine = String(sourceCard?.type_line || '');
      if (!sourceCard || !sourceTypeLine) return false;

      const cleanedTypeLine = sourceTypeLine
        .replace(/\blegendary\b\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      const tokenTypeLine = `Token ${cleanedTypeLine}`.trim();
      const colors = Array.isArray((sourceCard as any).colors) ? (sourceCard as any).colors : [];
      const keywords = Array.isArray((sourceCard as any).keywords) ? (sourceCard as any).keywords : [];

      const createdIds = createToken(ctx, controller, String((sourceCard as any).name || 'Token Copy'), 2, undefined, undefined, {
        colors,
        typeLine: tokenTypeLine,
        abilities: keywords,
        isArtifact: tokenTypeLine.toLowerCase().includes('artifact'),
      });

      const loyaltyValue = parseInt(String((sourceCard as any).loyalty ?? ''), 10);
      const battlefield = getBattlefield(ctx);
      for (const id of createdIds) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm) continue;

        perm.card = perm.card || {};
        perm.card.name = String((sourceCard as any).name || perm.card.name || 'Token Copy');
        perm.card.type_line = cleanedTypeLine;
        perm.card.oracle_text = String((sourceCard as any).oracle_text || perm.card.oracle_text || '');
        perm.card.colors = colors;
        perm.card.keywords = keywords;

        if (Number.isFinite(loyaltyValue)) {
          perm.counters = perm.counters || {};
          perm.counters.loyalty = loyaltyValue;
          perm.loyalty = loyaltyValue;
          perm.baseLoyalty = loyaltyValue;
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (created ${createdIds.length})`);
      return true;
    }

    case "CREATE_TOKEN_BASIC": {
      const m = text.match(
        /^(?:create|put) (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (tapped )?(\d+)\/(\d+) ([^\.]+?) (?:creature\s+)?tokens?(?: with ([\s\S]+?))?(?:\s+onto the battlefield)?\.?$/i
      );
      if (!m) return false;

      const count = parseCountTokenWord(m[1]);
      const isTapped = !!m[2];
      const power = parseInt(m[3], 10);
      const toughness = parseInt(m[4], 10);
      const descriptor = `${m[5].trim()}${m[6] ? ` with ${m[6].trim()}` : ""}`;
      const { name, colors, abilities } = parseCreateTokenDescriptor(descriptor);

      const createdIds = createToken(ctx, controller, name, count, power, toughness, {
        colors,
        abilities,
      });

      if (isTapped) {
        const battlefield = getBattlefield(ctx);
        for (const id of createdIds) {
          const perm = battlefield.find((p: any) => p?.id === id);
          if (perm) perm.tapped = true;
        }
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count} ${power}/${toughness} ${name})`);
      return true;
    }

    case "CREATE_2_2_BLACK_ZOMBIE_TOKEN_MILL_TWO": {
      const m = text.match(/^create a 2\/2 black zombie creature token\.\s*mill two cards\.?$/i);
      if (!m) return false;

      const { name, colors, creatureTypes, abilities } = parseCreateTokenDescriptor('black Zombie creature token');
      createToken(ctx, controller, name, 1, 2, 2, {
        colors,
        abilities,
        typeLine: `Token Creature — ${creatureTypes.length ? creatureTypes.join(' ') : name}`,
      });

      millCards(ctx, controller, 2);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATE_2_2_BLUE_WIZARD_TOKEN_DRAW_THEN_DISCARD": {
      const m = text.match(/^create a 2\/2 blue wizard creature token\.\s*draw a card, then discard a card\.?$/i);
      if (!m) return false;

      const { name, colors, creatureTypes, abilities } = parseCreateTokenDescriptor('blue Wizard creature token');
      createToken(ctx, controller, name, 1, 2, 2, {
        colors,
        abilities,
        typeLine: `Token Creature — ${creatureTypes.length ? creatureTypes.join(' ') : name}`,
      });

      // Reuse existing draw+discard pattern (queue discard selection if possible).
      drawCardsFromZone(ctx, controller, 1);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no interaction)`);
        return true;
      }

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[controller]?.hand || [];
      if (!hand.length) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (empty hand)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controller,
        description: `${sourceName}: Discard 1 card`,
        mandatory: true,
        sourceName: sourceName,
        discardCount: 1,
        hand: hand.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued discard)`);
      return true;
    }

    case "CREATE_1_1_HUMAN_WIZARD_TOKEN_ALL_COLORS": {
      const m = text.match(/^create a 1\/1 human wizard creature token that(?:'|’)s all colors\.?$/i);
      if (!m) return false;

      createToken(ctx, controller, 'Human Wizard', 1, 1, 1, {
        colors: ['W', 'U', 'B', 'R', 'G'],
        abilities: [],
        typeLine: 'Token Creature — Human Wizard',
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATE_1_1_WHITE_KOR_SOLDIER_TOKEN_MAY_ATTACH_EQUIPMENT": {
      const m = text.match(/^create a 1\/1 white kor soldier creature token\.\s*you may attach an equipment you control to it\.?$/i);
      if (!m) return false;

      const [tokenPermanentId] = createToken(ctx, controller, 'Kor Soldier', 1, 1, 1, {
        colors: ['W'],
        abilities: [],
        typeLine: 'Token Creature — Kor Soldier',
      });

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying || !tokenPermanentId) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no interaction)`);
        return true;
      }

      const battlefield = getBattlefield(ctx);
      const controlsEquipment = battlefield.some(
        (p: any) => p && p.controller === controller && String(p.card?.type_line || '').toLowerCase().includes('equipment')
      );
      if (!controlsEquipment) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no equipment)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: You may attach an Equipment you control to the created Kor Soldier token.`,
        mandatory: false,
        sourceName,
        options: [
          { id: 'attach', label: 'Attach an Equipment' },
          { id: 'decline', label: 'Decline' },
        ],
        minSelections: 1,
        maxSelections: 1,
        attachEquipmentToCreatedToken: true,
        attachEquipmentToCreatedTokenPermanentId: tokenPermanentId,
        attachEquipmentToCreatedTokenController: controller,
        attachEquipmentToCreatedTokenSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "CREATE_X_1_1_RED_DEVIL_TOKENS_WHEN_DIES_DEAL_1_DAMAGE": {
      const m = text.match(
        /^create x 1\/1 red devil creature tokens? with\s+"when this creature dies, it deals 1 damage to any target\."\.?$/i
      );
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (x === null) return false;
      if (x <= 0) return true;

      createToken(ctx, controller, 'Devil', x, 1, 1, {
        colors: ['R'],
        abilities: ["When this creature dies, it deals 1 damage to any target."],
        typeLine: 'Token Creature — Devil',
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x})`);
      return true;
    }

    case "CREATE_X_X_GREEN_PHYREXIAN_HORROR_TOKEN_WHERE_X_IS_SOURCE_LOYALTY": {
      const m = text.match(
        /^create an x\/x green phyrexian horror creature token, where x is [a-z0-9 ,'-]+(?:'|’)s loyalty\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || triggerItem?.source;
      const sourcePerm = sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null;
      if (!sourcePerm) return false;

      const loyalty = Number((sourcePerm as any)?.counters?.loyalty ?? (sourcePerm as any)?.loyalty ?? 0) || 0;
      if (loyalty <= 0) return true;

      createToken(ctx, controller, 'Phyrexian Horror', 1, loyalty, loyalty, {
        colors: ['G'],
        abilities: [],
        typeLine: 'Token Creature — Phyrexian Horror',
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${loyalty})`);
      return true;
    }

    case "CREATE_TOKEN_COPY_TARGET_CREATURE_EXCEPT_HASTE_SAC_AT_END_STEP": {
      const m = text.match(
        /^create a token that['’]s a copy of target creature you control, except it has haste and\s+"at the beginning of the end step, sacrifice this token\."\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const orig = battlefield.find((p: any) => p?.id === targetId);
      if (!orig?.card) return false;
      if (orig.controller !== controller) return false;

      const origTypeLine = String(orig.card?.type_line || '').trim();
      const origTypeLineLower = origTypeLine.toLowerCase();
      if (!origTypeLineLower.includes('creature')) return false;

      const stateAny = (ctx as any).state as any;
      const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
      const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
      const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
      const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
      const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

      stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
        ? stateAny.pendingSacrificeAtNextEndStep
        : [];

      const origCard = (orig as any)?.card || {};
      const basePower = Number((orig as any)?.basePower ?? origCard?.power ?? 0) || 0;
      const baseToughness = Number((orig as any)?.baseToughness ?? origCard?.toughness ?? 0) || 0;
      const colors = Array.isArray(origCard?.colors)
        ? origCard.colors.map((c: any) => String(c || '').toUpperCase()).filter(Boolean)
        : [];

      const tokenTypeLine = `Token ${origTypeLine}`.trim();

      const [tokenPermanentId] = createToken(ctx, controller, String(origCard?.name || 'Token Copy'), 1, basePower, baseToughness, {
        colors,
        typeLine: tokenTypeLine,
        abilities: ['Haste', 'At the beginning of the end step, sacrifice this token.'],
      });
      if (!tokenPermanentId) return true;

      const tokenPerm = battlefield.find((p: any) => p?.id === tokenPermanentId);
      if (tokenPerm?.card) {
        const tokenCardId = String((tokenPerm as any).card?.id || '').trim();
        (tokenPerm as any).card = {
          ...(origCard as any),
          id: tokenCardId || (tokenPerm as any).card?.id,
          zone: 'battlefield',
          type_line: tokenTypeLine,
        };

        (tokenPerm as any).grantedAbilities = Array.isArray((tokenPerm as any).grantedAbilities) ? (tokenPerm as any).grantedAbilities : [];
        if (!(tokenPerm as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('haste'))) {
          (tokenPerm as any).grantedAbilities.push('Haste');
        }
        if (!(tokenPerm as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('sacrifice this token'))) {
          (tokenPerm as any).grantedAbilities.push('At the beginning of the end step, sacrifice this token.');
        }
      }

      stateAny.pendingSacrificeAtNextEndStep.push({
        permanentId: tokenPermanentId,
        fireAtTurnNumber,
        maxManaValue: 0,
        sourceName,
        createdBy: controller,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (created 1)`);
      return true;
    }

    case "CREATE_N_N_COLOR_SUBTYPE_CREATURE_TOKEN_FOR_EACH_LAND_YOU_CONTROL": {
      const m = text.match(
        /^create a (\d+)\/(\d+) ([a-z]+(?: and [a-z]+)*) ([a-z][a-z-]*(?: [a-z][a-z-]*)*) creature tokens? for each land you control\.?$/i
      );
      if (!m) return false;

      const power = parseInt(m[1], 10);
      const toughness = parseInt(m[2], 10);
      if (!Number.isFinite(power) || !Number.isFinite(toughness)) return false;

      const descriptor = `${m[3].trim()} ${m[4].trim()} creature token`;
      const { name, colors, creatureTypes, abilities } = parseCreateTokenDescriptor(descriptor);

      const battlefield = getBattlefield(ctx);
      let landCount = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || "").toLowerCase();
        if (tl.includes("land")) landCount++;
      }

      if (landCount <= 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (0 lands)`);
        return true;
      }

      createToken(ctx, controller, name, landCount, power, toughness, {
        colors,
        abilities,
        typeLine: `Token Creature — ${creatureTypes.length ? creatureTypes.join(" ") : name}`,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${landCount}x ${power}/${toughness} ${name})`);
      return true;
    }

    case "CREATE_N_1_1_COLOR_ELEMENTAL_CREATURE_TOKENS_THEY_GAIN_HASTE_SACRIFICE_NEXT_END_STEP": {
      const m = text.match(
        /^create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) 1\/1 ([a-z]+) elemental creature tokens?\.\s*they gain haste\.\s*sacrifice them at the beginning of the next end step\.?$/i
      );
      if (!m) return false;

      const count = parseCountTokenWord(m[1]);
      const colorWord = String(m[2] || '').trim();
      if (!Number.isFinite(count) || count <= 0) return true;

      const descriptor = `${colorWord} Elemental creature token with haste`;
      const { name, colors, creatureTypes, abilities } = parseCreateTokenDescriptor(descriptor);

      const createdIds = createToken(ctx, controller, name, count, 1, 1, {
        colors,
        abilities,
        typeLine: `Token Creature — ${creatureTypes.length ? creatureTypes.join(' ') : name}`,
      });

      const stateAny = (ctx as any).state as any;
      const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
      const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
      const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
      const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
      const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

      stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
        ? stateAny.pendingSacrificeAtNextEndStep
        : [];
      for (const id of createdIds) {
        stateAny.pendingSacrificeAtNextEndStep.push({
          permanentId: id,
          fireAtTurnNumber,
          maxManaValue: 0,
          sourceName,
          createdBy: controller,
        });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count} 1/1 ${name}, sac next end)`);
      return true;
    }

    case "FOR_EACH_ARTIFACT_YOU_CONTROL_CREATE_TOKEN_THATS_A_COPY_TOKENS_GAIN_HASTE_EXILE_NEXT_END_STEP": {
      const m = text.match(
        /^for each artifact you control, create a token that['’]s a copy of it\.\s*those tokens gain haste\.\s*exile those tokens at the beginning of the next end step\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const artifactsSnapshot = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const typeLineLower = String(p.card?.type_line || '').toLowerCase();
        return typeLineLower.includes('artifact');
      });

      if (artifactsSnapshot.length === 0) return true;

      const stateAny = (ctx as any).state as any;
      const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
      const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
      const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
      const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
      const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

      stateAny.pendingExileAtNextEndStep = Array.isArray(stateAny.pendingExileAtNextEndStep)
        ? stateAny.pendingExileAtNextEndStep
        : [];

      const createdTokenIds: string[] = [];
      for (const orig of artifactsSnapshot) {
        const origCard = (orig as any)?.card || {};
        const origTypeLine = String(origCard?.type_line || '').trim();
        if (!origTypeLine) continue;

        const typeLineLower = origTypeLine.toLowerCase();
        const isCreature = typeLineLower.includes('creature');
        const basePower = isCreature ? (Number((orig as any)?.basePower ?? origCard?.power ?? 0) || 0) : undefined;
        const baseToughness = isCreature ? (Number((orig as any)?.baseToughness ?? origCard?.toughness ?? 0) || 0) : undefined;
        const colors = Array.isArray(origCard?.colors)
          ? origCard.colors.map((c: any) => String(c || '').toUpperCase()).filter(Boolean)
          : [];

        const [tokenPermanentId] = createToken(ctx, controller, String(origCard?.name || 'Token Copy'), 1, basePower, baseToughness, {
          colors,
          typeLine: `Token ${origTypeLine}`.trim(),
          abilities: ['Haste'],
          isArtifact: true,
        });
        if (!tokenPermanentId) continue;
        createdTokenIds.push(tokenPermanentId);

        const tokenPerm = battlefield.find((p: any) => p?.id === tokenPermanentId);
        if (tokenPerm?.card) {
          const tokenCardId = String((tokenPerm as any).card?.id || '').trim();
          (tokenPerm as any).card = {
            ...(origCard as any),
            id: tokenCardId || (tokenPerm as any).card?.id,
            zone: 'battlefield',
            type_line: `Token ${origTypeLine}`.trim(),
          };

          (tokenPerm as any).grantedAbilities = Array.isArray((tokenPerm as any).grantedAbilities) ? (tokenPerm as any).grantedAbilities : [];
          if (!(tokenPerm as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('haste'))) {
            (tokenPerm as any).grantedAbilities.push('Haste');
          }
        }

        stateAny.pendingExileAtNextEndStep.push({
          permanentId: tokenPermanentId,
          fireAtTurnNumber,
          sourceName,
          createdBy: controller,
        });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (created ${createdTokenIds.length})`);
      return true;
    }

    case "CREATE_TOKEN_THATS_A_COPY_OF_TARGET_ARTIFACT_OR_CREATURE_YOU_CONTROL_IT_GAINS_HASTE_EXILE_NEXT_END_STEP": {
      const m = text.match(
        /^create a token that['’]s a copy of target (?:artifact or creature|artifact|creature) you control(?:, except it(?:'|’)s an artifact in addition to its other types)?\.\s*that token gains haste\.\s*exile (?:it|that token) at the beginning of the next end step\.?$/i
      );
      if (!m) return false;

      const isArtifactAdded = /artifact in addition to its other types/i.test(text);

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const orig = battlefield.find((p: any) => p?.id === targetId);
      if (!orig?.card) return false;
      if (orig.controller !== controller) return false;

      const origTypeLine = String(orig.card?.type_line || '').trim();
      const origTypeLineLower = origTypeLine.toLowerCase();
      if (!(origTypeLineLower.includes('artifact') || origTypeLineLower.includes('creature'))) return false;

      const stateAny = (ctx as any).state as any;
      const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
      const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
      const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
      const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
      const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

      stateAny.pendingExileAtNextEndStep = Array.isArray(stateAny.pendingExileAtNextEndStep)
        ? stateAny.pendingExileAtNextEndStep
        : [];

      const origCard = (orig as any)?.card || {};
      const isCreature = origTypeLineLower.includes('creature');
      const basePower = isCreature ? (Number((orig as any)?.basePower ?? origCard?.power ?? 0) || 0) : undefined;
      const baseToughness = isCreature ? (Number((orig as any)?.baseToughness ?? origCard?.toughness ?? 0) || 0) : undefined;
      const colors = Array.isArray(origCard?.colors)
        ? origCard.colors.map((c: any) => String(c || '').toUpperCase()).filter(Boolean)
        : [];

      let tokenTypeLine = `Token ${origTypeLine}`.trim();
      if (isArtifactAdded && !tokenTypeLine.toLowerCase().includes('artifact')) {
        tokenTypeLine = `Token Artifact ${origTypeLine}`.trim();
      }

      const [tokenPermanentId] = createToken(ctx, controller, String(origCard?.name || 'Token Copy'), 1, basePower, baseToughness, {
        colors,
        typeLine: tokenTypeLine,
        abilities: ['Haste'],
        isArtifact: isArtifactAdded || origTypeLineLower.includes('artifact'),
      });
      if (!tokenPermanentId) return true;

      const tokenPerm = battlefield.find((p: any) => p?.id === tokenPermanentId);
      if (tokenPerm?.card) {
        const tokenCardId = String((tokenPerm as any).card?.id || '').trim();
        (tokenPerm as any).card = {
          ...(origCard as any),
          id: tokenCardId || (tokenPerm as any).card?.id,
          zone: 'battlefield',
          type_line: tokenTypeLine,
        };

        (tokenPerm as any).grantedAbilities = Array.isArray((tokenPerm as any).grantedAbilities) ? (tokenPerm as any).grantedAbilities : [];
        if (!(tokenPerm as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('haste'))) {
          (tokenPerm as any).grantedAbilities.push('Haste');
        }
      }

      stateAny.pendingExileAtNextEndStep.push({
        permanentId: tokenPermanentId,
        fireAtTurnNumber,
        sourceName,
        createdBy: controller,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (created 1)`);
      return true;
    }

    case "CREATE_INSECT_TOKEN_THEN_MILL_REPEAT_IF_INSECT_MILLED": {
      // Grist, the Hunger Tide:
      // "Create a 1/1 black and green Insect creature token, then mill a card.
      //  If an Insect card was milled this way, put a loyalty counter on Grist and repeat this process."
      const m = text.match(
        /^create a 1\/1 black and green insect creature token, then mill a card\. if an insect card was milled this way, put a loyalty counter on [a-z0-9 ,'-]+ and repeat this process\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const sourcePerm = sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null;

      const MAX_ITERS = 200;
      let iters = 0;
      let created = 0;
      let milledTotal = 0;

      while (iters++ < MAX_ITERS) {
        // Create the Insect token
        createToken(ctx, controller, "Insect", 1, 1, 1, {
          colors: ["B", "G"],
          typeLine: "Token Creature — Insect",
        });
        created++;

        // Mill one card
        const milled = millCards(ctx, controller, 1);
        milledTotal += milled.length;
        if (milled.length === 0) break;

        const milledCard = milled[0];
        const typeLineLower = String(milledCard?.type_line || "").toLowerCase();
        const isInsectCard = typeLineLower.includes("insect");
        if (!isInsectCard) break;

        // Put a loyalty counter on the source planeswalker (best-effort)
        if (sourcePerm) {
          (sourcePerm as any).counters = (sourcePerm as any).counters || {};
          (sourcePerm as any).counters.loyalty = ((sourcePerm as any).counters.loyalty || 0) + 1;
        }
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (created ${created}, milled ${milledTotal})`);
      return true;
    }

    case "PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_YOU_CONTROL": {
      const m = text.match(/^put a loyalty counter on ([a-z0-9 ,'-]+) for each creature you control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const sourcePerm = sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null;
      if (!sourcePerm) return false;

      let count = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if ((perm as any).controller !== controller) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || "").toLowerCase();
        if (typeLineLower.includes("creature")) count++;
      }

      if (count > 0) {
        (sourcePerm as any).counters = (sourcePerm as any).counters || {};
        (sourcePerm as any).counters.loyalty = ((sourcePerm as any).counters.loyalty || 0) + count;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${count})`);
      return true;
    }

    case "PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_TARGET_OPPONENT_CONTROLS": {
      const m = text.match(/^put a loyalty counter on ([a-z0-9 ,'-]+) for each creature target opponent controls\.?$/i);
      if (!m) return false;

      const [opponentId] = getTargets(triggerItem);
      if (!opponentId) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const sourcePerm = sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null;
      if (!sourcePerm) return false;

      let count = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if ((perm as any).controller !== opponentId) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || "").toLowerCase();
        if (typeLineLower.includes("creature")) count++;
      }

      if (count > 0) {
        (sourcePerm as any).counters = (sourcePerm as any).counters || {};
        (sourcePerm as any).counters.loyalty = ((sourcePerm as any).counters.loyalty || 0) + count;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${count}, opponent=${opponentId})`);
      return true;
    }

    case "EXILE_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_RETURN_AT_BEGINNING_OF_THAT_PLAYERS_NEXT_END_STEP": {
      const [targetId] = getTargets(triggerItem);
      // "up to one" => no target is a legal choice
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const typeLineLower = String(perm?.card?.type_line || "").toLowerCase();
      const isArtifactOrCreature = typeLineLower.includes("artifact") || typeLineLower.includes("creature");
      if (!isArtifactOrCreature) return false;

      const ownerId: PlayerID = (perm as any).owner;
      const cardId: string | undefined = (perm as any).card?.id;
      if (!ownerId || !cardId) return false;

      // Exile the permanent (tokens will cease to exist and won't return).
      movePermanentToExile(ctx, targetId);

      // Schedule a delayed return at the beginning of the owner's next end step.
      // We keep this as best-effort automation (no stack object); processed in turn.ts.
      (state as any).pendingFlickerReturns = Array.isArray((state as any).pendingFlickerReturns)
        ? (state as any).pendingFlickerReturns
        : [];
      (state as any).pendingFlickerReturns.push({
        kind: "return_from_exile_to_battlefield",
        ownerId,
        cardId,
        returnAt: "owners_next_end_step",
        sourceName,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${cardId}, returns at ${ownerId}'s next end step)`);
      return true;
    }

    case "EXILE_ANOTHER_TARGET_PERMANENT_YOU_OWN_THEN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const ownerId: PlayerID = (perm as any).owner;
      const cardId: string | undefined = (perm as any).card?.id;
      if (!ownerId || !cardId) return false;

      // "another" => cannot target the source permanent.
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      if (sourceId && targetId === sourceId) return false;

      // Must be a permanent you own.
      if (ownerId !== controller) return false;

      movePermanentToExile(ctx, targetId);

      // If this was a commander and the owner chose command zone (or exile failed),
      // don't schedule a return (best-effort).
      const zones = (state as any)?.zones || {};
      const exile: any[] = Array.isArray(zones?.[controller]?.exile) ? zones[controller].exile : [];
      const stillInExile = exile.some((c: any) => c?.id === cardId);
      if (!stillInExile) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${cardId}, but not in exile zone; skip return scheduling)`);
        return true;
      }

      // Best-effort automation: schedule return at the beginning of your next end step.
      // Note: This is not strictly "immediate"; we intentionally reuse the existing
      // pending-flicker infrastructure to keep implementation consistent.
      (state as any).pendingFlickerReturns = Array.isArray((state as any).pendingFlickerReturns)
        ? (state as any).pendingFlickerReturns
        : [];
      (state as any).pendingFlickerReturns.push({
        kind: "return_from_exile_to_battlefield",
        ownerId: controller,
        cardId,
        returnAt: "owners_next_end_step",
        sourceName,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${cardId}, returns at ${controller}'s next end step)`);
      return true;
    }

    case "EXILE_TARGET_PERMANENT_YOU_OWN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_AT_THE_BEGINNING_OF_THE_NEXT_END_STEP": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const ownerId: PlayerID = (perm as any).owner;
      const cardId: string | undefined = (perm as any).card?.id;
      if (!ownerId || !cardId) return false;
      if (ownerId !== controller) return false;

      movePermanentToExile(ctx, targetId);

      const zones = (state as any)?.zones || {};
      const exile: any[] = Array.isArray(zones?.[controller]?.exile) ? zones[controller].exile : [];
      const stillInExile = exile.some((c: any) => c?.id === cardId);
      if (!stillInExile) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${cardId}, but not in exile zone; skip return scheduling)`);
        return true;
      }

      (state as any).pendingFlickerReturns = Array.isArray((state as any).pendingFlickerReturns)
        ? (state as any).pendingFlickerReturns
        : [];
      (state as any).pendingFlickerReturns.push({
        kind: "return_from_exile_to_battlefield",
        ownerId: controller,
        cardId,
        returnAt: "owners_next_end_step",
        sourceName,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${cardId}, returns at ${controller}'s next end step)`);
      return true;
    }

    case "EXILE_ALL_OTHER_PERMANENTS": {
      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      if (!Array.isArray(battlefield) || battlefield.length === 0) return true;

      const toExile: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.id) continue;
        if (sourceId && perm.id === sourceId) continue;
        toExile.push(perm.id);
      }

      for (const id of toExile) {
        movePermanentToExile(ctx, id);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${toExile.length} permanents)`);
      return true;
    }

    case "CREATE_NAMED_TOKEN_WITH_ABILITIES": {
      const mComma = text.match(
        /^create (a|an|one|two|three|four|five|\d+)?\s*(tapped )?([^,]+),\s*a\s+(.+?)\s+token(?:\s+with\s+"[\s\S]+")?\.?$/i
      );

      const mNamed = !mComma
        ? text.match(
            /^create (a|an|one|two|three|four|five|\d+)?\s*(tapped )?(?:colorless )?(.+?)\s+token\s+named\s+([^\.]+?)(?:\s+with\s+"[\s\S]+")?\.?$/i
          )
        : null;

      if (!mComma && !mNamed) return false;

      const count = (mComma?.[1] || mNamed?.[1]) ? parseCountTokenWord((mComma?.[1] || mNamed?.[1]) as any) : 1;
      const isTapped = !!(mComma?.[2] || mNamed?.[2]);
      const tokenName = (mComma ? mComma[3] : mNamed![4]).trim();
      const descriptor = (mComma ? mComma[4] : mNamed![3]).trim();

      const quotedAbilities = extractQuotedAbilities(text);
      const { typeLine, colors, isArtifact } = parseTokenDescriptorToTypeLineAndColors(descriptor);

      const createdIds = createToken(ctx, controller, tokenName, count, undefined, undefined, {
        colors,
        typeLine,
        abilities: quotedAbilities,
        isArtifact,
      });

      if (isTapped) {
        const battlefield = getBattlefield(ctx);
        for (const id of createdIds) {
          const perm = battlefield.find((p: any) => p?.id === id);
          if (perm) perm.tapped = true;
        }
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count} ${tokenName})`);
      return true;
    }

    case "REVEAL_TOP_TWO_OPPONENT_CHOSES_ONE_HAND_EXILE_SILVER": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const z = (zones[controller] = zones[controller] || { library: [], libraryCount: 0, hand: [], handCount: 0, exile: [], exileCount: 0 });
      const lib: any[] = z.library || [];
      const topCards = lib.slice(0, 2);

      if (topCards.length <= 0) return true;
      if (topCards.length === 1) {
        // Best-effort: if only one card, just draw it.
        drawCardsFromZone(ctx, controller, 1);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (only 1 card; drew it)`);
        return true;
      }

      const opponents = getOpponents(ctx, controller);
      const controllerName = getPlayerById(ctx, controller)?.name || "You";

      // If there is exactly one opponent, skip choosing who chooses.
      if (opponents.length === 1) {
        const oppId = opponents[0];
        const options = topCards.map((c: any) => ({
          id: c.id,
          label: c.name || "Unknown",
          description: c.type_line,
          imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
        }));

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: oppId,
          description: `${sourceName}: Choose a card to put into ${controllerName}'s hand`,
          mandatory: true,
          sourceName,
          options,
          minSelections: 1,
          maxSelections: 1,
          pwkarn: true,
          pwkarnStage: "chooseCard",
          pwkarnController: controller,
          pwkarnSourceName: sourceName,
          pwkarnTopCardIds: topCards.map((c: any) => c.id),
        } as any);

        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opponent chooses)`);
        return true;
      }

      // Controller chooses which opponent makes the choice.
      const oppOptions = opponents.map((pid) => ({
        id: pid,
        label: getPlayerById(ctx, pid as any)?.name || String(pid),
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose an opponent to make the choice`,
        mandatory: true,
        sourceName,
        options: oppOptions,
        minSelections: 1,
        maxSelections: 1,
        pwkarn: true,
        pwkarnStage: "chooseOpponent",
        pwkarnController: controller,
        pwkarnSourceName: sourceName,
        pwkarnTopCards: topCards.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (controller chooses opponent)`);
      return true;
    }

    case "ADD_RESTRICTED_MANA_SPEND_ONLY": {
      const m = text.match(/^add (\{[WUBRGC]\}(?:\{[WUBRGC]\})*)\.\s*spend this mana only to (?:cast )?([^\.]+?)\.?$/i);
      if (!m) return false;

      const symbols = m[1];
      const spendClause = m[2].toLowerCase();

      let restriction: any = null;
      if (spendClause.includes("creature")) restriction = "creatures";
      else if (spendClause.includes("artifact")) restriction = "artifacts";
      else if (spendClause.includes("colorless")) restriction = "colorless_spells";
      else if (spendClause.includes("instant") || spendClause.includes("sorcery")) restriction = "instant_sorcery";
      else if (spendClause.includes("ability") || spendClause.includes("abilities")) restriction = "abilities";
      else return false; // don't match unsupported restriction types yet

      const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      const rx = /\{([WUBRGC])\}/gi;
      let mm: RegExpExecArray | null;
      while ((mm = rx.exec(symbols))) {
        const sym = mm[1].toUpperCase();
        counts[sym] = (counts[sym] || 0) + 1;
      }

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const sourceLabel = sourceName;

      addRestrictedMana(state, controller, "white", counts.W, restriction, sourceId, sourceLabel);
      addRestrictedMana(state, controller, "blue", counts.U, restriction, sourceId, sourceLabel);
      addRestrictedMana(state, controller, "black", counts.B, restriction, sourceId, sourceLabel);
      addRestrictedMana(state, controller, "red", counts.R, restriction, sourceId, sourceLabel);
      addRestrictedMana(state, controller, "green", counts.G, restriction, sourceId, sourceLabel);
      addRestrictedMana(state, controller, "colorless", counts.C, restriction, sourceId, sourceLabel);

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${symbols}, restriction=${restriction})`);
      return true;
    }

    case "ADD_TWO_MANA_ANY_COMBINATION_SPEND_ONLY_DRAGONS": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const colorOptions = [
        { id: "white", label: "White" },
        { id: "blue", label: "Blue" },
        { id: "black", label: "Black" },
        { id: "red", label: "Red" },
        { id: "green", label: "Green" },
      ];

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a color for the first mana (spend only to cast Dragon spells)`,
        mandatory: true,
        sourceName: sourceName,
        options: colorOptions,
        minSelections: 1,
        maxSelections: 1,
        pwAddTwoManaAnyCombination: true,
        pwAddTwoManaStage: "first",
        pwAddTwoManaController: controller,
        pwAddTwoManaSourceName: sourceName,
        pwAddTwoManaSourceId: sourceId,
        pwAddTwoManaRestriction: "dragon_spells",
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "PAY_ANY_AMOUNT_LOOK_AT_THAT_MANY_PUT_ONE_HAND_REST_BOTTOM_RANDOM": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const pool: any = state.manaPool?.[controller] || {};
      const maxPay =
        (pool.white || 0) +
        (pool.blue || 0) +
        (pool.black || 0) +
        (pool.red || 0) +
        (pool.green || 0) +
        (pool.colorless || 0);

      const options = Array.from({ length: Math.max(0, maxPay) + 1 }, (_, i) => ({
        id: String(i),
        label: String(i),
        description: i === 1 ? "Pay 1 mana" : `Pay ${i} mana`,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Pay any amount of mana (0–${maxPay})`,
        mandatory: true,
        sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        pwPayAnyAmountLook: true,
        pwPayAnyAmountLookStage: "chooseX",
        pwPayAnyAmountLookController: controller,
        pwPayAnyAmountLookSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "CREATE_PREDEFINED_ARTIFACT_TOKENS":
    case "CREATE_TAPPED_PREDEFINED_ARTIFACT_TOKENS": {
      const isTapped = match.id === "CREATE_TAPPED_PREDEFINED_ARTIFACT_TOKENS";
      const m = text.match(
        /^create (a|an|one|two|three|four|five|\d+) (?:tapped )?(food|treasure|clue|map|blood|gold|powerstone) tokens?\.(?:\s*\([^)]*\)\.)?$/i
      );
      if (!m) return false;

      const count = parseCountTokenWord(m[1]);
      const tokenKey = m[2].toLowerCase();
      const spec = predefinedArtifactTokens[tokenKey];
      if (!spec) return false;

      const createdIds = createToken(ctx, controller, spec.name, count, undefined, undefined, {
        colors: spec.colors,
        typeLine: spec.typeLine,
        abilities: spec.abilities,
        isArtifact: true,
      });

      if (isTapped) {
        const battlefield = getBattlefield(ctx);
        for (const id of createdIds) {
          const perm = battlefield.find((p: any) => p?.id === id);
          if (perm) perm.tapped = true;
        }
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count} ${spec.name}${count === 1 ? "" : "s"}${isTapped ? ", tapped" : ""})`);
      return true;
    }

    case "GAIN_LIFE_SELF": {
      const m = text.match(/you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
      const n = parseCountTokenWord(m?.[1] || "0");
      modifyLifeLikeStack(ctx, controller, n);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${n})`);
      return true;
    }

    case "LOSE_LIFE_SELF": {
      const m = text.match(/you lose (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
      const n = parseCountTokenWord(m?.[1] || "0");
      modifyLifeLikeStack(ctx, controller, -n);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${n})`);
      return true;
    }

    case "DRAW_CARD_AND_LOSE_LIFE_SELF": {
      const m = text.match(
        /^you draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) card and lose (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.(?:\s*proliferate\.)?$/i
      );
      if (!m) return false;
      const drawN = parseCountTokenWord(m[1]);
      const loseN = parseCountTokenWord(m[2]);
      drawCardsFromZone(ctx, controller, drawN);
      modifyLifeLikeStack(ctx, controller, -loseN);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (draw ${drawN}, lose ${loseN})`);
      return true;
    }

    case "TARGET_PLAYER_MILLS_N": {
      const m = text.match(
        /^target player mills (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const milled = millCards(ctx, targetPlayer as any, n);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${targetPlayer} mills ${milled.length})`);
      return true;
    }

    case "TARGET_PLAYER_MILLS_N_THEN_DRAW": {
      const m = text.match(
        /^target player mills (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.\s*draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const millN = parseCountTokenWord(m[1]);
      const drawN = parseCountTokenWord(m[2]);
      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      millCards(ctx, targetPlayer as any, millN);
      drawCardsFromZone(ctx, controller, drawN);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (mill ${millN}, draw ${drawN})`);
      return true;
    }

    case "DRAW_A_CARD_TARGET_PLAYER_MILLS_A_CARD": {
      const m = text.match(/^draw a card\.\s*target player mills a card\.?$/i);
      if (!m) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      const player = getPlayerById(ctx, targetPlayerId as any);
      if (!player) return false;

      drawCardsFromZone(ctx, controller, 1);
      millCards(ctx, targetPlayerId as any, 1);

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DRAW_A_CARD_EACH_PLAYER_MILLS_TWO_CARDS": {
      const m = text.match(/^draw a card\.\s*each player mills two cards\.?$/i);
      if (!m) return false;

      drawCardsFromZone(ctx, controller, 1);

      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;
        millCards(ctx, pid as any, 2);
      }

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_PLAYER_MILLS_THREE_TIMES_X": {
      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x) return false;

      const millN = 3 * x;
      millCards(ctx, targetPlayer as any, millN);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x}, mill ${millN})`);
      return true;
    }

    case "TARGET_PLAYER_MILLS_THREE_THEN_DRAW_DEPENDING_GRAVEYARD_20": {
      const m = text.match(
        /^target player mills three cards\. then if a graveyard has twenty or more cards in it, you draw three cards\. otherwise, you draw a card\.?$/i
      );
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      millCards(ctx, targetPlayer as any, 3);

      const zones = (state as any)?.zones || {};
      const players = ((ctx as any).state?.players as any[]) || [];
      const anyGy20 = players.some((p: any) => {
        const pid = p?.id as any;
        const gyCount = zones[pid]?.graveyardCount ?? zones[pid]?.graveyard?.length ?? 0;
        return (gyCount | 0) >= 20;
      });

      const drawN = anyGy20 ? 3 : 1;
      drawCardsFromZone(ctx, controller, drawN);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (draw ${drawN})`);
      return true;
    }

    case "UNTAP_UP_TO_ONE_TARGET_CREATURE_AND_UP_TO_ONE_TARGET_LAND": {
      const m = text.match(/^untap up to one target creature and up to one target land\.?$/i);
      if (!m) return false;

      const targets = getTargets(triggerItem).slice(0, 2);
      if (targets.length === 0) return true;

      const battlefield = getBattlefield(ctx);
      for (const id of targets) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm) continue;
        perm.tapped = false;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${targets.length})`);
      return true;
    }

    case "UNTAP_UP_TO_TWO_TARGET_CREATURES_AND_UP_TO_TWO_TARGET_LANDS": {
      const m = text.match(/^untap up to two target creatures and up to two target lands\.?$/i);
      if (!m) return false;

      const targets = getTargets(triggerItem).slice(0, 4);
      if (targets.length === 0) return true;

      const battlefield = getBattlefield(ctx);
      for (const id of targets) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm) continue;
        perm.tapped = false;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${targets.length})`);
      return true;
    }

    case "PUT_P1P1_COUNTERS_ON_TARGETS": {
      const m = text.match(/put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters?/i);
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const targets = getTargets(triggerItem);
      if (!targets.length) return false;

      for (const id of targets) {
        updateCounters(ctx, id, { "+1/+1": n });
      }
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${targets.length} target(s), +${n}/+${n} counters)`);
      return true;
    }

    case "PUT_X_P1P1_COUNTERS_ON_TARGET_CREATURE_WHERE_X_IS_YOUR_LIFE_TOTAL": {
      const m = text.match(
        /^put x \+1\/\+1 counters on target creature, where x is your life total(?:\.\s*that creature gains trample until end of turn)?\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const controllerLifeRaw = (state as any)?.life?.[controller];
      const players = ((state as any)?.players as any[]) || [];
      const controllerPlayer = players.find((p: any) => String(p?.id || '') === String(controller));
      const controllerLife =
        (typeof controllerLifeRaw === 'number' && Number.isFinite(controllerLifeRaw)
          ? controllerLifeRaw
          : typeof controllerPlayer?.life === 'number'
            ? controllerPlayer.life
            : (state as any)?.startingLife ?? 40) | 0;

      const x = Math.max(0, controllerLife);
      if (x > 0) {
        updateCounters(ctx, targetId, { "+1/+1": x });
      }

      const grantTrample = String(text).toLowerCase().includes('gains trample until end of turn');
      if (grantTrample) {
        const battlefield = getBattlefield(ctx);
        const perm = battlefield.find((p: any) => p?.id === targetId);
        if (perm) {
          (perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
          if (!(perm as any).grantedAbilities.includes('Trample')) (perm as any).grantedAbilities.push('Trample');

          (perm as any).untilEndOfTurn =
            (perm as any).untilEndOfTurn && typeof (perm as any).untilEndOfTurn === 'object' ? (perm as any).untilEndOfTurn : {};
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray(
            ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
          )
            ? ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
            : [];
          if (!((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Trample')) {
            ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.push('Trample');
          }
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x}${grantTrample ? ', +Trample EOT' : ''})`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_EACH_CREATURE_YOU_CONTROL": {
      const m = text.match(
        /^put a \+1\/\+1 counter on each creature you control(?:\. those creatures gain vigilance until end of turn)?\.?$/i
      );
      if (!m) return false;

      const grantVigilance = String(text).toLowerCase().includes("gain vigilance until end of turn");
      const battlefield = getBattlefield(ctx);

      let affected = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (String((perm as any).controller || "") !== String(controller)) continue;
        const tl = String(perm?.card?.type_line || "").toLowerCase();
        if (!tl.includes("creature")) continue;

        updateCounters(ctx, perm.id, { "+1/+1": 1 });
        affected++;

        if (grantVigilance) {
          perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
          if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes("vigilance"))) {
            perm.grantedAbilities.push("Vigilance");
          }

          perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === "object" ? perm.untilEndOfTurn : {};
          (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
            ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
            : [];
          if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes("Vigilance")) {
            (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push("Vigilance");
          }
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "PUT_A_LOYALTY_COUNTER_ON_EACH_COLOR_PLANESWALKER_YOU_CONTROL": {
      const m = text.match(/^put a loyalty counter on each (white|blue|black|red|green) planeswalker you control\.?$/i);
      if (!m) return false;

      const colorWord = String(m[1] || "").toLowerCase();
      const colorLetter =
        colorWord === "white"
          ? "W"
          : colorWord === "blue"
            ? "U"
            : colorWord === "black"
              ? "B"
              : colorWord === "red"
                ? "R"
                : colorWord === "green"
                  ? "G"
                  : null;
      if (!colorLetter) return false;

      const battlefield = getBattlefield(ctx);

      const permHasColor = (perm: any): boolean => {
        const card = perm?.card;
        if (!card) return false;
        const colors: string[] = Array.isArray(card.colors)
          ? card.colors
          : Array.isArray(card.color_identity)
            ? card.color_identity
            : [];
        if (colors.map((c) => String(c).toUpperCase()).includes(colorLetter)) return true;

        if (colors.length === 0) {
          const manaCost = String(card.mana_cost || "").toUpperCase();
          return manaCost.includes(`{${colorLetter}}`);
        }

        return false;
      };

      let affected = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (String((perm as any).controller || "") !== String(controller)) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || "").toLowerCase();
        if (!typeLineLower.includes("planeswalker")) continue;
        if (!permHasColor(perm)) continue;

        (perm as any).counters = (perm as any).counters || {};
        (perm as any).counters.loyalty = ((perm as any).counters.loyalty || 0) + 1;
        affected++;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "PUT_N_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_AND_N_LOYALTY_COUNTERS_ON_EACH_OTHER_PLANESWALKER_YOU_CONTROL": {
      const m = text.match(
        /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on each creature you control and (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) loyalty counters? on each other planeswalker you control\.?$/i
      );
      if (!m) return false;

      const nCreatures = parseCountTokenWord(m[1]);
      const nLoyalty = parseCountTokenWord(m[2]);
      if (nCreatures <= 0 && nLoyalty <= 0) return true;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;

      let creaturesAffected = 0;
      let planeswalkersAffected = 0;

      for (const perm of battlefield) {
        if (!perm) continue;
        if (String((perm as any).controller || "") !== String(controller)) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || "").toLowerCase();

        if (nCreatures > 0 && typeLineLower.includes("creature")) {
          updateCounters(ctx, perm.id, { "+1/+1": nCreatures });
          creaturesAffected++;
          continue;
        }

        if (nLoyalty > 0 && typeLineLower.includes("planeswalker")) {
          if (sourceId && String(perm.id) === String(sourceId)) continue; // "other" planeswalkers
          (perm as any).counters = (perm as any).counters || {};
          (perm as any).counters.loyalty = ((perm as any).counters.loyalty || 0) + nLoyalty;
          planeswalkersAffected++;
        }
      }

      (ctx as any).bumpSeq?.();
      debug(
        2,
        `[planeswalker/templates] ${sourceName}: resolved ${match.id} (creatures=${creaturesAffected}, otherPlaneswalkers=${planeswalkersAffected})`
      );
      return true;
    }

    case "PUT_MINUS1_MINUS1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE": {
      const m = text.match(/^put a -1\/-1 counter on up to one target creature\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return true;

      updateCounters(ctx, targetId, { "-1/-1": 1 });
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_MENACE_EOT": {
      const m = text.match(
        /^put a \+1\/\+1 counter on up to one target creature\. that creature gains menace until end of turn\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return true;

      updateCounters(ctx, targetId, { "+1/+1": 1 });

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes("menace"))) {
        perm.grantedAbilities.push("Menace");
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === "object" ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes("Menace")) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push("Menace");
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_INDESTRUCTIBLE_EOT": {
      const m = text.match(
        /^put a \+1\/\+1 counter on up to one target creature\. it gains indestructible until end of turn\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return true;

      updateCounters(ctx, targetId, { "+1/+1": 1 });

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes("indestructible"))) {
        perm.grantedAbilities.push("Indestructible");
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === "object" ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes("Indestructible")) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push("Indestructible");
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_FIRST_STRIKE_EOT": {
      const m = text.match(
        /^put a \+1\/\+1 counter on up to one target creature\. it gains first strike until end of turn\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return true;

      updateCounters(ctx, targetId, { "+1/+1": 1 });

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes("first strike"))) {
        perm.grantedAbilities.push("First strike");
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === "object" ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes("First strike")) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push("First strike");
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_VIGILANCE_EOT": {
      const m = text.match(
        /^put a \+1\/\+1 counter on up to one target creature\. it gains vigilance until end of turn\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;

      updateCounters(ctx, targetId, { '+1/+1': 1 });

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes('vigilance'))) {
        perm.grantedAbilities.push('Vigilance');
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === 'object' ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Vigilance')) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Vigilance');
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TARGET_TAPPED_CREATURE_YOU_GAIN_2_LIFE": {
      const m = text.match(/^exile target tapped creature\. you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i);
      if (!m) return false;

      const life = parseCountTokenWord(m[1]);
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;
      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return true;
      if (!perm.tapped) return true;

      movePermanentToExile(ctx, targetId);
      modifyLifeLikeStack(ctx, controller, life);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_YOU_CONTROL_FIGHTS_ANOTHER_TARGET_CREATURE": {
      const m = text.match(/^target creature you control fights another target creature\.?$/i);
      if (!m) return false;

      const [aId, bId] = getTargets(triggerItem);
      if (!aId || !bId) return false;

      const battlefield = getBattlefield(ctx);
      const a = battlefield.find((p: any) => p?.id === aId);
      const b = battlefield.find((p: any) => p?.id === bId);
      if (!a || !b) return false;

      if (a.controller !== controller) return true;

      const aTL = String(a?.card?.type_line || "").toLowerCase();
      const bTL = String(b?.card?.type_line || "").toLowerCase();
      if (!aTL.includes("creature") || !bTL.includes("creature")) return true;

      const aPT = getActualPowerToughness(a, (ctx as any).state);
      const bPT = getActualPowerToughness(b, (ctx as any).state);

      // Simultaneous damage (best-effort): each deals damage equal to its power to the other.
      applyDamageToPermanent(ctx, bId, Math.max(0, aPT.power | 0));
      applyDamageToPermanent(ctx, aId, Math.max(0, bPT.power | 0));

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_YOU_CONTROL_FIGHTS_TARGET_CREATURE_YOU_DONT_CONTROL": {
      const m = text.match(/^target creature you control fights target creature you don't control\.?$/i);
      if (!m) return false;

      const [aId, bId] = getTargets(triggerItem);
      if (!aId || !bId) return false;

      const battlefield = getBattlefield(ctx);
      const a = battlefield.find((p: any) => p?.id === aId);
      const b = battlefield.find((p: any) => p?.id === bId);
      if (!a || !b) return false;

      if (a.controller !== controller) return true;
      if (b.controller === controller) return true;

      const aTL = String(a?.card?.type_line || "").toLowerCase();
      const bTL = String(b?.card?.type_line || "").toLowerCase();
      if (!aTL.includes("creature") || !bTL.includes("creature")) return true;

      const aPT = getActualPowerToughness(a, (ctx as any).state);
      const bPT = getActualPowerToughness(b, (ctx as any).state);

      applyDamageToPermanent(ctx, bId, Math.max(0, aPT.power | 0));
      applyDamageToPermanent(ctx, aId, Math.max(0, bPT.power | 0));

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_SUBTYPE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_YOU_DONT_CONTROL": {
      const m = text.match(
        /^target ([a-z]+) you control deals damage equal to its power to target creature you don't control\.?$/i
      );
      if (!m) return false;

      const subtypeLower = String(m[1] || "").trim().toLowerCase();

      const [sourceCreatureId, targetCreatureId] = getTargets(triggerItem);
      if (!sourceCreatureId || !targetCreatureId) return false;

      const battlefield = getBattlefield(ctx);
      const source = battlefield.find((p: any) => p?.id === sourceCreatureId);
      const target = battlefield.find((p: any) => p?.id === targetCreatureId);
      if (!source || !target) return false;

      if (source.controller !== controller) return true;
      if (target.controller === controller) return true;

      if (!isCreatureOfSubtype(source, subtypeLower)) return true;

      const targetTL = String(target?.card?.type_line || "").toLowerCase();
      if (!targetTL.includes("creature")) return true;

      const power = getActualPowerToughness(source, (ctx as any).state).power;
      applyDamageToPermanent(ctx, targetCreatureId, Math.max(0, power | 0));
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (power=${power})`);
      return true;
    }

    case "PUT_P1P1_COUNTERS_ON_UP_TO_ONE_TARGET_SUBTYPE_YOU_CONTROL": {
      const m = text.match(
        /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on up to one target ([a-z]+) you control\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const subtype = String(m[2] || "").toLowerCase();

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return true; // up to one

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!p || p.controller !== controller) return false;
      if (!isCreatureOfSubtype(p, subtype)) return false;

      updateCounters(ctx, targetPermanentId, { "+1/+1": n });
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${n} on ${subtype})`);
      return true;
    }

    case "TARGET_CREATURE_GETS_PT_EOT": {
      const m = text.match(
        /^(?:until end of turn,?\s*)?(?:up to (?:one|two|three|four|five|\d+) )?target (?:[a-z][a-z-]* )?creatures? gets? ([+-]\d+)\/([+-]\d+)(?: and gains ([^.]+?))?(?:\.|$| until end of turn)$/i
      );
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);
      const gainsRaw = (m[3] || '').trim();
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!p) return false;

      (p as any).ptModsEOT = Array.isArray((p as any).ptModsEOT) ? (p as any).ptModsEOT : [];
      (p as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });

      if (gainsRaw) {
        const gainsLower = gainsRaw.toLowerCase();

        const known: Array<[RegExp, string]> = [
          [/\bflying\b/i, 'Flying'],
          [/\bfirst strike\b/i, 'First strike'],
          [/\bdouble strike\b/i, 'Double strike'],
          [/\bvigilance\b/i, 'Vigilance'],
          [/\blifelink\b/i, 'Lifelink'],
          [/\bdeathtouch\b/i, 'Deathtouch'],
          [/\btrample\b/i, 'Trample'],
          [/\bhaste\b/i, 'Haste'],
          [/\breach\b/i, 'Reach'],
          [/\bmenace\b/i, 'Menace'],
          [/\bhexproof\b/i, 'Hexproof'],
          [/\bindestructible\b/i, 'Indestructible'],
        ];

        const grantedToAdd: string[] = [];
        for (const [rx, label] of known) {
          if (rx.test(gainsLower)) grantedToAdd.push(label);
        }

        if (grantedToAdd.length === 0) {
          grantedToAdd.push(gainsRaw);
        }

        ;(p as any).grantedAbilities = Array.isArray((p as any).grantedAbilities) ? (p as any).grantedAbilities : [];
        p.untilEndOfTurn = p.untilEndOfTurn && typeof p.untilEndOfTurn === 'object' ? p.untilEndOfTurn : {};
        ;(p.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((p.untilEndOfTurn as any).grantedAbilitiesToRemove)
          ? (p.untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];

        for (const abilityText of grantedToAdd) {
          if (!(p as any).grantedAbilities.includes(abilityText)) {
            (p as any).grantedAbilities.push(abilityText);
          }
          if (!(p.untilEndOfTurn as any).grantedAbilitiesToRemove.includes(abilityText)) {
            (p.untilEndOfTurn as any).grantedAbilitiesToRemove.push(abilityText);
          }
        }
      }

      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${powerMod}/${toughnessMod})`);
      return true;
    }

    case "REVEAL_TOP_CARD_IF_CREATURE_OR_PLANESWALKER_PUT_INTO_HAND_OTHERWISE_MAY_PUT_ON_BOTTOM": {
      const m = text.match(
        /^reveal the top card of your library\. if it's a creature or planeswalker card, put it into your hand\. otherwise, you may put it on the bottom of your library\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || (zones[controller] = { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
      const lib: any[] = Array.isArray(z.library) ? z.library : [];
      if (lib.length === 0) return true;

      const top = lib[0];
      const tl = String(top?.type_line || '').toLowerCase();
      const isCreatureOrPw = tl.includes('creature') || tl.includes('planeswalker');

      if (isCreatureOrPw) {
        drawCardsFromZone(ctx as any, controller, 1);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (drew top card)`);
        return true;
      }

      // "Otherwise, you may put it on the bottom" — conservative default: do nothing.
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (left top card as-is)`);
      return true;
    }

    case "REVEAL_TOP_CARD_IF_ITS_A_CREATURE_CARD_PUT_INTO_HAND_OTHERWISE_PUT_ON_BOTTOM": {
      const m = text.match(
        /^reveal the top card of your library\. if it(?:'|’)s a creature card, put it into your hand\. otherwise, put it on the bottom of your library\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const z =
        zones[controller] ||
        (zones[controller] = {
          hand: [],
          handCount: 0,
          library: [],
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        } as any);

      z.library = Array.isArray(z.library) ? z.library : [];
      const lib: any[] = z.library;
      if (lib.length === 0) return true;

      const top = lib[0];
      const tl = String(top?.type_line || '').toLowerCase();
      const isCreature = tl.includes('creature');

      if (isCreature) {
        drawCardsFromZone(ctx as any, controller, 1);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (drew top card)`);
        return true;
      }

      // Mandatory: put that top card on the bottom of the library.
      const moved = lib.shift();
      if (moved) lib.push(moved);
      z.libraryCount = lib.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (moved top card to bottom)`);
      return true;
    }

    case "REVEAL_TOP_TWO_PUT_LANDS_ONTO_BATTLEFIELD_REST_INTO_HAND": {
      const m = text.match(
        /^reveal the top two cards of your library\. put all land cards from among them onto the battlefield and the rest into your hand\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || (zones[controller] = { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
      z.library = Array.isArray(z.library) ? z.library : [];
      z.hand = Array.isArray(z.hand) ? z.hand : [];

      const lib: any[] = z.library;
      if (lib.length === 0) return true;

      const revealCount = Math.min(2, lib.length);
      const revealed = lib.splice(0, revealCount);

      const battlefield = getBattlefield(ctx);
      for (const card of revealed) {
        const tl = String(card?.type_line || '').toLowerCase();
        if (tl.includes('land')) {
          const newPermanent: any = {
            id: uid('perm'),
            card: { ...(card as any), zone: 'battlefield' },
            controller,
            owner: (card as any)?.owner || controller,
            tapped: false,
            summoningSickness: false,
            counters: {},
            attachedTo: undefined,
          };
          battlefield.push(newPermanent);
        } else {
          z.hand.unshift({ ...(card as any), zone: 'hand' });
        }
      }

      z.libraryCount = lib.length;
      z.handCount = z.hand.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "REVEAL_TOP_FOUR_PUT_LANDS_INTO_HAND_REST_INTO_GRAVEYARD": {
      const m = text.match(
        /^reveal the top four cards of your library\. put all land cards revealed this way into your hand and the rest into your graveyard\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || (zones[controller] = { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
      z.library = Array.isArray(z.library) ? z.library : [];
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      const lib: any[] = z.library;
      if (lib.length === 0) return true;

      const revealCount = Math.min(4, lib.length);
      const revealed = lib.splice(0, revealCount);

      for (const card of revealed) {
        const tl = String(card?.type_line || '').toLowerCase();
        if (tl.includes('land')) {
          z.hand.unshift({ ...(card as any), zone: 'hand' });
        } else {
          z.graveyard.unshift({ ...(card as any), zone: 'graveyard' });
        }
      }

      z.libraryCount = lib.length;
      z.handCount = z.hand.length;
      z.graveyardCount = z.graveyard.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_TARGET_ARTIFACT_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND": {
      const m = text.match(/^return target artifact card from your graveyard to your hand\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      const artifactCards = gy.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('artifact'));
      if (artifactCards.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose an artifact card in your graveyard to return to your hand`,
        mandatory: true,
        sourceName,
        minTargets: 1,
        maxTargets: 1,
        action: 'move_graveyard_card_to_hand',
        fromPlayerId: controller,
        validTargets: artifactCards.map((c: any) => ({
          id: c.id,
          label: c.name || 'Artifact',
          description: c.type_line || 'artifact card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "TARGET_CREATURE_GETS_PLUSX_PLUSX_EOT_WHERE_X_IS_NUMBER_OF_CREATURES_YOU_CONTROL": {
      const m = text.match(/^target creature gets \+x\/\+x until end of turn, where x is the number of creatures you control\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const targetTL = String(target?.card?.type_line || "").toLowerCase();
      if (!targetTL.includes("creature")) return false;

      const x = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || "").toLowerCase();
        return tl.includes("creature");
      }).length;

      (target as any).ptModsEOT = Array.isArray((target as any).ptModsEOT) ? (target as any).ptModsEOT : [];
      (target as any).ptModsEOT.push({ power: x, toughness: x, sourceName });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (x=${x})`);
      return true;
    }

    case "TARGET_CREATURE_GETS_PLUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ARTIFACTS_YOU_CONTROL": {
      const m = text.match(/^target creature gets \+x\/-x until end of turn, where x is the number of artifacts you control\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const targetTL = String(target?.card?.type_line || "").toLowerCase();
      if (!targetTL.includes("creature")) return false;

      const x = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || "").toLowerCase();
        return tl.includes("artifact");
      }).length;

      (target as any).ptModsEOT = Array.isArray((target as any).ptModsEOT) ? (target as any).ptModsEOT : [];
      (target as any).ptModsEOT.push({ power: x, toughness: -x, sourceName });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (x=${x})`);
      return true;
    }

    case "TARGET_CREATURE_GETS_MINUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ZOMBIES_YOU_CONTROL": {
      const m = text.match(/^target creature gets -x\/-x until end of turn, where x is the number of zombies you control\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const targetTL = String(target?.card?.type_line || "").toLowerCase();
      if (!targetTL.includes("creature")) return false;

      const x = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        return permanentHasCreatureTypeNow(p, 'zombie');
      }).length;

      (target as any).ptModsEOT = Array.isArray((target as any).ptModsEOT) ? (target as any).ptModsEOT : [];
      (target as any).ptModsEOT.push({ power: -x, toughness: -x, sourceName });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (x=${x})`);
      return true;
    }

    case "DESTROY_TARGET_NONCREATURE_PERMANENT": {
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      const typeLine = (p?.card?.type_line || "").toLowerCase();
      if (!p || typeLine.includes("creature")) return false;

      destroyPermanents(ctx, [targetPermanentId]);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_TAPPED_CREATURE": {
      const m = text.match(/^destroy target tapped creature\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      const typeLine = (p?.card?.type_line || "").toLowerCase();
      if (!p || !typeLine.includes("creature")) return false;

      if (!(p as any).tapped) return false;

      destroyPermanents(ctx, [targetPermanentId]);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE": {
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      const typeLine = (p?.card?.type_line || "").toLowerCase();
      if (!p || !typeLine.includes("creature")) return false;

      const lower = text.toLowerCase();
      const control = getControlConstraint(lower);
      if (control === 'you' && p.controller !== controller) return false;
      if (control === 'not_you' && p.controller === controller) return false;

      const mv = getManaValueConstraint(lower);
      if (!satisfiesManaValueConstraint(p, mv)) return false;

      destroyPermanents(ctx, [targetPermanentId]);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_OR_PLANESWALKER": {
      const m = text.match(/^destroy target creature or planeswalker\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      const typeLine = (p?.card?.type_line || "").toLowerCase();
      if (!p) return false;
      if (!(typeLine.includes("creature") || typeLine.includes("planeswalker"))) return false;

      destroyPermanents(ctx, [targetPermanentId]);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_ALL_CREATURES_POWER_GE_N": {
      const m = text.match(/^destroy all creatures with power (\d+) or greater\.?$/i);
      if (!m) return false;

      const threshold = parseInt(m[1], 10);
      const battlefield = getBattlefield(ctx);

      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;
        const pwr = parseInt(String(perm.card?.power ?? perm.basePower ?? 0), 10) || 0;
        if (pwr >= threshold) toDestroy.push(perm.id);
      }

      destroyPermanents(ctx, toDestroy);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length})`);
      return true;
    }

    case "DESTROY_ALL_NON_DRAGON_CREATURES": {
      const m = text.match(/^destroy all non-dragon creatures\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        if (tl.includes('dragon')) continue;
        toDestroy.push(perm.id);
      }

      if (toDestroy.length > 0) destroyPermanents(ctx, toDestroy);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length})`);
      return true;
    }

    case "DESTROY_ALL_CREATURES_YOU_DONT_CONTROL": {
      const m = text.match(/^destroy all creatures (?:you don't|[a-z0-9 ,'-]+ doesn't) control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (String(perm.controller) === String(controller)) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        toDestroy.push(perm.id);
      }

      if (toDestroy.length > 0) destroyPermanents(ctx, toDestroy);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length})`);
      return true;
    }

    case "DESTROY_ALL_OTHER_PERMANENTS_EXCEPT_LANDS_AND_TOKENS": {
      const m = text.match(/^destroy all other permanents except for lands and tokens\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;

      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (sourceId && String(perm.id) === String(sourceId)) continue;
        if ((perm as any).isToken === true) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (tl.includes('land')) continue;
        toDestroy.push(perm.id);
      }

      if (toDestroy.length > 0) destroyPermanents(ctx, toDestroy);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length})`);
      return true;
    }

    case "DESTROY_ALL_CREATURES_TARGET_OPPONENT_CONTROLS_THEN_DEALS_DAMAGE_EQUAL_TO_THEIR_TOTAL_POWER": {
      const m = text.match(
        /^destroy all creatures target opponent controls\.?\s*(?:[a-z0-9 ,'-]+|it) deals damage to that player equal to their total power\.?$/i
      );
      if (!m) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      const targetPlayer = getPlayerById(ctx, targetPlayerId as any);
      if (!targetPlayer) return false;
      if (String(targetPlayerId) === String(controller)) return false; // effect says opponent

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      let totalPower = 0;

      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (String(perm.controller) !== String(targetPlayerId)) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        toDestroy.push(perm.id);
        const pt = getActualPowerToughness(ctx as any, perm);
        totalPower += Math.max(0, pt.power | 0);
      }

      if (toDestroy.length > 0) {
        destroyPermanents(ctx, toDestroy);
      }
      if (totalPower > 0) {
        applyDamageToPlayer(ctx, targetPlayerId as any, totalPower);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length}, damage ${totalPower})`);
      return true;
    }

    case "EXILE_TARGET_NONLAND_PERMANENT": {
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      const typeLine = (p?.card?.type_line || "").toLowerCase();
      if (!p || typeLine.includes("land")) return false;

      const lower = text.toLowerCase();
      const control = getControlConstraint(lower);
      if (control === 'you' && p.controller !== controller) return false;
      if (control === 'not_you' && p.controller === controller) return false;

      const mv = getManaValueConstraint(lower);
      if (!satisfiesManaValueConstraint(p, mv)) return false;

      exilePermanents(ctx, [targetPermanentId]);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DEALS_DAMAGE_TO_ANY_TARGET": {
      const m = text.match(/^([a-z0-9 ,'-]+) deals (\d+) damage to any target\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[2], 10);
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const player = getPlayerById(ctx, targetId as any);
      if (player) {
        applyDamageToPlayer(ctx, targetId as any, amount);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to player)`);
        return true;
      }

      applyDamageToPermanent(ctx, targetId, amount);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to permanent)`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_N_LIFE": {
      const m = text.match(/^([a-z0-9 ,'-]+) deals (\d+) damage to any target\. you gain \2 life\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[2], 10);
      if (!Number.isFinite(amount) || amount <= 0) return true;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const player = getPlayerById(ctx, targetId as any);
      if (player) {
        applyDamageToPlayer(ctx, targetId as any, amount);
      } else {
        applyDamageToPermanent(ctx, targetId, amount);
      }

      modifyLifeLikeStack(ctx, controller, amount);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} dmg + ${amount} life)`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_AND_PLANESWALKER_THEY_CONTROL": {
      const m = text.match(/^[a-z0-9 ,'-]+ deals (\d+) damage to target player and each creature and planeswalker they control\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[1], 10);
      if (!Number.isFinite(amount) || amount <= 0) return true;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      const player = getPlayerById(ctx, targetPlayerId as any);
      if (!player) return false; // effect says target player

      applyDamageToPlayer(ctx, targetPlayerId as any, amount);

      const battlefield = getBattlefield(ctx);
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== targetPlayerId) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature') && !tl.includes('planeswalker')) continue;
        applyDamageToPermanent(ctx, perm.id, amount);
      }

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount})`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_PLAYER_OR_PLANESWALKER": {
      const m = text.match(/^[a-z0-9 ,'-]+ deals (\d+) damage to target player or planeswalker\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[1], 10);
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const player = getPlayerById(ctx, targetId as any);
      if (player) {
        applyDamageToPlayer(ctx, targetId as any, amount);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to player)`);
        return true;
      }

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;
      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes('planeswalker')) return false;

      applyDamageToPermanent(ctx, targetId, amount);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to planeswalker)`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_OPPONENT_OR_PLANESWALKER_AND_EACH_CREATURE_THEY_CONTROL": {
      const m = text.match(
        /^[a-z0-9 ,'-]+ deals (\d+) damage to target opponent or planeswalker and each creature (?:they control|that player or that planeswalker's controller controls)\.?$/i
      );
      if (!m) return false;

      const amount = parseInt(m[1], 10);
      if (!Number.isFinite(amount) || amount <= 0) return true;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const player = getPlayerById(ctx, targetId as any);
      let affectedController: string | null = null;

      if (player) {
        if (String(targetId) === String(controller)) return false; // effect says opponent
        applyDamageToPlayer(ctx, targetId as any, amount);
        affectedController = String(targetId);
      } else {
        const battlefield = getBattlefield(ctx);
        const perm = battlefield.find((p: any) => p?.id === targetId);
        if (!perm) return false;
        const tl = String(perm?.card?.type_line || "").toLowerCase();
        if (!tl.includes("planeswalker")) return false;
        applyDamageToPermanent(ctx, targetId, amount);
        affectedController = String(perm.controller || "");
      }

      if (!affectedController) return false;

      const battlefield = getBattlefield(ctx);
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (String(perm.controller) !== affectedController) continue;
        const tl = String(perm.card?.type_line || "").toLowerCase();
        if (!tl.includes("creature")) continue;
        applyDamageToPermanent(ctx, perm.id, amount);
      }

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount})`);
      return true;
    }

    case "DEAL_X_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_AND_GAIN_X_LIFE": {
      const m = text.match(/^([a-z0-9 ,'-]+) deals x damage to target creature or planeswalker and you gain x life\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      applyDamageToPermanent(ctx, targetPermanentId, x);
      modifyLifeLikeStack(ctx, controller, x);
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x})`);
      return true;
    }

    case "DEALS_X_DAMAGE_TO_EACH_CREATURE": {
      const m = text.match(/^([a-z0-9 ,'-]+) deals x damage to each creature\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const battlefield = getBattlefield(ctx);
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || "").toLowerCase();
        if (!tl.includes("creature")) continue;
        applyDamageToPermanent(ctx, perm.id, x);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x})`);
      return true;
    }

    case "EACH_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_EACH_OPPONENT": {
      const m = text.match(/^each creature you control deals damage equal to its power to each opponent\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const opponents = getOpponents(ctx, controller);
      if (opponents.length === 0) return true;

      let total = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        const pt = getActualPowerToughness(ctx as any, perm);
        total += Math.max(0, pt.power | 0);
      }

      if (total <= 0) return true;
      for (const opp of opponents) {
        applyDamageToPlayer(ctx, opp, total);
      }

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${total} to each opponent)`);
      return true;
    }

    case "EXILE_THIS_PLANESWALKER_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL": {
      const m = text.match(/^exile [a-z0-9 ,'-]+ and each creature your opponents control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      if (sourceId) {
        movePermanentToExile(ctx, sourceId);
      }

      const toExile: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller === controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        toExile.push(perm.id);
      }

      exilePermanents(ctx, toExile);
      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${toExile.length} creatures)`);
      return true;
    }

    case "EXILE_TARGET_PERMANENT": {
      const m = text.match(/^exile target permanent\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const pwOracleId = triggerItem?.planeswalker?.oracleId;

      movePermanentToExile(
        ctx,
        targetId,
        pwOracleId
          ? {
              exiledWithSourceId: sourceId,
              exiledWithOracleId: pwOracleId,
              exiledWithSourceName: sourceName,
            }
          : undefined
      );
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_NONLAND_PERMANENT": {
      const m = text.match(
        /^destroy target nonland permanent(?: (?:you control|you don't control|an opponent controls))?(?: with mana value \d+ or (?:less|greater))?\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (tl.includes("land")) return true;

      const lower = text.toLowerCase();
      const control = getControlConstraint(lower);
      if (control === 'you' && perm.controller !== controller) return false;
      if (control === 'not_you' && perm.controller === controller) return false;

      const mv = getManaValueConstraint(lower);
      if (!satisfiesManaValueConstraint(perm, mv)) return false;

      movePermanentToGraveyard(ctx, targetId, true);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_PERMANENT_THATS_ONE_OR_MORE_COLORS": {
      const m = text.match(/^destroy target permanent that['’]s one or more colors\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return false;

      const colorsRaw: unknown = (perm as any)?.card?.colors ?? (perm as any)?.card?.color_indicator;
      const colors = Array.isArray(colorsRaw) ? colorsRaw.map((c) => String(c || '').toUpperCase()).filter(Boolean) : [];
      if (colors.length === 0) {
        // Illegal target (colorless) => resolve as no-op.
        return true;
      }

      movePermanentToGraveyard(ctx, targetId, true);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "YOU_AND_TARGET_OPPONENT_EACH_DRAW_A_CARD": {
      const m = text.match(/^you and target opponent each draw a card\.?$/i);
      if (!m) return false;

      const [targetOpponent] = getTargets(triggerItem);
      if (!targetOpponent) return false;

      drawCardsFromZone(ctx, controller, 1);
      drawCardsFromZone(ctx, targetOpponent as any, 1);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND": {
      const m = text.match(/^target player exiles a card from their hand\.?$/i);
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones[targetPlayer]?.hand || [];
      if (hand.length <= 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: targetPlayer as any,
        description: `${sourceName}: Exile 1 card from hand`,
        mandatory: true,
        sourceName: sourceName,
        discardCount: 1,
        destination: "exile",
        exileTag: triggerItem?.planeswalker?.oracleId
          ? {
              exiledWithSourceId: triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id,
              exiledWithOracleId: triggerItem?.planeswalker?.oracleId,
              exiledWithSourceName: sourceName,
            }
          : undefined,
        hand: hand.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "RESTART_THE_GAME_LEAVING_IN_EXILE_ALL_NON_AURA_PERMANENT_CARDS_EXILED_WITH_SOURCE_THEN_PUT_THOSE_CARDS_ONTO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL": {
      const m = text.match(
        /^restart the game, leaving in exile all non-aura permanent cards exiled with [a-z0-9 ,'-]+\. then put those cards onto the battlefield under your control\.?$/i
      );
      if (!m) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      if (!sourceId) return false;

      const result = restartGameWithKarnExemptions(ctx, controller, String(sourceId));
      debug(
        2,
        `[planeswalker/templates] ${sourceName}: resolved ${match.id} (preserved ${result.preservedCount})`
      );
      return true;
    }

    case "TARGET_PLAYER_SACRIFICES_A_CREATURE": {
      const m = text.match(/^target player sacrifices a creature\.?$/i);
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const creatures = battlefield.filter((perm: any) => {
        if (perm?.controller !== targetPlayer) return false;
        const tl = String(perm?.card?.type_line || "").toLowerCase();
        return tl.includes("creature");
      });

      if (creatures.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no creatures to sacrifice)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.UPKEEP_SACRIFICE,
        playerId: targetPlayer as any,
        description: `${sourceName}: Sacrifice a creature`,
        mandatory: true,
        sourceName: sourceName,
        // Custom data for selection UI + server handler
        allowSourceSacrifice: false,
        hasCreatures: true,
        creatures: creatures.map((perm: any) => ({
          id: perm.id,
          name: perm.card?.name || "Creature",
          imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          power: perm.card?.power || perm.basePower,
          toughness: perm.card?.toughness || perm.baseToughness,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEPARATE_ALL_PERMANENTS_TARGET_PLAYER_CONTROLS_INTO_TWO_PILES_THAT_PLAYER_SACRIFICES_PILE_OF_THEIR_CHOICE": {
      const m = text.match(
        /^separate all permanents target player controls into two piles\.\s*that player sacrifices all permanents in the pile of their choice\.?$/i
      );
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const permanents = battlefield.filter((perm: any) => perm?.controller === targetPlayer);
      if (permanents.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no permanents)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TWO_PILE_SPLIT,
        playerId: targetPlayer as any,
        description: `${sourceName}: Separate your permanents into two piles`,
        mandatory: true,
        sourceName,
        items: permanents.map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Permanent',
          description: p.card?.type_line || '',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        })),
        minPerPile: 0,
        pwLilianaSplitPermanents: true,
        pwLilianaTargetPlayerId: targetPlayer,
        pwLilianaSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "UNTAP_TARGET_ARTIFACT_OR_CREATURE_IF_ARTIFACT_CREATURE_P1P1": {
      const m = text.match(
        /^untap target artifact or creature\. if it's an artifact creature, put a \+1\/\+1 counter on it\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!(tl.includes("artifact") || tl.includes("creature"))) return true;

      perm.tapped = false;
      if (tl.includes("artifact") && tl.includes("creature")) {
        updateCounters(ctx, targetId, { "+1/+1": 1 });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_UP_TO_ONE_TARGET_LAND_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND": {
      const m = text.match(/^return up to one target land card from your graveyard to your hand\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      const landCards = gy.filter((c: any) => String(c?.type_line || "").toLowerCase().includes("land"));
      if (landCards.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose up to one land card in your graveyard to return to your hand`,
        mandatory: true,
        sourceName,
        minTargets: 0,
        maxTargets: 1,
        action: 'move_graveyard_card_to_hand',
        fromPlayerId: controller,
        validTargets: landCards.map((c: any) => ({
          id: c.id,
          label: c.name || 'Land',
          description: c.type_line || 'land card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_CARD_IF_ITS_A_CREATURE_CARD_YOU_MAY_REVEAL_PUT_INTO_HAND": {
      const m = text.match(
        /^look at the top card of your library\. if it's a creature card, you may reveal it and put it into your hand\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const lib: any[] = zones[controller]?.library || [];
      if (lib.length === 0) return true;

      const top = lib[0];
      const isCreature = String(top?.type_line || "").toLowerCase().includes('creature');
      if (!isCreature) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (top not creature)`);
        return true;
      }

      // Conservative: auto-put into hand (no "may" UI yet).
      // This is consistent with other non-interactive templates and avoids new UI.
      drawCardsFromZone(ctx, controller, 1);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (drew creature)`);
      return true;
    }

    case "CREATE_FRACTAL_0_0_PUT_X_P1P1_COUNTERS_ON_IT": {
      const m = text.match(/^create a 0\/0 green and blue fractal creature token\. put x \+1\/\+1 counters on it\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      const n = (x | 0) > 0 ? (x | 0) : 0;

      const createdIds = createToken(ctx, controller, 'Fractal', 1, undefined, undefined, {
        colors: ['G', 'U'],
        typeLine: 'Token Creature — Fractal',
      });

      if (createdIds.length > 0 && n > 0) {
        updateCounters(ctx, createdIds[0], { "+1/+1": n });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${n})`);
      return true;
    }

    case "SURVEIL_N_THEN_EXILE_A_CARD_FROM_A_GRAVEYARD": {
      const m = text.match(/^surveil (\d+), then exile a card from a graveyard\.?$/i);
      if (!m) return false;

      const n = parseInt(m[1], 10) || 0;
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      // Use the existing SURVEIL step, but attach a follow-up so the socket handler
      // can enqueue the graveyard-exile selection after surveil is resolved.
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SURVEIL,
        playerId: controller,
        description: `${sourceName}: Surveil ${n}`,
        mandatory: true,
        sourceName,
        surveilCount: n,
        followUpExileGraveyardCard: true,
        followUpSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SURVEIL_N": {
      const m = text.match(/^surveil (\d+)\.?$/i);
      if (!m) return false;

      const n = parseInt(m[1], 10) || 0;
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SURVEIL,
        playerId: controller,
        description: `${sourceName}: Surveil ${n}`,
        mandatory: true,
        sourceName,
        surveilCount: n,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued surveil ${n})`);
      return true;
    }

    case "REVEAL_TOP_N_YOU_MAY_PUT_A_CREATURE_CARD_AND_OR_A_LAND_CARD_INTO_YOUR_HAND_REST_INTO_GRAVEYARD": {
      const m = text.match(
        /^reveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.? you may put a creature card and\/or a land card from among them into your hand\.? put the rest into your graveyard\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Reveal top ${revealed.length} (put up to 1 creature and/or 1 land into your hand)`,
        mandatory: false,
        sourceName,
        searchCriteria: `a creature card and/or a land card`,
        minSelections: 0,
        maxSelections: Math.min(2, revealed.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'graveyard',
        remainderRandomOrder: false,
        filter: { types: ['creature', 'land'] },
        maxTypes: { creature: 1, land: 1 },
        availableCards: revealed.map((card: any) => ({
          id: card.id,
          name: card.name,
          type_line: card.type_line,
          oracle_text: card.oracle_text,
          image_uris: card.image_uris,
          mana_cost: card.mana_cost,
          cmc: card.cmc,
          colors: card.colors,
          power: (card as any).power,
          toughness: (card as any).toughness,
          loyalty: (card as any).loyalty,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "REVEAL_TOP_N_PUT_ALL_CREATURE_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^reveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put all creature cards revealed this way into your hand and the rest on the bottom of your library in any order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const isCreature = (c: any) => String(c?.type_line || '').toLowerCase().includes('creature');
      const selectable = revealed.filter(isCreature);
      const nonSelectable = revealed.filter((c: any) => !isCreature(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Reveal top ${revealed.length} (put all creature cards into your hand)` ,
        mandatory: selectable.length > 0,
        sourceName,
        searchCriteria: `all creature cards` ,
        minSelections: selectable.length,
        maxSelections: selectable.length,
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderPlayerChoosesOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "REVEAL_TOP_N_PUT_ALL_NONLAND_PERMANENT_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^reveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put all nonland permanent cards revealed this way into your hand and the rest on the bottom of your library in any order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const isNonlandPermanent = (c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (tl.includes('land')) return false;
        return (
          tl.includes('artifact') ||
          tl.includes('creature') ||
          tl.includes('enchantment') ||
          tl.includes('planeswalker') ||
          tl.includes('battle')
        );
      };

      const selectable = revealed.filter(isNonlandPermanent);
      const nonSelectable = revealed.filter((c: any) => !isNonlandPermanent(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Reveal top ${revealed.length} (put all nonland permanent cards into your hand)` ,
        mandatory: selectable.length > 0,
        sourceName,
        searchCriteria: `all nonland permanent cards` ,
        minSelections: selectable.length,
        maxSelections: selectable.length,
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderPlayerChoosesOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE": {
      const m = text.match(/^search your library for a card named (.+), put it onto the battlefield, then shuffle\.?$/i);
      if (!m) return false;

      const requestedName = normalizeCardNameForCompare(m[1]);
      if (!requestedName) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const available = lib.filter((c: any) => normalizeCardNameForCompare(c?.name) === requestedName);
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search your library for ${m[1]} (put onto the battlefield)` ,
        mandatory: true,
        sourceName,
        searchCriteria: `a card named ${m[1]}`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_SHUFFLE_IF_LIBRARY": {
      const m = text.match(
        /^search your library and\/or graveyard for a card named (.+) and put it onto the battlefield\. if you search your library this way, shuffle\.?$/i
      );
      if (!m) return false;

      const requestedName = normalizeCardNameForCompare(m[1]);
      if (!requestedName) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      const zones = (ctx as any)?.state?.zones || {};
      const z = zones?.[controller] || {};
      const gy: any[] = Array.isArray(z?.graveyard) ? z.graveyard : [];

      const availableFromLib = Array.isArray(lib)
        ? lib.filter((c: any) => normalizeCardNameForCompare(c?.name) === requestedName)
        : [];
      const availableFromGy = Array.isArray(gy)
        ? gy.filter((c: any) => normalizeCardNameForCompare(c?.name) === requestedName)
        : [];

      const available = [...availableFromLib, ...availableFromGy];
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search your library and/or graveyard for ${m[1]} (put onto the battlefield)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a card named ${m[1]}`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        shuffleOnlyIfSelectedFromLibrary: true,
        searchZones: ['library', 'graveyard'],
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_REVEAL_PUT_IT_INTO_YOUR_HAND_SHUFFLE_IF_LIBRARY": {
      const m = text.match(
        /^search your library and\/or graveyard for a card named (.+), reveal it, and put it into your hand\. if you search your library this way, shuffle\.?$/i
      );
      if (!m) return false;

      const requestedName = normalizeCardNameForCompare(m[1]);
      if (!requestedName) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      const zones = (ctx as any)?.state?.zones || {};
      const z = zones?.[controller] || {};
      const gy: any[] = Array.isArray(z?.graveyard) ? z.graveyard : [];

      const availableFromLib = Array.isArray(lib)
        ? lib.filter((c: any) => normalizeCardNameForCompare(c?.name) === requestedName)
        : [];
      const availableFromGy = Array.isArray(gy)
        ? gy.filter((c: any) => normalizeCardNameForCompare(c?.name) === requestedName)
        : [];

      const available = [...availableFromLib, ...availableFromGy];
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search your library and/or graveyard for ${m[1]} (reveal, put into your hand)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a card named ${m[1]}`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        shuffleOnlyIfSelectedFromLibrary: true,
        searchZones: ['library', 'graveyard'],
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_WITH_MANA_VALUE_N_OR_LESS_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for (?:a|an) (creature|artifact|enchantment|planeswalker|land|basic land) card with mana value (\d+) or less, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const rawType = String(m[1] || '').toLowerCase();
      const maxMv = parseInt(m[2], 10);
      if (!Number.isFinite(maxMv)) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const filter: any = {
        types: [rawType],
        maxCmc: maxMv,
      };

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl.includes(rawType)) return false;
        const cmc = typeof c?.cmc === 'number' ? c.cmc : Number(c?.cmc ?? NaN);
        if (!Number.isFinite(cmc)) return false;
        return cmc <= maxMv;
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for a ${m[1]} (mana value ${maxMv} or less)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a ${m[1]} card with mana value ${maxMv} or less`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        filter,
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_ANY_NUMBER_OF_SUBTYPE_CREATURE_CARDS_PUT_THEM_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for any number of ([a-z][a-z-]*) creature cards, put them onto the battlefield, then shuffle\.?$/i
      );
      if (!m) return false;

      const subtype = String(m[1] || '').toLowerCase();
      if (!subtype) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const subtypeRx = new RegExp(`\\b${subtype.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase().replace(/—/g, ' ');
        return tl.includes('creature') && subtypeRx.test(tl);
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for any number of ${m[1]} creature cards (put onto the battlefield)`,
        mandatory: false,
        sourceName,
        searchCriteria: `any number of ${m[1]} creature cards`,
        minSelections: 0,
        maxSelections: available.length,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        filter: { types: ['creature'], subtypes: [subtype] },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_A_BASIC_LAND_CARD_PUT_IT_ONTO_THE_BATTLEFIELD_OPTIONALLY_TAPPED_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for a basic land card, put (?:it|that card) onto the battlefield( tapped)?(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const entersTapped = !!m[1];

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('basic') && tl.includes('land');
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for a basic land (put onto the battlefield${entersTapped ? ' tapped' : ''})`,
        mandatory: true,
        sourceName,
        searchCriteria: `a basic land card`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        entersTapped,
        filter: { types: ['land'], supertypes: ['basic'] },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_A_CARD_THEN_SHUFFLE_PUT_ON_TOP": {
      const m = text.match(/^search your library for a card(?:,|\.)\s*then shuffle and put that card on top(?: of your library)?\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search your library for a card (put on top)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a card`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'top',
        reveal: false,
        shuffleAfter: true,
        availableCards: lib.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_AN_ARTIFACT_CARD_WITH_MANA_VALUE_X_OR_LESS_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for an artifact card with mana value x or less, put (?:it|that card) onto the battlefield(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (x === null) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl.includes('artifact')) return false;
        const cmc = typeof c?.cmc === 'number' ? c.cmc : Number(c?.cmc ?? NaN);
        if (!Number.isFinite(cmc)) return false;
        return cmc <= x;
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for an artifact (mana value ${x} or less) (put onto battlefield)`,
        mandatory: true,
        sourceName,
        searchCriteria: `an artifact card with mana value ${x} or less`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        filter: { types: ['artifact'], maxCmc: x },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_A_SUBTYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for (?:a|an) (basic )?([a-z][a-z-]*) card, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const basicFlag = !!m[1];
      const subtypeRaw = String(m[2] || '').trim();
      const subtypeLower = subtypeRaw.toLowerCase();
      if (!subtypeLower) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const isBasicLandSubtype = ['plains', 'island', 'swamp', 'mountain', 'forest'].includes(subtypeLower);

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (basicFlag && !tl.includes('basic')) return false;
        if (isBasicLandSubtype && !tl.includes('land')) return false;
        return tl.includes(subtypeLower);
      });
      if (available.length === 0) return true;

      const filter: any = { subtypes: [subtypeLower] };
      if (isBasicLandSubtype) filter.types = ['land'];
      if (basicFlag) filter.supertypes = ['basic'];

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for ${basicFlag ? 'a basic ' : 'a '}${subtypeRaw} card (reveal, put into hand)`,
        mandatory: true,
        sourceName,
        searchCriteria: `${basicFlag ? 'a basic ' : 'a '}${subtypeRaw} card`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        filter,
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for (?:a|an) (creature|artifact|enchantment|planeswalker|land|basic land|instant|sorcery) card, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const rawType = String(m[1] || '').toLowerCase();

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes(rawType);
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for a ${m[1]} (reveal, put into hand)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a ${m[1]} card`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        filter: { types: [rawType] },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_UP_TO_ONE_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for up to one (?:a|an) (creature|artifact|enchantment|planeswalker|land|basic land|instant|sorcery) card, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const rawType = String(m[1] || '').toLowerCase();

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes(rawType);
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for up to one ${m[1]} (reveal, put into hand)`,
        mandatory: false,
        sourceName,
        searchCriteria: `up to one ${m[1]} card`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        filter: { types: [rawType] },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_AN_INSTANT_OR_SORCERY_CARD_THAT_SHARES_A_COLOR_WITH_THIS_PLANESWALKER_EXILE_THEN_SHUFFLE_YOU_MAY_CAST_THAT_CARD_WITHOUT_PAYING_ITS_MANA_COST": {
      const m = text.match(
        /^search your library for an instant or sorcery card that shares a color with this planeswalker, exile that card(?:,|\.)\s*then shuffle\.?\s*you may cast that card without paying its mana cost\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const pwColors = new Set(getSourcePlaneswalkerColors(ctx, controller, sourceName, triggerItem));
      if (pwColors.size === 0) return false;

      const sharesColor = (card: any): boolean => {
        const raw = card?.colors ?? card?.color_identity;
        const colors = Array.isArray(raw) ? raw.map((c: any) => String(c || '').toUpperCase()) : [];
        return colors.some((c: string) => pwColors.has(c));
      };

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        const isInstantOrSorcery = tl.includes('instant') || tl.includes('sorcery');
        if (!isInstantOrSorcery) return false;
        return sharesColor(c);
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search your library (instant/sorcery sharing a color), exile it`,
        mandatory: true,
        sourceName,
        searchCriteria: `an instant or sorcery card that shares a color with ${sourceName}`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'exile',
        reveal: false,
        shuffleAfter: true,
        filter: { types: ['instant', 'sorcery'] },
        availableCards: available.map(toAvailableCard),
        followUpMayCastSelectedFromExileWithoutPayingManaCost: true,
        followUpMayCastDeclineDestination: 'exile',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_SACRIFICE_A_CREATURE_WHEN_YOU_DO_DESTROY_TARGET_CREATURE_OR_PLANESWALKER": {
      const m = text.match(/^you may sacrifice a creature\.? when you do, destroy target creature or planeswalker\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const creatures = battlefield.filter((perm: any) => {
        if (perm?.controller !== controller) return false;
        const tl = String(perm?.card?.type_line || '').toLowerCase();
        return tl.includes('creature');
      });

      if (creatures.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no creatures to sacrifice)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.UPKEEP_SACRIFICE,
        playerId: controller as any,
        description: `${sourceName}: You may sacrifice a creature`,
        mandatory: false,
        sourceName,
        allowSourceSacrifice: false,
        hasCreatures: true,
        afterSacrificeDestroyTargetCreatureOrPlaneswalker: true,
        creatures: creatures.map((perm: any) => ({
          id: perm.id,
          name: perm.card?.name || 'Creature',
          imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          power: perm.card?.power || perm.basePower,
          toughness: perm.card?.toughness || perm.baseToughness,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SCRY_N": {
      const m = text.match(/^scry (\d+)\.?$/i);
      if (!m) return false;

      const actualCount = parseInt(m[1], 10) || 0;
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `${sourceName}: Scry ${actualCount}`,
        mandatory: true,
        sourceName: sourceName,
        scryCount: actualCount,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (scry ${actualCount})`);
      return true;
    }

    case "SCRY_N_THEN_DEALS_M_DAMAGE_TO_EACH_OPPONENT": {
      const m = text.match(
        /^scry (\d+)\.?\s*(?:[a-z0-9 ,'-]+|it) deals (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) damage to each opponent\.?$/i
      );
      if (!m) return false;

      const scryN = parseInt(m[1], 10) || 0;
      const dmg = parseCountTokenWord(m[2]);
      if (scryN <= 0) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `${sourceName}: Scry ${scryN}`,
        mandatory: true,
        sourceName: sourceName,
        scryCount: scryN,
        pwScryThenDamageToEachOpponent: true,
        pwScryThenDamageController: controller,
        pwScryThenDamageAmount: dmg,
        pwScryThenDamageSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued scry ${scryN}, dmg ${dmg})`);
      return true;
    }

    case "SCRY_N_THEN_DRAW_A_CARD": {
      const m = text.match(/^scry (\d+),? then draw a card\.?$/i);
      if (!m) return false;

      const scryN = parseInt(m[1], 10) || 0;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `${sourceName}: Scry ${scryN}`,
        mandatory: true,
        sourceName: sourceName,
        scryCount: scryN,
        pwScryThenDrawCards: true,
        pwScryThenDrawCardsController: controller,
        pwScryThenDrawCardsAmount: 1,
        pwScryThenDrawCardsSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued scry ${scryN}, draw 1)`);
      return true;
    }

    case "SCRY_N_IF_YOU_CONTROL_AN_ARTIFACT_DRAW_A_CARD": {
      const m = text.match(/^scry (\d+)\. if you control an artifact, draw a card\.?$/i);
      if (!m) return false;

      const scryN = parseInt(m[1], 10) || 0;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `${sourceName}: Scry ${scryN}`,
        mandatory: true,
        sourceName: sourceName,
        scryCount: scryN,
        pwScryThenDrawCards: true,
        pwScryThenDrawCardsIfControllerControlsArtifact: true,
        pwScryThenDrawCardsController: controller,
        pwScryThenDrawCardsAmount: 1,
        pwScryThenDrawCardsSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued scry ${scryN}, conditional draw)`);
      return true;
    }

    case "EACH_OPPONENT_DISCARDS_N_AND_LOSES_M_LIFE": {
      const m = text.match(
        /^each opponent discards (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? and loses (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i
      );
      if (!m) return false;

      const discardN = parseCountTokenWord(m[1]);
      const loseLifeN = parseCountTokenWord(m[2]);

      const opponents = getOpponents(ctx, controller);
      if (!opponents.length) return true;

      // Apply life loss immediately (approximation of simultaneous resolution).
      for (const opp of opponents) {
        modifyLifeLikeStack(ctx, opp, -loseLifeN);
      }

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (life only; no queue)`);
        return true;
      }

      const zones = (state as any)?.zones || {};
      for (const opp of opponents) {
        const hand: any[] = zones[opp]?.hand || [];
        const actualDiscard = Math.max(0, Math.min(discardN, hand.length));
        if (actualDiscard <= 0) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.DISCARD_SELECTION,
          playerId: opp,
          description: `${sourceName}: Discard ${actualDiscard} card(s)`,
          mandatory: true,
          sourceName: sourceName,
          discardCount: actualDiscard,
          hand: hand.map((c: any) => ({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris,
            mana_cost: c.mana_cost,
            cmc: c.cmc,
            colors: c.colors,
          })),
        } as any);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opponents=${opponents.length})`);
      return true;
    }

    case "EACH_OPPONENT_DISCARDS_A_CARD_AND_YOU_DRAW_A_CARD": {
      const m = text.match(/^each opponent discards a card and you draw a card\.?$/i);
      if (!m) return false;

      // Approximate: draw immediately; queue opponent discards.
      drawCardsFromZone(ctx, controller, 1);

      const opponents = getOpponents(ctx, controller);
      if (!opponents.length) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (draw only; no queue)`);
        return true;
      }

      const zones = (state as any)?.zones || {};
      for (const opp of opponents) {
        const hand: any[] = zones[opp]?.hand || [];
        if (hand.length <= 0) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.DISCARD_SELECTION,
          playerId: opp,
          description: `${sourceName}: Discard 1 card`,
          mandatory: true,
          sourceName: sourceName,
          discardCount: 1,
          hand: hand.map((c: any) => ({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris,
            mana_cost: c.mana_cost,
            cmc: c.cmc,
            colors: c.colors,
          })),
        } as any);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opponents=${opponents.length})`);
      return true;
    }

    case "EACH_OPPONENT_LOSES_LIFE_EQUAL_CARDS_IN_GRAVEYARD": {
      const m = text.match(/^each opponent loses life equal to the number of cards in their graveyard\.?$/i);
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const opponents = getOpponents(ctx, controller);
      for (const opp of opponents) {
        const gyCount = zones[opp]?.graveyardCount ?? zones[opp]?.graveyard?.length ?? 0;
        const lose = Math.max(0, gyCount | 0);
        if (lose > 0) modifyLifeLikeStack(ctx, opp, -lose);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_ARTIFACTS_YOU_CONTROL": {
      const m = text.match(/^target opponent loses life equal to the number of artifacts you control\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      if (targetId === controller) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      const battlefield = getBattlefield(ctx);
      let artifactCount = 0;
      for (const p of battlefield) {
        if (p?.controller !== controller) continue;
        const tl = String(p?.card?.type_line || '').toLowerCase();
        if (tl.includes('artifact')) artifactCount++;
      }

      if (artifactCount > 0) modifyLifeLikeStack(ctx, targetId as any, -artifactCount);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${artifactCount})`);
      return true;
    }

    case "EACH_OPPONENT_LOSES_N_LIFE_AND_YOU_GAIN_N_LIFE": {
      const m = text.match(
        /^each opponent loses (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life and you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i
      );
      if (!m) return false;

      const loseN = parseCountTokenWord(m[1]);
      const gainN = parseCountTokenWord(m[2]);

      const opponents = getOpponents(ctx, controller);
      for (const opp of opponents) {
        modifyLifeLikeStack(ctx, opp, -loseN);
      }
      modifyLifeLikeStack(ctx, controller, gainN);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opp lose ${loseN}, you gain ${gainN})`);
      return true;
    }

    case "YOU_GET_EMBLEM": {
      const m = text.match(/^you get an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i);
      if (!m) return false;

      const effect = m[1].trim();
      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid("emblem"),
        controller,
        sourceName,
        effect,
      });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DRAW_N_CARDS_YOU_GET_AN_EMBLEM_WITH_QUOTED_TEXT": {
      const m = text.match(
        /^draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\. you get an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i
      );
      if (!m) return false;

      const drawN = parseCountTokenWord(m[1]);
      if (drawN > 0) drawCardsFromZone(ctx, controller, drawN);

      const effect = String(m[2] || '').trim();
      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid('emblem'),
        controller,
        sourceName,
        effect,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (draw ${drawN})`);
      return true;
    }

    case "TARGET_PLAYER_GETS_AN_EMBLEM_WITH_QUOTED_TEXT": {
      const m = text.match(/^target player gets an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i);
      if (!m) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      const effect = m[1].trim();
      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid('emblem'),
        controller: targetPlayerId as any,
        sourceName,
        effect,
      });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT": {
      const m = text.match(/^target opponent gets an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i);
      if (!m) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;
      if (targetPlayerId === controller) return false;

      const effect = m[1].trim();
      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid('emblem'),
        controller: targetPlayerId as any,
        sourceName,
        effect,
      });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EACH_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT": {
      const m = text.match(/^each opponent gets an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i);
      if (!m) return false;

      const effect = String(m[1] || '').trim();
      state.emblems = state.emblems || [];

      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;
        if (pid === controller) continue;
        state.emblems.push({
          id: uid('emblem'),
          controller: pid,
          sourceName,
          effect,
        });
      }

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "YOU_GET_EMBLEM_THEN_CREATE_TOKEN_BASIC": {
      const m = text.match(
        /^you get an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?\s*then create (a|an|one|two|three|four|five|\d+) (tapped )?(\d+)\/(\d+) ([^\.]+?) tokens?(?: with ([\s\S]+?))?\.?$/i
      );
      if (!m) return false;

      const effect = String(m[1] || '').trim();
      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid('emblem'),
        controller,
        sourceName,
        effect,
      });

      const count = parseCountTokenWord(m[2]);
      const isTapped = !!m[3];
      const power = parseInt(m[4], 10);
      const toughness = parseInt(m[5], 10);
      const descriptor = `${String(m[6] || '').trim()}${m[7] ? ` with ${String(m[7]).trim()}` : ''}`;
      const { name, colors, abilities } = parseCreateTokenDescriptor(descriptor);

      const createdIds = createToken(ctx, controller, name, count, power, toughness, {
        colors,
        abilities,
      });

      if (isTapped) {
        const battlefield = getBattlefield(ctx);
        for (const id of createdIds) {
          const perm = battlefield.find((p: any) => p?.id === id);
          if (perm) perm.tapped = true;
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (emblem + ${count} token(s))`);
      return true;
    }

    case "CONTAINS_YOU_GET_EMBLEM_WITH_QUOTED_TEXT_MANUAL": {
      const gameId = getGameId(ctx);
      const sourceId = String((triggerItem as any)?.source || "");
      const description = `[Manual planeswalker resolution] ${sourceName}: ${text}`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown') {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceId,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        });
      }

      return true;
    }

    case "PUT_A_CARD_YOU_OWN_WITH_A_SILVER_COUNTER_ON_IT_FROM_EXILE_INTO_YOUR_HAND": {
      const m = text.match(/^put a card you own with a silver counter on it from exile into your hand\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const exile: any[] = Array.isArray(zones?.[controller]?.exile) ? zones[controller].exile : [];

      const available = exile.filter((c: any) => (c as any)?.silverCounters && Number((c as any).silverCounters) > 0);
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Choose a card you own with a silver counter on it (from exile)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a card you own with a silver counter on it`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZone: 'exile',
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_PUT_A_SUBTYPE_CREATURE_CARD_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD": {
      const m = text.match(
        /^you may put a ([a-z][a-z-]*) creature card with mana value (\d+) or less from your hand onto the battlefield\.?$/i
      );
      if (!m) return false;

      const subtype = String(m[1] || '').toLowerCase();
      const maxMv = parseInt(m[2], 10);
      if (!subtype || !Number.isFinite(maxMv)) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = Array.isArray(zones?.[controller]?.hand) ? zones[controller].hand : [];
      if (hand.length === 0) return true;

      const available = hand.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) return false;
        if (!tl.includes(subtype)) return false;
        const cmc = typeof c?.cmc === 'number' ? c.cmc : Number(c?.cmc ?? NaN);
        if (!Number.isFinite(cmc)) return false;
        return cmc <= maxMv;
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: You may put a ${m[1]} creature (mana value ${maxMv} or less) from your hand onto the battlefield`,
        mandatory: false,
        sourceName,
        searchCriteria: `a ${m[1]} creature card with mana value ${maxMv} or less`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZone: 'hand',
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_PUT_A_COLOR_OR_SUBTYPE_CREATURE_CARD_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD": {
      const m = text.match(/^you may put a ([a-z][a-z-]*) creature card from your hand onto the battlefield\.?$/i);
      if (!m) return false;

      const adjective = String(m[1] || '').toLowerCase();
      if (!adjective) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = Array.isArray(zones?.[controller]?.hand) ? zones[controller].hand : [];
      if (hand.length === 0) return true;

      const colorWords = new Set(['white', 'blue', 'black', 'red', 'green']);
      const colorMap: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
      const isColor = colorWords.has(adjective);
      const colorSymbol = isColor ? colorMap[adjective] : null;

      const available = hand.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) return false;
        if (isColor) {
          const colorsRaw: unknown = c?.colors ?? c?.color_identity;
          const colors = Array.isArray(colorsRaw) ? colorsRaw.map((x) => String(x || '').toUpperCase()) : [];
          return !!colorSymbol && colors.includes(colorSymbol);
        }
        return tl.includes(adjective);
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: You may put a ${m[1]} creature from your hand onto the battlefield`,
        mandatory: false,
        sourceName,
        searchCriteria: `a ${m[1]} creature card`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZone: 'hand',
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_PUT_AN_ARTIFACT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD": {
      const m = text.match(/^you may put an artifact card from your hand or graveyard onto the battlefield\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = Array.isArray(zones?.[controller]?.hand) ? zones[controller].hand : [];
      const graveyard: any[] = Array.isArray(zones?.[controller]?.graveyard) ? zones[controller].graveyard : [];
      const combined = [...hand, ...graveyard];
      if (combined.length === 0) return true;

      const available = combined.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('artifact');
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: You may put an artifact card from your hand or graveyard onto the battlefield`,
        mandatory: false,
        sourceName,
        searchCriteria: `an artifact card`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZones: ['hand', 'graveyard'],
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_PUT_AN_EQUIPMENT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD": {
      const m = text.match(/^you may put an equipment card from your hand or graveyard onto the battlefield\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = Array.isArray(zones?.[controller]?.hand) ? zones[controller].hand : [];
      const graveyard: any[] = Array.isArray(zones?.[controller]?.graveyard) ? zones[controller].graveyard : [];
      const combined = [...hand, ...graveyard];
      if (combined.length === 0) return true;

      const available = combined.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('equipment');
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: You may put an Equipment card from your hand or graveyard onto the battlefield`,
        mandatory: false,
        sourceName,
        searchCriteria: `an Equipment card`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZones: ['hand', 'graveyard'],
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_PUT_A_CREATURE_CARD_WITH_MANA_VALUE_LESS_THAN_OR_EQUAL_TO_LANDS_YOU_CONTROL_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_WITH_TWO_P1P1_COUNTERS": {
      const m = text.match(
        /^you may put a creature card with mana value less than or equal to the number of lands you control onto the battlefield from your hand or graveyard with two \+1\/\+1 counters on it\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const landsYouControl = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || "").toLowerCase();
        return tl.includes('land');
      }).length;

      const zones = (state as any)?.zones || {};
      const hand: any[] = Array.isArray(zones?.[controller]?.hand) ? zones[controller].hand : [];
      const graveyard: any[] = Array.isArray(zones?.[controller]?.graveyard) ? zones[controller].graveyard : [];
      const combined = [...hand, ...graveyard];
      if (combined.length === 0) return true;

      const available = combined.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) return false;
        const mvRaw = (c as any)?.cmc;
        const mv = typeof mvRaw === 'number' ? mvRaw : parseFloat(String(mvRaw));
        if (!Number.isFinite(mv)) return false;
        return mv <= landsYouControl;
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: You may put a creature card with MV ≤ ${landsYouControl} from your hand or graveyard onto the battlefield with two +1/+1 counters on it`,
        mandatory: false,
        sourceName,
        searchCriteria: `a creature card with mana value ${landsYouControl} or less`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZones: ['hand', 'graveyard'],
        addCounters: { p1p1: 2 },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_GAIN_N_LIFE_FOR_EACH_SUBTYPE_YOU_CONTROL": {
      const m = text.match(/^you gain (\d+) life for each ([a-z][a-z-]*) you control\.?$/i);
      if (!m) return false;

      const lifePer = parseInt(m[1], 10);
      const subtype = String(m[2] || '').toLowerCase();
      if (!Number.isFinite(lifePer) || lifePer <= 0 || !subtype) return false;

      const battlefield = getBattlefield(ctx);
      let count = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes(subtype)) continue;
        count += 1;
      }

      if (count > 0) {
        modifyLifeLikeStack(ctx, controller, lifePer * count);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (count=${count})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_EOT": {
      const m = text.match(/^(?:until end of turn, )?creatures you control get ([+-]\d+)\/([+-]\d+) and gain haste(?: until end of turn)?\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });

        (perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        if (!(perm as any).grantedAbilities.includes("Haste")) (perm as any).grantedAbilities.push("Haste");

        (perm as any).untilEndOfTurn = (perm as any).untilEndOfTurn && typeof (perm as any).untilEndOfTurn === 'object' ? (perm as any).untilEndOfTurn : {};
        ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray(((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove)
          ? ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];
        if (!((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Haste')) {
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.push('Haste');
        }

        affected++;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_TRAMPLE_EOT": {
      const m = text.match(/^(?:until end of turn, )?creatures you control get ([+-]\d+)\/([+-]\d+) and gain trample(?: until end of turn)?\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });

        (perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        if (!(perm as any).grantedAbilities.includes("Trample")) (perm as any).grantedAbilities.push("Trample");

        (perm as any).untilEndOfTurn = (perm as any).untilEndOfTurn && typeof (perm as any).untilEndOfTurn === 'object' ? (perm as any).untilEndOfTurn : {};
        ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray(((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove)
          ? ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];
        if (!((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Trample')) {
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.push('Trample');
        }

        affected++;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_LIFELINK_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(/^until your next turn, creatures you control get ([+-]\d+)\/([+-]\d+) and gain lifelink\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      const stateAny = ctx.state as any;

      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;

        ;(perm as any).untilNextTurnPtMods = Array.isArray((perm as any).untilNextTurnPtMods)
          ? (perm as any).untilNextTurnPtMods
          : [];
        ;(perm as any).untilNextTurnPtMods.push({
          power: powerMod,
          toughness: toughnessMod,
          controllerId: controller,
          turnApplied: stateAny.turnNumber || 0,
          sourceName,
          kind: 'pt_mod',
        });

        ;(perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        if (!(perm as any).grantedAbilities.includes('Lifelink')) (perm as any).grantedAbilities.push('Lifelink');

        ;(perm as any).untilNextTurnGrants = Array.isArray((perm as any).untilNextTurnGrants)
          ? (perm as any).untilNextTurnGrants
          : [];
        ;(perm as any).untilNextTurnGrants.push({
          controllerId: controller,
          turnApplied: stateAny.turnNumber || 0,
          grantedAbilities: ['Lifelink'],
          sourceName,
          kind: 'gain_lifelink',
        });

        affected++;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_EOT": {
      const m = text.match(/^(?:until end of turn, )?creatures you control get ([+-]\d+)\/([+-]\d+) and gain flying(?: until end of turn)?\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });

        (perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        if (!(perm as any).grantedAbilities.includes('Flying')) (perm as any).grantedAbilities.push('Flying');

        (perm as any).untilEndOfTurn = (perm as any).untilEndOfTurn && typeof (perm as any).untilEndOfTurn === 'object' ? (perm as any).untilEndOfTurn : {};
        ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray(((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove)
          ? ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];
        if (!((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Flying')) {
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.push('Flying');
        }

        affected++;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_EOT": {
      const m = text.match(/^(?:until end of turn, )?creatures you control get ([+-]\d+)\/([+-]\d+)(?: until end of turn)?\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });
        affected++;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_WITH_FLYING_GET_PT_EOT": {
      const m = text.match(/^creatures you control with flying get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;

        const typeLine = String(perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        const oracleTextLower = String(perm?.card?.oracle_text || '').toLowerCase();
        const granted = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        const hasFlying = oracleTextLower.includes('flying') || granted.some((a: any) => String(a).toLowerCase().includes('flying'));
        if (!hasFlying) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });
        affected++;
      }

      if (affected > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "SUBTYPE_YOU_CONTROL_GET_PT_EOT": {
      const m = text.match(/^([a-z]+)s you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i);
      if (!m) return false;

      const subtype = String(m[1] || "").toLowerCase();
      const powerMod = parseInt(m[2], 10);
      const toughnessMod = parseInt(m[3], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        if (!isCreatureOfSubtype(perm, subtype)) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });
        affected++;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${subtype}, affected ${affected})`);
      return true;
    }

    case "UNTAP_UP_TO_N_TARGET_PERMANENTS": {
      const m = text.match(/^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target permanents?\.?$/i);
      if (!m) return false;

      const maxN = parseCountTokenWord(m[1]);
      const targets = getTargets(triggerItem).slice(0, Math.max(0, maxN));
      if (!targets.length) return true;

      const battlefield = getBattlefield(ctx);
      for (const id of targets) {
        const p = battlefield.find((x: any) => x?.id === id);
        if (!p) continue;
        p.tapped = false;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${targets.length})`);
      return true;
    }

    case "UNTAP_TWO_TARGET_LANDS": {
      const m = text.match(/^untap two target lands\.?$/i);
      if (!m) return false;

      const targets = getTargets(triggerItem).slice(0, 2);
      if (!targets.length) return false;

      const battlefield = getBattlefield(ctx);
      let untapped = 0;
      for (const id of targets) {
        const p = battlefield.find((x: any) => x?.id === id);
        if (!p?.card) continue;
        const tl = String(p.card?.type_line || "").toLowerCase();
        if (!tl.includes("land")) continue;
        p.tapped = false;
        untapped++;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${untapped})`);
      return true;
    }

    case "TAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_FREEZE": {
      const isUpToTwoNonland =
        /^tap up to two target nonland permanents?\. they don't untap during their controller's next untap step\.?$/i.test(text);
      const maxTargets = isUpToTwoNonland ? 2 : 1;
      const requireNonland = isUpToTwoNonland;

      const targets = getTargets(triggerItem).slice(0, maxTargets);
      if (!targets.length) return false;

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const targetPermanentId of targets) {
        const p = battlefield.find((x: any) => x?.id === targetPermanentId);
        if (!p?.card) continue;

        if (requireNonland) {
          const typeLineLower = String(p.card?.type_line || "").toLowerCase();
          if (typeLineLower.includes("land")) continue;
        }

        p.tapped = true;
        (p as any).doesntUntapNextTurn = true;
        affected++;
      }

      if (affected === 0) return false;
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "TAP_TARGET_CREATURE_PUT_TWO_STUN_COUNTERS": {
      const m = text.match(/^tap target creature\. put two stun counters on it\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return false;

      perm.tapped = true;
      perm.counters = perm.counters && typeof perm.counters === "object" ? perm.counters : {};
      perm.counters.stun = (perm.counters.stun || 0) + 2;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TAP_TARGET_PERMANENT_THEN_UNTAP_ANOTHER_TARGET_PERMANENT": {
      const m = text.match(/^tap target permanent, then untap another target permanent\.?$/i);
      if (!m) return false;

      const [tapId, untapId] = getTargets(triggerItem);
      if (!tapId || !untapId) return false;

      const battlefield = getBattlefield(ctx);
      const tapPerm = battlefield.find((x: any) => x?.id === tapId);
      const untapPerm = battlefield.find((x: any) => x?.id === untapId);
      if (!tapPerm || !untapPerm) return false;

      tapPerm.tapped = true;
      untapPerm.tapped = false;
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CAST_SORCERY_SPELLS_AS_THOUGH_THEY_HAD_FLASH_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(/^until your next turn, you may cast sorcery spells as though they had flash\.?$/i);
      if (!m) return false;

      const stateAny = ctx.state as any;
      stateAny.untilNextTurnPlayerGrants = Array.isArray(stateAny.untilNextTurnPlayerGrants) ? stateAny.untilNextTurnPlayerGrants : [];
      stateAny.untilNextTurnPlayerGrants.push({
        kind: "cast_sorceries_as_though_flash",
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PREVENT_ALL_DAMAGE_TO_AND_DEALT_BY_TARGET_OPPONENT_PERMANENT_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(
        /^until your next turn, prevent all damage that would be dealt to and dealt by target permanent an opponent controls\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      // Best-effort legality check: must be controlled by an opponent.
      if (target.controller === controller) {
        return true;
      }

      const stateAny = ctx.state as any;
      const grantText = "Prevent all damage to and dealt by this permanent (until your next turn)";

      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.includes(grantText)) {
        (target as any).grantedAbilities.push(grantText);
      }

      (target as any).untilNextTurnGrants = Array.isArray((target as any).untilNextTurnGrants) ? (target as any).untilNextTurnGrants : [];
      (target as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: [grantText],
        sourceName,
        kind: "prevent_all_damage_to_and_from",
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_PT": {
      const m = text.match(/^until your next turn, up to one target creature gets ([+-]\d+)\/([+-]\d+)\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;
      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;
      (target as any).untilNextTurnPtMods = Array.isArray((target as any).untilNextTurnPtMods)
        ? (target as any).untilNextTurnPtMods
        : [];
      (target as any).untilNextTurnPtMods.push({
        power: powerMod,
        toughness: toughnessMod,
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: "pt_mod",
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UP_TO_ONE_TARGET_CREATURE_GETS_PT_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(/^up to one target creature gets ([+-]\d+)\/([+-]\d+) until your next turn\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return true; // up to one

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;
      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;
      (target as any).untilNextTurnPtMods = Array.isArray((target as any).untilNextTurnPtMods)
        ? (target as any).untilNextTurnPtMods
        : [];
      (target as any).untilNextTurnPtMods.push({
        power: powerMod,
        toughness: toughnessMod,
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: "pt_mod",
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS3_MINUS0_AND_ITS_ACTIVATED_ABILITIES_CANT_BE_ACTIVATED": {
      const m = text.match(
        /^until your next turn, up to one target creature gets -3\/-0 and its activated abilities can't be activated\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;
      ;(target as any).untilNextTurnPtMods = Array.isArray((target as any).untilNextTurnPtMods)
        ? (target as any).untilNextTurnPtMods
        : [];
      ;(target as any).untilNextTurnPtMods.push({
        power: -3,
        toughness: 0,
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: "pt_mod",
      });

      ;(target as any).untilNextTurnCantActivateAbilities = Array.isArray((target as any).untilNextTurnCantActivateAbilities)
        ? (target as any).untilNextTurnCantActivateAbilities
        : [];
      ;(target as any).untilNextTurnCantActivateAbilities.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: "cant_activate_abilities",
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_UP_TO_TWO_TARGET_CREATURES_HAVE_BASE_POWER_AND_TOUGHNESS_0_3_AND_LOSE_ALL_ABILITIES": {
      const m = text.match(
        /^until your next turn, up to two target creatures each have base power and toughness 0\/3 and lose all abilities\.?$/i
      );
      if (!m) return false;

      const targetIds = getTargets(triggerItem).slice(0, 2);
      if (targetIds.length === 0) return true;

      const battlefield = getBattlefield(ctx);
      const stateAny = ctx.state as any;

      for (const targetPermanentId of targetIds) {
        const target = battlefield.find((x: any) => x?.id === targetPermanentId);
        if (!target) continue;

        const typeLine = String(target?.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        // Represent set-base-P/T by a base override that expires at the start of our next turn.
        ;(target as any).untilNextTurnBasePtOverrides = Array.isArray((target as any).untilNextTurnBasePtOverrides)
          ? (target as any).untilNextTurnBasePtOverrides
          : [];
        ;(target as any).untilNextTurnBasePtOverrides.push({
          power: 0,
          toughness: 3,
          controllerId: controller,
          turnApplied: stateAny.turnNumber || 0,
          sourceName,
          kind: "base_pt_override",
        });

        // Mark that this permanent's abilities are suppressed (best-effort) until our next turn.
        ;(target as any).untilNextTurnLoseAllAbilities = Array.isArray((target as any).untilNextTurnLoseAllAbilities)
          ? (target as any).untilNextTurnLoseAllAbilities
          : [];
        ;(target as any).untilNextTurnLoseAllAbilities.push({
          controllerId: controller,
          turnApplied: stateAny.turnNumber || 0,
          sourceName,
          kind: "lose_all_abilities",
        });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_BECOMES_A_TREASURE_ARTIFACT_WITH_TREASURE_ABILITY_AND_LOSES_ALL_OTHER_CARD_TYPES_AND_ABILITIES": {
      const m = text.match(
        /^target creature becomes a treasure artifact with\s+"?\{t\},\s*sacrifice this artifact:\s*add one mana of any color"?\s+and loses all other card types and abilities\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target?.card) return false;

      const typeLineLower = String(target.card?.type_line || '').toLowerCase();
      if (!typeLineLower.includes('creature')) return true;

      const treasureOracle = '{T}, Sacrifice this artifact: Add one mana of any color.';

      // Best-effort: overwrite the permanent's card characteristics to behave like a Treasure.
      // This is intentionally simple (no layer system); it matches the template and enables existing Treasure support.
      (target as any).card = {
        ...(target as any).card,
        type_line: 'Artifact — Treasure',
        oracle_text: treasureOracle,
        colors: [],
      };

      // Clear cached creature stats/abilities (best-effort).
      delete (target as any).basePower;
      delete (target as any).baseToughness;
      (target as any).grantedAbilities = [];
      (target as any).keywords = [];

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (treasureify ${targetPermanentId})`);
      return true;
    }

    case "TARGET_ARTIFACT_OR_CREATURE_LOSES_ALL_ABILITIES_AND_BECOMES_A_GREEN_ELK_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_3_3": {
      const m = text.match(
        /^target (?:artifact or creature|artifact|creature) loses all abilities and becomes a green elk creature with base power and toughness 3\/3\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target?.card) return false;

      const typeLineLower = String(target.card?.type_line || '').toLowerCase();
      if (!(typeLineLower.includes('artifact') || typeLineLower.includes('creature'))) return true;

      // Best-effort: overwrite characteristics.
      (target as any).card = {
        ...(target as any).card,
        type_line: 'Creature — Elk',
        oracle_text: '',
        colors: ['G'],
        power: '3',
        toughness: '3',
      };
      (target as any).basePower = 3;
      (target as any).baseToughness = 3;
      (target as any).grantedAbilities = [];
      (target as any).keywords = [];

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (elkify ${targetPermanentId})`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS2_MINUS0_AND_LOSES_FLYING": {
      const m = text.match(/^until your next turn, up to one target creature gets -2\/-0 and loses flying\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return true;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;
      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;

      // P/T mod until next turn
      (target as any).untilNextTurnPtMods = Array.isArray((target as any).untilNextTurnPtMods)
        ? (target as any).untilNextTurnPtMods
        : [];
      (target as any).untilNextTurnPtMods.push({
        power: -2,
        toughness: 0,
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: "pt_mod",
      });

      // Keyword removal marker until next turn
      const grantText = "This creature loses flying (until your next turn)";
      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.includes(grantText)) {
        (target as any).grantedAbilities.push(grantText);
      }
      (target as any).untilNextTurnGrants = Array.isArray((target as any).untilNextTurnGrants)
        ? (target as any).untilNextTurnGrants
        : [];
      (target as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: [grantText],
        sourceName,
        kind: "keyword_loss",
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "GAIN_CONTROL_OF_TARGET_CREATURE": {
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      target.controller = controller;
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "GAIN_CONTROL_OF_TARGET_ARTIFACT": {
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("artifact")) return true;

      target.controller = controller;
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "GAIN_CONTROL_OF_ALL_CREATURES_TARGET_OPPONENT_CONTROLS": {
      const m = text.match(/^gain control of all creatures target opponent controls\.?$/i);
      if (!m) return false;

      const [targetOpponent] = getTargets(triggerItem);
      if (!targetOpponent) return false;

      const battlefield = getBattlefield(ctx);
      for (const perm of battlefield) {
        if (!perm) continue;
        if (perm.controller !== targetOpponent) continue;

        const typeLine = String(perm?.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;
        perm.controller = controller;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_EACH_NONLAND_PERMANENT_YOUR_OPPONENTS_CONTROL": {
      const m = text.match(/^exile each nonland permanent your opponents control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const toExile: string[] = [];
      for (const perm of battlefield) {
        if (!perm) continue;
        if (perm.controller === controller) continue;

        const typeLine = String(perm?.card?.type_line || "").toLowerCase();
        if (typeLine.includes("land")) continue;

        if (perm?.id) toExile.push(String(perm.id));
      }

      for (const id of toExile) {
        movePermanentToExile(ctx, id);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${toExile.length} exiled)`);
      return true;
    }

    case "GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_END_OF_TURN_UNTAP_IT_IT_GAINS_HASTE_UNTIL_END_OF_TURN": {
      const m = text.match(
        /^gain control of target creature until end of turn\.\s*untap (?:it|that creature)\.\s*it gains haste until end of turn\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;
      stateAny.controlChangeEffects = Array.isArray(stateAny.controlChangeEffects) ? stateAny.controlChangeEffects : [];

      // Gain control until EOT (reverted in endTemporaryEffects via state.controlChangeEffects)
      const originalController = target.controller;
      if (originalController !== controller) {
        target.controller = controller;
        stateAny.controlChangeEffects.push({
          permanentId: target.id,
          originalController,
          newController: controller,
          duration: 'eot',
          appliedAt: Date.now(),
        });
      }

      // Untap
      target.tapped = false;

      // Grant haste until EOT (cleanup removes via untilEndOfTurn.grantedAbilitiesToRemove)
      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('haste'))) {
        (target as any).grantedAbilities.push('Haste');
      }
      if (!(target as any).untilEndOfTurn || typeof (target as any).untilEndOfTurn !== 'object') {
        (target as any).untilEndOfTurn = {};
      }
      (target as any).untilEndOfTurn.grantedAbilitiesToRemove = Array.isArray((target as any).untilEndOfTurn.grantedAbilitiesToRemove)
        ? (target as any).untilEndOfTurn.grantedAbilitiesToRemove
        : [];
      if (!(target as any).untilEndOfTurn.grantedAbilitiesToRemove.includes('Haste')) {
        (target as any).untilEndOfTurn.grantedAbilitiesToRemove.push('Haste');
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_END_OF_TURN_UNTAP_IT_IT_GAINS_HASTE_UNTIL_END_OF_TURN_SACRIFICE_IT_AT_THE_BEGINNING_OF_THE_NEXT_END_STEP_IF_ITS_MANA_VALUE_IS_3_OR_LESS": {
      const m = text.match(
        /^gain control of target creature until end of turn\.\s*untap (?:it|that creature)\.\s*it gains haste until end of turn\.\s*sacrifice it at the beginning of the next end step if (?:it has|its) mana value (?:is )?3 or less\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;
      stateAny.controlChangeEffects = Array.isArray(stateAny.controlChangeEffects) ? stateAny.controlChangeEffects : [];

      // Gain control until EOT (reverted in endTemporaryEffects via state.controlChangeEffects)
      const originalController = target.controller;
      if (originalController !== controller) {
        target.controller = controller;
        stateAny.controlChangeEffects.push({
          permanentId: target.id,
          originalController,
          newController: controller,
          duration: 'eot',
          appliedAt: Date.now(),
        });
      }

      // Untap
      target.tapped = false;

      // Grant haste until EOT (cleanup removes via untilEndOfTurn.grantedAbilitiesToRemove)
      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('haste'))) {
        (target as any).grantedAbilities.push('Haste');
      }
      if (!(target as any).untilEndOfTurn || typeof (target as any).untilEndOfTurn !== 'object') {
        (target as any).untilEndOfTurn = {};
      }
      (target as any).untilEndOfTurn.grantedAbilitiesToRemove = Array.isArray((target as any).untilEndOfTurn.grantedAbilitiesToRemove)
        ? (target as any).untilEndOfTurn.grantedAbilitiesToRemove
        : [];
      if (!(target as any).untilEndOfTurn.grantedAbilitiesToRemove.includes('Haste')) {
        (target as any).untilEndOfTurn.grantedAbilitiesToRemove.push('Haste');
      }

      // Conditional delayed sacrifice at the beginning of the next end step.
      const mv = Number((target as any)?.card?.cmc ?? 0) || 0;
      if (mv <= 3) {
        const currentTurn = Number(stateAny.turnNumber ?? 0) || 0;
        const currentPhase = String(stateAny.phase ?? '').toLowerCase();
        const currentStepUpper = String(stateAny.step ?? '').toUpperCase();
        const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
        const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

        stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
          ? stateAny.pendingSacrificeAtNextEndStep
          : [];
        stateAny.pendingSacrificeAtNextEndStep.push({
          permanentId: target.id,
          fireAtTurnNumber,
          maxManaValue: 3,
          sourceName,
          createdBy: controller,
        });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EACH_PLAYER_DISCARDS_A_CARD": {
      const m = text.match(/^each player discards a card\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no queue)`);
        return true;
      }

      const players = ((ctx as any).state?.players as any[]) || [];
      const zones = (state as any)?.zones || {};
      for (const p of players) {
        const pid = p?.id as PlayerID;
        if (!pid) continue;

        const hand: any[] = zones[pid]?.hand || [];
        if (hand.length <= 0) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.DISCARD_SELECTION,
          playerId: pid,
          description: `${sourceName}: Discard 1 card`,
          mandatory: true,
          sourceName: sourceName,
          discardCount: 1,
          hand: hand.map((c: any) => ({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris,
            mana_cost: c.mana_cost,
            cmc: c.cmc,
            colors: c.colors,
          })),
        } as any);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "REVEAL_TOP_CARD_PUT_INTO_HAND_EACH_OPPONENT_LOSES_LIFE_EQUAL_MV": {
      const m = text.match(
        /^reveal the top card of your library\.(?:\s*and)?\s*put that card into your hand\.?\s*each opponent loses life equal to its mana value\.?$/i
      );
      if (!m) return false;

      const [card] = drawCardsFromZone(ctx, controller, 1);
      if (!card) return true;

      const mv = Number((card as any)?.cmc ?? 0) || 0;
      if (mv <= 0) return true;

      const opponents = getOpponents(ctx, controller);
      for (const opp of opponents) {
        modifyLifeLikeStack(ctx, opp, -mv);
      }
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (mv=${mv})`);
      return true;
    }

    case "DISCARD_ALL_CARDS_THEN_DRAW_THAT_MANY_PLUS_ONE": {
      const m = text.match(/^discard all the cards in your hand, then draw that many cards plus one\.?$/i);
      if (!m) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = zones[controller] || (zones[controller] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      const discardN = (z.hand as any[]).length;
      if (discardN > 0) {
        for (const card of z.hand as any[]) {
          z.graveyard.push({ ...(card as any), zone: 'graveyard' });
        }
        z.hand = [];
      }
      z.handCount = (z.hand as any[]).length;
      z.graveyardCount = (z.graveyard as any[]).length;

      drawCardsFromZone(ctx, controller, discardN + 1);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (discard ${discardN}, draw ${discardN + 1})`);
      return true;
    }

    case "YOU_MAY_SACRIFICE_ANOTHER_PERMANENT_IF_YOU_DO_GAIN_LIFE_AND_DRAW_A_CARD": {
      const m = text.match(
        /^you may sacrifice another permanent\. if you do, you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life and draw a card\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lifeGain = parseCountTokenWord(m[1]);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: You may sacrifice another permanent. If you do, you gain ${lifeGain} life and draw a card.`,
        mandatory: true,
        sourceName,
        sourceId,
        options: [
          { id: 'sac', label: 'Sacrifice a permanent' },
          { id: 'dont', label: "Don't sacrifice" },
        ],
        minSelections: 1,
        maxSelections: 1,
        pwSacAnotherPermanentGainLifeDraw: true,
        pwSacAnotherPermanentStage: 'ask',
        pwSacAnotherPermanentController: controller,
        pwSacAnotherPermanentSourceName: sourceName,
        pwSacAnotherPermanentSourcePermanentId: sourceId,
        pwSacAnotherPermanentLifeGain: lifeGain,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_GAIN_LIFE_THEN_PUT_P1P1_COUNTERS_ON_UP_TO_ONE_TARGET_CREATURE": {
      const m = text.match(
        /^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.\s*put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on up to one target creature\.?$/i
      );
      if (!m) return false;

      const lifeGain = parseCountTokenWord(m[1]);
      const counters = parseCountTokenWord(m[2]);

      if (lifeGain > 0) modifyLifeLikeStack(ctx, controller, lifeGain);

      const [targetId] = getTargets(triggerItem);
      if (targetId) {
        const battlefield = getBattlefield(ctx);
        const perm = battlefield.find((p: any) => p?.id === targetId);
        const tl = String(perm?.card?.type_line || '').toLowerCase();
        if (perm && tl.includes('creature')) {
          updateCounters(ctx, targetId, { '+1/+1': counters });
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE": {
      const m = text.match(
        /^exile target creature\. its controller gains (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      const gain = parseCountTokenWord(m[1]);
      const controllerId = String((perm as any).controller || '');

      movePermanentToExile(ctx, targetId);
      if (gain > 0 && controllerId) {
        modifyLifeLikeStack(ctx, controllerId as any, gain);
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE_EQUAL_TO_ITS_POWER": {
      const m = text.match(/^exile target creature\. its controller gains life equal to its power\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      const controllerId = String((perm as any).controller || '');
      const power = Math.max(0, getActualPowerToughness(perm, (ctx as any).state).power | 0);

      movePermanentToExile(ctx, targetId);
      if (power > 0 && controllerId) {
        modifyLifeLikeStack(ctx, controllerId as any, power);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${power})`);
      return true;
    }

    case "RETURN_TARGET_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND": {
      const m = text.match(/^return target card from your graveyard to your hand\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      if (gy.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose a card in your graveyard to return to your hand`,
        mandatory: true,
        sourceName,
        minTargets: 1,
        maxTargets: 1,
        action: 'move_graveyard_card_to_hand',
        fromPlayerId: controller,
        validTargets: gy.map((c: any) => ({
          id: c.id,
          label: c.name || 'Card',
          description: c.type_line || 'card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "RETURN_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD": {
      const m = text.match(
        /^return target creature card(?: with mana value (\d+) or less)? from your graveyard to the battlefield\.(?:\s*[\s\S]+)?$/i
      );
      if (!m) return false;

      const maxMv = m[1] ? parseInt(m[1], 10) : undefined;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      if (gy.length === 0) return true;

      const validTargets = gy
        .filter((c: any) => {
          const tl = String(c?.type_line || '').toLowerCase();
          if (!tl.includes('creature')) return false;
          if (typeof maxMv === 'number') {
            const cmc = typeof c?.cmc === 'number' ? c.cmc : parseFloat(String(c?.cmc || ''));
            if (!Number.isFinite(cmc)) return false;
            if (cmc > maxMv) return false;
          }
          return true;
        })
        .map((c: any) => ({
          id: c.id,
          label: c.name || 'Card',
          description: c.type_line || 'card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        }));

      if (validTargets.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description:
          typeof maxMv === 'number'
            ? `${sourceName}: Choose a creature card (mana value ${maxMv} or less) in your graveyard to return to the battlefield`
            : `${sourceName}: Choose a creature card in your graveyard to return to the battlefield`,
        mandatory: true,
        sourceName,
        minTargets: 1,
        maxTargets: 1,
        action: 'move_graveyard_card_to_battlefield',
        fromPlayerId: controller,
        validTargets,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued: choices=${validTargets.length})`);
      return true;
    }

    case "RETURN_TARGET_SUBTYPE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD": {
      const m = text.match(/^return target ([a-z][a-z-]*) card from your graveyard to the battlefield\.?$/i);
      if (!m) return false;

      const subtype = String(m[1] || '').toLowerCase();

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      if (gy.length === 0) return true;

      const validTargets = gy
        .filter((c: any) => {
          const tl = String(c?.type_line || '').toLowerCase();
          if (!tl) return false;

          // Avoid returning Auras without an attachment choice.
          if (tl.includes('aura')) return false;

          // Must be a permanent card.
          const isPermanent =
            tl.includes('artifact') || tl.includes('creature') || tl.includes('enchantment') || tl.includes('planeswalker') || tl.includes('land');
          if (!isPermanent) return false;

          return tl.includes(subtype);
        })
        .map((c: any) => ({
          id: c.id,
          label: c.name || 'Card',
          description: c.type_line || 'card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        }));

      if (validTargets.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose a ${subtype} card in your graveyard to return to the battlefield`,
        mandatory: true,
        sourceName,
        minTargets: 1,
        maxTargets: 1,
        action: 'move_graveyard_card_to_battlefield',
        fromPlayerId: controller,
        validTargets,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued: subtype=${subtype}, choices=${validTargets.length})`);
      return true;
    }

    case "RETURN_UP_TO_TWO_TARGET_CREATURES_TO_THEIR_OWNERS_HANDS": {
      const m = text.match(/^return up to two target creatures to their owners'? hands\.?$/i);
      if (!m) return false;

      const targetIds = getTargets(triggerItem).filter(Boolean).slice(0, 2);
      if (targetIds.length === 0) return true;

      const battlefield = getBattlefield(ctx);
      for (const targetId of targetIds) {
        const perm = battlefield.find((p: any) => p?.id === targetId);
        const typeLine = String(perm?.card?.type_line || "").toLowerCase();
        if (!perm || !typeLine.includes('creature')) return false;
      }

      for (const targetId of targetIds) {
        movePermanentToHand(ctx, targetId);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${targetIds.length})`);
      return true;
    }

    case "PUT_TARGET_CREATURE_ON_TOP_OF_ITS_OWNERS_LIBRARY": {
      const m = text.match(/^put target creature on top of its owner['’]s library\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      movePermanentToLibrary(ctx as any, targetId, 'top');
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE": {
      const m = text.match(/^take an extra turn after this one\.?$/i);
      if (!m) return false;

      addExtraTurn(ctx as any, controller, sourceName);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TAP_ALL_CREATURES_YOUR_OPPONENTS_CONTROL_TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE": {
      const m = text.match(/^tap all creatures your opponents control\.?\s*(?:you\s+)?take an extra turn after this one\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let tappedCount = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller === controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        if (!perm.tapped) tappedCount += 1;
        perm.tapped = true;
      }

      addExtraTurn(ctx as any, controller, sourceName);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (tapped ${tappedCount})`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_EACH_OPPONENT": {
      const m = text.match(
        /^([a-z0-9 ,'-]+) deals (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) damage to each opponent\.?$/i
      );
      if (!m) return false;

      const dmg = parseCountTokenWord(m[2]);
      if (dmg <= 0) return true;

      const opponents = getOpponents(ctx, controller);
      if (opponents.length === 0) return true;

      for (const opp of opponents) {
        applyDamageToPlayer(ctx, opp, dmg);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${dmg} to each opponent)`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GAIN_FLYING_AND_DOUBLE_STRIKE_EOT": {
      const m = text.match(/^creatures you control gain flying and double strike until end of turn\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;

        perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
        if (!perm.grantedAbilities.includes('Flying')) perm.grantedAbilities.push('Flying');
        if (!perm.grantedAbilities.includes('Double strike')) perm.grantedAbilities.push('Double strike');

        perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === 'object' ? perm.untilEndOfTurn : {};
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
          ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];
        if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Flying')) {
          (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Flying');
        }
        if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Double strike')) {
          (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Double strike');
        }
        affected += 1;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GAINS_VIGILANCE_AND_REACH": {
      const m = text.match(/^until your next turn, up to one target creature gains vigilance and reach\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return true;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;
      const typeLine = String(target?.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) return true;

      const stateAny = ctx.state as any;
      const grants = ['Vigilance', 'Reach'];

      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      for (const g of grants) {
        if (!(target as any).grantedAbilities.includes(g)) (target as any).grantedAbilities.push(g);
      }

      ;(target as any).untilNextTurnGrants = Array.isArray((target as any).untilNextTurnGrants)
        ? (target as any).untilNextTurnGrants
        : [];
      ;(target as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: grants,
        sourceName,
        kind: 'keyword_grants',
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UP_TO_ONE_TARGET_CREATURE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(/^up to one target creature (?:can't|cannot) attack or block until your next turn\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return true;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;
      const typeLine = String(target?.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) return true;

      const stateAny = ctx.state as any;
      const grantText = "This creature can't attack or block (until your next turn)";

      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.includes(grantText)) {
        (target as any).grantedAbilities.push(grantText);
      }

      (target as any).untilNextTurnGrants = Array.isArray((target as any).untilNextTurnGrants)
        ? (target as any).untilNextTurnGrants
        : [];
      (target as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: [grantText],
        sourceName,
        kind: 'cant_attack_or_block',
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_WITHOUT_FIRST_STRIKE_DOUBLE_STRIKE_OR_VIGILANCE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(
        /^target creature without first strike, double strike, or vigilance (?:can't|cannot) attack or block until your next turn\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) return false;

      // Must NOT have any of these keywords to be a legal target.
      if (
        permanentHasKeyword(target, 'first strike') ||
        permanentHasKeyword(target, 'double strike') ||
        permanentHasKeyword(target, 'vigilance')
      ) {
        return false;
      }

      const stateAny = ctx.state as any;
      const grantText = "This creature can't attack or block (until your next turn)";

      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.includes(grantText)) {
        (target as any).grantedAbilities.push(grantText);
      }

      (target as any).untilNextTurnGrants = Array.isArray((target as any).untilNextTurnGrants)
        ? (target as any).untilNextTurnGrants
        : [];
      (target as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: [grantText],
        sourceName,
        kind: 'cant_attack_or_block',
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_SUBTYPE_UNTAP_IT_IT_GAINS_DEATHTOUCH_EOT": {
      const m = text.match(
        /^put a \+1\/\+1 counter on up to one target ([a-z][a-z-]*)\. untap it\. it gains deathtouch until end of turn\.?$/i
      );
      if (!m) return false;

      const subtype = String(m[1] || '').toLowerCase();
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;
      if (subtype && !tl.includes(subtype)) return true;

      updateCounters(ctx, targetId, { '+1/+1': 1 });
      perm.tapped = false;

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes('deathtouch'))) {
        perm.grantedAbilities.push('Deathtouch');
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === 'object' ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Deathtouch')) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Deathtouch');
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_AN_ANGEL_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_FLYING": {
      const m = text.match(
        /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on target creature\. it becomes an angel in addition to its other types and gains flying\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;
      const tl = String(perm?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;

      updateCounters(ctx, targetId, { '+1/+1': n });

      perm.card = perm.card || {};
      const currentTypeLine = String(perm.card.type_line || '');
      if (!/\bangel\b/i.test(currentTypeLine)) {
        perm.card.type_line = currentTypeLine.length > 0 ? `${currentTypeLine} Angel` : 'Angel';
      }

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.includes('Flying')) perm.grantedAbilities.push('Flying');

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EACH_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_CREATURE_CARDS_IN_YOUR_GRAVEYARD": {
      const m = text.match(/^each opponent loses life equal to the number of creature cards in your graveyard\.?$/i);
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = Array.isArray(zones?.[controller]?.graveyard) ? zones[controller].graveyard : [];
      const creatureCount = gy.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('creature')).length;
      if (creatureCount <= 0) return true;

      const opponents = getOpponents(ctx, controller);
      for (const opp of opponents) {
        modifyLifeLikeStack(ctx, opp, -creatureCount);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (count=${creatureCount})`);
      return true;
    }

    case "EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_CAST_THAT_CARD_IF_YOU_DONT_DEALS_DAMAGE_TO_EACH_OPPONENT": {
      const m = text.match(
        /^exile the top card of your library\. you may cast that card\. if you don't, ([a-z0-9 ,'-]+) deals (\d+) damage to each opponent\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const topCard = lib.shift();
      (ctx as any).libraries?.set(controller, lib);

      const cardId = String((topCard as any)?.id || uid('c'));

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const exiled = {
        ...topCard,
        id: cardId,
        zone: 'exile',
        exiledBy: sourceName,
        canBePlayedBy: controller,
        playableUntilTurn: (state as any).turnNumber ?? 0,
      };
      z.exile.push(exiled);
      z.libraryCount = lib.length;
      if (typeof z.exileCount === 'number') z.exileCount = z.exile.length;

      (state as any).playableFromExile = (state as any).playableFromExile || {};
      const pfe = ((state as any).playableFromExile[controller] = (state as any).playableFromExile[controller] || {});
      pfe[cardId] = (state as any).turnNumber ?? 0;

      const dmg = parseInt(m[2], 10) || 0;
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller as any,
        description: `${sourceName}: You may cast ${topCard?.name || 'that card'}. If you don't, ${sourceName} deals ${dmg} damage to each opponent.`,
        mandatory: true,
        sourceName,
        options: [
          { id: 'cast', label: `Cast ${topCard?.name || 'that card'}` },
          { id: 'dont', label: "Don't cast" },
        ],
        minSelections: 1,
        maxSelections: 1,
        pwChandraImpulseCastOrBurn: true,
        pwChandraImpulseStage: 'ask',
        pwChandraImpulseController: controller,
        pwChandraImpulseSourceName: sourceName,
        pwChandraImpulseExiledCardId: cardId,
        pwChandraImpulseDamage: dmg,
      } as any);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "EACH_OPPONENT_LOSES_1_YOU_GAIN_LIFE_EQUAL_TO_THE_LIFE_LOST_THIS_WAY": {
      const m = text.match(/^each opponent loses 1 life\.\s*you gain life equal to the life lost this way\.?$/i);
      if (!m) return false;

      const opponents = getOpponents(ctx, controller);
      if (opponents.length === 0) return true;

      for (const opp of opponents) {
        modifyLifeLikeStack(ctx, opp, -1);
      }
      modifyLifeLikeStack(ctx, controller, opponents.length);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opponents=${opponents.length})`);
      return true;
    }

    case "EXILE_TOP_N_CARDS_OF_TARGET_OPPONENTS_LIBRARY": {
      const m = text.match(
        /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of target opponent's library\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const [targetOpponent] = getTargets(triggerItem);
      if (!targetOpponent) return false;

      const zones = (state as any)?.zones || ((state as any).zones = {});
      const z = (zones[targetOpponent] = zones[targetOpponent] || {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });

      z.library = Array.isArray(z.library) ? z.library : [];
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const actual = Math.min(n, z.library.length);
      if (actual <= 0) return true;

      const moved = z.library.splice(0, actual).map((c: any) => ({ ...(c as any), zone: 'exile' }));
      z.exile.unshift(...moved);
      z.libraryCount = z.library.length;
      z.exileCount = z.exile.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${actual})`);
      return true;
    }

    case "DESTROY_TARGET_PLANESWALKER": {
      const m = text.match(/^destroy (?:another )?target planeswalker\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('planeswalker')) return true;

      destroyPermanents(ctx, [String(targetId)]);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_ALL_NON_ZOMBIE_CREATURES": {
      const m = text.match(/^destroy all non-zombie creatures\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card?.type_line) continue;
        const tl = String(perm.card.type_line).toLowerCase();
        if (!tl.includes('creature')) continue;
        if (tl.includes('zombie')) continue;
        if (perm.id) toDestroy.push(String(perm.id));
      }

      if (toDestroy.length > 0) {
        destroyPermanents(ctx, toDestroy);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${toDestroy.length} destroyed)`);
      return true;
    }

    case "DESTROY_ALL_LANDS_TARGET_PLAYER_CONTROLS": {
      const m = text.match(/^destroy all lands target player controls\.?$/i);
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (String(perm.controller || '') !== String(targetPlayer)) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('land')) continue;
        if (perm.id) toDestroy.push(String(perm.id));
      }

      if (toDestroy.length > 0) {
        destroyPermanents(ctx, toDestroy);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${toDestroy.length} destroyed)`);
      return true;
    }

    case "EXILE_ALL_CARDS_FROM_TARGET_PLAYERS_LIBRARY_THEN_SHUFFLE_HAND_INTO_LIBRARY": {
      const m = text.match(
        /^exile all cards from target player's library, then that player shuffles their hand into their library\.?$/i
      );
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const zones = (state as any)?.zones || ((state as any).zones = {});
      const z = (zones[targetPlayer] = zones[targetPlayer] || {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });

      z.library = Array.isArray(z.library) ? z.library : [];
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const exiled = z.library.splice(0, z.library.length).map((c: any) => ({ ...(c as any), zone: 'exile' }));
      z.exile.unshift(...exiled);

      const newLib = z.hand.splice(0, z.hand.length).map((c: any) => ({ ...(c as any), zone: 'library' }));
      shuffleInPlace(newLib, typeof (ctx as any).rng === 'function' ? (ctx as any).rng : Math.random);
      z.library = newLib;

      z.libraryCount = z.library.length;
      z.handCount = z.hand.length;
      z.exileCount = z.exile.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled=${exiled.length})`);
      return true;
    }

    case "EXILE_ALL_CARDS_FROM_ALL_OPPONENTS_HANDS_AND_GRAVEYARDS": {
      const m = text.match(/^exile all cards from all opponents' hands and graveyards\.?$/i);
      if (!m) return false;

      const zones = (state as any)?.zones || ((state as any).zones = {});
      const opponents = getOpponents(ctx, controller);
      let movedTotal = 0;

      for (const opp of opponents) {
        const z = (zones[opp] = zones[opp] || {
          hand: [],
          handCount: 0,
          library: [],
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        });

        z.hand = Array.isArray(z.hand) ? z.hand : [];
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.exile = Array.isArray(z.exile) ? z.exile : [];

        const movedHand = z.hand.splice(0, z.hand.length).map((c: any) => ({ ...(c as any), zone: 'exile' }));
        const movedGy = z.graveyard.splice(0, z.graveyard.length).map((c: any) => ({ ...(c as any), zone: 'exile' }));

        z.exile.unshift(...movedHand, ...movedGy);
        movedTotal += movedHand.length + movedGy.length;

        z.handCount = z.hand.length;
        z.graveyardCount = z.graveyard.length;
        z.exileCount = z.exile.length;
      }

      if (movedTotal > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled=${movedTotal})`);
      return true;
    }

    case "GAIN_CONTROL_OF_ALL_ARTIFACTS_AND_CREATURES_TARGET_OPPONENT_CONTROLS": {
      const m = text.match(/^gain control of all artifacts and creatures target opponent controls\.?$/i);
      if (!m) return false;

      const [targetOpponent] = getTargets(triggerItem);
      if (!targetOpponent) return false;

      const battlefield = getBattlefield(ctx);
      let changed = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (String(perm.controller || '') !== String(targetOpponent)) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('artifact') && !tl.includes('creature')) continue;
        perm.controller = controller;
        changed++;
      }

      if (changed > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (changed=${changed})`);
      return true;
    }

    case "UNTAP_EACH_ENCHANTED_PERMANENT_YOU_CONTROL": {
      const m = text.match(/^untap each enchanted permanent you control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let untapped = 0;

      for (const aura of battlefield) {
        if (!aura?.card) continue;
        const tl = String(aura.card?.type_line || '').toLowerCase();
        if (!tl.includes('enchantment') || !tl.includes('aura')) continue;

        const attachedTo = String((aura as any).attachedTo || '');
        if (!attachedTo) continue;

        const enchanted = battlefield.find((p: any) => p?.id === attachedTo);
        if (!enchanted) continue;
        if (enchanted.controller !== controller) continue;

        if ((enchanted as any).tapped) {
          (enchanted as any).tapped = false;
          untapped++;
        }
      }

      if (untapped > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped=${untapped})`);
      return true;
    }

    case "YOU_GAIN_LIFE_EQUAL_TO_CREATURES_YOU_CONTROL_PLUS_PLANESWALKERS_YOU_CONTROL": {
      const m = text.match(
        /^you gain life equal to the number of creatures you control plus the number of planeswalkers you control\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let creatures = 0;
      let planeswalkers = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (tl.includes('creature')) creatures++;
        if (tl.includes('planeswalker')) planeswalkers++;
      }

      const total = creatures + planeswalkers;
      if (total > 0) {
        modifyLifeLikeStack(ctx, controller, total);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (life=${total})`);
      return true;
    }

    case "SARKHAN_DEALS_1_DAMAGE_TO_EACH_OPPONENT_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL": {
      const m = text.match(/^sarkhan deals 1 damage to each opponent and each creature your opponents control\.?$/i);
      if (!m) return false;

      const opponents = getOpponents(ctx, controller);
      for (const opp of opponents) {
        applyDamageToPlayer(ctx, opp, 1);
      }

      const battlefield = getBattlefield(ctx);
      let damaged = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller === controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        applyDamageToPermanent(ctx, String(perm.id), 1);
        damaged++;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (creatures=${damaged})`);
      return true;
    }

    case "KOTH_DEALS_DAMAGE_TO_TARGET_CREATURE_EQUAL_TO_NUMBER_OF_MOUNTAINS_YOU_CONTROL": {
      const m = text.match(/^koth deals damage to target creature equal to the number of mountains you control\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((p: any) => p?.id === targetId);
      if (!target?.card) return true;
      if (!String(target.card?.type_line || '').toLowerCase().includes('creature')) return true;

      const mountains = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        return tl.includes('mountain');
      }).length;

      if (mountains > 0) {
        applyDamageToPermanent(ctx, String(targetId), mountains);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (mountains=${mountains})`);
      return true;
    }

    case "NAHIRI_DEALS_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_EQUAL_TO_TWICE_NUMBER_OF_EQUIPMENT_YOU_CONTROL": {
      const m = text.match(
        /^nahiri deals damage to target creature or planeswalker equal to twice the number of equipment you control\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const equipmentCount = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        return tl.includes('equipment');
      }).length;

      const dmg = Math.max(0, equipmentCount * 2);
      if (dmg > 0) {
        applyDamageToPermanent(ctx, String(targetId), dmg);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (equipment=${equipmentCount})`);
      return true;
    }

    case "NAHIRI_DEALS_X_DAMAGE_TO_TARGET_TAPPED_CREATURE": {
      const m = text.match(/^nahiri deals x damage to target tapped creature\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((p: any) => p?.id === targetId);
      if (!target?.card) return true;

      const tl = String(target.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;
      if (!(target as any).tapped) return true;

      applyDamageToPermanent(ctx, String(targetId), x);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (x=${x})`);
      return true;
    }

    case "SORIN_MARKOV_DEALS_2_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_2_LIFE": {
      const m = text.match(/^sorin markov deals 2 damage to any target and you gain 2 life\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      const isPlayer = players.some((p: any) => String(p?.id || '') === String(targetId));
      if (isPlayer) {
        applyDamageToPlayer(ctx, targetId as any, 2);
      } else {
        applyDamageToPermanent(ctx, String(targetId), 2);
      }

      modifyLifeLikeStack(ctx, controller, 2);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "KAYA_DEALS_DAMAGE_TO_TARGET_PLAYER_EQUAL_TO_CARDS_THE_PLAYER_OWNS_IN_EXILE_AND_YOU_GAIN_THAT_MUCH_LIFE": {
      const m = text.match(
        /^kaya deals damage to target player equal to the number of cards that player owns in exile and you gain that much life\.?$/i
      );
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const zones = (state as any)?.zones || {};
      const exile: any[] = Array.isArray(zones?.[targetPlayer]?.exile) ? zones[targetPlayer].exile : [];
      const dmg = exile.length;
      if (dmg <= 0) return true;

      applyDamageToPlayer(ctx, targetPlayer as any, dmg);
      modifyLifeLikeStack(ctx, controller, dmg);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (dmg=${dmg})`);
      return true;
    }

    case "NICOL_BOLAS_DEALS_7_DAMAGE_TO_EACH_OPPONENT_YOU_DRAW_SEVEN_CARDS": {
      const m = text.match(/^nicol bolas deals 7 damage to each opponent\. you draw seven cards\.?$/i);
      if (!m) return false;

      const opponents = getOpponents(ctx, controller);
      for (const opp of opponents) {
        applyDamageToPlayer(ctx, opp, 7);
      }
      drawCardsFromZone(ctx, controller, 7);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opponents=${opponents.length})`);
      return true;
    }

    case "NICOL_BOLAS_DEALS_7_DAMAGE_TO_TARGET_OPPONENT_CREATURE_OR_PLANESWALKER_AN_OPPONENT_CONTROLS": {
      const m = text.match(
        /^nicol bolas deals 7 damage to target opponent, creature an opponent controls, or planeswalker an opponent controls\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      const isPlayer = players.some((p: any) => String(p?.id || '') === String(targetId));
      if (isPlayer) {
        applyDamageToPlayer(ctx, targetId as any, 7);
      } else {
        applyDamageToPermanent(ctx, String(targetId), 7);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CHANDRA_DEALS_3_DAMAGE_TO_EACH_NON_ELEMENTAL_CREATURE": {
      const m = text.match(/^chandra deals 3 damage to each non-elemental creature\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        if (tl.includes('elemental')) continue;
        applyDamageToPermanent(ctx, String(perm.id), 3);
        affected++;
      }

      if (affected > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected=${affected})`);
      return true;
    }

    case "CHANDRA_DEALS_N_DAMAGE_TO_TARGET_PLAYER_OR_PLANESWALKER_AND_EACH_CREATURE_THAT_PLAYER_OR_THAT_PLANESWALKERS_CONTROLLER_CONTROLS": {
      const m = text.match(
        /^chandra(?: nalaar)? deals (\d+) damage to target player or planeswalker and each creature that player or that planeswalker['’]s controller controls\.?$/i
      );
      if (!m) return false;

      const n = parseInt(m[1], 10);
      if (!Number.isFinite(n) || n <= 0) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      const isPlayer = players.some((p: any) => String(p?.id || '') === String(targetId));

      let affectedController: string | null = null;
      if (isPlayer) {
        affectedController = String(targetId);
        applyDamageToPlayer(ctx, targetId as any, n);
      } else {
        const battlefield = getBattlefield(ctx);
        const perm = battlefield.find((p: any) => p?.id === targetId);
        if (perm) affectedController = String(perm.controller || '');
        applyDamageToPermanent(ctx, String(targetId), n);
      }

      if (affectedController) {
        const battlefield = getBattlefield(ctx);
        for (const perm of battlefield) {
          if (!perm?.card) continue;
          if (String(perm.controller || '') !== affectedController) continue;
          const tl = String(perm.card?.type_line || '').toLowerCase();
          if (!tl.includes('creature')) continue;
          applyDamageToPermanent(ctx, String(perm.id), n);
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (n=${n})`);
      return true;
    }

    case "CHANDRA_NALAAR_DEALS_X_DAMAGE_TO_TARGET_CREATURE": {
      const m = text.match(/^chandra nalaar deals x damage to target creature\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;

      applyDamageToPermanent(ctx, String(targetId), x);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (x=${x})`);
      return true;
    }

    case "YOU_GET_AN_ADVENTURING_PARTY": {
      const m = text.match(/^you get an adventuring party\.(?:\s*\([^)]*\))?\.?$/i);
      if (!m) return false;

      createToken(ctx, controller, 'Fighter', 1, 3, 3, { colors: ['R'], abilities: ['First strike'] });
      createToken(ctx, controller, 'Cleric', 1, 1, 1, { colors: ['W'], abilities: ['Lifelink'] });
      createToken(ctx, controller, 'Rogue', 1, 2, 2, { colors: ['B'], abilities: ['Hexproof'] });
      createToken(ctx, controller, 'Wizard', 1, 1, 1, { colors: ['U'], abilities: ['Flying'] });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "AMASS_ZOMBIES_N": {
      const m = text.match(/^amass zombies (\d+)\.(?:\s*\([^)]*\))?\.?$/i);
      if (!m) return false;

      const n = parseInt(m[1], 10);
      if (!Number.isFinite(n) || n <= 0) return false;

      const battlefield = getBattlefield(ctx);
      const army = battlefield.find((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        return tl.includes('army') && tl.includes('creature');
      });

      let armyId: string | null = null;
      if (army?.id) {
        armyId = String(army.id);
        const tl = String(army.card?.type_line || '');
        if (!tl.toLowerCase().includes('zombie')) {
          (army.card as any).type_line = `${tl} Zombie`;
        }
      } else {
        const [createdId] = createToken(ctx, controller, 'Zombie Army', 1, 0, 0, { colors: ['B'] });
        if (createdId) armyId = String(createdId);
      }

      if (armyId) updateCounters(ctx, armyId, { '+1/+1': n });
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (n=${n})`);
      return true;
    }

    case "DESTROY_UP_TO_SIX_TARGET_NONLAND_PERMANENTS_THEN_CREATE_SIX_CAT_WARRIOR_TOKENS_WITH_FORESTWALK": {
      const m = text.match(
        /^destroy up to six target nonland permanents, then create six 2\/2 green cat warrior creature tokens with forestwalk\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const targetIds = getTargets(triggerItem).slice(0, 6);
      const toDestroy: string[] = [];
      for (const id of targetIds) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (tl.includes('land')) continue;
        toDestroy.push(String(id));
      }

      if (toDestroy.length > 0) destroyPermanents(ctx, toDestroy);
      createToken(ctx, controller, 'Cat Warrior', 6, 2, 2, { colors: ['G'], abilities: ['Forestwalk'] });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed=${toDestroy.length})`);
      return true;
    }

    case "PUT_THREE_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_THOSE_CREATURES_GAIN_TRAMPLE_EOT": {
      const m = text.match(
        /^put three \+1\/\+1 counters on each creature you control\. those creatures gain trample until end of turn\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;

        updateCounters(ctx, String(perm.id), { '+1/+1': 3 });

        ;(perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        if (!(perm as any).grantedAbilities.includes('Trample')) (perm as any).grantedAbilities.push('Trample');

        ;(perm as any).untilEndOfTurn =
          (perm as any).untilEndOfTurn && typeof (perm as any).untilEndOfTurn === 'object' ? (perm as any).untilEndOfTurn : {};
        ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray(
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
        )
          ? ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];
        if (!((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Trample')) {
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.push('Trample');
        }

        affected++;
      }

      if (affected > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected=${affected})`);
      return true;
    }

    case "ROWAN_DEALS_1_DAMAGE_TO_EACH_OF_UP_TO_TWO_TARGET_CREATURES_THOSE_CREATURES_CANT_BLOCK_THIS_TURN": {
      const m = text.match(/^rowan deals 1 damage to each of up to two target creatures\. those creatures can't block this turn\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const targetIds = getTargets(triggerItem).slice(0, 2);

      for (const id of targetIds) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;

        applyDamageToPermanent(ctx, String(id), 1);

        ;(perm as any).tempAbilities = Array.isArray((perm as any).tempAbilities) ? (perm as any).tempAbilities : [];
        if (!(perm as any).tempAbilities.some((a: any) => String(a).toLowerCase().includes("can't block"))) {
          (perm as any).tempAbilities.push("Can't block");
        }
      }

      if (targetIds.length > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_UP_TO_ONE_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND": {
      const m = text.match(/^return up to one target creature card from your graveyard to your hand\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      const creatureCards = gy.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('creature'));
      if (creatureCards.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose up to one creature card in your graveyard to return to your hand`,
        mandatory: true,
        sourceName,
        minTargets: 0,
        maxTargets: 1,
        action: 'move_graveyard_card_to_hand',
        fromPlayerId: controller,
        validTargets: creatureCards.map((c: any) => ({
          id: c.id,
          label: c.name || 'Creature',
          description: c.type_line || 'creature card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    default:
      return false;
  }
}

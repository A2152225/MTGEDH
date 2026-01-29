import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { parseWordNumber } from "../../utils.js";

export function normalizeOracleEffectText(effect: string): string {
  return String(effect || "")
    .trim()
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ");
}

export function getGameId(ctx: GameContext): string | null {
  return ((ctx as any).gameId as string) || ((ctx as any).id as string) || ((ctx as any).state?.gameId as string) || null;
}

export function getBattlefield(ctx: GameContext): any[] {
  return ((ctx as any).state?.battlefield as any[]) || [];
}

export function getTargets(triggerItem: any): string[] {
  const t = triggerItem?.targets;
  if (!Array.isArray(t)) return [];
  return t.map((x: any) => (typeof x === "string" ? x : x?.id)).filter(Boolean);
}

export function getPlaneswalkerX(triggerItem: any): number | null {
  const raw = triggerItem?.planeswalker?.loyaltyCost;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.abs(raw);
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.abs(n);
  }
  return null;
}

export function parseCreateTokenDescriptor(raw: string): {
  name: string;
  colors: string[];
  creatureTypes: string[];
  abilities: string[];
} {
  const lower = raw.toLowerCase();

  const colorMap: Record<string, string> = {
    white: "W",
    blue: "U",
    black: "B",
    red: "R",
    green: "G",
    colorless: "",
  };

  const colors: string[] = [];
  const creatureTypes: string[] = [];

  const quoted = raw.match(/with\s+"([\s\S]+)"/i)?.[1]?.trim();

  const cleaned = raw
    .replace(/\bcreature\b/gi, "")
    .replace(/\btoken\b/gi, "")
    .replace(/\bwith\b[\s\S]*$/i, "")
    .trim();

  const parts = cleaned.split(/\s+/).filter(Boolean);
  for (const part of parts) {
    const p = part.toLowerCase();
    if (colorMap[p] !== undefined) {
      if (colorMap[p]) colors.push(colorMap[p]);
      continue;
    }

    if (["a", "an", "and", "or"].includes(p)) continue;

    creatureTypes.push(part.charAt(0).toUpperCase() + part.slice(1));
  }

  const abilities: string[] = [];
  if (lower.includes("flying")) abilities.push("Flying");
  if (lower.includes("vigilance")) abilities.push("Vigilance");
  if (lower.includes("haste")) abilities.push("Haste");
  if (lower.includes("lifelink")) abilities.push("Lifelink");
  if (lower.includes("deathtouch")) abilities.push("Deathtouch");
  if (lower.includes("first strike")) abilities.push("First strike");
  if (lower.includes("trample")) abilities.push("Trample");
  if (lower.includes("menace")) abilities.push("Menace");
  if (lower.includes("reach")) abilities.push("Reach");

  if (quoted) abilities.push(quoted);

  const name = creatureTypes.length ? creatureTypes.join(" ") : "Token";

  return { name, colors, creatureTypes, abilities };
}

export function modifyLifeLikeStack(
  ctx: GameContext,
  playerId: PlayerID,
  delta: number,
  options?: { trackLifeChangeThisTurn?: boolean }
) {
  const state = (ctx as any).state;
  if (!state) return;

  const startingLife = state.startingLife || 40;
  state.life = state.life || {};
  const players = state.players || [];

  const currentLife = state.life[playerId] ?? startingLife;
  state.life[playerId] = currentLife + delta;

  if (options?.trackLifeChangeThisTurn !== false && delta !== 0) {
    if (delta > 0) {
      try {
        state.lifeGainedThisTurn = state.lifeGainedThisTurn || {};
        state.lifeGainedThisTurn[String(playerId)] = (state.lifeGainedThisTurn[String(playerId)] || 0) + delta;
      } catch {}
    } else {
      try {
        state.lifeLostThisTurn = state.lifeLostThisTurn || {};
        state.lifeLostThisTurn[String(playerId)] =
          (state.lifeLostThisTurn[String(playerId)] || 0) + Math.abs(delta);
      } catch {}
    }
  }

  const player = players.find((p: any) => p.id === playerId);
  if (player) player.life = state.life[playerId];
}

export function parseCountTokenWord(word: string): number {
  return parseWordNumber(word);
}

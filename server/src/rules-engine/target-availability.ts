import type { PlayerID } from "../../../shared/src/index.js";
import { categorizeSpell, evaluateTargeting, parseTargetRequirements, requiresTargeting } from "./targeting.js";

function getTargetingContext(state: any): { hasBattlefield: boolean; hasPlayers: boolean; hasStack: boolean } {
  return {
    hasBattlefield: Array.isArray(state?.battlefield),
    hasPlayers: Array.isArray(state?.players),
    hasStack: Array.isArray(state?.stack),
  };
}

function specNeedsPlayers(spec: any): boolean {
  const op = spec?.op;
  return (
    op === 'DRAW_TARGET_PLAYER' ||
    op === 'DISCARD_TARGET_PLAYER' ||
    op === 'MILL_TARGET_PLAYER' ||
    op === 'SURVEIL_TARGET_PLAYER' ||
    op === 'GAIN_LIFE_TARGET_PLAYER' ||
    op === 'LOSE_LIFE_TARGET_PLAYER' ||
    op === 'DAMAGE_TARGET_PLAYER' ||
    op === 'DESTROY_ALL_TARGET_PLAYER' ||
    op === 'EXILE_ALL_TARGET_PLAYER' ||
    op === 'TAP_ALL_TARGET_PLAYER' ||
    op === 'UNTAP_ALL_TARGET_PLAYER' ||
    op === 'TARGET_PLAYER' ||
    op === 'BLIGHT_TARGET_OPPONENT' ||
    op === 'BLIGHT_TARGET_PLAYER'
  );
}

function specNeedsStack(spec: any): boolean {
  const op = spec?.op;
  return op === 'COUNTER_TARGET_SPELL' || op === 'COUNTER_TARGET_ABILITY';
}

function specNeedsBattlefield(spec: any): boolean {
  // Most other targeting ops are battlefield/permanent based.
  // (ANY_TARGET damage can target battlefield and/or players; battlefield is the safe requirement for the permanent side.)
  return !specNeedsPlayers(spec) && !specNeedsStack(spec);
}

function matchesBattlefieldTargetType(perm: any, rawTargetType: string): boolean {
  const targetType = String(rawTargetType || "").trim().toLowerCase();
  const typeLine = String(perm?.card?.type_line || "").toLowerCase();

  if (!perm?.card) return false;

  if (targetType === "permanent") return true;
  if (targetType === "nonland permanent") return !typeLine.includes("land");

  // Common type words from oracle patterns.
  if (targetType === "creature") return typeLine.includes("creature");
  if (targetType === "artifact") return typeLine.includes("artifact");
  if (targetType === "enchantment") return typeLine.includes("enchantment");
  if (targetType === "land") return typeLine.includes("land");
  if (targetType === "planeswalker") return typeLine.includes("planeswalker");
  if (targetType === "battle") return typeLine.includes("battle");

  // Fallback: substring match (keeps this helper flexible for multiword types like "noncreature artifact").
  return targetType.length > 0 && typeLine.includes(targetType);
}

export function hasValidTargetsForSpell(
  state: any,
  playerId: PlayerID,
  card: any,
  options?: { conservative?: boolean }
): boolean {
  const conservative = options?.conservative ?? true;

  if (!card) return false;

  const oracleTextRaw = String(card.oracle_text || "");
  const oracleText = oracleTextRaw.toLowerCase();
  const typeLine = String(card.type_line || "").toLowerCase();
  const cardName = String(card.name || "");

  const ctx = getTargetingContext(state);

  // Auras ALWAYS require a target when cast.
  const isAura = typeLine.includes("aura") && /^enchant\s+/i.test(oracleText);
  if (isAura) {
    if (!ctx.hasPlayers && !ctx.hasBattlefield) {
      return conservative;
    }
    const auraMatch = oracleText.match(/^enchant\s+(creature|permanent|player|artifact|land|opponent|planeswalker|battle)/i);
    const auraTargetType = auraMatch ? auraMatch[1].toLowerCase() : "creature";

    if (auraTargetType === "player" || auraTargetType === "opponent") {
      const players = Array.isArray(state.players) ? state.players : [];
      const validPlayers = players.filter((p: any) => auraTargetType !== "opponent" || p.id !== playerId);
      return validPlayers.length > 0;
    }

    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    return battlefield.some((p: any) => matchesBattlefieldTargetType(p, auraTargetType));
  }

  // Quick exit for spells that don't require targeting.
  if (!requiresTargeting(oracleTextRaw)) {
    return true;
  }

  // Prefer the dynamic heuristic spell categorizer (it aligns with our target selector).
  const spellSpec = categorizeSpell(cardName, oracleText);
  if (spellSpec) {
    if (specNeedsPlayers(spellSpec) && !ctx.hasPlayers) return conservative;
    if (specNeedsStack(spellSpec) && !ctx.hasStack) return conservative;
    if (specNeedsBattlefield(spellSpec) && !ctx.hasBattlefield) return conservative;

    try {
      const possibleTargets = evaluateTargeting(state, playerId, spellSpec);
      return possibleTargets.length >= spellSpec.minTargets;
    } catch {
      return conservative;
    }
  }

  // Fallback: use template parser to infer basic targeting requirements.
  const targetReqs = parseTargetRequirements(oracleTextRaw);
  if (!targetReqs.needsTargets || targetReqs.minTargets <= 0) {
    return true;
  }

  const needsPlayers = targetReqs.targetTypes.includes('player') || targetReqs.targetTypes.includes('opponent');
  const needsStack = targetReqs.targetTypes.some(t => {
    const tt = String(t).toLowerCase();
    return tt.includes('spell') || tt.includes('ability');
  });
  const needsBattlefield = !needsPlayers && !needsStack;

  if (needsPlayers && !ctx.hasPlayers) return conservative;
  if (needsStack && !ctx.hasStack) return conservative;
  if (needsBattlefield && !ctx.hasBattlefield) return conservative;

  const candidates = new Set<string>();

  // Player targets.
  if (targetReqs.targetTypes.includes("player")) {
    for (const pr of state.players || []) candidates.add(`player:${pr.id}`);
  }
  if (targetReqs.targetTypes.includes("opponent")) {
    for (const pr of state.players || []) {
      if (pr.id !== playerId) candidates.add(`player:${pr.id}`);
    }
  }

  // Stack targets.
  if (targetReqs.targetTypes.some(t => String(t).includes("spell"))) {
    for (const si of state.stack || []) {
      if (si?.type === "ability" || si?.type === "triggered_ability" || si?.type === "activated_ability") continue;
      candidates.add(`stack:${si.id}`);
    }
  }
  if (targetReqs.targetTypes.some(t => String(t).includes("ability"))) {
    for (const si of state.stack || []) {
      if (si?.type === "ability" || si?.type === "triggered_ability" || si?.type === "activated_ability") {
        candidates.add(`stack:${si.id}`);
      }
    }
  }

  // Per-opponent targeting where each opponent must supply a target they control.
  if (targetReqs.perOpponent && targetReqs.targetControllerConstraint === "that_player") {
    const opponents = (state.players || []).filter((p: any) => p.id !== playerId);
    if (opponents.length === 0) return false;

    for (const opp of opponents) {
      const hasOne = (state.battlefield || []).some((perm: any) => {
        if (perm?.controller !== opp.id) return false;
        return targetReqs.targetTypes.some(tt => matchesBattlefieldTargetType(perm, tt));
      });
      if (!hasOne) return false;
    }

    return true;
  }

  // Battlefield targets.
  for (const perm of state.battlefield || []) {
    if (!perm?.id) continue;
    if (targetReqs.targetTypes.some(tt => matchesBattlefieldTargetType(perm, tt))) {
      candidates.add(`battlefield:${perm.id}`);
    }
  }

  return candidates.size >= targetReqs.minTargets;
}

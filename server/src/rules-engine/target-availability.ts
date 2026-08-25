import type { PlayerID } from "../../../shared/src/index.js";
import { canPlayerBeTargetedByPlayer, categorizeSpell, categorizeSpellWithoutPrimaryRetirement, evaluateTargeting, matchesGraveyardCardTargetType as matchesSharedGraveyardCardTargetType, parseTargetRequirements, requiresTargeting } from "./targeting.js";
import { permanentMatchesTargetRequirementStatKeywordFilters } from "./targeting-handlers/targetingParseTargetRequirementRestrictions.js";
import { isOracleIrSpellPrimaryEnabled } from "../state/modules/oracleIrFeatureFlags.js";
import { cardManaValue } from "../state/utils.js";

function getTargetingContext(state: any): { hasBattlefield: boolean; hasPlayers: boolean; hasStack: boolean; hasZones: boolean } {
  return {
    hasBattlefield: Array.isArray(state?.battlefield),
    hasPlayers: Array.isArray(state?.players),
    hasStack: Array.isArray(state?.stack),
    hasZones: !!state?.zones && typeof state.zones === 'object',
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
  if (targetType === "any") return typeLine.includes("creature") || typeLine.includes("planeswalker");

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

function matchesGraveyardTargetType(card: any, rawTargetType: string): boolean {
  return matchesSharedGraveyardCardTargetType(card, rawTargetType);
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
      const validPlayers = players.filter((p: any) => {
        if (auraTargetType === "opponent" && p.id === playerId) return false;
        return canPlayerBeTargetedByPlayer(p.id, state, playerId);
      });
      return validPlayers.length > 0;
    }

    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    return battlefield.some((p: any) => matchesBattlefieldTargetType(p, auraTargetType));
  }

  // Other permanent spells do not choose targets as part of being cast.
  // Later triggered/activated abilities on the permanent may target, but that
  // must not suppress castability or auto-pass checks.
  const isPermanentSpell = /\b(creature|artifact|enchantment|planeswalker|battle)\b/i.test(typeLine);
  if (isPermanentSpell) {
    return true;
  }

  // IR-primary: parseTargetRequirements owns cast-time legality (no categorize opcode table).
  // IR-off: keep the non-retired categorizer so empty-stack COUNTER_TARGET_* stays uncastable.
  const useParsedCastTargets = isOracleIrSpellPrimaryEnabled();
  const spellSpec = useParsedCastTargets
    ? null
    : (categorizeSpellWithoutPrimaryRetirement(cardName, oracleText)
      || categorizeSpell(cardName, oracleText));

  // Counterspells and similar stack-targeting effects must have legal targets on the stack,
  // even when requiresTargeting() misses oracle phrasing like "target instant or sorcery spell".
  if (spellSpec && specNeedsStack(spellSpec)) {
    const stack = Array.isArray(state?.stack) ? state.stack : [];
    if (stack.length === 0) {
      return false;
    }
  }

  // Safety net when categorizer is null but oracle clearly targets the stack.
  if (
    !spellSpec
    && /(?:counter\s+target\b[\s\S]{0,40}\b(?:spell|ability)\b|\btarget\s+(?:noncreature\s+|creature\s+)?(?:instant\s+or\s+sorcery\s+)?spell\b|\btarget\s+(?:activated|triggered)\s+ability\b)/i.test(oracleTextRaw)
  ) {
    const stack = Array.isArray(state?.stack) ? state.stack : [];
    if (stack.length === 0) {
      return false;
    }
  }

  // Quick exit for spells that don't require targeting.
  if (!requiresTargeting(oracleTextRaw)) {
    if (spellSpec && specNeedsStack(spellSpec)) {
      try {
        const possibleTargets = evaluateTargeting(state, playerId, spellSpec);
        return possibleTargets.length >= (spellSpec.minTargets || 1);
      } catch {
        return conservative;
      }
    }
    return true;
  }

  // Fallback: use template parser to infer basic targeting requirements.
  const targetReqs = parseTargetRequirements(oracleTextRaw, {
    gameState: state,
    controllerId: String(playerId),
    sourceName: cardName,
  });
  const preferParsedTargetReqs = Boolean(targetReqs.needsTargets)
    && (
      useParsedCastTargets
      || targetReqs.perOpponent === true
      || (
        Array.isArray(targetReqs.targetTypes)
        && targetReqs.targetTypes.some(t => String(t || '').toLowerCase().startsWith('graveyard_'))
      )
    );

  if (spellSpec && !preferParsedTargetReqs) {
    if (specNeedsPlayers(spellSpec) && !ctx.hasPlayers) return conservative;
    if (specNeedsStack(spellSpec)) {
      const stack = Array.isArray(state?.stack) ? state.stack : [];
      if (stack.length === 0) return false;
    }
    if (specNeedsBattlefield(spellSpec) && !ctx.hasBattlefield) return conservative;

    try {
      const possibleTargets = evaluateTargeting(state, playerId, spellSpec);
      return possibleTargets.length >= spellSpec.minTargets;
    } catch {
      return conservative;
    }
  }

  if (!targetReqs.needsTargets || targetReqs.minTargets <= 0) {
    return true;
  }

  const needsAnyTarget = targetReqs.targetTypes.includes('any');
  const needsPlayers = needsAnyTarget || targetReqs.targetTypes.includes('player') || targetReqs.targetTypes.includes('opponent');
  const needsStack = targetReqs.targetTypes.some(t => {
    const tt = String(t).toLowerCase();
    return tt.includes('spell') || tt.includes('ability');
  });
  const needsGraveyard = targetReqs.targetTypes.some(t => String(t).toLowerCase().startsWith('graveyard_'));
  const needsBattlefield = needsAnyTarget || (!needsPlayers && !needsStack && !needsGraveyard);

  if (needsPlayers && !ctx.hasPlayers) return conservative;
  if (needsStack) {
    const stack = Array.isArray(state?.stack) ? state.stack : [];
    if (stack.length === 0) return false;
  }
  if (needsGraveyard && !ctx.hasZones) return conservative;
  if (needsBattlefield && !ctx.hasBattlefield) return conservative;

  const candidates = new Set<string>();

  // Player targets.
  if (targetReqs.targetTypes.includes("player") || targetReqs.targetTypes.includes("any")) {
    for (const pr of state.players || []) {
      if (canPlayerBeTargetedByPlayer(pr.id, state, playerId)) {
        candidates.add(`player:${pr.id}`);
      }
    }
  }
  if (targetReqs.targetTypes.includes("opponent")) {
    for (const pr of state.players || []) {
      if (pr.id !== playerId && canPlayerBeTargetedByPlayer(pr.id, state, playerId)) {
        candidates.add(`player:${pr.id}`);
      }
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

  if (needsGraveyard) {
    const graveyardOwnerIds = (targetReqs.graveyardScope === 'any'
      ? (state.players || []).filter((player: any) => player?.id).map((player: any) => String(player.id))
      : [String(playerId)]) as string[];

    for (const ownerId of graveyardOwnerIds) {
      const graveyard = Array.isArray(state?.zones?.[ownerId]?.graveyard)
        ? state.zones[ownerId].graveyard
        : [];
      for (const card of graveyard) {
        if (!targetReqs.targetTypes.some(tt => matchesGraveyardTargetType(card, tt))) {
          continue;
        }
        if (typeof (targetReqs as any).targetFilterExactManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterExactManaValue)) {
          if (cardManaValue(card) !== Number((targetReqs as any).targetFilterExactManaValue)) {
            continue;
          }
        }
        if (typeof (targetReqs as any).targetFilterMinManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterMinManaValue)) {
          if (cardManaValue(card) < Number((targetReqs as any).targetFilterMinManaValue)) {
            continue;
          }
        }
        if (typeof (targetReqs as any).targetFilterMaxManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterMaxManaValue)) {
          if (cardManaValue(card) > Number((targetReqs as any).targetFilterMaxManaValue)) {
            continue;
          }
        }
          candidates.add(`graveyard:${card.id}`);
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
        if (!targetReqs.targetTypes.some(tt => matchesBattlefieldTargetType(perm, tt))) return false;
        return permanentMatchesTargetRequirementStatKeywordFilters(perm, state, targetReqs, playerId);
      });
      if (!hasOne) return false;
    }

    return true;
  }

  // Battlefield targets.
  for (const perm of state.battlefield || []) {
    if (!perm?.id) continue;
    if (!targetReqs.targetTypes.some(tt => matchesBattlefieldTargetType(perm, tt))) continue;
    if (!permanentMatchesTargetRequirementStatKeywordFilters(perm, state, targetReqs, playerId)) continue;
    candidates.add(`battlefield:${perm.id}`);
  }

  return candidates.size >= targetReqs.minTargets;
}

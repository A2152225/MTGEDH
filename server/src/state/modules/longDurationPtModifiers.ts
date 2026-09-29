// server/src/state/modules/longDurationPtModifiers.ts
// Oracle IR `powerToughness` modifiers that last longer than "until end of turn":
//   - until_next_turn : "gets -3/-0 until your next turn" (expires when the caster's next turn begins)
//   - end_of_combat   : "gets +2/+0 until end of combat"   (expires when the combat phase ends)
//   - static/permanent: "perpetually gets +1/+1", "for as long as ..." grants (never auto-expire here)
//   - this_turn / until_end_of_turn / eot: end-of-turn aliases (removed at cleanup)
// Plain `end_of_turn` entries are NOT handled here: they are mirrored into temporaryPTMods and
// counted by temporaryPtMods.ts / sumUnmirroredOracleIrPtModifiers (avoids double counting).
//
// The shared current P/T calculation (currentPowerToughness.ts) counts these through
// sumLongDurationPtModifiers; the turn code expires them through the expire* helpers below.
// Public entry symbols: sumLongDurationPtModifiers, isLongDurationPtModifier,
//   expireUntilNextTurnPtModifiers, expireEndOfCombatPtEffects, recordEndOfCombatKeywordPtBonus.

const PT_MODIFIER_TYPES = new Set(['powertoughness', 'power_toughness']);

function modifierDuration(modifier: any): string {
  return String(modifier?.duration || 'end_of_turn').trim().toLowerCase();
}

function isPtModifier(modifier: any): boolean {
  return PT_MODIFIER_TYPES.has(String(modifier?.type || '').trim().toLowerCase());
}

/** True for a P/T modifier whose duration is anything other than plain `end_of_turn`. */
export function isLongDurationPtModifier(modifier: any): boolean {
  return isPtModifier(modifier) && modifierDuration(modifier) !== 'end_of_turn';
}

function isUntilNextTurnDuration(duration: string): boolean {
  return duration === 'until_next_turn' || duration === 'until_your_next_turn';
}

/**
 * Whether the modifier still applies. "Until your next turn" modifiers stop applying as soon as
 * that player's next turn has begun, even before the turn-start cleanup ran.
 */
function isLongDurationPtModifierActive(modifier: any, state: any): boolean {
  const duration = modifierDuration(modifier);
  if (!isUntilNextTurnDuration(duration)) return true;
  const controllerId = String(modifier?.expiresOnControllerTurn || '').trim();
  const turnApplied = Number(modifier?.turnApplied ?? 0) || 0;
  const turnNumber = Number(state?.turnNumber ?? 0) || 0;
  const turnPlayer = String(state?.turnPlayer || '').trim();
  if (controllerId && turnPlayer === controllerId && turnApplied > 0 && turnNumber > turnApplied) return false;
  return true;
}

/** Sum of the active longer-than-end-of-turn P/T modifiers on a permanent. */
export function sumLongDurationPtModifiers(perm: any, state?: any): { power: number; toughness: number } {
  const modifiers = Array.isArray(perm?.modifiers) ? perm.modifiers : [];
  let power = 0;
  let toughness = 0;
  for (const modifier of modifiers) {
    if (!isLongDurationPtModifier(modifier)) continue;
    if (!isLongDurationPtModifierActive(modifier, state)) continue;
    power += Number(modifier?.power ?? 0) || 0;
    toughness += Number(modifier?.toughness ?? 0) || 0;
  }
  return { power, toughness };
}

function dropCachedPt(permanent: any): void {
  delete permanent.effectivePower;
  delete permanent.effectiveToughness;
}

/**
 * Turn start for `currentPlayerId`: remove that player's "until your next turn" P/T modifiers
 * that were applied on an earlier turn. Returns how many were removed.
 */
export function expireUntilNextTurnPtModifiers(
  battlefield: readonly any[],
  currentPlayerId: string,
  currentTurn: number,
): number {
  let removed = 0;
  for (const permanent of battlefield) {
    if (!permanent || !Array.isArray(permanent.modifiers)) continue;
    const before = permanent.modifiers.length;
    permanent.modifiers = permanent.modifiers.filter((modifier: any) => {
      if (!isPtModifier(modifier) || !isUntilNextTurnDuration(modifierDuration(modifier))) return true;
      const controllerId = String(modifier?.expiresOnControllerTurn || '').trim();
      const turnApplied = Number(modifier?.turnApplied ?? 0) || 0;
      return !(controllerId === String(currentPlayerId) && turnApplied < currentTurn);
    });
    const dropped = before - permanent.modifiers.length;
    if (dropped > 0) {
      removed += dropped;
      if (permanent.modifiers.length === 0) delete permanent.modifiers;
      dropCachedPt(permanent);
    }
  }
  return removed;
}

/**
 * "Until end of combat" ends: remove end_of_combat P/T modifiers, mirrored temporaryPTMods and
 * keyword pump bonuses that were flagged end_of_combat. Returns how many entries were removed.
 */
export function expireEndOfCombatPtEffects(battlefield: readonly any[]): number {
  let removed = 0;
  for (const permanent of battlefield) {
    if (!permanent) continue;
    let touched = false;

    if (Array.isArray(permanent.modifiers)) {
      const before = permanent.modifiers.length;
      permanent.modifiers = permanent.modifiers.filter((modifier: any) => modifierDuration(modifier) !== 'end_of_combat' || !isPtModifier(modifier));
      const dropped = before - permanent.modifiers.length;
      if (dropped > 0) {
        removed += dropped;
        touched = true;
        if (permanent.modifiers.length === 0) delete permanent.modifiers;
      }
    }

    if (Array.isArray(permanent.temporaryPTMods)) {
      const before = permanent.temporaryPTMods.length;
      permanent.temporaryPTMods = permanent.temporaryPTMods.filter((entry: any) => {
        const until = String(entry?.until || entry?.expiresAt || '').trim().toLowerCase();
        return until !== 'end_of_combat';
      });
      const dropped = before - permanent.temporaryPTMods.length;
      if (dropped > 0) {
        removed += dropped;
        touched = true;
        if (permanent.temporaryPTMods.length === 0) delete permanent.temporaryPTMods;
      }
    }

    // Keyword-trigger pumps accumulate in the temp*Bonus fields; only the end-of-combat part
    // (tracked separately) is taken back, so an end-of-turn pump from the same turn stays.
    const combatPower = Number(permanent.tempCombatPowerBonus ?? 0) || 0;
    const combatToughness = Number(permanent.tempCombatToughnessBonus ?? 0) || 0;
    if (combatPower !== 0 || combatToughness !== 0) {
      for (const [field, delta] of [
        ['tempPowerBonus', combatPower],
        ['temporaryPowerBoost', combatPower],
        ['tempToughnessBonus', combatToughness],
        ['temporaryToughnessBoost', combatToughness],
      ] as const) {
        if (typeof permanent[field] !== 'number') continue;
        const next = permanent[field] - delta;
        if (next === 0) delete permanent[field];
        else permanent[field] = next;
      }
      removed += 1;
      touched = true;
    }
    if (permanent.tempCombatPowerBonus !== undefined) delete permanent.tempCombatPowerBonus;
    if (permanent.tempCombatToughnessBonus !== undefined) delete permanent.tempCombatToughnessBonus;
    if (permanent.tempBonusExpires === 'end_of_combat') delete permanent.tempBonusExpires;

    if (touched) dropCachedPt(permanent);
  }
  return removed;
}

/** applyKeywordPTMod hook: remember the part of a keyword pump that ends with combat. */
export function recordEndOfCombatKeywordPtBonus(permanent: any, power: number, toughness: number): void {
  if (!permanent) return;
  permanent.tempCombatPowerBonus = (Number(permanent.tempCombatPowerBonus ?? 0) || 0) + power;
  permanent.tempCombatToughnessBonus = (Number(permanent.tempCombatToughnessBonus ?? 0) || 0) + toughness;
}
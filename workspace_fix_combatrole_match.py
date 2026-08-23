from pathlib import Path

path = Path(r"D:\Git\MTGEDH\server\src\state\modules\triggeredAbilityBattlefieldTargetMatch.ts")
text = path.read_text(encoding="utf-8")
old_type = """export type TriggeredBattlefieldTargetFilterMetadata = {
  targetFilterTypes?: string[];
  targetFilterRequiredTypeWords?: string[];
  targetFilterExcludeTypes?: string[];
  /** Ugin-style: permanent that is one or more colors (not colorless). */
  targetFilterRequiresOneOrMoreColors?: boolean;
};
"""
new_type = """export type TriggeredBattlefieldTargetFilterMetadata = {
  targetFilterTypes?: string[];
  targetFilterRequiredTypeWords?: string[];
  targetFilterExcludeTypes?: string[];
  /** Ugin-style: permanent that is one or more colors (not colorless). */
  targetFilterRequiresOneOrMoreColors?: boolean;
  /** Bast / Condemn-style combat role on the target noun phrase. */
  targetCombatRole?: 'attacking' | 'blocking' | 'attacking_or_blocking';
};

export function isPermanentCurrentlyAttacking(permanent: any): boolean {
  if (!permanent) return false;
  if (permanent.isAttacking === true) return true;
  const attacking = permanent.attacking;
  if (typeof attacking === 'string' && attacking.trim().length > 0) return true;
  if (attacking === true) return true;
  return false;
}

export function isPermanentCurrentlyBlocking(permanent: any): boolean {
  if (!permanent) return false;
  if (permanent.isBlocking === true) return true;
  const blocking = permanent.blocking;
  if (Array.isArray(blocking) && blocking.length > 0) return true;
  if (typeof blocking === 'string' && blocking.trim().length > 0) return true;
  return false;
}

export function matchesTriggeredCombatRole(
  permanent: any,
  role: 'attacking' | 'blocking' | 'attacking_or_blocking' | undefined,
): boolean {
  if (!role) return true;
  const attacking = isPermanentCurrentlyAttacking(permanent);
  const blocking = isPermanentCurrentlyBlocking(permanent);
  if (role === 'attacking_or_blocking') return attacking || blocking;
  if (role === 'blocking') return blocking;
  return attacking;
}
"""
if old_type not in text:
    raise SystemExit('metadata type not found')
text = text.replace(old_type, new_type, 1)

# Update function signature permanent type and add combat role check before return true
old_sig = """export function matchesTriggeredBattlefieldTarget(
  targetType: string,
  typeLine: string,
  metadata?: TriggeredBattlefieldTargetFilterMetadata,
  permanent?: { colors?: readonly string[]; colorAdditions?: readonly string[]; card?: any; id?: string } | null,
  gameState?: unknown,
): boolean {"""
new_sig = """export function matchesTriggeredBattlefieldTarget(
  targetType: string,
  typeLine: string,
  metadata?: TriggeredBattlefieldTargetFilterMetadata,
  permanent?: {
    colors?: readonly string[];
    colorAdditions?: readonly string[];
    card?: any;
    id?: string;
    attacking?: unknown;
    isAttacking?: boolean;
    blocking?: unknown;
    isBlocking?: boolean;
  } | null,
  gameState?: unknown,
): boolean {"""
if old_sig not in text:
    raise SystemExit('match fn sig not found')
text = text.replace(old_sig, new_sig, 1)

old_end = """  if (metadata?.targetFilterRequiresOneOrMoreColors === true) {
    const colors = getEffectiveColors(permanent || { card: { type_line: typeLine } }, gameState);
    if (!Array.isArray(colors) || colors.length === 0) {
      return false;
    }
  }

  return true;
}
"""
new_end = """  if (metadata?.targetFilterRequiresOneOrMoreColors === true) {
    const colors = getEffectiveColors(permanent || { card: { type_line: typeLine } }, gameState);
    if (!Array.isArray(colors) || colors.length === 0) {
      return false;
    }
  }

  if (metadata?.targetCombatRole && !matchesTriggeredCombatRole(permanent, metadata.targetCombatRole)) {
    return false;
  }

  return true;
}
"""
if old_end not in text:
    raise SystemExit('match fn end not found')
text = text.replace(old_end, new_end, 1)
path.write_text(text, encoding='utf-8')
print('patched triggeredAbilityBattlefieldTargetMatch.ts', round(path.stat().st_size/1024,1), 'KB')

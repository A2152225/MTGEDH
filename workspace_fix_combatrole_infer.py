from pathlib import Path

# --- Bug 2a: infer targetCombatRole ---
path = Path(r"D:\Git\MTGEDH\server\src\state\modules\inferTriggeredAbilityTargetMetadata.ts")
text = path.read_text(encoding="utf-8")
old_sig = """  targetFilterRequiresOneOrMoreColors?: boolean;
  minTargets?: number;
  maxTargets?: number;
} {"""
new_sig = """  targetFilterRequiresOneOrMoreColors?: boolean;
  /** Combat-role restriction for "target attacking/blocking creature". */
  targetCombatRole?: 'attacking' | 'blocking' | 'attacking_or_blocking';
  minTargets?: number;
  maxTargets?: number;
} {"""
if old_sig not in text:
    raise SystemExit('infer signature not found')
text = text.replace(old_sig, new_sig, 1)

old_vars = """  let targetFilterRequiresOneOrMoreColors = false;
  let minTargets: number | undefined;
  let maxTargets: number | undefined;
"""
new_vars = """  let targetFilterRequiresOneOrMoreColors = false;
  let targetCombatRole: 'attacking' | 'blocking' | 'attacking_or_blocking' | undefined;
  let minTargets: number | undefined;
  let maxTargets: number | undefined;
"""
if old_vars not in text:
    raise SystemExit('infer vars not found')
text = text.replace(old_vars, new_vars, 1)

# After setting targetType for attacking creature, also set combat role.
# Insert detection just before targetConstraint block or after targetType assignment area.
marker = """  // Colored-permanent riders (Ugin Eye of the Storms, etc.).
  if (requiresTarget && /\\b(?:that(?:'s| is)|which (?:are|is)) one or more colors\\b/i.test(lower)) {
    targetFilterRequiresOneOrMoreColors = true;
  }
"""
insert = """  // Colored-permanent riders (Ugin Eye of the Storms, etc.).
  if (requiresTarget && /\\b(?:that(?:'s| is)|which (?:are|is)) one or more colors\\b/i.test(lower)) {
    targetFilterRequiresOneOrMoreColors = true;
  }

  // Combat-role noun phrases: "target attacking creature", "target blocking creature",
  // "target attacking or blocking creature" (optional subtype words allowed).
  if (requiresTarget) {
    const combatRoleMatch = lower.match(
      /\\btarget\\s+(attacking(?:\\s+or\\s+blocking)?|blocking)(?:\\s+[a-z0-9'-]+)*\\s+creature\\b/,
    );
    if (combatRoleMatch) {
      const role = String(combatRoleMatch[1] || '').replace(/\\s+/g, ' ').trim();
      if (role === 'attacking or blocking') targetCombatRole = 'attacking_or_blocking';
      else if (role === 'blocking') targetCombatRole = 'blocking';
      else targetCombatRole = 'attacking';
    }
  }
"""
if marker not in text:
    raise SystemExit('colored-permanent marker not found')
text = text.replace(marker, insert, 1)

old_ret = """    targetFilterRequiresOneOrMoreColors,
    minTargets,
    maxTargets,
  };
}
"""
new_ret = """    targetFilterRequiresOneOrMoreColors,
    targetCombatRole,
    minTargets,
    maxTargets,
  };
}
"""
if old_ret not in text:
    raise SystemExit('infer return not found')
text = text.replace(old_ret, new_ret, 1)
path.write_text(text, encoding='utf-8')
print('patched inferTriggeredAbilityTargetMetadata.ts', round(path.stat().st_size/1024,1), 'KB')

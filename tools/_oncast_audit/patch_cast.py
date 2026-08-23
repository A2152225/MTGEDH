from pathlib import Path

# --- 1) castTriggers.ts: extract full line, preserve case, collect all self-cast clauses ---
cast_path = Path(r"D:\Git\MTGEDH\rules-engine\src\cards\castTriggers.ts")
cast = cast_path.read_text(encoding="utf-8")

old_interface = """export interface CastTriggerInfo {
  readonly hasCastTrigger: boolean;
  readonly triggerType: 'self_cast' | 'other_cast' | 'none';
  readonly effect?: string;
  readonly creatureTypeFilter?: string;
  readonly hasStorm?: boolean;
  readonly hasCascade?: boolean;
  readonly cascadeCount?: number;
  readonly copyTriggers?: boolean;
}"""

new_interface = """export interface CastTriggerInfo {
  readonly hasCastTrigger: boolean;
  readonly triggerType: 'self_cast' | 'other_cast' | 'none';
  readonly effect?: string;
  /** All self-cast on-cast clauses when a card has more than one (e.g. kicker pairs). */
  readonly effects?: readonly string[];
  readonly creatureTypeFilter?: string;
  readonly hasStorm?: boolean;
  readonly hasCascade?: boolean;
  readonly cascadeCount?: number;
  readonly copyTriggers?: boolean;
}

/** Strip a single trailing reminder-text parenthetical from oracle clause text. */
function stripTrailingReminderText(clause: string): string {
  return String(clause || '')
    .replace(/\\s*\\([^)]*\\)\\s*$/g, '')
    .trim()
    .replace(/\\.\\s*$/g, '');
}

/**
 * Extract each "When you cast this spell," clause from oracle text.
 * Uses the full paragraph line (not first-period truncation) and absorbs following
 * bullet/mode lines so modal on-cast abilities keep their modes.
 */
export function extractSelfCastEffectClauses(oracleText: string): string[] {
  const lines = String(oracleText || '').split(/\\r?\\n/);
  const clauses: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = line.match(
      /^\\s*When you cast (?:this spell|this creature|~|this card)\\s*,?\\s*(.*)$/i,
    );
    if (!match) continue;
    let effect = String(match[1] || '').trim();
    while (i + 1 < lines.length) {
      const nextRaw = lines[i + 1] ?? '';
      const next = nextRaw.trim();
      if (!next) break;
      // Mode bullets or indented continuations belonging to this ability.
      if (/^[\\u2022\\u2023\\u25E6•]/.test(next) || /^[-–—]\\s+/.test(next)) {
        effect += '\\n' + next;
        i += 1;
        continue;
      }
      break;
    }
    const cleaned = stripTrailingReminderText(effect);
    if (cleaned) clauses.push(cleaned);
  }
  return clauses;
}"""

if old_interface not in cast:
    raise SystemExit("castTriggers interface block not found")
cast = cast.replace(old_interface, new_interface, 1)

old_self = """  // Check for "when you cast this" patterns (Eldrazi-style)
  const selfCastPattern = /when you cast (this spell|this creature|~|this card)/i;
  if (selfCastPattern.test(text)) {
    // Extract the effect after the trigger
    const match = text.match(/when you cast (?:this spell|this creature|~|this card)[^,]*,?\\s*([^.]+)/i);
    return {
      hasCastTrigger: true,
      triggerType: 'self_cast',
      effect: match ? match[1].trim() : 'Cast trigger effect',
    };
  }"""

new_self = """  // Check for "when you cast this" patterns (Eldrazi-style).
  // Prefer full-line extraction (preserves "If you do," clauses and original casing).
  const selfCastClauses = extractSelfCastEffectClauses(oracleText);
  if (selfCastClauses.length > 0) {
    return {
      hasCastTrigger: true,
      triggerType: 'self_cast',
      effect: selfCastClauses[0],
      effects: selfCastClauses,
    };
  }
  const selfCastPattern = /when you cast (this spell|this creature|~|this card)/i;
  if (selfCastPattern.test(text)) {
    // Fallback for odd layouts: take rest of matched line from original text.
    const match = oracleText.match(
      /when you cast (?:this spell|this creature|~|this card)\\s*,?\\s*([^\\n]+)/i,
    );
    const effect = stripTrailingReminderText(match ? match[1] : 'Cast trigger effect');
    return {
      hasCastTrigger: true,
      triggerType: 'self_cast',
      effect,
      effects: effect ? [effect] : [],
    };
  }"""

if old_self not in cast:
    raise SystemExit("castTriggers self-cast block not found")
cast = cast.replace(old_self, new_self, 1)
cast_path.write_text(cast, encoding="utf-8")
print("patched castTriggers.ts")

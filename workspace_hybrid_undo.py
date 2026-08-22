from pathlib import Path
import re

p = Path(r"D:\Git\MTGEDH\server\src\socket\undo.ts")
raw = p.read_text(encoding="utf-8")

# Fix mojibake join in buildTurnPhaseTargetLabel if present
raw2 = raw
# replace any broken join separator after filter(Boolean)
raw2 = re.sub(
    r"return parts\.filter\(Boolean\)\.join\('(?: ? | A. | ?? |\s+)'\) \|\| 'Earlier game state';",
    "return parts.filter(Boolean).join(' ? ') || 'Earlier game state';",
    raw2,
    count=1,
)
if "join(' ? ') || 'Earlier game state'" not in raw2:
    # try broader
    m = re.search(r"return parts\.filter\(Boolean\)\.join\((['\"])(.*?)\1\) \|\| 'Earlier game state';", raw2)
    print("join match", m.group(0) if m else None, m.group(2).encode('unicode_escape') if m else None)
    if m:
        raw2 = raw2.replace(m.group(0), "return parts.filter(Boolean).join(' ? ') || 'Earlier game state';", 1)

# Replace the target-building loop body to hybrid step/phase.
# Find the section from `const step = includeSteps` through candidate creation.

old = """    const turnNumber = typeof state.turnNumber === 'number' && state.turnNumber > 0
      ? state.turnNumber
      : undefined;
    const step = includeSteps ? (typeof state.step === 'undefined' ? undefined : String(state.step)) : undefined;
    const eventsToUndo = Math.max(0, eventCount - Math.max(0, entry.entryIndex));
"""

new = """    const turnNumber = typeof state.turnNumber === 'number' && state.turnNumber > 0
      ? state.turnNumber
      : undefined;
    // Steps only for the last full round of turns; older history is phase-only.
    const useStepForEntry = includeSteps && (
      recentStepMinTurn === undefined
      || typeof turnNumber !== 'number'
      || turnNumber >= recentStepMinTurn
    );
    const step = useStepForEntry
      ? (typeof state.step === 'undefined' ? undefined : String(state.step))
      : undefined;
    const eventsToUndo = Math.max(0, eventCount - Math.max(0, entry.entryIndex));
"""

if old not in raw2:
    raise SystemExit('step assignment block not found')
raw2 = raw2.replace(old, new, 1)

# Insert recentStepMinTurn after playerCount
anchor = "  const playerCount = getPlayerCountForRound(game);\n"
insert = """  const playerCount = getPlayerCountForRound(game);
  const liveTurnNumber = typeof (game?.state as any)?.turnNumber === 'number' && (game.state as any).turnNumber > 0
    ? Number((game.state as any).turnNumber)
    : undefined;
  // Keep step detail for the current round of seats; older than that -> phase rows only.
  const recentStepMinTurn = typeof liveTurnNumber === 'number'
    ? liveTurnNumber - playerCount + 1
    : undefined;
"""
if "recentStepMinTurn" not in raw2:
    if anchor not in raw2:
        raise SystemExit('playerCount anchor missing')
    raw2 = raw2.replace(anchor, insert, 1)

# Update comment above listUndoTurnPhaseTargets
old_comment = """ * Defaults to step-level targets; dedupes by (turn, phase, step) keeping the earliest boundary
 * (largest eventsToUndo) so revisited/flickered segments do not double-list.
 * Round / turn-player name are display-only fields on the label.
"""
new_comment = """ * Defaults to step-level targets for the last full round of turns; older history is phase-only.
 * Dedupes by (turn, phase, step) keeping the earliest boundary (largest eventsToUndo) so
 * revisited/flickered segments do not double-list.
 * Round / turn-player name are display-only fields on the label.
"""
if old_comment in raw2:
    raw2 = raw2.replace(old_comment, new_comment, 1)

# Sort: always consider step rank when present on either side
old_sort = """    if (includeSteps) {
      const stepDiff = stepOrderRank(b.step) - stepOrderRank(a.step);
      if (stepDiff !== 0) return stepDiff;
    }
"""
new_sort = """    if (a.step || b.step) {
      const stepDiff = stepOrderRank(b.step) - stepOrderRank(a.step);
      if (stepDiff !== 0) return stepDiff;
    }
"""
if old_sort in raw2:
    raw2 = raw2.replace(old_sort, new_sort, 1)

p.write_bytes(raw2.encode("utf-8"))
print("patched")

# verify
t = p.read_text(encoding="utf-8")
print("has recentStepMinTurn", "recentStepMinTurn" in t)
print("has useStepForEntry", "useStepForEntry" in t)
print("join ok", "join(' ? ') || 'Earlier game state'" in t)
print("no feff", "\ufeff" not in t)
# esbuild check

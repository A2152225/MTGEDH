from pathlib import Path

# 1) TriggerEvent enum
types_path = Path(r"D:/Git/MTGEDH/rules-engine/src/triggeredAbilitiesTypes.ts")
types = types_path.read_text(encoding="utf-8")
needle = "  ATTACKS_ALONE = 'attacks_alone',\n  BLOCKS = 'blocks',"
repl = "  ATTACKS_ALONE = 'attacks_alone',\n  ATTACKS_A_PLAYER_ALONE = 'attacks_a_player_alone',\n  BLOCKS = 'blocks',"
if needle not in types:
  raise SystemExit("enum needle missing")
types_path.write_text(types.replace(needle, repl, 1), encoding="utf-8", newline="\n")
print("enum ok")

# 2) Event detection
det_path = Path(r"D:/Git/MTGEDH/rules-engine/src/triggeredAbilitiesEventDetection.ts")
det = det_path.read_text(encoding="utf-8")
old = """  if (/\\battacks?\\b/.test(text)) {
    if (/\\battacks?\\s+alone\\b/.test(text)) {
      return { event: triggerEventValues.ATTACKS_ALONE, filter: text };
    }
"""
new = """  if (/\\battacks?\\b/.test(text)) {
    // CR 506.6: "attacks a player alone" is per defending player (multiplayer-aware),
    // distinct from exalted-style global "attacks alone".
    if (/\\battacks?\\s+a\\s+player\\s+alone\\b/.test(text)) {
      return { event: triggerEventValues.ATTACKS_A_PLAYER_ALONE, filter: text };
    }
    if (/\\battacks?\\s+alone\\b/.test(text)) {
      return { event: triggerEventValues.ATTACKS_ALONE, filter: text };
    }
"""
if old not in det:
  raise SystemExit("detection needle missing")
det_path.write_text(det.replace(old, new, 1), encoding="utf-8", newline="\n")
print("detection ok")

# 3) combatAutomation relevant events
combat_path = Path(r"D:/Git/MTGEDH/rules-engine/src/combatAutomation.ts")
combat = combat_path.read_text(encoding="utf-8")
oldc = "      ? new Set<TriggerEvent>([TriggerEvent.ATTACKS, TriggerEvent.ATTACKS_ALONE])"
newc = "      ? new Set<TriggerEvent>([TriggerEvent.ATTACKS, TriggerEvent.ATTACKS_ALONE, TriggerEvent.ATTACKS_A_PLAYER_ALONE])"
if oldc not in combat:
  raise SystemExit("combat needle missing")
combat_path.write_text(combat.replace(oldc, newc, 1), encoding="utf-8", newline="\n")
print("combat ok")

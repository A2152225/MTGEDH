from pathlib import Path
path = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandler.ts")
text = path.read_text(encoding="utf-8")
print("size", path.stat().st_size)
start = text.find("export function checkAttacksAloneTriggers(")
end = text.find("export function checkCombatDamageToPlayerTriggers(", start)
block = text[start:end]
# Derive player-alone variant
new_block = block.replace("checkAttacksAloneTriggers", "checkAttacksAPlayerAloneTriggers")
new_block = new_block.replace("TriggerEvent.ATTACKS_ALONE", "TriggerEvent.ATTACKS_A_PLAYER_ALONE")
new_block = new_block.replace(
  "Check triggers that fire when a creature attacks alone.",
  "Check triggers that fire when a creature attacks a player alone (CR 506.6).",
)
# Insert before combat damage function
text2 = text[:end] + new_block + text[end:]
path.write_text(text2, encoding="utf-8", newline="\n")
print("new size", path.stat().st_size)
print("has player alone fn", "checkAttacksAPlayerAloneTriggers" in path.read_text(encoding="utf-8"))

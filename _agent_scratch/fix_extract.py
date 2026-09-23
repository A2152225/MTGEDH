from pathlib import Path

mod_path = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandlerAttacksAlone.ts")
handler = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandler.ts")
h = handler.read_text(encoding="utf-8")

# Grab player-alone function body still in handler
p_start = h.find("export function checkAttacksAPlayerAloneTriggers(")
if p_start < 0:
  raise SystemExit("player alone missing in handler")
# include its (wrong) doc comment
doc = h.rfind("/**", 0, p_start)
p_start = doc if doc >= 0 else p_start
p_end = h.find("export function checkCombatDamageToPlayerTriggers(", p_start)
# include combat damage doc that should stay with combat function
combat_doc = h.rfind("/**", p_start, p_end)
player_fn = h[p_start:combat_doc].rstrip() + "\n\n"
# Fix its doc comment
player_fn = player_fn.replace(
  "Check triggers that care about combat damage to players and provide\n * relational opponent context for Oracle IR automation.",
  "Check triggers that fire when a creature attacks a player alone (CR 506.6).",
)

mod = mod_path.read_text(encoding="utf-8")
if "checkAttacksAPlayerAloneTriggers" not in mod:
  mod = mod.rstrip() + "\n\n" + player_fn
  mod_path.write_text(mod, encoding="utf-8", newline="\n")

# Remove player alone leftover from handler (keep combat doc + function)
h2 = h[:p_start] + h[combat_doc:]
# Ensure re-export still present once
if h2.count("triggersHandlerAttacksAlone") != 1:
  print("warn reexport count", h2.count("triggersHandlerAttacksAlone"))
handler.write_text(h2, encoding="utf-8", newline="\n")

print("handler size", handler.stat().st_size)
print("mod has both", "checkAttacksAloneTriggers" in mod_path.read_text(encoding="utf-8"), "checkAttacksAPlayerAloneTriggers" in mod_path.read_text(encoding="utf-8"))
print("handler has player body", "ATTACKS_A_PLAYER_ALONE" in handler.read_text(encoding="utf-8"))
# show reexport neighborhood
hh = handler.read_text(encoding="utf-8")
idx = hh.find("triggersHandlerAttacksAlone")
print(hh[idx-80:idx+350])

from pathlib import Path

handler = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandler.ts")
mod_path = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandlerAttacksAlone.ts")
h = handler.read_text(encoding="utf-8")
mod = mod_path.read_text(encoding="utf-8")

# Strip module header/imports; keep only the two export functions + docs
fn_start = mod.find("/**\n * Check triggers that fire when a creature attacks alone.")
if fn_start < 0:
  fn_start = mod.find("export function checkAttacksAloneTriggers")
fns = mod[fn_start:].rstrip() + "\n\n"

# Replace re-export with inline functions
reexport = """export {
  checkAttacksAloneTriggers,
  checkAttacksAPlayerAloneTriggers,
} from './triggersHandlerAttacksAlone.js';

"""
if reexport not in h:
  raise SystemExit("reexport missing")
h2 = h.replace(reexport, fns, 1)
handler.write_text(h2, encoding="utf-8", newline="\n")
mod_path.unlink()
print("handler size", handler.stat().st_size)
print("mod exists", mod_path.exists())
print("has both", "checkAttacksAloneTriggers" in h2 and "checkAttacksAPlayerAloneTriggers" in h2)

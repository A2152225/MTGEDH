from pathlib import Path
hpath = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandler.ts")
h = hpath.read_text(encoding="utf-8")
start = h.find("/**\n * Check triggers that care about combat damage to players")
# find next export after this function - checkBecomesBlocked or similar
import re
# Find all export function positions after start
exports = [(m.start(), m.group(0)) for m in re.finditer(r"^export function \w+", h[start:], re.M)]
print("exports after combat doc:")
for pos, name in exports[:5]:
  print(pos, name)
print("combat fn approx size", exports[1][0] - exports[0][0] if len(exports)>1 else "unknown")
print("total", hpath.stat().st_size)

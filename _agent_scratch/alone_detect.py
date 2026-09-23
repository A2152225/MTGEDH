import pathlib, re
# Check detection order for attacks alone vs attacks a player alone in attack-detection
files = [
 r"D:/Git/MTGEDH/server/src/state/modules/triggers/attack-detection.ts",
 r"D:/Git/MTGEDH/server/src/state/modules/triggers/attack-detection-watchers.ts",
 r"D:/Git/MTGEDH/server/src/state/modules/triggers/attack-detection-generic.ts",
]
for f in files:
  text = pathlib.Path(f).read_text(encoding="utf-8", errors="replace")
  for i, line in enumerate(text.splitlines(), 1):
    if re.search(r"alone|attacks a player", line, re.I):
      print(f"{pathlib.Path(f).name}:{i}:{line.strip()[:200]}")
  print("---")

import pathlib, re
# find add_counter target resolution
root = pathlib.Path(r"D:/Git/MTGEDH/rules-engine/src")
for p in root.rglob("*.ts"):
  text = p.read_text(encoding="utf-8", errors="replace")
  if "add_counter" not in text: continue
  if "resolveDirectBattlefieldPermanents" in text or "Army" in text or "target" in text:
    if re.search(r"kind === ['\"]add_counter['\"]|case ['\"]add_counter['\"]|add_counter", text):
      for i, line in enumerate(text.splitlines(), 1):
        if "add_counter" in line and ("kind" in line or "case" in line or "step.kind" in line):
          print(f"{p.name}:{i}:{line.strip()[:160]}")

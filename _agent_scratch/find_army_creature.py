import pathlib, re
root = pathlib.Path(r"D:/Git/MTGEDH/rules-engine/src")
# Also search server
roots = [root, pathlib.Path(r"D:/Git/MTGEDH/server/src")]
for base in roots:
  for p in base.rglob("*.ts"):
    try:
      text = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
      continue
    if "Army creature" not in text and "army creature" not in text.lower() and "don't control an army" not in text.lower().replace("\u2019","'"):
      continue
    if "Parser" in p.name or "Postprocess" in p.name or "amass.ts" in p.name.lower():
      # still show runtime-ish
      if "Executor" not in p.name and "executor" not in p.name and "Conditional" not in p.name:
        continue
    for i, line in enumerate(text.splitlines(), 1):
      low = line.lower().replace("\u2019","'")
      if "army creature" in low or "don't control an army" in low or "dont control an army" in low:
        rel = str(p).replace(r"D:\Git\MTGEDH\\","").replace(r"D:/Git/MTGEDH/","")
        print(f"{rel}:{i}:{line.strip()[:220]}")

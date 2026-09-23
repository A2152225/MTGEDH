from pathlib import Path
import re
root = Path(r"D:/Git/MTGEDH/rules-engine/test")
for p in root.rglob("*.ts"):
  t = p.read_text(encoding="utf-8", errors="replace")
  if re.search(r"don't control|Army creature|evaluateConditional|amass", t, re.I):
    print(p.name)

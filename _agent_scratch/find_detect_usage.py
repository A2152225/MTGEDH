from pathlib import Path
import re
root = Path(r"D:/Git/MTGEDH/rules-engine/test")
for p in root.glob("*.ts"):
  t = p.read_text(encoding="utf-8", errors="replace")
  if "detectTriggeredAbilityEvent" in t:
    print(p.name)
    for i,l in enumerate(t.splitlines(),1):
      if "detectTriggeredAbilityEvent" in l:
        print(f"  {i}:{l.strip()[:160]}")

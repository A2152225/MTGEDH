from pathlib import Path
import re
# Find then-discard / sequence then subject inheritance
root = Path(r'D:/Git/MTGEDH/rules-engine/src')
for p in sorted(root.glob('*.ts')):
  text = p.read_text(encoding='utf-8', errors='replace')
  if not re.search(r'then discards|sequence.*then|inherit.*who|same.*player|subject.*then', text, re.I):
    continue
  lines = text.splitlines()
  for i,line in enumerate(lines,1):
    if re.search(r'then discards|inherits?Player|previousWho|samePlayer|sequence === .then|forThenClause', line, re.I):
      print(f'{p.name}:{i}:{line.strip()[:170]}')

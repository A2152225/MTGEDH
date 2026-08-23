from pathlib import Path
import re
# find look_hand definition and usages
root = Path(r'D:/Git/MTGEDH/rules-engine/src')
for p in sorted(root.glob('*.ts')):
  lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
  for i,line in enumerate(lines,1):
    if 'look_hand' in line:
      print(f'{p.name}:{i}:{line.strip()[:180]}')

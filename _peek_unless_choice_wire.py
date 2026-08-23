from pathlib import Path
import re
hits=[]
for root in [Path(r'D:/Git/MTGEDH/rules-engine/src'), Path(r'D:/Git/MTGEDH/server/src')]:
  for p in root.rglob('*.ts'):
    if 'node_modules' in str(p) or '\\dist\\' in str(p): continue
    text=p.read_text(encoding='utf-8',errors='replace')
    if 'unlessDiscardsChoice' in text or 'unlessPaysManaChoice' in text:
      for i,line in enumerate(text.splitlines(),1):
        if 'unlessDiscardsChoice' in line or 'unlessPaysManaChoice' in line or 'unlessPaysLifeChoice' in line:
          hits.append(f'{p.relative_to(r"D:/Git/MTGEDH")}:{i}|{line.strip()[:140]}')
print('\n'.join(hits[:40]))

from pathlib import Path
import re
for p in Path(r'D:/Git/MTGEDH/server/src/state/modules').glob('*.ts'):
  text=p.read_text(encoding='utf-8',errors='replace')
  if 'isTriggerStepRuntimeWired' in text:
    print('FILE', p.name)
    lines=text.splitlines()
    for i,line in enumerate(lines,1):
      if 'isTriggerStepRuntimeWired' in line or 'grant_static' in line:
        print(f'{i}|{line[:160]}')

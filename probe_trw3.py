from pathlib import Path
p=Path(r'D:/Git/MTGEDH/server/src/state/modules/trigger-runtime-wiring.ts')
lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
for i in range(118, 290):
  print(f'{i+1}|{lines[i]}')

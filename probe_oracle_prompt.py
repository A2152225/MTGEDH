from pathlib import Path
p = Path(r'D:/Git/MTGEDH/server/src/utils/oraclePromptContext.ts')
lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
for i in range(200, 420):
  if i < len(lines):
    print(f'{i+1}|{lines[i]}')

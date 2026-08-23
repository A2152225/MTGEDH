from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserPostprocess.ts')
lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
for i in range(29840, 30020):
  print(f'{i+1}|{lines[i]}')

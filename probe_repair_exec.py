from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserPostprocess.ts')
lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
for a,b in [(30370,30400),(31020,31080)]:
  print(f'==== {a}-{b} ====')
  for i in range(a-1, min(b, len(lines))):
    print(f'{i+1}|{lines[i]}')

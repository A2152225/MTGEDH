from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIR.ts')
lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
for i,line in enumerate(lines,1):
  if "readonly kind: 'discard'" in line and i > 1000:
    for j in range(max(1,i-2), min(len(lines)+1, i+30)):
      print(f'{j}|{lines[j-1]}')
    print('---')

from pathlib import Path
# Check discard step type for chooser/filters
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIR.ts')
lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
# find discard kind definition
for i,line in enumerate(lines,1):
  if "kind: 'discard'" in line:
    for j in range(i-1, min(i+25, len(lines)+1)):
      print(f'{j}|{lines[j-1]}')
    break

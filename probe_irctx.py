from pathlib import Path
# Find OracleIRExecutionContext fields
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutionTypes.ts')
lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
for i,line in enumerate(lines,1):
  if 'teamworkWasPaid' in line or 'wasKicked' in line or 'interface OracleIRExecutionContext' in line:
    print(f'{i}|{line}')
# print context interface
for i,line in enumerate(lines,1):
  if 'export interface OracleIRExecutionContext' in line:
    for j in range(i-1, min(i+120, len(lines))):
      print(f'{j+1}|{lines[j]}')
    break

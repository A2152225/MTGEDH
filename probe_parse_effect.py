from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserPostprocess.ts')
lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
print('==== parseEffectClausesToSteps ====')
for i in range(30540, 30590):
  print(f'{i+1}|{lines[i]}')
# where repairGapClosureAbilitySteps is called
text='\n'.join(lines)
import re
for i,line in enumerate(lines,1):
  if 'repairGapClosureAbilitySteps' in line:
    print(f'CALL {i}|{line[:160]}')

from pathlib import Path
p=Path(r'D:/Git/MTGEDH/server/src/state/modules/oracleIrAbilityExecution.ts')
lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
for i in range(270, 380):
  print(f'{i+1}|{lines[i]}')
print('==== spell ====')
p2=Path(r'D:/Git/MTGEDH/server/src/state/modules/oracleIrSpellExecution.ts')
lines2=p2.read_text(encoding='utf-8',errors='replace').splitlines()
for i in range(40, 140):
  print(f'{i+1}|{lines2[i]}')
print('==== stack resolve ability ====')
p3=Path(r'D:/Git/MTGEDH/server/src/state/modules/stackResolveAbilityLateHandlersUtils.ts')
lines3=p3.read_text(encoding='utf-8',errors='replace').splitlines()
for i in range(370, 410):
  print(f'{i+1}|{lines3[i]}')

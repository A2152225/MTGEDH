from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts')
text=p.read_text(encoding='utf-8')
print('resolvePlayers count', text.count('resolvePlayers'))
print('OracleIRExecutionContext' in text[:5000])
# show imports head
for i,line in enumerate(text.splitlines()[:80],1):
  if 'import' in line or 'resolvePlayers' in line:
    print(f'{i}|{line[:160]}')

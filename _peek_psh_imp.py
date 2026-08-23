from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorPlayerStepHandlers.ts')
text=p.read_text(encoding='utf-8')
print('imports battlefield', 'BattlefieldStepHandlers' in text[:5000])
print(text[:1200])

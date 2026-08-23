from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts')
text=p.read_text(encoding='utf-8')
idx=text.find('export function applySacrificeStep(')
print(text[idx:idx+600])

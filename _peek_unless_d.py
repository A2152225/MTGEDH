from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorPlayerStepHandlers.ts')
text=p.read_text(encoding='utf-8')
start=text.find('type UnlessDiscardsResult')
print(text[start:start+800])
print('==== applySacrifice ====')
import re
for m in re.finditer(r'export function applySacrifice|function applySacrificeStep', text):
    print(m.group(), m.start())

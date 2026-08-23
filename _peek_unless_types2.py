from pathlib import Path
import re
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorPlayerStepHandlers.ts')
text=p.read_text(encoding='utf-8')
for m in re.finditer(r'type Unless\w+|UnlessDiscardsResult|UnlessPaysLifeResult', text):
    print(m.group(), m.start())
    print(text[m.start()-50:m.start()+200])
    print('---')

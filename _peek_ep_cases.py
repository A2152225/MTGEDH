from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/effectProgram.ts')
text=p.read_text(encoding='utf-8')
import re
for m in re.finditer(r"unless_discards|unless_pays_mana", text):
    start=max(0,m.start()-80); end=min(len(text), m.end()+80)
    snippet=text[start:end].replace('\n','\\n')
    print(f'{m.start()}: {snippet}')
    print('---')

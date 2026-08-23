from pathlib import Path
import re
p=Path(r'D:/Git/MTGEDH/rules-engine/src/effectProgram.ts')
text=p.read_text(encoding='utf-8')
for m in re.finditer(r'unlessDiscardsChoice|unlessPaysManaChoice|unlessPaysLifeChoice', text):
    print(f'{m.start()}: {text[m.start()-60:m.end()+80]!r}')
    print('---')

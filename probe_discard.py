from pathlib import Path
import re
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserSimpleActionClauses.ts')
lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
for i,line in enumerate(lines,1):
  if 'discard' in line.lower() and ('PLAYER_SUBJECT' in line or 'then' in line.lower() or 'match' in line.lower()) and i > 4300 and i < 4500:
    print(f'{i}|{line}')
# also find discard with then
for i,line in enumerate(lines,1):
  if re.search(r"discards?\s", line) and ('withMeta' in line or 'kind: \'discard\'' in line or 'match' in line) and 4200 < i < 4520:
    print(f'{i}|{line[:180]}')

from pathlib import Path
import re
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIR.ts')
text = p.read_text(encoding='utf-8', errors='replace')
# extract all kind: '...' 
kinds = sorted(set(re.findall(r"kind:\s*'([a-z0-9_]+)'", text)))
for k in kinds:
  if any(x in k for x in ['hand','choose','discard','select','reveal','look','counter','sacrifice','unless']):
    print(k)
print('--- total kinds', len(kinds))

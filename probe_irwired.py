from pathlib import Path
import re
p=Path(r'D:/Git/MTGEDH/server/src/state/modules/oracleIrTriggerLegacyRouting.ts')
text=p.read_text(encoding='utf-8',errors='replace')
lines=text.splitlines()
out=[]
for i,line in enumerate(lines,1):
  if 'isTriggerEffectFullyIrWired' in line or 'UNSUPPORTED' in line or 'grant_static' in line or 'unknown' in line.lower() and 'kind' in line:
    out.append(f'{i}|{line}')
# print function body
for i,line in enumerate(lines,1):
  if 'export function isTriggerEffectFullyIrWired' in line:
    for j in range(i-1, min(i+80, len(lines))):
      out.append(f'{j+1}|{lines[j]}')
    break
Path(r'D:/Git/MTGEDH/probe_irwired.out.txt').write_text('\n'.join(out),encoding='utf-8')
print(len(out))

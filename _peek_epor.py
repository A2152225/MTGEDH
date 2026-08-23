from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/effectProgramOracleRunner.ts')
text = p.read_text(encoding='utf-8')
# show around 1445-1460 and 1250-1270
lines=text.splitlines()
for i in range(1245, 1280):
  print(f'{i+1}|{lines[i]}')
print('====')
for i in range(1435, 1470):
  print(f'{i+1}|{lines[i]}')

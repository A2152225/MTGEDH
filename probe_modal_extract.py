from pathlib import Path
import re
# find extractModalModesFromOracleText
hits = list(Path(r'D:/Git/MTGEDH').rglob('*oraclePromptContext*'))
print('hits', [str(h) for h in hits if 'node_modules' not in str(h)])
for p in Path(r'D:/Git/MTGEDH/server').rglob('*.ts'):
  if 'node_modules' in str(p): continue
  text = p.read_text(encoding='utf-8', errors='replace')
  if 'extractModalModesFromOracleText' in text and ('function extractModalModes' in text or 'export function extractModalModes' in text):
    print('DEF', p)
    lines=text.splitlines()
    for i,line in enumerate(lines):
      if 'function extractModalModesFromOracleText' in line or 'choose both' in line.lower() or 'kicked' in line.lower() and 'choose' in line.lower():
        print(f'{i+1}|{line[:160]}')

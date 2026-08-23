from pathlib import Path
import re
# Find PLAYER_SUBJECT_PREFIX definition
for p in Path(r'D:/Git/MTGEDH/rules-engine/src').glob('*.ts'):
  text=p.read_text(encoding='utf-8',errors='replace')
  if 'PLAYER_SUBJECT_PREFIX' in text and ('export' in text or 'const PLAYER_SUBJECT' in text):
    for i,line in enumerate(text.splitlines(),1):
      if 'PLAYER_SUBJECT_PREFIX' in line and i < 80:
        print(f'{p.name}:{i}:{line[:200]}')
# Print discardTail handling
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserSimpleActionClauses.ts')
lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
for i in range(4435, 4505):
  print(f'{i+1}|{lines[i]}')

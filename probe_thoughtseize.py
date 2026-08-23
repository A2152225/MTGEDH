from pathlib import Path
import re
# Thoughtseize / Duress / Inquisition style choose discard
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserPostprocess.ts')
lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
for i,line in enumerate(lines,1):
  if re.search(r'you choose|target player reveals|look at.*hand.*choose|discard.*chosen|chosen card', line, re.I):
    if 11400 < i < 11700 or 29800 < i < 30100:
      print(f'{i}|{line[:180]}')
print('==== more broad ====')
for i,line in enumerate(lines,1):
  if re.search(r'You choose (?:a|one|up to|from)|choose a (?:nonland )?card.*(hand|from it)', line, re.I):
    print(f'{i}|{line[:180]}')

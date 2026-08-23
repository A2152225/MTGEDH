from pathlib import Path
import re
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserPostprocess.ts')
lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
# search around choose from / mana value / discards those
for i,line in enumerate(lines,1):
  low=line.lower()
  if ('choose from' in low or 'mana value' in low and 'choose' in low or 'discards those' in low
      or 'nonland card with mana' in low or 'grant_static_ability' in low and 'choose' in low
      or 'hasRevealHandStep' in line or 'reveal_hand' in low and 'choose' in low):
    start=max(0,i-3); end=min(len(lines),i+5)
    print(f'--- around {i} ---')
    for j in range(start,end):
      print(f'{j+1}|{lines[j][:160]}')

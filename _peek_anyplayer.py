# Find where "If a player does" / "If you do" compound clauses get joined or split
import re, os
needles=['If a player does', 'if a player does', 'any player may', 'if_player_does', 'If you do']
for root in [r'D:\Git\MTGEDH\rules-engine\src']:
  for dp,_,fns in os.walk(root):
    for fn in fns:
      if not fn.endswith('.ts'): continue
      if 'dist' in dp: continue
      p=os.path.join(dp,fn)
      t=open(p,encoding='utf-8',errors='ignore').read()
      if 'any player may' in t.lower() or 'if a player does' in t.lower():
        c=len(re.findall(r'any player may|if a player does', t, re.I))
        if c:
          print(f'{c:3d} {p}')

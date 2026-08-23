from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserPostprocess.ts')
text=p.read_text(encoding='utf-8')
print('parsePlayerSelector in first 8k', 'parsePlayerSelector' in text[:8000])
# show import from utils
for i,line in enumerate(text.splitlines()[:80],1):
  if 'parsePlayerSelector' in line or 'oracleIRParserUtils' in line:
    print(f'{i}|{line[:160]}')

# Add reveal_hand, look_hand, unless_sacrifices to FALLBACK kinds
p2=Path(r'D:/Git/MTGEDH/server/src/state/modules/trigger-runtime-wiring.ts')
t2=p2.read_text(encoding='utf-8')
old="  'unless_discards',\n  'conditional',"
new="  'unless_discards',\n  'unless_sacrifices',\n  'reveal_hand',\n  'look_hand',\n  'conditional',"
if old not in t2:
    raise SystemExit('fallback anchor missing')
if 'unless_sacrifices' not in t2:
    t2=t2.replace(old,new,1)
    p2.write_text(t2,encoding='utf-8')
    print('fallback kinds ok')
else:
    print('fallback already has unless_sacrifices')

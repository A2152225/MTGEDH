from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserPostprocess.ts')
lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
for a,b in [(26880,26980),(30400,30520)]:
  print(f'==== {a}-{b} ====')
  for i in range(a-1,min(b,len(lines))):
    print(f'{i+1}|{lines[i]}')
  print()
# PLAYER_SUBJECT_PREFIX
p2=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserSimpleActionClauses.ts')
for i,line in enumerate(p2.read_text(encoding='utf-8',errors='replace').splitlines()[:40],1):
  print(f'{i}|{line}')

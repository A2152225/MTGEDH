from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserZoneAndRemovalActions.ts')
head=p.read_text(encoding='utf-8').splitlines()[:40]
for i,l in enumerate(head,1):
  print(f'{i}|{l}')

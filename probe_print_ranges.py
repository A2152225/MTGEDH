from pathlib import Path
# Print unless_discards type and handler snippets
files = {
  'oracleIR.ts': (1760, 1820),
  'oracleIRParserLifeAndCombatClauses.ts': (380, 430),
  'oracleIRExecutorPlayerStepHandlers.ts': (8230, 8350),
  'oracleIRExecutorMainLoop.ts': (3740, 3860),
}
for name,(a,b) in files.items():
  p=Path(r'D:/Git/MTGEDH/rules-engine/src')/name
  lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
  print('====',name,a,'-',b,'====')
  for i in range(a-1, min(b,len(lines))):
    print(f'{i+1}|{lines[i]}')
  print()

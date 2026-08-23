from pathlib import Path
files = {
  'oracleIR.ts': (1105, 1160),
  'oracleIRParserSimpleActionClauses.ts': (1590, 1650),
  'oracleIRParserSimpleActionClauses.ts': (4490, 4560),
  'oracleIRExecutorPlayerStepHandlers.ts': (6540, 6700),
}
# unique print
printed=set()
for name, (a,b) in [('oracleIR.ts',(1105,1160)),('oracleIRParserSimpleActionClauses.ts',(1590,1650)),('oracleIRParserSimpleActionClauses.ts',(4490,4560)),('oracleIRExecutorPlayerStepHandlers.ts',(6540,6700))]:
  key=(name,a)
  if key in printed: continue
  printed.add(key)
  p=Path(r'D:/Git/MTGEDH/rules-engine/src')/name
  lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
  print('====',name,a,'-',b,'====')
  for i in range(a-1,min(b,len(lines))):
    print(f'{i+1}|{lines[i]}')
  print()

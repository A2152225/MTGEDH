import re
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParser.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
# find gain control of target creature until end of turn parsing
i=t.lower().find('gain control of target creature')
print('parser.ts gain control mentions', t.lower().count('gain control of target'))
p2=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserSimpleActionClauses.ts'
t2=open(p2,encoding='utf-8',errors='ignore').read()
for m in re.finditer(r'gain\s+control[^\n]{0,200}', t2, re.I):
  print('-', m.group(0)[:200])

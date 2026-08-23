import re
# Find remove all counters / remove_counter parsing
for p in [
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserSimpleActionClauses.ts',
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserZoneAndRemovalActions.ts',
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRParser.ts',
]:
  t=open(p,encoding='utf-8',errors='ignore').read()
  print('====', p.split('\\')[-1])
  for m in re.finditer(r'.{0,80}remove all counters.{0,200}|kind:\s*\'remove_counter\'.{0,200}', t, re.I|re.S):
    print('-', m.group(0).replace(chr(10),' ')[:280])
    print()

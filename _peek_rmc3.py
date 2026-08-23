p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserSimpleActionClauses.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('const removeCounters = clause.match')
print(t[i:i+1200])
print('====')
i2=t.find('remove all counters')
print('literal remove all counters', i2)
# search for amount all
import re
for m in re.finditer(r"amount:.*all|kind: 'all'|parseQuantity\('all", t):
  print(m.group(0)[:100], 'at', m.start())

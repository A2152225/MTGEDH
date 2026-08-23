p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserSimpleActionClauses.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find("kind: 'gain_control'")
print('first at', i)
# find all gain_control creation sites with context
import re
idxs=[m.start() for m in re.finditer(r"kind:\s*'gain_control'", t)]
print('count', len(idxs))
for i in idxs[:6]:
  print('---', i)
  print(t[max(0,i-400):i+500])

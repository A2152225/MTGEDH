p=r'D:\Git\MTGEDH\server\src\state\modules\cost-adjustments.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print('len', len(t))
import re
for m in re.finditer(r'.{0,40}(for each|referenceAmount|counters? removed|genericReduction).{0,80}', t, re.I):
  print('-', m.group(0).replace(chr(10),' ')[:180])

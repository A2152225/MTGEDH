p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrServerZoneSync.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print('queueUnlessPay calls', t.count('queueUnlessPayChoicePromptsFromOracleIRResult('))
# show call sites briefly
import re
for m in re.finditer(r'queueUnlessPayChoicePromptsFromOracleIRResult\([^;]+;', t):
  print(m.group(0)[:200])
  print('---')

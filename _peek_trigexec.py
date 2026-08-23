p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrTriggerExecution.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print('len', len(t))
# find target-related building
import re
for m in re.finditer(r'.{0,60}(targetCreatureId|targetPermanentId|chosenObjectIds|targets).{0,100}', t):
  print('-', m.group(0).replace(chr(10),' ')[:200])

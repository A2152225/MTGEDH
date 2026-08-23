import re
p=r'D:\Git\MTGEDH\server\src\state\modules\inferTriggeredAbilityTargetMetadata.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print('len', len(t))
for m in re.finditer(r'.{0,60}(gain control|targetAction|for each opponent).{0,100}', t, re.I):
  print('-', m.group(0).replace(chr(10),' ')[:200])

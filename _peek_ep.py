import re
p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrEffectProgramServer.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print('len', len(t))
for m in re.finditer(r'targetCreatureId|targetPermanentId|chosenObjectIds|selectedTargets|targets', t):
  i=m.start()
  print(t[max(0,i-80):i+120].replace('\n',' | ')[:220])
  print('---')

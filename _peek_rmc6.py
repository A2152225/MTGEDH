p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorBattlefieldStepHandlers.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('function resolveRemoveCounterTargets')
# find end - next function
import re
# print last part of function - search for return resolveObject or targetPermanentId
chunk=t[i:i+8000]
for m in re.finditer(r'targetPermanentId|chosenObjectIds|target creature|return ', chunk):
  pass
print(chunk[-2500:])

p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserPostprocess.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('export function repairGapClosureAbilitySteps')
print(t[i:i+2000])
print('==== pipeline call ====')
# find where repairGapClosureAbilitySteps is called
idxs=[m.start() for m in __import__('re').finditer('repairGapClosureAbilitySteps', t)]
print('refs', idxs)
for i in idxs[1:3]:
  print(t[max(0,i-100):i+80])

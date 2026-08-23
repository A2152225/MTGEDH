import re
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorPlayerStepHandlers.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
# find evaluateUnlessPaysLifeStep
for name in ['evaluateUnlessPaysLifeStep','evaluateUnlessDiscardsStep','evaluateUnlessPaysManaStep']:
  i=t.find(f'export function {name}')
  print('====', name, i)
  if i>=0:
    j=t.find('\nexport function ', i+10)
    print(t[i:i+2500])
    print('... len fn', (j if j>0 else len(t))-i)

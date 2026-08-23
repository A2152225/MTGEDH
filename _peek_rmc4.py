p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorBattlefieldStepHandlers.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('export function applyRemoveCounterStep')
print(t[i:i+3500])

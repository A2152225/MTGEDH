p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorBattlefieldStepHandlers.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find("counterName.toLowerCase() === 'any'")
print(t[i-200:i+1200])
print('==== resolveRemoveCounterTargets ====')
i2=t.find('function resolveRemoveCounterTargets')
print(t[i2:i2+2000])

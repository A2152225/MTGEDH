p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorBattlefieldStepHandlers.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print('export applyRemoveCounterStep', 'export function applyRemoveCounterStep' in t)
print('export applyGainControlStep', 'export function applyGainControlStep' in t)
# check buildOracleIRExecutionContext export
p2=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutor.ts'
t2=open(p2,encoding='utf-8',errors='ignore').read()
print('buildOracleIRExecutionContext reexport', 'buildOracleIRExecutionContext' in t2)

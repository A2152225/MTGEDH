# Check how other executor files import GameState
import re
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorPlayerStepHandlers.ts'
t=open(p,encoding='utf-8',errors='ignore').read()[:1500]
print(t)
print('====')
import os
print('shared exists', os.path.exists(r'D:\Git\MTGEDH\shared\src\types.ts'))
print('shared index', os.path.exists(r'D:\Git\MTGEDH\shared\src\index.ts'))
# how battlefield handlers import
p2=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorBattlefieldStepHandlers.ts'
print(open(p2,encoding='utf-8',errors='ignore').read()[:800])

import re
# Find repairAbilityExecutionSteps and list what repairs it calls
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserPostprocess.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('function repairAbilityExecutionSteps')
print(t[i:i+2500])

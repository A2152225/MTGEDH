p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrTriggerExecution.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('let targetPermanentId')
print(t[i:i+2000])

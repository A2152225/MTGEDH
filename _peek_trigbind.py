p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrTriggerExecution.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('const targets = Array.isArray(triggerItem?.targets)')
print(t[i:i+3500])

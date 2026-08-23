p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrServerZoneSync.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('function resumeOracleIRRemainingStepsFromResolution')
print(t[i:i+1800])

p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrServerZoneSync.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
# Find the optional payment completion handler that checks oracleIrUnlessPayChoice
i=t.find('oracleIrUnlessPayChoice !== true')
print('at', i)
print(t[i-400:i+1200])

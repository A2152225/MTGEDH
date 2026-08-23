p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrServerZoneSync.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
start=t.find('function queueUnlessPayChoicePromptsFromOracleIRResult')
# find next function at same indent level roughly
end=t.find('\nfunction ', start+10)
print('len', end-start)
open(r'D:\Git\MTGEDH\_peek_queue_unless.txt','w',encoding='utf-8').write(t[start:end])
print('wrote', end-start)
print(t[start:start+6000])

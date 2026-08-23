p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrServerZoneSync.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
# Find the function that queues unless pay from skipped step - search backwards from first oracleIrUnlessPayChoice
i=186400
# find function start
start=t.rfind('function ', 0, i)
print('fn start around', start)
print(t[start:start+800])
print('====')
# Also find where skipped steps with unless_pays get recognized
for needle in ['unless_pays_life', 'unless_pays_mana', 'unless_discards', 'unless_sacrifices', 'queueOracleIrUnless', 'enqueueOracleIrUnless', 'optionalPaymentPrompt']:
  print(needle, t.count(needle))

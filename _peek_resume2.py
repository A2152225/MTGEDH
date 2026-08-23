import re
p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrServerZoneSync.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
# find resume functions
for m in re.finditer(r'function \w*[Rr]esume\w*|function \w*UnlessPay\w*|resumeOracle', t):
  print(m.group(0), 'at', m.start())
# show the unless pay paid branch
i=t.find('if (stepData.oracleIrUnlessPayChoice === true)')
print('====')
print(t[i:i+1500])

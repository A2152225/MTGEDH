import re
p=r'D:\Git\MTGEDH\server\src\state\modules\casting-modifiers.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print('len', len(t))
print(t[:3000])
print('====')
# find next spell
i=t.lower().find('next spell')
print(t[max(0,i-100):i+800] if i>=0 else 'no next spell')

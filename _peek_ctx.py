import re,os
for root in [r'D:\Git\MTGEDH\rules-engine\src', r'D:\Git\MTGEDH\server\src']:
  for dp,_,fns in os.walk(root):
    for fn in fns:
      if not fn.endswith('.ts'): continue
      p=os.path.join(dp,fn)
      t=open(p,encoding='utf-8',errors='ignore').read()
      if 'function buildOracleIRExecutionContext' in t or 'export function buildOracleIRExecutionContext' in t:
        i=t.find('buildOracleIRExecutionContext')
        print('FOUND', p)
        print(t[i:i+2000])

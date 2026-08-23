import re
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserPostprocess.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
# find export functions related to repair
for m in re.finditer(r'export function \w+', t):
  name=m.group(0)
  if any(x in name.lower() for x in ['repair','merge','enrich','post']):
    print(name, m.start())

import re, os
p=r'D:\Git\MTGEDH\server\tests\eldrazi-cast-trigger-resolution.integration.test.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print('len', len(t))
for m in re.finditer(r"""(describe|it)\(['\"]([^'\"]+)""", t):
  print(m.group(1), m.group(2)[:140])

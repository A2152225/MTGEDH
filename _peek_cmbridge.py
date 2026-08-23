# casting modifier bridge test summary
p=r'D:\Git\MTGEDH\server\tests\oracle-ir-casting-modifier-bridge.integration.test.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
import re
for m in re.finditer(r"""(describe|it)\(['\"]([^'\"]+)""", t):
  print(m.group(1), m.group(2)[:140])
print('--- sample ---')
print(t[:2500])

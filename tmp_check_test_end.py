f = r'd:\Git\MTGEDH\rules-engine\test\oracleIRExecutor.test.ts'
with open(f, 'r', encoding='utf-8') as fh:
    lines = fh.readlines()

print(f'Total lines: {len(lines)}')
# Show last 10 lines
for i in range(len(lines)-10, len(lines)):
    print(f'{i+1}: {lines[i].rstrip()[:80]}')

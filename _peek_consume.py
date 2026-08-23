import re
p=r'D:\Git\MTGEDH\server\src\socket\game-actions.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print('import present', 'nextSpellCostReduction' in t)
i=t.find('consumeNextSpellCostReductionAfterCast')
print(t[max(0,i-200):i+250])
# check for broken import duplication
print('count consume call', t.count('consumeNextSpellCostReductionAfterCast'))

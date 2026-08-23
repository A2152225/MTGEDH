p=r'D:\Git\MTGEDH\server\src\state\modules\cost-adjustments.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('export function getCostAdjustmentForCard')
print(t[i:i+2000])
print('====')
# also check casting-modifiers getDynamicBattlefieldCostReduction
p2=r'D:\Git\MTGEDH\server\src\state\modules\casting-modifiers.ts'
t2=open(p2,encoding='utf-8',errors='ignore').read()
i2=t2.find('export function getDynamicBattlefieldCostReduction')
print(t2[i2:i2+1500])

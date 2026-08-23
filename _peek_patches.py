print(open(r'D:\Git\MTGEDH\_patch_unless_sac.py',encoding='utf-8-sig',errors='ignore').read()[:4000])
print('====')
# list recent new util files related to on-cast
import os, glob
for p in sorted(glob.glob(r'D:\Git\MTGEDH\server\src\state\modules\*onCast*') + glob.glob(r'D:\Git\MTGEDH\server\src\state\modules\*Control*') + glob.glob(r'D:\Git\MTGEDH\rules-engine\src\*Unless*') + glob.glob(r'D:\Git\MTGEDH\rules-engine\src\*AnyPlayer*')):
  print(os.path.getsize(p), p)
# also batch7 patches for gain control / mutated
for p in sorted(glob.glob(r'D:\Git\MTGEDH\_patch_batch7*.py')):
  print('patch', os.path.getsize(p), p)

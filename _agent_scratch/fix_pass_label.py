import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once, write_text

# Fix dock Pass label to ASCII to avoid Windows encoding corruption
dock = Path(r'D:\Git\MTGEDH\client\src\components\MobileActionDock.tsx')
t = dock.read_text(encoding='utf-8')
# Replace any corrupted Pass label ternary
import re
t2, n = re.subn(
    r"label=\{highlightPass \? '[^']*' : 'Pass'\}",
    "label={highlightPass ? 'Pass *' : 'Pass'}",
    t,
    count=1,
)
if n != 1:
    raise SystemExit(f'dock label replace count={n}')
write_text(dock, t2)

# Fix stack sheet Pass footer similarly
sheets = Path(r'D:\Git\MTGEDH\client\src\components\MobilePlaySheets.tsx')
st = sheets.read_text(encoding='utf-8')
st2 = st
# Replace Pass with checkmark variants in button children
st2, n2 = re.subn(r">\s*Pass[^\n<]*\s*<", ">Pass *<", st2, count=1)
if n2 != 1:
    # try find line
    for i,line in enumerate(st.splitlines()):
        if 'Pass' in line and ('button' not in line) and ('onPass' not in line) and ('PassPriority' not in line):
            print('LINE', i+1, repr(line))
    raise SystemExit(f'sheets pass replace count={n2}')
write_text(sheets, st2)
print('pass labels fixed to ASCII')
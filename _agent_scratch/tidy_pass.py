from pathlib import Path
# tidy Pass button children in MobilePlaySheets
p = Path(r'D:\Git\MTGEDH\client\src\components\MobilePlaySheets.tsx')
raw = p.read_bytes()
eol = b'\r\n' if b'\r\n' in raw else b'\n'
t = raw.decode('utf-8').replace('\r\n','\n').replace('\r','\n')
old = '>\n          Pass *\n        </button>'
# current is likely '>Pass *</button>'
if '>Pass *</button>' in t:
    t = t.replace('>Pass *</button>', '>\n          Pass *\n        </button>', 1)
    p.write_bytes(t.encode('utf-8').replace(b'\n', eol))
    print('tidied pass button')
else:
    print('already tidy or different')
    for i,l in enumerate(t.splitlines()):
        if 'Pass *' in l:
            print(i+1, repr(l))
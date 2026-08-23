from pathlib import Path

p = Path(r'rules-engine/src/oracleIRParserSimpleActionClauses.ts')
t = p.read_text(encoding='utf-8')

# In TS source, RegExp template uses \\s (two chars: \ and \ then s? Actually file bytes are \\s = backslash backslash s)
# Find gainControl duration alternation with double-escaped backslashes as stored in file.
old_alt = "until\\\\s+end\\\\s+of\\\\s+turn|for\\\\s+as\\\\s+long\\\\s+as\\\\s+that\\\\s+aura"
new_alt = "until\\\\s+end\\\\s+of\\\\s+turn|during\\\\s+that\\\\s+(?:player|opponent)['\\\\u2019]?s\\\\s+next\\\\s+turn|for\\\\s+as\\\\s+long\\\\s+as\\\\s+that\\\\s+aura"

# Verify what's actually in the file near gainControl
idx = t.find('const gainControl = clause.match')
snippet = t[idx:idx+700]
# Locate the until...aura segment in the snippet
key = 'until'
k = snippet.find(key)
print('SNIP:', repr(snippet[k:k+160]))

# Build old_alt from actual file content
# From previous probe: until\\\\s+end... in Python repr means the string has \\s (two backslashes)
# In a normal Python raw approach: the file contains characters: u n t i l \ \ s ...
actual_old = None
for candidate in [
    r"until\\s+end\\s+of\\s+turn|for\\s+as\\s+long\\s+as\\s+that\\s+aura",  # one escape level in python = \\ in file? 
]:
    pass

# Direct: read bytes around until near gainControl
abs_k = idx + k
actual = t[abs_k:abs_k+120]
print('ACTUAL repr:', repr(actual))

# Replace using exact actual prefix
marker = actual.split('|for')[0]  # until...turn
print('MARKER:', repr(marker))
if marker + '|for\\\\s+as\\\\s+long\\\\s+as\\\\s+that\\\\s+aura' in t or True:
    # Use exact string from file
    old = "until\\\\s+end\\\\s+of\\\\s+turn|for\\\\s+as\\\\s+long\\\\s+as\\\\s+that\\\\s+aura"
    # Wait - in Python source code above, \\\\ means two backslashes in the Python string.
    # File has two backslashes before s. So we need Python string with two backslashes = '\\\\s' in source.
    pass

# Simplest approach: character-by-character from ACTUAL
old_from_file = actual[: actual.find('|for') + len('|for')] 
# Better: find unique longer string
start = t.find("gain(?:s)?\\\\s+control\\\\s+of\\\\s+(.+?)(?:\\\\s+(", idx)
print('start', start)
if start < 0:
    start = t.find("gain(?:s)?\\s+control", idx)
    print('alt start', start, repr(t[start:start+80]))

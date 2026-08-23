from pathlib import Path

p = Path(r'rules-engine/src/oracleIRParserSimpleActionClauses.ts')
t = p.read_text(encoding='utf-8')

# File stores RegExp template with doubled backslashes: \\s
old_alt = "until\\\\s+end\\\\s+of\\\\s+turn|for\\\\s+as\\\\s+long\\\\s+as\\\\s+that\\\\s+aura"
new_alt = (
    "until\\\\s+end\\\\s+of\\\\s+turn|"
    "during\\\\s+that\\\\s+(?:player|opponent)['\\\\u2019]?s\\\\s+next\\\\s+turn|"
    "for\\\\s+as\\\\s+long\\\\s+as\\\\s+that\\\\s+aura"
)
count = t.count(old_alt)
print('old_alt count', count)
if count < 1:
    raise SystemExit('old_alt not found')
# Only replace the gainControl one — first occurrence after const gainControl
idx = t.find('const gainControl = clause.match')
if idx < 0:
    raise SystemExit('gainControl missing')
pos = t.find(old_alt, idx)
if pos < 0 or pos > idx + 800:
    raise SystemExit(f'old_alt not near gainControl: {pos}')
t = t[:pos] + new_alt + t[pos + len(old_alt):]
print('regex alt patched at', pos)

# Duration assignment
old_dur = """      const durationRaw = String(gainControl[3] || '').trim().toLowerCase();
      const duration = /until\\s+end\\s+of\\s+turn/i.test(durationRaw)
        ? 'until_end_of_turn'
        : /aura\\s+is\\s+attached/i.test(durationRaw)
          ? 'as_long_as_attached'
          : /as\\s+long\\s+as\\s+you\\s+control/i.test(durationRaw)
            ? 'as_long_as_control_source'
            : 'indefinite';"""
new_dur = """      const durationRaw = String(gainControl[3] || '').trim().toLowerCase();
      const duration = /until\\s+end\\s+of\\s+turn/i.test(durationRaw)
        ? 'until_end_of_turn'
        : /during\\s+that\\s+(?:player|opponent)['\\u2019]?s\\s+next\\s+turn/i.test(durationRaw)
          ? 'during_that_players_next_turn'
          : /aura\\s+is\\s+attached/i.test(durationRaw)
            ? 'as_long_as_attached'
            : /as\\s+long\\s+as\\s+you\\s+control/i.test(durationRaw)
              ? 'as_long_as_control_source'
              : 'indefinite';"""
if old_dur not in t:
    # show nearby
    didx = t.find('const durationRaw = String(gainControl')
    print('NEAR DUR:', repr(t[didx:didx+350]))
    raise SystemExit('duration assignment missing')
t = t.replace(old_dur, new_dur, 1)
print('duration assignment patched')

# take_extra_turn after-that-turn variant
old_tet = """    const takeExtraTurn = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:take|takes)\\s+an?\\s+extra\\s+turn\\s+after\\s+this\\s+one\\b`, 'i')
    );
    if (takeExtraTurn) {
      return withMeta({
        kind: 'take_extra_turn',
        who: parsePlayerSelector(takeExtraTurn[1]),
        raw: rawClause,
        });
    }"""
new_tet = """    const afterThatTurnExtra = clause.match(
      /^after\\s+that\\s+turn,?\\s+(that\\s+player|that\\s+opponent|they)\\s+takes?\\s+an?\\s+extra\\s+turn\\b/i
    );
    if (afterThatTurnExtra) {
      return withMeta({
        kind: 'take_extra_turn',
        who: parsePlayerSelector(String(afterThatTurnExtra[1] || 'that player').trim()),
        raw: rawClause,
      });
    }

    const takeExtraTurn = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:take|takes)\\s+an?\\s+extra\\s+turn(?:\\s+after\\s+this\\s+one)?\\b`, 'i')
    );
    if (takeExtraTurn) {
      return withMeta({
        kind: 'take_extra_turn',
        who: parsePlayerSelector(takeExtraTurn[1]),
        raw: rawClause,
        });
    }"""
# File may use doubled backslashes in the RegExp template
if old_tet not in t:
    # try doubled form
    old_tet2 = old_tet.replace("\\s", "\\\\s").replace("\\b", "\\\\b").replace("\\d", "\\\\d")
    # That over-doubles. Build from file.
    tidx = t.find('const takeExtraTurn = clause.match')
    print('takeExtraTurn idx', tidx)
    print(repr(t[tidx:tidx+280]))
    raise SystemExit('takeExtraTurn block missing')
t = t.replace(old_tet, new_tet, 1)
print('take_extra_turn patched')

p.write_text(t, encoding='utf-8')
print('OK')

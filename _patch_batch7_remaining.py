from pathlib import Path
md = Path(r'D:/Git/MTGEDH/tools/on-cast-trigger-coverage.md')
text = md.read_text(encoding='utf-8')
idx = text.find('~~**Lashweed Lurker**~~')
if idx < 0:
    raise SystemExit('lashweed strike missing')
eol = text.find('\n', idx)
insert = (
    '\n\nNamed retest priorities 1-8 are cleared. Remaining paper on-cast gaps are mostly cluster-level: '
    '**Brain Gorgers** any-player sacrifice tax UX; targeted Obligator/Flayer/Beast gain-control prompts; '
    'Dash Hopes / Temporal Extortion / Phantasmagorian any-player payment windows; '
    'Mutated Cultist remove-counters cost-reduce.'
)
if 'Named retest priorities 1-8 are cleared' not in text:
    text = text[:eol] + insert + text[eol:]
    md.write_text(text, encoding='utf-8')
    print('remaining gaps note added')
else:
    print('already noted')

import pathlib, re
root = pathlib.Path(r'D:/Git/MTGEDH/rules-engine/src')
pats = [
    r"unless_sacrif",
    r"kind: 'unless_",
    r"unless_pays",
    r"choose_from",
    r"from_hand",
    r"hand_choose",
    r"look_choose",
    r"select_cards",
    r"choose.*mana value",
    r"discard those",
]
for p in sorted(root.glob('*.ts')):
    text = p.read_text(encoding='utf-8', errors='replace')
    for i, line in enumerate(text.splitlines(), 1):
        if any(re.search(pat, line, re.I) for pat in pats):
            print(f'{p.name}:{i}:{line.strip()[:170]}')

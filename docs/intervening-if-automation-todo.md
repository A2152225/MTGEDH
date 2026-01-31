# Intervening-If Automation Todo (135)

One todo per `(best-effort)` marker in `server/src/state/modules/triggers/intervening-if.ts`.

Legend: [ ] not started, [~] in progress, [x] done, [!] blocked

## Items

### Item 1
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L1875
- Comment: // "if N or more damage was dealt to it this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+damage\s+was\s+dealt\s+to\s+it\s+this\s+turn$/i);`
- Plan: TBD

### Item 2
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L1894
- Comment: // "if any of those creatures have power or toughness equal to the chosen number" (best-effort)
- Nearby check: `if (/^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause)) {`
- Plan: TBD

### Item 3
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L1936
- Comment: // "if this creature was dealt damage this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+was\s+dealt\s+damage\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 4
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L2101
- Comment: // "if a card is exiled with it" (best-effort)
- Plan: TBD

### Item 5
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L2157
- Comment: // "if N or more cards have been exiled with this artifact" (best-effort)
- Nearby check: `const m = clause.match(`
- Plan: TBD

### Item 6
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L2206
- Comment: // Evidence path 2: linked-exile bookkeeping (best-effort).
- Nearby check: `if (/^if\s+it\s+has\s+the\s+same\s+name\s+as\s+one\s+of\s+the\s+cards\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {`
- Plan: TBD

### Item 7
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L2218
- Comment: // Spellweaver Helix-style: "if it has the same name as one of the cards exiled with this artifact" (best-effort)
- Nearby check: `if (/^if\s+it\s+has\s+the\s+same\s+name\s+as\s+one\s+of\s+the\s+cards\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {`
- Plan: TBD

### Item 8
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L2303
- Comment: // "if this creature attacked or blocked this combat" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+attacked\s+or\s+blocked\s+this\s+combat$/i.test(clause)) {`
- Plan: TBD

### Item 9
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L2326
- Comment: // Graveyard-order templates (best-effort). Assumes graveyard arrays append new cards (top is end).
- Nearby check: `if (/^if\s+this\s+card\s+is\s+in\s+your\s+graveyard\s+and\s+it'?s\s+your\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 10
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L3618
- Comment: // "if this creature didn't attack this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+did\s+not\s+attack\s+this\s+turn$/i.test(clause) || /^if\s+this\s+creature\s+didn't\s+attack\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 11
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L3625
- Comment: // "if this creature attacked this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+attacked\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 12
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L3680
- Comment: // "if it's at least one of the chosen colors" (best-effort)
- Nearby check: `if (/^if\s+it'?s\s+at\s+least\s+one\s+of\s+the\s+chosen\s+colors$/i.test(clause)) {`
- Plan: TBD

### Item 13
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L3709
- Comment: // "if this creature attacked or blocked this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+attacked\s+or\s+blocked\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 14
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L3735
- Comment: // "if this Vehicle attacked or blocked this combat" (best-effort)
- Nearby check: `if (/^if\s+this\s+vehicle\s+attacked\s+or\s+blocked\s+this\s+combat$/i.test(clause)) {`
- Plan: TBD

### Item 15
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4117
- Comment: // "if it entered from your graveyard or you cast it from your graveyard" (best-effort)
- Nearby check: `if (/^if\s+it\s+entered\s+from\s+your\s+graveyard\s+or\s+you\s+cast\s+it\s+from\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 16
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4131
- Comment: // "if it was cast from your graveyard" / "if this spell was cast from your graveyard" (best-effort)
- Nearby check: `if (/^if\s+(?:it|this\s+spell)\s+was\s+cast\s+from\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 17
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4257
- Comment: // "if this creature wasn't kicked" / "if this creature was not kicked" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+was\s+not\s+kicked$/i.test(clause) || /^if\s+this\s+creature\s+wasn'?t\s+kicked$/i.test(clause)) {`
- Plan: TBD

### Item 18
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4272
- Comment: // "if it was bargained" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+bargained$/i.test(clause)) {`
- Plan: TBD

### Item 19
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4279
- Comment: // "if it was cast" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+cast$/i.test(clause)) {`
- Plan: TBD

### Item 20
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4959
- Comment: // "if all nonland permanents you control are white" (best-effort)
- Nearby check: `if (/^if\s+all\s+nonland\s+permanents\s+you\s+control\s+are\s+white$/i.test(clause)) {`
- Plan: TBD

### Item 21
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6130
- Comment: // "if you've cast a spell with mana value N or greater this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+you'?ve\s+cast\s+a\s+spell\s+with\s+mana\s+value\s+([a-z0-9]+)\s+or\s+greater\s+this\s+turn$/i);`
- Plan: TBD

### Item 22
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6147
- Comment: // "if you've played a land or cast a spell this turn from anywhere other than your hand" (best-effort)
- Nearby check: `if (/^if\s+you\s+cast\s+them$/i.test(clause)) {`
- Plan: TBD

### Item 23
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6263
- Comment: // "if you have four token counters" (best-effort)
- Nearby check: `if (/^if\s+you\s+have\s+four\s+token\s+counters$/i.test(clause)) {`
- Plan: TBD

### Item 24
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6270
- Comment: // "if you haven't added mana with this ability this turn" (best-effort)
- Nearby check: `if (/^if\s+you\s+haven'?t\s+added\s+mana\s+with\s+this\s+ability\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 25
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6289
- Comment: // "if you planeswalked to Unyaro this turn" (best-effort)
- Nearby check: `if (/^if\s+you\s+planeswalked\s+to\s+unyaro\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 26
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6303
- Comment: // "if two or more players have lost the game" (best-effort)
- Nearby check: `if (/^if\s+two\s+or\s+more\s+players\s+have\s+lost\s+the\s+game$/i.test(clause)) {`
- Plan: TBD

### Item 27
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6325
- Comment: // "if your opponents control no permanents with bounty counters on them" (best-effort)
- Nearby check: `if (/^if\s+your\s+opponents\s+control\s+no\s+permanents\s+with\s+bounty\s+counters\s+on\s+them$/i.test(clause)) {`
- Plan: TBD

### Item 28
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6351
- Comment: // "if there are no nonbasic land cards in your library" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+no\s+nonbasic\s+land\s+cards\s+in\s+your\s+library$/i.test(clause)) {`
- Plan: TBD

### Item 29
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6370
- Comment: // "if there are five colors among permanents you control" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+five\s+colors\s+among\s+permanents\s+you\s+control$/i.test(clause)) {`
- Plan: TBD

### Item 30
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6393
- Comment: // "if there are five or more mana values among cards in your graveyard" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+five\s+or\s+more\s+mana\s+values\s+among\s+cards\s+in\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 31
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6411
- Comment: // "if Rasputin started the turn untapped" (best-effort)
- Nearby check: `if (/^if\s+rasputin\s+started\s+the\s+turn\s+untapped$/i.test(clause)) {`
- Plan: TBD

### Item 32
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6422
- Comment: // "if there are one or more oil counters on Glistening Extractor" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+one\s+or\s+more\s+oil\s+counters\s+on\s+glistening\s+extractor$/i.test(clause)) {`
- Plan: TBD

### Item 33
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6725
- Comment: // "if defending player controls more lands than you" (best-effort)
- Nearby check: `if (/^if\s+defending\s+player\s+controls\s+more\s+lands\s+than\s+you$/i.test(clause)) {`
- Plan: TBD

### Item 34
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6734
- Comment: // "if defending player controls no Walls" (best-effort)
- Nearby check: `if (/^if\s+defending\s+player\s+controls\s+no\s+walls$/i.test(clause)) {`
- Plan: TBD

### Item 35
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6741
- Comment: // "if defending player has more cards in hand than you" (best-effort)
- Nearby check: `if (/^if\s+defending\s+player\s+has\s+more\s+cards\s+in\s+hand\s+than\s+you$/i.test(clause)) {`
- Plan: TBD

### Item 36
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6748
- Comment: // "if defending player has N or fewer cards in hand" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+defending\s+player\s+has\s+([a-z0-9]+)\s+or\s+fewer\s+cards\s+in\s+hand$/i);`
- Plan: TBD

### Item 37
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6760
- Comment: // "if defending player is poisoned" (best-effort)
- Nearby check: `if (/^if\s+defending\s+player\s+is\s+poisoned$/i.test(clause)) {`
- Plan: TBD

### Item 38
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6767
- Comment: // "if defending player controls no Glimmer creatures" (best-effort)
- Nearby check: `if (/^if\s+defending\s+player\s+controls\s+no\s+glimmer\s+creatures$/i.test(clause)) {`
- Plan: TBD

### Item 39
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6828
- Comment: // "if you put a counter on a creature this turn" (best-effort)
- Nearby check: `if (/^if\s+you\s+put\s+a\s+counter\s+on\s+a\s+creature\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 40
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6862
- Comment: // "if you sacrificed N or more Clues this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+you\s+sacrificed\s+([a-z0-9]+)\s+or\s+more\s+clues\s+this\s+turn$/i);`
- Plan: TBD

### Item 41
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6972
- Comment: // "if that creature was a Horror" (best-effort)
- Nearby check: `if (/^if\s+that\s+creature\s+was\s+a\s+horror$/i.test(clause)) {`
- Plan: TBD

### Item 42
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6983
- Comment: // "if that card is on the battlefield" / "if that card is still exiled" (best-effort)
- Nearby check: `if (/^if\s+that\s+card\s+is\s+on\s+the\s+battlefield$/i.test(clause) || /^if\s+that\s+card\s+is\s+still\s+exiled$/i.test(clause)) {`
- Plan: TBD

### Item 43
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7005
- Comment: // "if that player controls a Plains" (best-effort)
- Nearby check: `if (/^if\s+that\s+player\s+controls\s+a\s+plains$/i.test(clause)) {`
- Plan: TBD

### Item 44
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7012
- Comment: // "if that player didn't cast a spell this turn" (best-effort)
- Nearby check: `if (/^if\s+that\s+player\s+didn'?t\s+cast\s+a\s+spell\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 45
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7021
- Comment: // "if that player didn't cast a creature spell this turn" (best-effort)
- Nearby check: `if (/^if\s+that\s+player\s+didn'?t\s+cast\s+a\s+creature\s+spell\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 46
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7034
- Comment: // "if that opponent has more life than another of your opponents" (best-effort)
- Nearby check: `if (/^if\s+that\s+opponent\s+has\s+more\s+life\s+than\s+another\s+of\s+your\s+opponents$/i.test(clause)) {`
- Plan: TBD

### Item 47
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7049
- Comment: // "if that player has less than half their starting life total" (best-effort)
- Nearby check: `if (/^if\s+that\s+player\s+has\s+less\s+than\s+half\s+their\s+starting\s+life\s+total$/i.test(clause)) {`
- Plan: TBD

### Item 48
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7065
- Comment: // "if that spell's mana cost or that ability's activation cost contains {X}" (best-effort)
- Nearby check: `if (/^if\s+that\s+spell'?s\s+mana\s+cost\s+or\s+that\s+ability'?s\s+activation\s+cost\s+contains\s+\{x\}$/i.test(clause)) {`
- Plan: TBD

### Item 49
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7078
- Comment: // "if one or more players being attacked are poisoned" (best-effort)
- Nearby check: `if (/^if\s+one\s+or\s+more\s+players\s+being\s+attacked\s+are\s+poisoned$/i.test(clause)) {`
- Plan: TBD

### Item 50
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7091
- Comment: // "if you attacked with exactly one other creature this combat" (best-effort)
- Nearby check: `if (/^if\s+you\s+attacked\s+with\s+exactly\s+one\s+other\s+creature\s+this\s+combat$/i.test(clause)) {`
- Plan: TBD

### Item 51
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7144
- Comment: // "if this creature is monstrous" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+is\s+monstrous$/i.test(clause)) {`
- Plan: TBD

### Item 52
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7158
- Comment: // "if this creature regenerated this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+regenerated\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 53
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7169
- Comment: // "if this creature is suspected" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+is\s+suspected$/i.test(clause)) {`
- Plan: TBD

### Item 54
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7183
- Comment: // "if it's not suspected" (best-effort)
- Nearby check: `if (/^if\s+it'?s\s+not\s+suspected$/i.test(clause)) {`
- Plan: TBD

### Item 55
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7194
- Comment: // "if a creature or planeswalker an opponent controlled was dealt excess damage this turn" (best-effort)
- Nearby check: `if (/^if\s+a\s+creature\s+or\s+planeswalker\s+an\s+opponent\s+controlled\s+was\s+dealt\s+excess\s+damage\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 56
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7237
- Comment: // Counters-based artifacts (best-effort)
- Nearby check: `if (/^if\s+this\s+artifact\s+has\s+loyalty\s+counters\s+on\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 57
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7295
- Comment: // "if this card is exiled with an <counter> counter on it" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+this\s+card\s+is\s+exiled\s+with\s+an?\s+([a-z\-]+)\s+counter\s+on\s+it$/i);`
- Plan: TBD

### Item 58
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7310
- Comment: // "if three or more cards have been exiled with this artifact" (best-effort)
- Nearby check: `if (/^if\s+three\s+or\s+more\s+cards\s+have\s+been\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {`
- Plan: TBD

### Item 59
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7329
- Comment: // "if there are N or more cards exiled with <Name>" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+cards\s+exiled\s+with\s+(.+)$/i);`
- Plan: TBD

### Item 60
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7360
- Comment: // "if <Name> attacked this combat" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+attacked\s+this\s+combat$/i);`
- Plan: TBD

### Item 61
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7382
- Comment: // "if <Name> dealt damage to another creature this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+dealt\s+damage\s+to\s+another\s+creature\s+this\s+turn$/i);`
- Plan: TBD

### Item 62
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7416
- Comment: // "if this creature didn't enter the battlefield this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+didn'?t\s+enter\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 63
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7427
- Comment: // "if this creature didn't attack or come under your control this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+didn'?t\s+attack\s+or\s+come\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 64
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7462
- Comment: // "if a creature died under an opponent's control this turn" (best-effort)
- Nearby check: `if (/^if\s+a\s+creature\s+died\s+under\s+an\s+opponent's\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 65
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7483
- Comment: // "if a/an/another <Subtype> died under your control this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(?:another\s+)?an?\s+([a-z\-]+)\s+died\s+under\s+your\s+control\s+this\s+turn$/i);`
- Plan: TBD

### Item 66
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7495
- Comment: // "if <Name> entered this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+entered\s+this\s+turn$/i);`
- Plan: TBD

### Item 67
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7513
- Comment: // "if <Name> has counters on it" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+has\s+counters\s+on\s+it$/i);`
- Plan: TBD

### Item 68
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7536
- Comment: // "if he/she/it was cast" and "if this <thing> was cast" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(?:he|she|it|this\s+(?:spell|creature|card))\s+was\s+cast$/i);`
- Plan: TBD

### Item 69
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7550
- Comment: // "if <Name> is a creature" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+is\s+a\s+creature$/i);`
- Plan: TBD

### Item 70
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7568
- Comment: // "if <Name> is in exile with an <counter> counter on it" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+is\s+in\s+exile\s+with\s+an?\s+([a-z\-]+)\s+counter\s+on\s+it$/i);`
- Plan: TBD

### Item 71
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7596
- Comment: // "if it had a counter on it" (best-effort)
- Nearby check: `if (/^if\s+it\s+had\s+a\s+counter\s+on\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 72
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7622
- Comment: // "if it didn't die" (best-effort)
- Nearby check: `if (/^if\s+it\s+didn'?t\s+die$/i.test(clause)) {`
- Plan: TBD

### Item 73
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7632
- Comment: // "if it wasn't sacrificed" (best-effort)
- Nearby check: `if (/^if\s+it\s+wasn'?t\s+sacrificed$/i.test(clause)) {`
- Plan: TBD

### Item 74
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7641
- Comment: // "if equipped creature didn't deal combat damage to a creature this turn" (best-effort)
- Nearby check: `if (/^if\s+equipped\s+creature\s+didn'?t\s+deal\s+combat\s+damage\s+to\s+a\s+creature\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 75
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7658
- Comment: // "if it has the same name as one of the cards exiled with this artifact" (best-effort)
- Nearby check: `if (/^if\s+it\s+has\s+the\s+same\s+name\s+as\s+one\s+of\s+the\s+cards\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {`
- Plan: TBD

### Item 76
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7690
- Comment: // "if Ring Out is in your library" (best-effort)
- Nearby check: `if (/^if\s+ring\s+out\s+is\s+in\s+your\s+library$/i.test(clause)) {`
- Plan: TBD

### Item 77
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7710
- Comment: // "if a counter was put on <Name> this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+a\s+counter\s+was\s+put\s+on\s+(.+?)\s+this\s+turn$/i);`
- Plan: TBD

### Item 78
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7752
- Comment: // "if an Aura you controlled was attached to it" (best-effort)
- Nearby check: `if (/^if\s+an\s+aura\s+you\s+controlled\s+was\s+attached\s+to\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 79
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7782
- Comment: // "if it targets a creature you control with the chosen name" (best-effort)
- Nearby check: `if (/^if\s+it\s+targets\s+a\s+creature\s+you\s+control\s+with\s+the\s+chosen\s+name$/i.test(clause)) {`
- Plan: TBD

### Item 80
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7817
- Comment: // "if it targets one or more other permanents you control" (best-effort)
- Nearby check: `if (/^if\s+it\s+targets\s+one\s+or\s+more\s+other\s+permanents\s+you\s+control$/i.test(clause)) {`
- Plan: TBD

### Item 81
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7843
- Comment: // "if it was attacking or blocking alone" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+attacking\s+or\s+blocking\s+alone$/i.test(clause)) {`
- Plan: TBD

### Item 82
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7866
- Comment: // "if it shares a creature type with <Name>" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+it\s+shares\s+a\s+creature\s+type\s+with\s+(.+)$/i);`
- Plan: TBD

### Item 83
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7908
- Comment: // "if any of those creatures have power or toughness equal to the chosen number" (best-effort)
- Nearby check: `if (/^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause)) {`
- Plan: TBD

### Item 84
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7932
- Comment: // "if it enlisted a creature this combat" (best-effort)
- Nearby check: `if (/^if\s+it\s+enlisted\s+a\s+creature\s+this\s+combat$/i.test(clause)) {`
- Plan: TBD

### Item 85
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7942
- Comment: // "if an Assassin crewed it this turn" (best-effort)
- Nearby check: `if (/^if\s+an\s+assassin\s+crewed\s+it\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 86
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7954
- Comment: // "if it was crewed by exactly two creatures" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+crewed\s+by\s+exactly\s+two\s+creatures$/i.test(clause)) {`
- Plan: TBD

### Item 87
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8304
- Comment: // "if it wasn't blocking" (best-effort)
- Nearby check: `if (/^if\s+it\s+wasn't\s+blocking$/i.test(clause) || /^if\s+it\s+was\s+not\s+blocking$/i.test(clause)) {`
- Plan: TBD

### Item 88
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8310
- Comment: // "if it isn't being declared as an attacker" (best-effort)
- Nearby check: `if (/^if\s+it\s+isn't\s+being\s+declared\s+as\s+an\s+attacker$/i.test(clause)) {`
- Plan: TBD

### Item 89
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8316
- Comment: // "if it was enchanted or equipped" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+enchanted\s+or\s+equipped$/i.test(clause)) {`
- Plan: TBD

### Item 90
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8322
- Comment: // "if it was enchanted" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+enchanted$/i.test(clause)) {`
- Plan: TBD

### Item 91
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8328
- Comment: // "if it was equipped" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+equipped$/i.test(clause)) {`
- Plan: TBD

### Item 92
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8440
- Comment: // "if a/an/another <type> entered the battlefield under your control this turn" (best-effort)
- Nearby check: `const m = clause.match(`
- Plan: TBD

### Item 93
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8455
- Comment: // "if N or more artifacts/creatures entered the battlefield under your control this turn" (best-effort)
- Nearby check: `const m = clause.match(`
- Plan: TBD

### Item 94
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8483
- Comment: // "if no creatures entered the battlefield under your control this turn" (best-effort)
- Nearby check: `if (/^if\s+no\s+creatures\s+entered\s+(?:the\s+)?battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 95
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8511
- Comment: // "if creatures you control have total toughness N or greater" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+creatures\s+you\s+control\s+have\s+total\s+toughness\s+([a-z0-9]+)\s+or\s+greater$/i);`
- Plan: TBD

### Item 96
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8831
- Comment: // "if evidence was collected" (best-effort)
- Nearby check: `if (/^if\s+evidence\s+was\s+collected$/i.test(clause)) {`
- Plan: TBD

### Item 97
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8858
- Comment: // "if its prowl cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+prowl\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: TBD

### Item 98
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8880
- Comment: // "if its surge cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+surge\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: TBD

### Item 99
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8902
- Comment: // "if its madness cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+madness\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: TBD

### Item 100
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8924
- Comment: // "if its spectacle cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+spectacle\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: TBD

### Item 101
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8970
- Comment: // Inga and Esika-style: "if three or more mana from creatures was spent to cast it" (best-effort)
- Nearby check: `if (/^if\s+three\s+or\s+more\s+mana\s+from\s+creatures\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 102
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8998
- Comment: // "if its additional cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+additional\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: TBD

### Item 103
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9012
- Comment: // "if at least three mana of the same color was spent to cast it" (best-effort)
- Nearby check: `if (/^if\s+at\s+least\s+three\s+mana\s+of\s+the\s+same\s+color\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 104
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9033
- Comment: // "if {S} of any of that spell's colors was spent to cast it" (best-effort)
- Nearby check: `if (/^if\s+\{s\}\s+of\s+any\s+of\s+that\s+spell'?s\s+colors\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 105
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9588
- Comment: // Generic "a face-down creature entered ..." (best-effort)
- Nearby check: `if (/^if\s+a\s+face-down\s+creature\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 106
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9731
- Comment: // Damage-to-player turn tracking (best-effort).
- Nearby check: `const mOppN = clause.match(/^if\s+an\s+opponent\s+was\s+dealt\s+([a-z0-9]+)\s+or\s+more\s+damage\s+this\s+turn$/i);`
- Plan: TBD

### Item 107
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10222
- Comment: // "this creature/enchantment is on the battlefield" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+is\s+on\s+the\s+battlefield$/i.test(clause)) {`
- Plan: TBD

### Item 108
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10451
- Comment: // "if you both own and control <X> and a creature named <Y>" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+you\s+both\s+own\s+and\s+control\s+(this\s+creature|[a-z0-9][a-z0-9'â€™\- ]+)\s+and\s+a\s+creature\s+named\s+(.+)$/i);`
- Plan: TBD

### Item 109
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10752
- Comment: // "if its power was different from its base power" (best-effort)
- Nearby check: `if (/^if\s+its\s+power\s+was\s+different\s+from\s+its\s+base\s+power$/i.test(clause)) {`
- Plan: TBD

### Item 110
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10763
- Comment: // "if its toughness was less than 1" (best-effort)
- Nearby check: `if (/^if\s+its\s+toughness\s+was\s+less\s+than\s+1$/i.test(clause)) {`
- Plan: TBD

### Item 111
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10773
- Comment: // "if it's on the battlefield and you control 9 or fewer creatures named \"Name Sticker\" Goblin" (best-effort)
- Nearby check: `if (/^if\s+it'?s\s+on\s+the\s+battlefield\s+and\s+you\s+control\s+9\s+or\s+fewer\s+creatures\s+named\s+"name\s+sticker"\s+goblin$/i.test(clause)) {`
- Plan: TBD

### Item 112
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10788
- Comment: // "if its mana value is equal to 1 plus the number of soul counters on this enchantment" (best-effort)
- Nearby check: `if (/^if\s+its\s+mana\s+value\s+is\s+equal\s+to\s+1\s+plus\s+the\s+number\s+of\s+soul\s+counters\s+on\s+this\s+enchantment$/i.test(clause)) {`
- Plan: TBD

### Item 113
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10810
- Comment: // --- Remaining hard / card-specific / replacement-effect templates (best-effort) ---
- Nearby check: `if (/^if\s+you\s+would\s+draw\s+a\s+card$/i.test(clause)) {`
- Plan: TBD

### Item 114
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10989
- Comment: // "if at least one other Wall creature is blocking that creature and no non-Wall creatures are blocking that creature" (best-effort)
- Nearby check: `if (/^if\s+at\s+least\s+one\s+other\s+wall\s+creature\s+is\s+blocking\s+that\s+creature\s+and\s+no\s+non-wall\s+creatures\s+are\s+blocking\s+that\s+creature$/i.test(clause)) {`
- Plan: TBD

### Item 115
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11035
- Comment: // "if it doesn't share a keyword or ability word with a permanent you control or a card in your graveyard" (best-effort)
- Nearby check: `if (/^if\s+it\s+doesn'?t\s+share\s+a\s+keyword\s+or\s+ability\s+word\s+with\s+a\s+permanent\s+you\s+control\s+or\s+a\s+card\s+in\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 116
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11041
- Comment: // "if it shares a mana value with one or more uncrossed digits in the chosen number" (best-effort)
- Nearby check: `if (/^if\s+it\s+shares\s+a\s+mana\s+value\s+with\s+one\s+or\s+more\s+uncrossed\s+digits\s+in\s+the\s+chosen\s+number$/i.test(clause)) {`
- Plan: TBD

### Item 117
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11069
- Comment: // "if its power is greater than this creature's power or its toughness is greater than this creature's toughness" (best-effort)
- Nearby check: `if (/^if\s+its\s+power\s+is\s+greater\s+than\s+this\s+creature'?s\s+power\s+or\s+its\s+toughness\s+is\s+greater\s+than\s+this\s+creature'?s\s+toughness$/i.test(clause)) {`
- Plan: TBD

### Item 118
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11083
- Comment: // "if more lands entered the battlefield under your control this turn than an opponent had enter during their last turn" (best-effort)
- Nearby check: `if (/^if\s+more\s+lands\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn\s+than\s+an\s+opponent\s+had\s+enter\s+during\s+their\s+last\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 119
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11367
- Comment: // "if you control the artifact with the greatest mana value or tied for the greatest mana value" (best-effort)
- Nearby check: `if (/^if\s+you\s+control\s+the\s+artifact\s+with\s+the\s+greatest\s+mana\s+value\s+or\s+tied\s+for\s+the\s+greatest\s+mana\s+value$/i.test(clause)) {`
- Plan: TBD

### Item 120
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11386
- Comment: // "if you had another creature enter the battlefield under your control last turn" (best-effort)
- Nearby check: `if (/^if\s+you\s+had\s+another\s+creature\s+enter\s+the\s+battlefield\s+under\s+your\s+control\s+last\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 121
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11429
- Comment: // "if the number of attacking creatures is greater than the number of quest counters on ED-E" (best-effort)
- Nearby check: `if (/^if\s+the\s+number\s+of\s+attacking\s+creatures\s+is\s+greater\s+than\s+the\s+number\s+of\s+quest\s+counters\s+on\s+ed-e$/i.test(clause)) {`
- Plan: TBD


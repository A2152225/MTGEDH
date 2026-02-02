# Intervening-If Automation Todo (135)

One todo per `(best-effort)` marker in `server/src/state/modules/triggers/intervening-if.ts`.

Legend: [ ] not started, [~] in progress, [x] done, [!] blocked

## Items

### Item 1
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L1905
- Comment: // "if any of those creatures have power or toughness equal to the chosen number" (best-effort)
- Nearby check: `if (/^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause)) {`
- Plan: TBD

### Item 2
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L2244
- Comment: // Spellweaver Helix-style: "if it has the same name as one of the cards exiled with this artifact" (best-effort)
- Nearby check: `if (/^if\s+it\s+has\s+the\s+same\s+name\s+as\s+one\s+of\s+the\s+cards\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {`
- Plan: TBD

### Item 3
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L2377
- Comment: // Graveyard-order templates (best-effort). Assumes graveyard arrays append new cards (top is end).
- Nearby check: `if (/^if\s+this\s+card\s+is\s+in\s+your\s+graveyard\s+and\s+it'?s\s+your\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 4
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L3742
- Comment: // "if it's at least one of the chosen colors" (best-effort)
- Nearby check: `if (/^if\s+it'?s\s+at\s+least\s+one\s+of\s+the\s+chosen\s+colors$/i.test(clause)) {`
- Plan: TBD

### Item 5
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4173
- Comment: // "if it entered from your graveyard or you cast it from your graveyard" (best-effort)
- Nearby check: `if (/^if\s+it\s+entered\s+from\s+your\s+graveyard\s+or\s+you\s+cast\s+it\s+from\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 6
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4187
- Comment: // "if it was cast from your graveyard" / "if this spell was cast from your graveyard" (best-effort)
- Nearby check: `if (/^if\s+(?:it|this\s+spell)\s+was\s+cast\s+from\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 7
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4313
- Comment: // "if this creature wasn't kicked" / "if this creature was not kicked" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+was\s+not\s+kicked$/i.test(clause) || /^if\s+this\s+creature\s+wasn'?t\s+kicked$/i.test(clause)) {`
- Plan: TBD

### Item 8
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4328
- Comment: // "if it was bargained" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+bargained$/i.test(clause)) {`
- Plan: TBD

### Item 9
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4335
- Comment: // "if it was cast" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+cast$/i.test(clause)) {`
- Plan: TBD

### Item 10
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L5015
- Comment: // "if all nonland permanents you control are white" (best-effort)
- Nearby check: `if (/^if\s+all\s+nonland\s+permanents\s+you\s+control\s+are\s+white$/i.test(clause)) {`
- Plan: TBD

### Item 11
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6324
- Comment: // "if you have four token counters" (best-effort)
- Nearby check: `if (/^if\s+you\s+have\s+four\s+token\s+counters$/i.test(clause)) {`
- Plan: TBD

### Item 12
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6331
- Comment: // "if you haven't added mana with this ability this turn" (best-effort)
- Nearby check: `if (/^if\s+you\s+haven'?t\s+added\s+mana\s+with\s+this\s+ability\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 13
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6350
- Comment: // "if you planeswalked to Unyaro this turn" (best-effort)
- Nearby check: `if (/^if\s+you\s+planeswalked\s+to\s+unyaro\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 14
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6364
- Comment: // "if two or more players have lost the game" (best-effort)
- Nearby check: `if (/^if\s+two\s+or\s+more\s+players\s+have\s+lost\s+the\s+game$/i.test(clause)) {`
- Plan: TBD

### Item 15
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6386
- Comment: // "if your opponents control no permanents with bounty counters on them" (best-effort)
- Nearby check: `if (/^if\s+your\s+opponents\s+control\s+no\s+permanents\s+with\s+bounty\s+counters\s+on\s+them$/i.test(clause)) {`
- Plan: TBD

### Item 16
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6412
- Comment: // "if there are no nonbasic land cards in your library" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+no\s+nonbasic\s+land\s+cards\s+in\s+your\s+library$/i.test(clause)) {`
- Plan: TBD

### Item 17
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6431
- Comment: // "if there are five colors among permanents you control" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+five\s+colors\s+among\s+permanents\s+you\s+control$/i.test(clause)) {`
- Plan: TBD

### Item 18
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6454
- Comment: // "if there are five or more mana values among cards in your graveyard" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+five\s+or\s+more\s+mana\s+values\s+among\s+cards\s+in\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 19
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6472
- Comment: // "if Rasputin started the turn untapped" (best-effort)
- Nearby check: `if (/^if\s+rasputin\s+started\s+the\s+turn\s+untapped$/i.test(clause)) {`
- Plan: TBD

### Item 20
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6483
- Comment: // "if there are one or more oil counters on Glistening Extractor" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+one\s+or\s+more\s+oil\s+counters\s+on\s+glistening\s+extractor$/i.test(clause)) {`
- Plan: TBD

### Item 21
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7021
- Comment: // "if that creature was a Horror" (best-effort)
- Nearby check: `if (/^if\s+that\s+creature\s+was\s+a\s+horror$/i.test(clause)) {`
- Plan: TBD

### Item 22
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7191
- Comment: // "if this creature is monstrous" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+is\s+monstrous$/i.test(clause)) {`
- Plan: TBD

### Item 23
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7205
- Comment: // "if this creature regenerated this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+regenerated\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 24
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7216
- Comment: // "if this creature is suspected" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+is\s+suspected$/i.test(clause)) {`
- Plan: TBD

### Item 25
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7230
- Comment: // "if it's not suspected" (best-effort)
- Nearby check: `if (/^if\s+it'?s\s+not\s+suspected$/i.test(clause)) {`
- Plan: TBD

### Item 26
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7241
- Comment: // "if a creature or planeswalker an opponent controlled was dealt excess damage this turn" (best-effort)
- Nearby check: `if (/^if\s+a\s+creature\s+or\s+planeswalker\s+an\s+opponent\s+controlled\s+was\s+dealt\s+excess\s+damage\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 27
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7284
- Comment: // Counters-based artifacts (best-effort)
- Nearby check: `if (/^if\s+this\s+artifact\s+has\s+loyalty\s+counters\s+on\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 28
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7342
- Comment: // "if this card is exiled with an <counter> counter on it" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+this\s+card\s+is\s+exiled\s+with\s+an?\s+([a-z\-]+)\s+counter\s+on\s+it$/i);`
- Plan: TBD

### Item 29
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7357
- Comment: // "if three or more cards have been exiled with this artifact" (best-effort)
- Nearby check: `if (/^if\s+three\s+or\s+more\s+cards\s+have\s+been\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {`
- Plan: TBD

### Item 30
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7376
- Comment: // "if there are N or more cards exiled with <Name>" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+cards\s+exiled\s+with\s+(.+)$/i);`
- Plan: TBD

### Item 31
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7432
- Comment: // "if <Name> dealt damage to another creature this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+dealt\s+damage\s+to\s+another\s+creature\s+this\s+turn$/i);`
- Plan: TBD

### Item 32
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7466
- Comment: // "if this creature didn't enter the battlefield this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+didn'?t\s+enter\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 33
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7477
- Comment: // "if this creature didn't attack or come under your control this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+didn'?t\s+attack\s+or\s+come\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 34
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7512
- Comment: // "if a creature died under an opponent's control this turn" (best-effort)
- Nearby check: `if (/^if\s+a\s+creature\s+died\s+under\s+an\s+opponent's\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 35
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7533
- Comment: // "if a/an/another <Subtype> died under your control this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(?:another\s+)?an?\s+([a-z\-]+)\s+died\s+under\s+your\s+control\s+this\s+turn$/i);`
- Plan: TBD

### Item 36
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7545
- Comment: // "if <Name> entered this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+entered\s+this\s+turn$/i);`
- Plan: TBD

### Item 37
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7563
- Comment: // "if <Name> has counters on it" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+has\s+counters\s+on\s+it$/i);`
- Plan: TBD

### Item 38
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7586
- Comment: // "if he/she/it was cast" and "if this <thing> was cast" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(?:he|she|it|this\s+(?:spell|creature|card))\s+was\s+cast$/i);`
- Plan: TBD

### Item 39
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7600
- Comment: // "if <Name> is a creature" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+is\s+a\s+creature$/i);`
- Plan: TBD

### Item 40
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7618
- Comment: // "if <Name> is in exile with an <counter> counter on it" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+is\s+in\s+exile\s+with\s+an?\s+([a-z\-]+)\s+counter\s+on\s+it$/i);`
- Plan: TBD

### Item 41
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7646
- Comment: // "if it had a counter on it" (best-effort)
- Nearby check: `if (/^if\s+it\s+had\s+a\s+counter\s+on\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 42
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7672
- Comment: // "if it didn't die" (best-effort)
- Nearby check: `if (/^if\s+it\s+didn'?t\s+die$/i.test(clause)) {`
- Plan: TBD

### Item 43
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7682
- Comment: // "if it wasn't sacrificed" (best-effort)
- Nearby check: `if (/^if\s+it\s+wasn'?t\s+sacrificed$/i.test(clause)) {`
- Plan: TBD

### Item 44
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7691
- Comment: // "if equipped creature didn't deal combat damage to a creature this turn" (best-effort)
- Nearby check: `if (/^if\s+equipped\s+creature\s+didn'?t\s+deal\s+combat\s+damage\s+to\s+a\s+creature\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 45
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7708
- Comment: // "if it has the same name as one of the cards exiled with this artifact" (best-effort)
- Nearby check: `if (/^if\s+it\s+has\s+the\s+same\s+name\s+as\s+one\s+of\s+the\s+cards\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {`
- Plan: TBD

### Item 46
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7740
- Comment: // "if Ring Out is in your library" (best-effort)
- Nearby check: `if (/^if\s+ring\s+out\s+is\s+in\s+your\s+library$/i.test(clause)) {`
- Plan: TBD

### Item 47
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7760
- Comment: // "if a counter was put on <Name> this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+a\s+counter\s+was\s+put\s+on\s+(.+?)\s+this\s+turn$/i);`
- Plan: TBD

### Item 48
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7802
- Comment: // "if an Aura you controlled was attached to it" (best-effort)
- Nearby check: `if (/^if\s+an\s+aura\s+you\s+controlled\s+was\s+attached\s+to\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 49
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7832
- Comment: // "if it targets a creature you control with the chosen name" (best-effort)
- Nearby check: `if (/^if\s+it\s+targets\s+a\s+creature\s+you\s+control\s+with\s+the\s+chosen\s+name$/i.test(clause)) {`
- Plan: TBD

### Item 50
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7867
- Comment: // "if it targets one or more other permanents you control" (best-effort)
- Nearby check: `if (/^if\s+it\s+targets\s+one\s+or\s+more\s+other\s+permanents\s+you\s+control$/i.test(clause)) {`
- Plan: TBD

### Item 51
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7893
- Comment: // "if it was attacking or blocking alone" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+attacking\s+or\s+blocking\s+alone$/i.test(clause)) {`
- Plan: TBD

### Item 52
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7916
- Comment: // "if it shares a creature type with <Name>" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+it\s+shares\s+a\s+creature\s+type\s+with\s+(.+)$/i);`
- Plan: TBD

### Item 53
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7958
- Comment: // "if any of those creatures have power or toughness equal to the chosen number" (best-effort)
- Nearby check: `if (/^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause)) {`
- Plan: TBD

### Item 54
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7982
- Comment: // "if it enlisted a creature this combat" (best-effort)
- Nearby check: `if (/^if\s+it\s+enlisted\s+a\s+creature\s+this\s+combat$/i.test(clause)) {`
- Plan: TBD

### Item 55
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7992
- Comment: // "if an Assassin crewed it this turn" (best-effort)
- Nearby check: `if (/^if\s+an\s+assassin\s+crewed\s+it\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 56
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8004
- Comment: // "if it was crewed by exactly two creatures" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+crewed\s+by\s+exactly\s+two\s+creatures$/i.test(clause)) {`
- Plan: TBD

### Item 57
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8354
- Comment: // "if it wasn't blocking" (best-effort)
- Nearby check: `if (/^if\s+it\s+wasn't\s+blocking$/i.test(clause) || /^if\s+it\s+was\s+not\s+blocking$/i.test(clause)) {`
- Plan: TBD

### Item 58
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8360
- Comment: // "if it isn't being declared as an attacker" (best-effort)
- Nearby check: `if (/^if\s+it\s+isn't\s+being\s+declared\s+as\s+an\s+attacker$/i.test(clause)) {`
- Plan: TBD

### Item 59
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8366
- Comment: // "if it was enchanted or equipped" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+enchanted\s+or\s+equipped$/i.test(clause)) {`
- Plan: TBD

### Item 60
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8372
- Comment: // "if it was enchanted" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+enchanted$/i.test(clause)) {`
- Plan: TBD

### Item 61
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8378
- Comment: // "if it was equipped" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+equipped$/i.test(clause)) {`
- Plan: TBD

### Item 62
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8490
- Comment: // "if a/an/another <type> entered the battlefield under your control this turn" (best-effort)
- Nearby check: `const m = clause.match(`
- Plan: TBD

### Item 63
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8505
- Comment: // "if N or more artifacts/creatures entered the battlefield under your control this turn" (best-effort)
- Nearby check: `const m = clause.match(`
- Plan: TBD

### Item 64
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8533
- Comment: // "if no creatures entered the battlefield under your control this turn" (best-effort)
- Nearby check: `if (/^if\s+no\s+creatures\s+entered\s+(?:the\s+)?battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 65
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8561
- Comment: // "if creatures you control have total toughness N or greater" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+creatures\s+you\s+control\s+have\s+total\s+toughness\s+([a-z0-9]+)\s+or\s+greater$/i);`
- Plan: TBD

### Item 66
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8891
- Comment: // "if evidence was collected" (best-effort)
- Nearby check: `if (/^if\s+evidence\s+was\s+collected$/i.test(clause)) {`
- Plan: TBD

### Item 67
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8918
- Comment: // "if its prowl cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+prowl\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: TBD

### Item 68
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8940
- Comment: // "if its surge cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+surge\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: TBD

### Item 69
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8962
- Comment: // "if its madness cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+madness\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: TBD

### Item 70
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8984
- Comment: // "if its spectacle cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+spectacle\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: TBD

### Item 71
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9030
- Comment: // Inga and Esika-style: "if three or more mana from creatures was spent to cast it" (best-effort)
- Nearby check: `if (/^if\s+three\s+or\s+more\s+mana\s+from\s+creatures\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 72
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9058
- Comment: // "if its additional cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+additional\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: TBD

### Item 73
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9072
- Comment: // "if at least three mana of the same color was spent to cast it" (best-effort)
- Nearby check: `if (/^if\s+at\s+least\s+three\s+mana\s+of\s+the\s+same\s+color\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 74
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9093
- Comment: // "if {S} of any of that spell's colors was spent to cast it" (best-effort)
- Nearby check: `if (/^if\s+\{s\}\s+of\s+any\s+of\s+that\s+spell'?s\s+colors\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 75
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9648
- Comment: // Generic "a face-down creature entered ..." (best-effort)
- Nearby check: `if (/^if\s+a\s+face-down\s+creature\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 76
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10285
- Comment: // "this creature/enchantment is on the battlefield" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+is\s+on\s+the\s+battlefield$/i.test(clause)) {`
- Plan: TBD

### Item 77
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10514
- Comment: // "if you both own and control <X> and a creature named <Y>" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+you\s+both\s+own\s+and\s+control\s+(this\s+creature|[a-z0-9][a-z0-9'â€™\- ]+)\s+and\s+a\s+creature\s+named\s+(.+)$/i);`
- Plan: TBD

### Item 78
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10815
- Comment: // "if its power was different from its base power" (best-effort)
- Nearby check: `if (/^if\s+its\s+power\s+was\s+different\s+from\s+its\s+base\s+power$/i.test(clause)) {`
- Plan: TBD

### Item 79
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10826
- Comment: // "if its toughness was less than 1" (best-effort)
- Nearby check: `if (/^if\s+its\s+toughness\s+was\s+less\s+than\s+1$/i.test(clause)) {`
- Plan: TBD

### Item 80
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10836
- Comment: // "if it's on the battlefield and you control 9 or fewer creatures named \"Name Sticker\" Goblin" (best-effort)
- Nearby check: `if (/^if\s+it'?s\s+on\s+the\s+battlefield\s+and\s+you\s+control\s+9\s+or\s+fewer\s+creatures\s+named\s+"name\s+sticker"\s+goblin$/i.test(clause)) {`
- Plan: TBD

### Item 81
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10851
- Comment: // "if its mana value is equal to 1 plus the number of soul counters on this enchantment" (best-effort)
- Nearby check: `if (/^if\s+its\s+mana\s+value\s+is\s+equal\s+to\s+1\s+plus\s+the\s+number\s+of\s+soul\s+counters\s+on\s+this\s+enchantment$/i.test(clause)) {`
- Plan: TBD

### Item 82
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10873
- Comment: // --- Remaining hard / card-specific / replacement-effect templates (best-effort) ---
- Nearby check: `if (/^if\s+you\s+would\s+draw\s+a\s+card$/i.test(clause)) {`
- Plan: TBD

### Item 83
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11052
- Comment: // "if at least one other Wall creature is blocking that creature and no non-Wall creatures are blocking that creature" (best-effort)
- Nearby check: `if (/^if\s+at\s+least\s+one\s+other\s+wall\s+creature\s+is\s+blocking\s+that\s+creature\s+and\s+no\s+non-wall\s+creatures\s+are\s+blocking\s+that\s+creature$/i.test(clause)) {`
- Plan: TBD

### Item 84
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11098
- Comment: // "if it doesn't share a keyword or ability word with a permanent you control or a card in your graveyard" (best-effort)
- Nearby check: `if (/^if\s+it\s+doesn'?t\s+share\s+a\s+keyword\s+or\s+ability\s+word\s+with\s+a\s+permanent\s+you\s+control\s+or\s+a\s+card\s+in\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 85
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11104
- Comment: // "if it shares a mana value with one or more uncrossed digits in the chosen number" (best-effort)
- Nearby check: `if (/^if\s+it\s+shares\s+a\s+mana\s+value\s+with\s+one\s+or\s+more\s+uncrossed\s+digits\s+in\s+the\s+chosen\s+number$/i.test(clause)) {`
- Plan: TBD

### Item 86
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11132
- Comment: // "if its power is greater than this creature's power or its toughness is greater than this creature's toughness" (best-effort)
- Nearby check: `if (/^if\s+its\s+power\s+is\s+greater\s+than\s+this\s+creature'?s\s+power\s+or\s+its\s+toughness\s+is\s+greater\s+than\s+this\s+creature'?s\s+toughness$/i.test(clause)) {`
- Plan: TBD

### Item 87
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11146
- Comment: // "if more lands entered the battlefield under your control this turn than an opponent had enter during their last turn" (best-effort)
- Nearby check: `if (/^if\s+more\s+lands\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn\s+than\s+an\s+opponent\s+had\s+enter\s+during\s+their\s+last\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 88
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11430
- Comment: // "if you control the artifact with the greatest mana value or tied for the greatest mana value" (best-effort)
- Nearby check: `if (/^if\s+you\s+control\s+the\s+artifact\s+with\s+the\s+greatest\s+mana\s+value\s+or\s+tied\s+for\s+the\s+greatest\s+mana\s+value$/i.test(clause)) {`
- Plan: TBD

### Item 89
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11449
- Comment: // "if you had another creature enter the battlefield under your control last turn" (best-effort)
- Nearby check: `if (/^if\s+you\s+had\s+another\s+creature\s+enter\s+the\s+battlefield\s+under\s+your\s+control\s+last\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 90
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11492
- Comment: // "if the number of attacking creatures is greater than the number of quest counters on ED-E" (best-effort)
- Nearby check: `if (/^if\s+the\s+number\s+of\s+attacking\s+creatures\s+is\s+greater\s+than\s+the\s+number\s+of\s+quest\s+counters\s+on\s+ed-e$/i.test(clause)) {`
- Plan: TBD


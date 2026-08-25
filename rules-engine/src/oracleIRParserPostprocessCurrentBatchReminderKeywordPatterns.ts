// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: the first slice of isCurrentBatchReminderOrPlatformOnlyText's pattern disjunction -
// keyword reminder text (saga, partner, infect, landwalk, bestow, reconfigure ...), cost-reduction
// notes, copy-without-paying reminders and deck-construction notes.
//
// The operands are byte-identical to the original chain and keep their order; the trailing `false`
// only terminates the disjunction, which cannot change a boolean result.

export function isCurrentBatchReminderKeywordPattern(normalizedText: string, normalizedModalHeader: string, isParentheticalText: boolean): boolean {
  return (
    /^as this saga enters and after your draw step, add a lore counter(?:\.\s*sacrifice after [ivxlcdm]+\.?)?$/i.test(normalizedText) ||
    /^as a saga enters, choose a chapter and start with that many lore counters(?:\.\s*sacrifice after [ivxlcdm]+\.?)?$/i.test(normalizedText) ||
    /^read ahead \(choose a chapter and start with that many lore counters(?:\.\s*sacrifice after [ivxlcdm]+\.?)?$/i.test(normalizedText) ||
    /^partner(?:\s*\(you can have two commanders if both have partner(?:\.?\s*each other)?\))?\.?$/i.test(normalizedText) ||
    /^infect(?:\s*\(this creature deals damage to creatures in the form of -1\/-1 counters and to players in the form of poison counters\))?\.?$/i.test(normalizedText) ||
    /^fear(?:\s*\(this creature can(?:not|'t) be blocked except by artifact creatures and(?:\/or)? black creatures\))?\.?$/i.test(normalizedText) ||
    /^start your engines!?\.?$/i.test(normalizedText) ||
    /^attach this permanent to target (?:creature|land) you control(?:\.\s*activate only as a sorcery\.?)?$/i.test(normalizedText) ||
    /^reconfigure\s+(?:\{[^}]+\})*(?:\s*\([^)]*\))?\.?$/i.test(normalizedText) ||
    /^(?:(?:snow\s+)?(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk|landwalk)|(?:legendary|nonbasic)\s+landwalk)(?:\s*\([^)]*\))?(?:,\s*(?:(?:snow\s+)?(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk|landwalk)|(?:legendary|nonbasic)\s+landwalk)(?:\s*\([^)]*\))?)*\.?$/i.test(normalizedText) ||
    /^aftermath(?:\s*\(cast this spell only from your graveyard\. then exile it\))?\.?$/i.test(normalizedText) ||
    /^skulk(?:\s*\(this creature can(?:not|'t) be blocked by creatures with greater power\))?\.?$/i.test(normalizedText) ||
    /^skulk$/i.test(normalizedText) ||
    /^horsemanship(?:\s*\(this creature can(?:not|'t) be blocked except by creatures with horsemanship\))?\.?$/i.test(normalizedText) ||
    /^horsemanship$/i.test(normalizedText) ||
    /^enchant (?:permanent|artifact(?: or creature)?|artifact|creature(?: you control)?|land|player)$/i.test(normalizedText) ||
    /^do this only once each turn\.?$/i.test(normalizedText) ||
    /^as a siege enters,.+$/i.test(normalizedText) ||
    /^threshold\s*[-�]\s*as long as there are (?:seven|\d+) or more cards in your graveyard,.+$/i.test(normalizedText) ||
    /^return this card transformed under its owner's control(?:\.\s*craft only as a sorcery\.?)?$/i.test(normalizedText) ||
    /^spell mastery\s*[-�]\s*if there are two or more instant and\/or sorcery cards in your graveyard,.+$/i.test(normalizedText) ||
    /^gift a card\s*\(.+$/i.test(normalizedText) ||
    /^devoid \(this card has no color\)?$/i.test(normalizedText) ||
    /^gain the next level as a sorcery to add its ability$/i.test(normalizedText) ||
    /^offspring\s+(?:\{[^}]+\})+\s*\(you may pay an additional (?:\{[^}]+\})+ as you cast this spell$/i.test(normalizedText) ||
    /^offspring\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^partner-friends forever\s*\(/i.test(normalizedText) ||
    /^enchant creature or vehicle$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each instant and sorcery card in your graveyard\.?$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each creature card in your graveyard\.?$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each creature in your party\.?\s*(?:\(|$)/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each creature on the battlefield\.?$/i.test(normalizedText) ||
    /^enchant land you control$/i.test(normalizedText) ||
    /^gift a\b/i.test(normalizedText) ||
    /^casualty \d+\b/i.test(normalizedText) ||
    /^enchant (?:creature(?: you control)?|land|player)$/i.test(normalizedText) ||
    /^ward\s*(?:\{[^}]+\}|\d+)$/i.test(normalizedText) ||
    /^ward\s*(?:-|-)\s*(?:discard|sacrifice|pay)\b.+$/i.test(normalizedText) ||
    /^a creature with hexproof can(?:not|'t) be the target of spells or abilities your opponents control$/i.test(normalizedText) ||
    /^you can(?:not|'t) be the target of spells or abilities your opponents control$/i.test(normalizedText) ||
    /^a permanent with protection can(?:not|'t) be targeted, dealt damage, or enchanted by anything with the stated quality$/i.test(normalizedText) ||
    /^a permanent with protection from everything can(?:not|'t) be targeted, dealt damage, or enchanted by anything$/i.test(normalizedText) ||
    /^commander enchantment\s*\(this aura enchants a commander creature, and remains attached to the creature as it moves between any face-up zones$/i.test(normalizedText) ||
    /^a suspected creature has menace and can(?:not|'t) block$/i.test(normalizedText) ||
    /^artifacts, legendaries, and sagas are historic$/i.test(normalizedText) ||
    /^assassins, mercenaries, pirates, rogues, and warlocks are outlaws$/i.test(normalizedText) ||
    /^each \{[wubrgc]\} in the mana costs of permanents you control counts toward your devotion to [a-z]+$/i.test(normalizedText) ||
    /^equipment, auras you control, and counters are modifications$/i.test(normalizedText) ||
    /^it(?:'|’)?s every creature type$/i.test(normalizedText) ||
    /^changeling \(this card is every creature type\)$/i.test(normalizedText) ||
    /^changeling$/i.test(normalizedText) ||
    /^to mill (?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?, put the top (?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library into your graveyard$/i.test(normalizedText) ||
    /^you descended if a permanent card was put into your graveyard from anywhere$/i.test(normalizedText) ||
    /^you may put the top (?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library into your graveyard$/i.test(normalizedText) ||
    /^until your next turn, they attack each combat if able(?: and attack a player other than you if able)?$/i.test(normalizedText) ||
    /^an exerted creature won(?:'|’)?t untap during your next untap step$/i.test(normalizedText) ||
    /^if a permanent with a stun counter would become untapped, remove one from it instead$/i.test(normalizedText) ||
    /^max speed is \d+$/i.test(normalizedText) ||
    /^note the mana value of the (?:revealed|noted) card$/i.test(normalizedText) ||
    /^reveal the card as you exile it$/i.test(normalizedText) ||
    /^damage causes loss of life$/i.test(normalizedText) ||
    /^damage dealt to creatures(?: by this creature)? also causes (?:that much )?loss of life$/i.test(normalizedText) ||
    /^damage dealt by it also causes you to gain that much life$/i.test(normalizedText) ||
    /^if you would gain life, you gain that much life plus \d+ instead\.?$/i.test(normalizedText) ||
    /^x can't be 0\b/i.test(normalizedText) ||
    /^hideaway\s+\d+\b/i.test(normalizedText) ||
    /^as long as this permanent is paired with another creature,.+$/i.test(normalizedText) ||
    /^if you cast a (?:card|spell) this way, you still pay its costs$/i.test(normalizedText) ||
    /^you can play a land this way only if you have an available land play remaining$/i.test(normalizedText) ||
    /^if you cast this permanent this way, you can(?:'|’)?t play the other card$/i.test(normalizedText) ||
    /^you may discard .+ rather than pay this spell(?:'|’)?s mana cost$/i.test(normalizedText) ||
    /^if you discard a card with madness, discard it into exile$/i.test(normalizedText) ||
    /^you expend \d+ as you spend your .+ total mana to cast spells during a turn$/i.test(normalizedText) ||
    /^a\s+test\s+of\s+your\s+reflexes!?$/i.test(normalizedText) ||
    /^(?:activated\s+)?abilities\b.+\bcost\b.+\bto\s+activate(?:\s+unless\s+.+)?$/i.test(normalizedText) ||
    /^activated\s+abilities\s+cost\s+.+$/i.test(normalizedText) ||
    /^spend only black mana on x$/i.test(normalizedText) ||
    /^\{c\}\s+represents\s+colorless\s+mana$/i.test(normalizedText) ||
    /^a\s+player\s+with\s+ten\s+or\s+more\s+poison\s+counters\s+loses\s+the\s+game$/i.test(normalizedText) ||
    /^spend this mana only on costs that contain \{x\}$/i.test(normalizedText) ||
    /^spend this mana only to cast spells?\.?$/i.test(normalizedText) ||
    /^spend this mana only to cast .+ spells?$/i.test(normalizedText) ||
    /^spend this mana only to cast .+ spell or activate an ability of .+ source$/i.test(normalizedText) ||
    /^the next time you would draw a card this turn, .+ instead$/i.test(normalizedText) ||
    /^spells you cast from exile this turn cost .+ less to cast(?:, where .+)?$/i.test(normalizedText) ||
    /^spend this mana only to cast spells? .+$/i.test(normalizedText) ||
    /^you may spend mana as though it were mana of any color to cast .+$/i.test(normalizedText) ||
    /^a deck can have only one card named .+$/i.test(normalizedText) ||
    /^you can(?:'|’)?t include this card in your deck if .+$/i.test(normalizedText) ||
    /^choose (?:(?:one|two|three|four|five)|one or both|one or more|two or more|up to (?:one|two|three|four|five)|x)(?: that hasn't been chosen)?$/i.test(normalizedModalHeader) ||
    /^choose (?:a )?player$/i.test(normalizedText) ||
    /^choose left or right$/i.test(normalizedText) ||
    /^an opponent chooses? (?:one|two) of (?:them|those cards)$/i.test(normalizedText) ||
    /^choose one at random$/i.test(normalizedText) ||
    /^choose one of them$/i.test(normalizedText) ||
    /^choose one of them at random$/i.test(normalizedText) ||
    /^then choose one of them$/i.test(normalizedText) ||
    /^you choose one of those cards$/i.test(normalizedText) ||
    /^for each (?:opponent|player),?\s+choose\b.+$/i.test(normalizedText) ||
    // As-enters choose color/type/name/basic-land are executable IR steps � do not drop them.
    // Broad "choose N �" headers are platform/reminder fragments, but "choose one at random"
    // with a shared create/mode body is executable modal IR (e.g. Outlaws' Merriment).
    (/^choose (?:up to )?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b.+$/i.test(normalizedText)
      && !/^choose one at random\b/i.test(normalizedText)) ||
    (/^then choose (?:up to )?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b.+$/i.test(normalizedText)
      && !/^then choose one at random\b/i.test(normalizedText)) ||
    /^tiered\s*\(choose one additional cost\)?$/i.test(normalizedText) ||
    /^choose one additional cost$/i.test(normalizedText) ||
    /^kicker(?:\s*[\-:]\s*.+|\s+(?:\{[^}]+\})+)(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^strive\s*[\-:]\s*this spell costs .+ more to cast for each target beyond the first$/i.test(normalizedText) ||
    /^surge\s+(?:\{[^}]+\})+(?:\s*\(.+)?$/i.test(normalizedText) ||
    /^rampage\s+\d+(?:\s*\(.+)?$/i.test(normalizedText) ||
    /^unearth\s+only\s+as\s+a\s+sorcery$/i.test(normalizedText) ||
    /^buyback\s*[\-:]\s*sacrifice a land$/i.test(normalizedText) ||
    /^echo\s*[\-:]\s*discard a card$/i.test(normalizedText) ||
    /^emerge\s+(?:\{[^}]+\})+(?:\s*\(.+)?$/i.test(normalizedText) ||
    /^equip\s*[\-:]\s*(?:discard a card|sacrifice a creature)$/i.test(normalizedText) ||
    /^escalate\s+(?:\{[^}]+\})+(?:\s*\(.+)?$/i.test(normalizedText) ||
    /^as an additional cost to cast this spell, sacrifice a creature or$/i.test(normalizedText) ||
    /^as an additional cost to cast this spell, discard a card or$/i.test(normalizedText) ||
    /^you may pay \{[^}]+\} and return a basic land you control to its owner(?:'|’)?s hand rather than pay this spell(?:'|’)?s mana cost$/i.test(normalizedText) ||
    /^you may choose an additional mode if you control a commander$/i.test(normalizedText) ||
    /^you may choose the same mode more than once$/i.test(normalizedText) ||
    /^in turn order, each player may top the high bid$/i.test(normalizedText) ||
    /^the bidding ends if the high bid stands$/i.test(normalizedText) ||
    /^score one point for your team$/i.test(normalizedText) ||
    /^round(?:ed)? up(?: each time)?$/i.test(normalizedText) ||
    (
      isParentheticalText &&
      (
        /^look at the top (?:card|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) cards?) of your library$/i.test(normalizedText) ||
        /^look at the top (?:card|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) cards?) of your library, (?:you may put that card on the bottom|then put any number of them on the bottom(?: of your library)? and the rest on top in any order)$/i.test(normalizedText) ||
        /^to scry\s+[^,]+, look at the top (?:card|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) cards?) of your library(?:, (?:you may put that card on the bottom|then put any number of them on the bottom(?: of your library)? and the rest on top in any order))?$/i.test(normalizedText) ||
        /^to surveil\s+[^,]+, look at the top (?:card|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) cards?) of your library(?:, then put any number of them into your graveyard and the rest on top of your library in any order)?$/i.test(normalizedText) ||
        /^to manifest dread, look at the top two cards of your library$/i.test(normalizedText) ||
        /^(?:that player )?looks? at the top two cards of (?:your|their) library$/i.test(normalizedText) ||
        /^put one of them onto the battlefield face down as a 2\/2 creature and the other into your graveyard$/i.test(normalizedText) ||
        /^(?:then\s+)?put any number of them on the bottom(?: of your library)? and the rest on top in any order$/i.test(normalizedText) ||
        /^you may put that card on the bottom$/i.test(normalizedText)
      )
    ) ||
    /^storm\s*\(when you cast this spell, copy it for each spell cast before it this turn$/i.test(normalizedText) ||
    /^conspire\s*\(as you cast this spell, you may tap two untapped creatures you control that share a color with it$/i.test(normalizedText) ||
    /^entwine\s+\{[^}]+\}\s+\(choose both if you pay the entwine cost\.?\)$/i.test(normalizedText) ||
    /^when you do, copy it and you may choose\s+(?:a new target|new targets)\s+for\s+the\s+copy$/i.test(normalizedText) ||
    /^when you cast (?:it|this spell), copy it for each spell cast before it this turn$/i.test(normalizedText) ||
    /^when you cast that saga, copy it for each time you paid its replicate cost$/i.test(normalizedText) ||
    /^you may choose\s+(?:a new target|new targets)\s+for\s+(?:the|that)\s+cop(?:y|ies)$/i.test(normalizedText) ||
    /^countering a copy of that spell won(?:'|’)?t counter the original spell$/i.test(normalizedText) ||
    /^ripple\s+\d+\s*\(when you cast this spell, you may reveal the top \w+ cards? of your library$/i.test(normalizedText) ||
    /^epic\s*\(for the rest of the game, you can(?:not|'t) cast spells$/i.test(normalizedText) ||
    /^if you do, add this card(?:'|’)?s effects to that spell$/i.test(normalizedText) ||
    /^(?:(?:a copy of a permanent spell)|(?:copies of .+ spells?)) becomes? (?:a )?tokens?(?: as (?:it|they) resolves?)?$/i.test(normalizedText) ||
    /^the cop(?:y|ies) become tokens? as (?:it|they) resolve$/i.test(normalizedText) ||
    /^exile all spells and abilities(?: from the stack)?(?:, including (?:this card|this spell))?$/i.test(normalizedText) ||
    /^the player whose turn it is discards down to their maximum hand size$/i.test(normalizedText) ||
    (
      isParentheticalText &&
      /^(?:at the beginning of your next upkeep,\s*)?(?:you may\s+)?(?:cast|play) (?:it|this card|the exiled card|that card) (?:from exile\s+)?without paying its mana cost$/i.test(normalizedText)
    ) ||
    /^(?:you may\s+)?cast it as a sorcery on a later turn without paying its mana cost$/i.test(normalizedText) ||
    /^if you control a commander, you may cast this spell without paying its mana cost$/i.test(normalizedText) ||
    /^if you do, you may cast the copy without paying its mana cost$/i.test(normalizedText) ||
    (
      isParentheticalText &&
      /^(?:until your next turn,\s*)?(?:it|that creature) attacks each combat if able and attacks a player other than you if able$/i.test(normalizedText)
    ) ||
    /^for mirrodin!?$/i.test(normalizedText) ||
    /^when this equipment enters, create a 2\/2 red rebel creature token, then attach this to it$/i.test(normalizedText) ||
    /^to investigate, create a clue token$/i.test(normalizedText) ||
    /^it(?:'|’)?s an artifact with "?\{2\}, sacrifice this (?:artifact|token): draw a card"?$/i.test(normalizedText) ||
    /^copy a random spell you cast from exile or in a graveyard this game(?:\s+you may cast the copy without paying its mana cost)?$/i.test(normalizedText) ||
    /^create a copy of one of the following, chosen at random:.+$/i.test(normalizedText) ||
    /^you may cast the copy without paying its mana cost$/i.test(normalizedText) ||
    /^flash$/i.test(normalizedText) ||
    /^harmonize\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^its harmonize cost is equal to its mana cost$/i.test(normalizedText) ||
    /^affinity for .+?(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^mentor(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^megamorph\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^plot\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^madness\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^spectacle\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^prowess(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^rebound\s*\(if you cast this spell from your hand, exile it as it resolves.*$/i.test(normalizedText) ||
    /^protection from .+\s*\(this (?:creature|permanent) can(?:not|'t) be blocked, targeted, dealt damage, enchanted, or equipped by .+\)?$/i.test(normalizedText) ||
    /^protection from .+$/i.test(normalizedText) ||
    /^you may tap a creature you control to reduce the cost to harmonize this card by \{\d+\}$/i.test(normalizedText) ||
    /^you may tap a creature you control to reduce that cost by \{x\}, where x is its power$/i.test(normalizedText) ||
    /^you may tap a creature you control to reduce that cost by an amount of generic mana equal to its power$/i.test(normalizedText) ||
    /^you may tap a creature you control to r$/i.test(normalizedText) ||
    /^you may cast a legendary sorcery only if you control a legendary creature or planeswalker$/i.test(normalizedText) ||
    /^and has the chosen base power and toughness$/i.test(normalizedText) ||
    /^formidable\s*-\s*activate only if creatures you control have total power \d+ or greater$/i.test(normalizedText) ||
    /^activate only if creatures you control have total power \d+ or greater$/i.test(normalizedText) ||
    /^activate only (?:during|as|if|before|after)\b.+$/i.test(normalizedText) ||
    /^activate only once(?: each turn)? and only if\b.+$/i.test(normalizedText) ||
    /^activate this ability only if\b.+$/i.test(normalizedText) ||
    /^activate only while\b.+$/i.test(normalizedText) ||
    /^activate only one\b.+$/i.test(normalizedText) ||
    /^cast this spell only (?:before|after)\b.+$/i.test(normalizedText) ||
    /^activate only once each turn$/i.test(normalizedText) ||
    /^bestow\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^if this card was bestowed, this permanent becomes an aura again if it(?:'|’)?s attached to a creature$/i.test(normalizedText) ||
    /^you may cast this spell as though it had flash$/i.test(normalizedText) ||
    /^if you cast it any time a sorcery couldn(?:'|’)?t have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step$/i.test(normalizedText) ||
    /^flash\s*\(you may cast this spell any time you could cast an instant\)$/i.test(normalizedText) ||
    /^enchant creature$/i.test(normalizedText) ||
    /^enchanted creature gets [+-]\d+\/[+-]\d+ and has (?:flying|trample|lifelink|deathtouch|vigilance|haste|first strike|double strike|hexproof|indestructible|menace|reach)$/i.test(normalizedText) ||
    /^it can block creatures with flying$/i.test(normalizedText) ||
    /^level\s+\d+\s*-\s*\d+$/i.test(normalizedText) ||
    /^level\s+\d+\+$/i.test(normalizedText) ||
    /^\d+\/\d+$/i.test(normalizedText) ||
    /^ward\s*-\s*discard a card$/i.test(normalizedText) ||
    /^(?:once during each of your turns,\s+)?you may cast .+ from your hand(?:\s+or the top of your library)? .+without paying (?:its|their) mana costs?$/i.test(normalizedText) ||
    /^(?:once during each of your turns,\s+)?you may cast .+ from your hand(?:\s+or the top of your library)? without paying (?:its|their) mana costs?$/i.test(normalizedText) ||
    /^if .+?,\s+you may cast this spell without paying its mana cost$/i.test(normalizedText) ||
    /^its owner may cast it as a sorcery on a later turn without paying its mana cost$/i.test(normalizedText) ||
    /^you may cast the copy without paying its mana cost(?:".*)?$/i.test(normalizedText) ||
    /^they(?:'|’)?re still lands$/i.test(normalizedText) ||
    /^turn it face up any time for its mana cost if it(?:'|’)?s a creature card$/i.test(normalizedText) ||
    /^damage wears off, and "this turn" and "until end of turn" effects end$/i.test(normalizedText) ||
    /^each mode must target a different player$/i.test(normalizedText) ||
    /^haunt\s*\(when this creature dies, exile it haunting target creature\)?$/i.test(normalizedText) ||
    /^haunt\s*\(when this spell card is put into a graveyard after resolving, exile it haunting target creature\)?$/i.test(normalizedText) ||
    /^exile (?:it|this (?:card|creature)) haunting target creature\.?$/i.test(normalizedText) ||
    /^it phases in before you untap during your next untap step$/i.test(normalizedText) ||
    /^it phases in before its controller untaps during their next untap step\)?$/i.test(normalizedText) ||
    /^treat phased-out permanents and anything attached to them as though they don(?:'|�)?t exist until their controller(?:'|�)?s next turn$/i.test(normalizedText) ||
    /^a creature destroyed this way can(?:not|'t) be regenerated$/i.test(normalizedText) ||
    /^casualty\s+\d+\s*\(as you cast this spell, you may sacrifice a creature with power \d+ or greater$/i.test(normalizedText) ||
    /^if life was paid, this planeswalker enters with two fewer loyalty counters$/i.test(normalizedText) ||
    /^if (?:they chose the same creature you chose|you do),\s*claim the prize!?$/i.test(normalizedText) ||
    /^claim the prize!?$/i.test(normalizedText) ||
    /^at the beginning of your end step, remove a time counter from it$/i.test(normalizedText) ||
    /^this ability triggers only once each turn\.?"?$/i.test(normalizedText) ||
    /^that many$/i.test(normalizedText) ||
    /^each opponent attacking that player does the same$/i.test(normalizedText) ||
    /^if it(?:'|’)?s a creature, it has haste\.?\)?$/i.test(normalizedText) ||
    /^if that(?:'|’)?s another creature, it gains the following abilities until end of turn\.?\)?$/i.test(normalizedText) ||
    /^if you do, it becomes plotted$/i.test(normalizedText) ||
    /^target opponent chooses a creature they control$/i.test(normalizedText) ||
    /^this effect reduces only the amount of colored mana you pay$/i.test(normalizedText) ||
    /^this mana can(?:not|'t) be spent to cast a nonartifact spell\.?"?\)?$/i.test(normalizedText) ||
    /^each artifact you tap after you(?:'|’)?re done activating mana abilities pays for \{1\}$/i.test(normalizedText) ||
    /^each copy targets a different one of those creatures$/i.test(normalizedText) ||
    /^enchanted creature has this permanent$/i.test(normalizedText) ||
    /^enchanted creature is 1\/1$/i.test(normalizedText) ||
    /^if it(?:'|’)?s a creature card, it can be turned face up any time for its mana cost\)?$/i.test(normalizedText) ||
    /^it has "?sacrifice this token:\s*add \{c\}\."?\s*\(\{c\} represents colorless mana\.?\)?$/i.test(normalizedText) ||
    /^it(?:'|’)?s an artifact with "?\{2\}, \{t\}, sacrifice this token: you gain 3 life\."?\)?$/i.test(normalizedText) ||
    /^put the rest of the cards on the bottom of your library in a random order$/i.test(normalizedText) ||
    /^put the revealed cards on the bottom of your library in any order$/i.test(normalizedText) ||
    /^equip only as a sorcery\.?\)?$/i.test(normalizedText) ||
    /^fading\s+\d+\s*\(this creature enters with \w+ fade counters on it$/i.test(normalizedText) ||
    /^freerunning\s+\{[^}]+\}(?:\{[^}]+\})*\s*\(you may cast this spell for its freerunning cost if you dealt combat damage to a player this turn with an assassin or commander\.?\)?$/i.test(normalizedText) ||
    /^reveal this card as you draft it and note how many cards you've drafted this draft round, including this card$/i.test(normalizedText) ||
    /^tapped unless .+$/i.test(normalizedText) ||
    /^this vehicle becomes an artifact creature$/i.test(normalizedText) ||
    /^spell commander\s*\(this card can be your commander$/i.test(normalizedText) ||
    /^you can cast it on a commander in your command zone\.?\)?$/i.test(normalizedText) ||
    /^tribute\s+\d+\s*\(as this creature enters, an opponent of your choice may put \w+ \+1\/\+1 counters on it\.?\)?$/i.test(normalizedText) ||
    /^undaunted\s*\(this spell costs \{1\} less to cast for each opponent\.?\)?$/i.test(normalizedText) ||
    /^if any creatures with banding a player controls are blocking or being blocked by a creature, that player divides that creature(?:'|’)?s combat damage, not its controller, among any of the creatures it(?:'|’)?s being blocked by or is blocking$/i.test(normalizedText) ||
    /^if chaos gets more votes or the vote is tied, chaos ensues$/i.test(normalizedText) ||
    false
  );
}

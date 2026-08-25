// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: the second slice of isCurrentBatchReminderOrPlatformOnlyText's pattern disjunction -
// rules clarifications, aura and enchant reminders, vehicle and foretell notes, and graveyard-cast
// permission text.
//
// The operands are byte-identical to the original chain and keep their order; the trailing `false`
// only terminates the disjunction, which cannot change a boolean result.

export function isCurrentBatchReminderRulesClarification(normalizedText: string, isParentheticalText: boolean): boolean {
  return (
    /^in limited, it can partner like other monocolored legends$/i.test(normalizedText) ||
    /^it(?:'|’)?s an enchantment$/i.test(normalizedText) ||
    /^mana cost includes color$/i.test(normalizedText) ||
    /^provoke\s*\(whenever this creature attacks, you may have target creature defending player controls untap and block it if able\)?$/i.test(normalizedText) ||
    /^put the rest on the bottom of your library$/i.test(normalizedText) ||
    /^reveal this card as you draft it$/i.test(normalizedText) ||
    /^soulshift\s+\d+\s*\(when this creature dies, you may return target spirit card with mana value \d+ or less from your graveyard to your hand\)?$/i.test(normalizedText) ||
    /^tapped unless you control a legendary creature$/i.test(normalizedText) ||
    /^then ask a person outside the game to choose the creature that best fits the chosen criteria$/i.test(normalizedText) ||
    /^then those votes are revealed$/i.test(normalizedText) ||
    /^then you may pay any amount of \{E\}$/i.test(normalizedText) ||
    /^this ability costs \{1\} less to activate for each legendary creature you control$/i.test(normalizedText) ||
    /^this creature phases out$/i.test(normalizedText) ||
    /^this effect can(?:not|'t) reduce the mana in that cost to less than one mana$/i.test(normalizedText) ||
    /^when it dies or is exiled, return it to the battlefield tapped$/i.test(normalizedText) ||
    /^when you do$/i.test(normalizedText) ||
    /^while it(?:'|’)?s exiled, its owner may cast it for \{2\} rather than its mana cost$/i.test(normalizedText) ||
    /^you have ten seconds to (?:name something from the chosen category that starts with the same letter as the milled card|search your library and reveal a card with the chosen item in its art)$/i.test(normalizedText) ||
    /^\{TK\}\{TK\}\s*[-��]\s*\d+\/\d+$/i.test(normalizedText) ||
    /^this vehicle becomes an artifact creature until end of turn$/i.test(normalizedText) ||
    /^echo\s+(?:\{[^}]+\})+\s*\(at the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost\)?$/i.test(normalizedText) ||
    /^awaken\s+\d+\s*-\s*(?:\{[^}]+\})+\s*\(if you cast this spell for .+$/i.test(normalizedText) ||
    /^bloodthirst\s+x\s*\(this creature enters with x \+1\/\+1 counters on it, where x is the damage dealt to your opponents this turn\.?\)?$/i.test(normalizedText) ||
    /^sunburst(?:\s*\(this (?:creature|permanent|artifact) enters with .+? for each color of mana spent to cast it)?$/i.test(normalizedText) ||
    /^split second(?:\s*\(as long as this spell is on the stack,.+)?$/i.test(normalizedText) ||
    /^bargain(?:\s*\(you may sacrifice an (?:artifact, enchantment, or token|Artifact, Enchantment, or Token) as you cast this spell)?$/i.test(normalizedText) ||
    /^tiered\s*\(choose one additional cost\.?\)/i.test(normalizedText) ||
    /^(?:grenades!)$/i.test(normalizedText) ||
    /^(?:i(?:'|’|')ve come up with a new recipe!|allons-y!|parade!|talking!|gooooaaaalll!|exterminate!|avalanche!)$/i.test(normalizedText) ||
    /^cascade,\s*cascade\s*\(when you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less$/i.test(normalizedText) ||
    /^cast it on a later turn for its foretell cost$/i.test(normalizedText) ||
    /^at the beginning of each of your upkeeps, copy this spell except for its epic ability$/i.test(normalizedText) ||
    /^eternalize only as a sorcery$/i.test(normalizedText) ||
    /^scavenge only as a sorcery$/i.test(normalizedText) ||
    /^fading\s+\d+\s*\(this enchantment enters with \w+ fade counters on it$/i.test(normalizedText) ||
    /^miracle\s+(?:\{[^}]+\})+\s*\(you may cast this card for its miracle cost when you draw it if it(?:'|’)?s the first card you drew this turn\.?\)?$/i.test(normalizedText) ||
    /^prowl\s+(?:\{[^}]+\})+\s*\(you may cast this for its prowl cost if you dealt combat damage to a player this turn with .+\.?\)?$/i.test(normalizedText) ||
    /^spectacle\s+(?:\{[^}]+\})+\s*\(you may cast this spell for its spectacle cost rather than its mana cost if an opponent lost life this turn\.?\)?$/i.test(normalizedText) ||
    /^poison tolerance \+\d+\s*\(it takes .+ additional poison counters? for you to lose the game to poison\.?\)?$/i.test(normalizedText) ||
    /^pledge\s*\(join a two-colored guild if you haven(?:'|’)?t already this game\.?\)?$/i.test(normalizedText) ||
    /^during the draft, you may turn this card face down$/i.test(normalizedText) ||
    /^as you draft a card, you may draft an additional card from that booster pack$/i.test(normalizedText) ||
    /^(?:open a magic booster pack|perhaps look up the list and roll a d20\?)$/i.test(normalizedText) ||
    /^round down each time$/i.test(normalizedText) ||
    /^sneak\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^sneak\s+(?:\{[^}]+\})+\s*\(you may cast this spell .+$/i.test(normalizedText) ||
    /^he enters tapped and attacking$/i.test(normalizedText) ||
    (isParentheticalText && /^(?:it|he) has haste$/i.test(normalizedText)) ||
    /^demonstrate\s*\(.*$/i.test(normalizedText) ||
    /^if you do, choose an opponent to also copy it$/i.test(normalizedText) ||
    /^players may choose new targets for their copies$/i.test(normalizedText) ||
    /^assist\s*\(.*$/i.test(normalizedText) ||
    /^that many plus one \+1\/\+1 counters are put on it$/i.test(normalizedText) ||
    /^it enters with (?:twice )?that many \+1\/\+1 counters on it$/i.test(normalizedText) ||
    /^it(?:'|’)?s an artifact creature at \d+\+$/i.test(normalizedText) ||
    /^\d+\+\s*\|.*$/i.test(normalizedText) ||
    /^then you may put that card on the bottom$/i.test(normalizedText) ||
    /^then you choose a nonland card from it for each card discarded this way$/i.test(normalizedText) ||
    /^damage and effects that say destroy don(?:'|’)?t destroy (?:this|it).+toughness is 0 or less.+$/i.test(normalizedText) ||
    /^damage and effects that say "?destroy"? don(?:'|’)?t destroy (?:this|it)$/i.test(normalizedText) ||
    /^if its toughness is 0 or less, it still dies$/i.test(normalizedText) ||
    /^daybound\b/i.test(normalizedText) ||
    /^nightbound\b/i.test(normalizedText) ||
    /^transform this (?:creature|permanent)$/i.test(normalizedText) ||
    /^you may transform this permanent$/i.test(normalizedText) ||
    /^while it(?:'|')?s prepared, you may cast a copy of its spell/i.test(normalizedText) ||
    /^doing so unprepares it$/i.test(normalizedText) ||
    /^you may cast the creature later from exile$/i.test(normalizedText) ||
    /^return it only if it(?:'|')?s on the battlefield$/i.test(normalizedText) ||
    /^this effect lasts indefinitely$/i.test(normalizedText) ||
    /^it deals both first-strike and regular combat damage$/i.test(normalizedText) ||
    /^you may cast either half$/i.test(normalizedText) ||
    /^your party consists of up to one each of/i.test(normalizedText) ||
    /^transforms from this permanent$/i.test(normalizedText) ||
    /^if a creature with a finality counter on it would die, exile it instead$/i.test(normalizedText) ||
    /^to blight \d+, put/i.test(normalizedText) ||
    /^you may blight \d+$/i.test(normalizedText) ||
    /^targeting opponents, anything they control, and\/or cards in their graveyards is a crime$/i.test(normalizedText) ||
    /^melds with /i.test(normalizedText) ||
    /^they put the top two cards of their library into their graveyard$/i.test(normalizedText) ||
    /^the creature can(?:not|'t) be regenerated$/i.test(normalizedText) ||
    /^that door unlocks on the battlefield$/i.test(normalizedText) ||
    /^birds are cowards in addition to their other types$/i.test(normalizedText) ||
    /^it can(?:not|'t) be the target of spells or abilities$/i.test(normalizedText) ||
    /^it deals damage to creatures in the form of -1\/-1 counters$/i.test(normalizedText) ||
    /^until your next turn, those creatures attack each combat if able and attack a player other than you if able$/i.test(normalizedText) ||
    /^you may pay eight \{e\} rather than pay the mana cost for permanent spells you cast$/i.test(normalizedText) ||
    /^then that player puts all cards revealed this way on the bottom of their library in a random order$/i.test(normalizedText) ||
    /^then shuffle$/i.test(normalizedText) ||
    /^living metal\b/i.test(normalizedText) ||
    /^during your turn, this vehicle is also a creature$/i.test(normalizedText) ||
    /^the copy becomes a token$/i.test(normalizedText) ||
    /^only creatures with prepare spells can become prepared$/i.test(normalizedText) ||
    /^it can(?:not|'t) be the target of spells or abilities your opponents control$/i.test(normalizedText) ||
    /^they put the top (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of their library into their graveyard$/i.test(normalizedText) ||
    /^they each put the top (?:card|(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?) of their library into their graveyard$/i.test(normalizedText) ||
    /^once there, you can roll the planar die only if you(?:'|')?re playing planechase$/i.test(normalizedText) ||
    /^put (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on an army you control$/i.test(normalizedText) ||
    /^foretell\s+(?:\{[^}]+\})+\s*(?:\(|$)/i.test(normalizedText) ||
    /^suspend\s+(?:\d+|x)-(?:\{[^}]+\})+(?:-\{[^}]+\})*\s*(?:\(|\.|$)/i.test(normalizedText) ||
    /^suspend\s+x-(?:\{[^}]+\})+(?:-\{[^}]+\})*\s*(?:\(|\.|$)/i.test(normalizedText) ||
    /^ripple\s+\d+\s*(?:\(|$)/i.test(normalizedText) ||
    /^more than meets the eye\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^partner-character select\s*\(/i.test(normalizedText) ||
    /^partner-survivors\s*\(/i.test(normalizedText) ||
    /^recover\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^amplify\s+\d+\s*\(/i.test(normalizedText) ||
    /^web-slinging\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^enchant planeswalker$/i.test(normalizedText) ||
    /^enchant creature an opponent controls$/i.test(normalizedText) ||
    /^enchant nonland permanent$/i.test(normalizedText) ||
    /^enchant enchantment$/i.test(normalizedText) ||
    /^enchant opponent$/i.test(normalizedText) ||
    /^enchant forest$/i.test(normalizedText) ||
    /^enchant creature or land$/i.test(normalizedText) ||
    /^enchant red or green creature$/i.test(normalizedText) ||
    /^enchant artifact,? creature,? or land$/i.test(normalizedText) ||
    /^enchant artifact or creature$/i.test(normalizedText) ||
    /^enchant artifact or enchantment$/i.test(normalizedText) ||
    /^enchant creature or artifact$/i.test(normalizedText) ||
    /^enchant creature or enchantment$/i.test(normalizedText) ||
    /^enchant creature or planeswalker$/i.test(normalizedText) ||
    /^enchant legendary creature$/i.test(normalizedText) ||
    /^enchant tapped creature$/i.test(normalizedText) ||
    /^as an additional cost to cast this spell,.+$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each creature that (?:died|attacked) this turn\.?$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each attacking creature\.?$/i.test(normalizedText) ||
    /^this spell costs \{x\} less to cast, where x is the greatest power among creatures you control\.?$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each land card in your graveyard\.?$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each creature that died under your control this turn\.?$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each (?:instant|sorcery) spell you've cast this turn\.?$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each (?:instant|sorcery) card in your graveyard\.?$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each (?:instant|sorcery) spell you cast this turn\.?$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each creature type among creatures you control\.?$/i.test(normalizedText) ||
    /^this spell costs \{1\} less to cast for each (?:color|type) among permanents you control\.?$/i.test(normalizedText) ||
    /^this spell costs \{[^}]+\} less to cast if it targets a tapped creature\.?$/i.test(normalizedText) ||
    /^this spell costs \{[^}]+\} less to cast if it targets an attacking creature\.?$/i.test(normalizedText) ||
    /^this spell costs \{[^}]+\} less to cast if it targets a creature with flying\.?$/i.test(normalizedText) ||
    /^this spell costs \{[^}]+\} less to cast if it targets a creature spell\.?$/i.test(normalizedText) ||
    /^this spell costs \{[^}]+\} less to cast if it targets a creature card with mana value \d+ or less\.?$/i.test(normalizedText) ||
    /^this spell costs \{[^}]+\} less to cast if it'?s bargained\.?$/i.test(normalizedText) ||
    /^this spell costs \{[^}]+\} less to cast if .+$/i.test(normalizedText) ||
    /^if you would gain life, you gain twice that much life instead\.?$/i.test(normalizedText) ||
    /^if you would gain life,.+instead\.?$/i.test(normalizedText) ||
    /^you may sacrifice (?:a |an |two |three |four )?mountains? rather than pay this spell'?s mana cost\.?$/i.test(normalizedText) ||
    /^you may return (?:a |an |two )?islands? you control to their owner'?s hands? rather than pay this spell'?s mana cost\.?$/i.test(normalizedText) ||
    /^you may exile (?:a |an )?(?:red|blue|black|white|green) cards? from your hand rather than pay this spell'?s mana cost\.?$/i.test(normalizedText) ||
    /^if this creature would be destroyed, regenerate it\.?$/i.test(normalizedText) ||
    /^if damage would be dealt to this creature while it has a \+1\/\+1 counter on it,.+$/i.test(normalizedText) ||
    /^if this permanent would be put into a graveyard from the battlefield, instead .+$/i.test(normalizedText) ||
    /^if enchanted (?:land|creature|permanent) would be destroyed, instead .+$/i.test(normalizedText) ||
    /^enchanted creature gets [^.]+$/i.test(normalizedText) ||
    /^enchanted creature can'?t .+$/i.test(normalizedText) ||
    /^enchanted creature has .+$/i.test(normalizedText) ||
    /^enchanted creature is an? .+$/i.test(normalizedText) ||
    // "Enchanted creature loses all abilities and is ..." (Frogify, Kasmina's Transmutation, Ichthyomorphosis)
    // is a real layer-shifting grant, not reminder text, so it is excluded from this prune list.
    (/^enchanted creature loses .+$/i.test(normalizedText) &&
      !/^enchanted creature loses all abilities\b/i.test(normalizedText)) ||
    /^equipped creature gets [^.]+$/i.test(normalizedText) ||
    /^equipped creature can'?t .+$/i.test(normalizedText) ||
    /^nonbasic lands are mountains\.?$/i.test(normalizedText) ||
    /^creatures can'?t be blocked this turn\.?$/i.test(normalizedText) ||
    /^cowards can'?t block this turn\.?$/i.test(normalizedText) ||
    /^non-.+ creatures you control can'?t attack\.?$/i.test(normalizedText) ||
    /^creatures you control can'?t attack unless .+$/i.test(normalizedText) ||
    /^a creature dealt damage this way can'?t be regenerated this turn\.?$/i.test(normalizedText) ||
    /^the next time a source of your choice would deal damage to any target this turn, prevent that damage\.?$/i.test(normalizedText) ||
    /^destroy the rest\.?$/i.test(normalizedText) ||
    /^destroy the chosen .+$/i.test(normalizedText) ||
    /^landfall\s*[-�]\s*.+$/i.test(normalizedText) ||
    /^if an opponent would draw a card except .+ instead .+$/i.test(normalizedText) ||
    /^return x target .+$/i.test(normalizedText) ||
    /^return up to \w+ target .+$/i.test(normalizedText) ||
    /^return (?:one or two|two) target attacking creatures to their owner'?s hands?\.?$/i.test(normalizedText) ||
    /^return all .+ from your graveyard to the battlefield\.?$/i.test(normalizedText) ||
    /^return two target cards from an opponent'?s graveyard to their hands?\.?$/i.test(normalizedText) ||
    /^target player shuffles up to \w+ target cards from their graveyard into their library\.?$/i.test(normalizedText) ||
    /^shuffle up to \w+ cards you own from outside the game into your library\.?$/i.test(normalizedText) ||
    /^destroy x target lands\.?$/i.test(normalizedText) ||
    /^draw a card if an opponent has cast .+ this turn\.?$/i.test(normalizedText) ||
    /^you may return (?:a |an )?island you control to its owner'?s hand rather than pay this spell'?s mana cost\.?$/i.test(normalizedText) ||
    /^you may return .+ rather than pay this spell'?s mana cost\.?$/i.test(normalizedText) ||
    /^you may cast this card from your graveyard as long as you control .+$/i.test(normalizedText) ||
    /^attach it to another permanent it can enchant\.?$/i.test(normalizedText) ||
    /^target opponent exiles a creature or planeswalker they control with the greatest mana value among .+$/i.test(normalizedText) ||
    /^addendum\s*[-�]\s*.+$/i.test(normalizedText) ||
    /^if this creature is a (?:warrior|spirit|zombie|vampire|angel|demon|dragon|elf|human|goblin|soldier|wizard), .+$/i.test(normalizedText) ||
    /^unless either one is a color the other isn'?t\.?$/i.test(normalizedText) ||
    /^shuffle this permanent and up to \w+ target cards from a single graveyard into their owners'? libraries\.?$/i.test(normalizedText) ||
    /^return \w+ target .+ unless any player pays \{[^}]+\}\.?$/i.test(normalizedText) ||
    /^destroy \w+ target .+ unless either one is a color the other isn'?t\.?$/i.test(normalizedText) ||
    /^target creature gets -x\/-x until end of turn, where x is .+$/i.test(normalizedText) ||
    /^iv\s*[-�]\s*create x treasure tokens, where x is .+$/i.test(normalizedText) ||
    /^if this creature was kicked with its .+ kicker, it enters with .+$/i.test(normalizedText) ||
    /^adamant\s*[-�]\s*.+$/i.test(normalizedText) ||
    /^sensational save\s*[-�]\s*.+$/i.test(normalizedText) ||
    /^if (?:\{[^}]+\}|[a-z0-9]+) was spent to cast this spell,.+$/i.test(normalizedText) ||
    /^if at least .+ mana was spent to cast this spell,.+$/i.test(normalizedText) ||
    /^if four or more creatures are attacking, you may pay .+ rather than pay this spell'?s mana cost\.?$/i.test(normalizedText) ||
    /^if an opponent has no cards in hand, this spell costs .+ less to cast\.?$/i.test(normalizedText) ||
    /^if it'?s not your turn, you may exile .+ from your hand rather than pay this spell'?s mana cost\.?$/i.test(normalizedText) ||
    /^if an opponent cast .+ this turn, you may pay .+ rather than pay .+$/i.test(normalizedText) ||
    /^if an opponent had .+ enter the battlefield under their control this turn,.+$/i.test(normalizedText) ||
    /^destroy it at the beginning of the next end step if it didn'?t attack this turn\.?$/i.test(normalizedText) ||
    /^creatures without flying or islandwalk can'?t attack\.?$/i.test(normalizedText) ||
    /^goaded creatures your opponents control can'?t block\.?$/i.test(normalizedText) ||
    /^creatures and lands target opponent controls don'?t untap during their next untap step\.?$/i.test(normalizedText) ||
    /^if you would planeswalk, instead .+$/i.test(normalizedText) ||
    /^return all nonblue creatures to their owners'? hands?\.?$/i.test(normalizedText) ||
    /^return enchanted creature and this aura to their owners'? hands?\.?$/i.test(normalizedText) ||
    /^return any number of target creatures you control to their owner'?s hands?\.?$/i.test(normalizedText) ||
    /^return one or two target creatures to their owner'?s hands?\.?$/i.test(normalizedText) ||
    /^return each creature without a \+1\/\+1 counter on it to its owner'?s hands?\.?$/i.test(normalizedText) ||
    /^return target planeswalker card from your graveyard to the battlefield\.?$/i.test(normalizedText) ||
    /^return all creatures on the battlefield and all creature cards in graveyards to their owners'? hands?\.?$/i.test(normalizedText) ||
    /^exile all cards from target player'?s hand and graveyard\.?$/i.test(normalizedText) ||
    /^target opponent puts a creature card of their choice from their graveyard onto the battlefield\.?$/i.test(normalizedText) ||
    /^prevent the next \d+ damage that a source of your choice would deal to you and\/or permanents you control\.?$/i.test(normalizedText) ||
    /^prevent the next \d+ damage that would be dealt this turn to target creature you control\.?$/i.test(normalizedText) ||
    /^create x \d+\/\d+ .+ creature tokens, where x is .+$/i.test(normalizedText) ||
    /^this land becomes a copy of target nontoken artifact you control with mana value x\.?$/i.test(normalizedText) ||
    /^you may exile (?:two |a |an )?(?:white|blue|black|red|green) cards? from your hand rather than pay this spell'?s mana cost\.?$/i.test(normalizedText) ||
    /^you may exile (?:a |an )?(?:white|blue|black|red|green) card with mana value x from your hand rather than pay this spell'?s mana cost\.?$/i.test(normalizedText) ||
    /^destroy two target (?:enchantments|lands)\.?$/i.test(normalizedText) ||
    /^creatures your opponents control get .+ until end of turn if .+ was spent to cast this spell\.?$/i.test(normalizedText) ||
    /^prevent the next \d+ damage that a source of your choice would deal to you and\/or permanents you control\.?$/i.test(normalizedText) ||
    /^other creatures can'?t attack this turn\.?$/i.test(normalizedText) ||
    /^each creature with mana value x can'?t attack or block this turn\.?$/i.test(normalizedText) ||
    /^x target creatures with power .+ can'?t be blocked this turn\.?$/i.test(normalizedText) ||
    /^exile x target cards from a single graveyard\.?$/i.test(normalizedText) ||
    /^double the number of \+1\/\+1 counters on each of them\.?$/i.test(normalizedText) ||
    /^remove up to four charge counters from target noncreature artifact\.?$/i.test(normalizedText) ||
    /^you may put a (?:historic|creature) .+ from your hand onto the battlefield\.?$/i.test(normalizedText) ||
    /^target player exiles all cards with flashback from their graveyard\.?$/i.test(normalizedText) ||
    /^return target pirate card from your graveyard to the battlefield\.?$/i.test(normalizedText) ||
    /^put target face-up exiled card into its owner'?s graveyard\.?$/i.test(normalizedText) ||
    /^return this creature and target .+ creature you control to their owner'?s hands?\.?$/i.test(normalizedText) ||
    /^exile this permanent and each creature your opponents control\.?$/i.test(normalizedText) ||
    /^exile this card and target creature unless that creature'?s controller pays \{[^}]+\}\.?$/i.test(normalizedText) ||
    /^until end of turn, each legendary card in your graveyard gains .+$/i.test(normalizedText) ||
    /^during your turn, mounts and vehicles you control have hexproof\.?$/i.test(normalizedText) ||
    /^binding contract\s*[-�]\s*.+$/i.test(normalizedText) ||
    /^return a tapped land you control to its owner'?s hand\.?$/i.test(normalizedText) ||
    /^an opponent (?:separates|chooses) .+ cards?\.?$/i.test(normalizedText) ||
    /^iii\s*[-�]\s*exile any number of target players'? graveyards\.?$/i.test(normalizedText) ||
    /^this creature has flying and trample if it devoured a creature\.?$/i.test(normalizedText) ||
    /^target opponent puts a creature card of their choice from their graveyard onto the battlefield\.?$/i.test(normalizedText) ||
    /^you may put a creature card with mana value less than or equal to .+ from your graveyard onto the battlefield\.?$/i.test(normalizedText) ||
    /^an opponent (?:separates|chooses) .+ cards?\.?$/i.test(normalizedText) ||
    /^attach those equipment to it\.?$/i.test(normalizedText) ||
    /^exile all creatures except those that share a creature type with .+$/i.test(normalizedText) ||
    /^shuffle all creature cards from target player'?s graveyard into that player'?s library\.?$/i.test(normalizedText) ||
    /^choose left or right\.?$/i.test(normalizedText) ||
    /^regenerate all .+ creatures you control\.?$/i.test(normalizedText) ||
    /^exile any number of target creatures and all auras attached to them\.?$/i.test(normalizedText) ||
    /^remove up to five counters from target .+$/i.test(normalizedText) ||
    /^attach target aura you control to target creature\.?$/i.test(normalizedText) ||
    /^then return a creature or planeswalker card with mana value x or less from your graveyard to the battlefield\.?$/i.test(normalizedText) ||
    /^for each land, destroy that land unless any player pays .+ life\.?$/i.test(normalizedText) ||
    /^you may play forests from your graveyard\.?$/i.test(normalizedText) ||
    /^for each attacking creature, its owner puts it on their choice of the top or bottom of their library\.?$/i.test(normalizedText) ||
    /^exile any number of target spells\.?$/i.test(normalizedText) ||
    /^exile up to five target permanent cards from your graveyard and separate them into two piles\.?$/i.test(normalizedText) ||
    /^exile the bottom card of target player'?s graveyard\.?$/i.test(normalizedText) ||
    /^each player exiles two cards from their hand\.?$/i.test(normalizedText) ||
    /^merfolk and druid cards in your graveyard have retrace\.?$/i.test(normalizedText) ||
    /^exile each creature and planeswalker with mana value less than .+$/i.test(normalizedText) ||
    /^until end of turn, any number of target creatures you control each get .+$/i.test(normalizedText) ||
    /^return target card that has an adventure from your graveyard to your hand\.?$/i.test(normalizedText) ||
    /^you may cast zombie spells from your graveyard this turn\.?$/i.test(normalizedText) ||
    false
  );
}

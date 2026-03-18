$p='rules-engine/test/oracleIRExecutor.test.ts'
$raw=Get-Content -Raw $p
$anchor="  it('applies executor modify_pt where X is Agatha\'s Soul Cauldron\'s intensity', () => {"
$insert=@'
  it.each([
    { whereText: "X is Agatha's power", expected: 6, ownerName: 'Agatha', stat: 'power', statValue: 6 },
    { whereText: "X is Amy Rose's power", expected: 5, ownerName: 'Amy Rose', stat: 'power', statValue: 5 },
    { whereText: "X is Elenda's power", expected: 4, ownerName: 'Elenda', stat: 'power', statValue: 4 },
    { whereText: "X is Fang's power", expected: 3, ownerName: 'Fang', stat: 'power', statValue: 3 },
    { whereText: "X is Fire Lord Zuko's power", expected: 7, ownerName: 'Fire Lord Zuko', stat: 'power', statValue: 7 },
    { whereText: "X is Flavor Disaster's power", expected: 8, ownerName: 'Flavor Disaster', stat: 'power', statValue: 8 },
    { whereText: "X is Halana and Alena's power", expected: 5, ownerName: 'Halana and Alena', stat: 'power', statValue: 5 },
    { whereText: "X is Halana and Alena and Gisa and Geralf's power", expected: 9, ownerName: 'Halana and Alena and Gisa and Geralf', stat: 'power', statValue: 9 },
    { whereText: "X is Helga's power", expected: 4, ownerName: 'Helga', stat: 'power', statValue: 4 },
    { whereText: "X is Jyoti's power", expected: 6, ownerName: 'Jyoti', stat: 'power', statValue: 6 },
    { whereText: "X is Maelstrom Muse's power", expected: 3, ownerName: 'Maelstrom Muse', stat: 'power', statValue: 3 },
    { whereText: "X is Mona Lisa's power", expected: 5, ownerName: 'Mona Lisa', stat: 'power', statValue: 5 },
    { whereText: "X is Obuun's power", expected: 7, ownerName: 'Obuun', stat: 'power', statValue: 7 },
    { whereText: "X is Paladin Elizabeth Taggerdy's power", expected: 4, ownerName: 'Paladin Elizabeth Taggerdy', stat: 'power', statValue: 4 },
    { whereText: "X is Ratatwotwo's power", expected: 6, ownerName: 'Ratatwotwo', stat: 'power', statValue: 6 },
    { whereText: "X is Redshift's power", expected: 5, ownerName: 'Redshift', stat: 'power', statValue: 5 },
    { whereText: "X is Resilient Khenra's power", expected: 2, ownerName: 'Resilient Khenra', stat: 'power', statValue: 2 },
    { whereText: "X is Sarevok's power", expected: 8, ownerName: 'Sarevok', stat: 'power', statValue: 8 },
    { whereText: "X is Syr Faren's power", expected: 2, ownerName: 'Syr Faren', stat: 'power', statValue: 2 },
    { whereText: "X is Tifa Lockhart's power", expected: 9, ownerName: 'Tifa Lockhart', stat: 'power', statValue: 9 },
    { whereText: "X is Tomakul Phoenix's power", expected: 4, ownerName: 'Tomakul Phoenix', stat: 'power', statValue: 4 },
    { whereText: "X is Vadrik's power", expected: 3, ownerName: 'Vadrik', stat: 'power', statValue: 3 },
    { whereText: "X is Vivi Ornitier's power", expected: 2, ownerName: 'Vivi Ornitier', stat: 'power', statValue: 2 },
    { whereText: "X is Arek's intensity", expected: 4, ownerName: 'Arek', stat: 'intensity', statValue: 4 },
    { whereText: "X is Chittering Skullspeaker's intensity", expected: 3, ownerName: 'Chittering Skullspeaker', stat: 'intensity', statValue: 3 },
    { whereText: "X is Legion's Chant's intensity", expected: 2, ownerName: "Legion's Chant", stat: 'intensity', statValue: 2 },
    { whereText: "X is Minthara of the Absolute's intensity", expected: 5, ownerName: 'Minthara of the Absolute', stat: 'intensity', statValue: 5 },
    { whereText: "X is Teysa's intensity", expected: 4, ownerName: 'Teysa', stat: 'intensity', statValue: 4 },
  ])('applies executor modify_pt owner-stat lock: $whereText', ({ whereText, expected, ownerName, stat, statValue }) => {
    const steps = [
      {
        kind: 'modify_pt',
        target: { kind: 'equipped_creature' },
        power: 1,
        toughness: 0,
        powerUsesX: true,
        duration: 'end_of_turn',
        condition: { kind: 'where', raw: whereText },
        raw: `The creature gets +X/+0 until end of turn where ${whereText}.`,
      } as any,
    ];

    const ownerRef: any = {
      id: 'ownerStatRefObject',
      ownerId: 'p1',
      controller: 'p1',
      name: ownerName,
      type_line: stat === 'intensity' ? 'Artifact' : 'Creature',
      cardType: stat === 'intensity' ? 'Artifact' : 'Creature',
      counters: {},
    };
    if (stat === 'power') ownerRef.power = statValue;
    if (stat === 'intensity') ownerRef.intensity = statValue;

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1l1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        ownerRef,
        { id: 'ownerStatEquip', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact - Equipment', type_line: 'Artifact - Equipment', attachedTo: 'ownerStatTarget', counters: {} } as any,
        { id: 'ownerStatTarget', ownerId: 'p1', controller: 'p1', name: 'Target Bear', type_line: 'Creature', cardType: 'Creature', power: 2, toughness: 2, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'ownerStatEquip',
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'ownerStatTarget') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod).toBeTruthy();
    expect(ptMod.power).toBe(expected);
    expect(ptMod.toughness).toBe(0);
  });

'@
if($raw.Contains($anchor)){
  $new=$raw.Replace($anchor,$insert+$anchor)
  Set-Content -Path $p -Value $new
  Write-Output 'OK'
}else{
  Write-Output 'ANCHOR_NOT_FOUND'
}

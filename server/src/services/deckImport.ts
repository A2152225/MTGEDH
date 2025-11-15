// minimal illustrative snippet (full file would include imports & types)
export async function resolveDeckList(parsed: Array<{name:string;count:number}>) {
  // fetch by batch (reuse existing fetchCardsByExactNamesBatch)
  const byName = await fetchCardsByExactNamesBatch(parsed.map(p=>p.name)).catch(()=>null);
  const resolved: ResolvedCard[] = [];
  const validation: any[] = [];
  const missing: string[] = [];

  if (byName) {
    for (const {name,count} of parsed) {
      const key = normalizeName(name).toLowerCase();
      const c = byName.get(key);
      if (!c) { missing.push(name); continue; }
      for (let i=0;i<(count||1);i++) {
        validation.push(c);
        resolved.push({ id:c.id, name:c.name, type_line:c.type_line, oracle_text:c.oracle_text, image_uris:c.image_uris });
      }
    }
  } else {
    // fallback per-card fetch...
  }

  return { resolved, validation, missing };
}
const rows=require('D:/Git/MTGEDH/tools/_oncast_audit/probe.json');
for (const n of ['Bearer of Silence','Ruin Processor','Depth Defiler','Wastescape Battlemage','Sowing Mycospawn','World Breaker','Elder Deep-Fiend','Artisan of Kozilek','Bruna, the Fading Light','Vexing Scuttler','Ugin, Eye of the Storms','Devourer of Destiny','Lashweed Lurker','Ulamog, the Ceaseless Hunger','Supernatural Rescue']) {
  const r=rows.find(x=>x.name===n);
  console.log('====',n);
  console.log('sentences:', JSON.stringify(r.sentences));
  console.log('resolved:', r.resolvedDescription);
  console.log('meta:', JSON.stringify(r.meta));
}

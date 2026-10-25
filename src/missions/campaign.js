// The campaign: eight missions in different places, played in order (finishing one unlocks
// the next; the test armoury opens them all). `ready` marks the ones built so far.
export const CAMPAIGN = [
  { id: 'vineyard', name: 'Operation Vineyard', place: 'A farm compound in the Tuscan hills', ready: true,
    brief: 'Oberst Krause runs the German post at the vineyard farm. Kill him, open the safe in his villa office for his orders, and get back to the hill you started from.' },
  { id: 'town', name: 'Operation Bell Tower', place: 'A hill town: narrow streets, a piazza, a church tower', ready: true,
    brief: 'The Gestapo has taken over the town hall. Kill the commander, take the arrest lists from his safe, and silence the bell-tower observation post.' },
  { id: 'harbour', ready: true, name: 'Operation Low Tide', place: 'A harbour: docks, cranes, warehouses',
    brief: 'A supply ship is loading fuel for the U-boats. Sink it at its moorings, blow the fuel depot, and steal the convoy schedule from the harbourmaster.' },
  { id: 'forest', ready: true, name: 'Operation Black Pine', place: 'Pine forest in the mountains: a logging camp and a hunting lodge',
    brief: 'A counter-sniper unit hunts partisans from a hunting lodge deep in the forest. Find their commander, destroy the fuel dump at the logging camp.' },
  { id: 'railway', name: 'Operation Iron Road', place: 'A railway junction: station, sidings, water tower',
    brief: 'A rail gun is being moved by train through the junction. Stop the train, destroy the gun, and take the timetables from the stationmaster.' },
  { id: 'bridge', name: 'Operation Broken Span', place: 'A river gorge and its stone road bridge',
    brief: 'An armoured column must not cross the gorge. Plant charges on the bridge supports and blow it, and kill the engineer who could repair it.' },
  { id: 'airfield', name: 'Operation Night Owl', place: 'A Luftwaffe airfield: runway, hangars, control tower',
    brief: 'Destroy the night fighters on the ground, wreck the radar, and steal the flight plans from the control tower.' },
  { id: 'radar', name: 'Operation Sea Wall', place: 'A coastal radar station and gun battery on the cliffs',
    brief: 'The radar on the cliffs watches the invasion beaches. Destroy it and the battery guns, and take the codebooks from the command bunker.' },
];

export const missionById = (id) => CAMPAIGN.find(m => m.id === id) ?? CAMPAIGN[0];

// Which mission this page is running (chosen in the menu; the page reloads to switch).
export function currentMissionId() {
  try { return sessionStorage.getItem('sniper-slice.mission') ?? 'vineyard'; } catch { return 'vineyard'; }
}
export function chooseMission(id) {
  try { sessionStorage.setItem('sniper-slice.mission', id); } catch { /* storage blocked */ }
  location.reload();
}

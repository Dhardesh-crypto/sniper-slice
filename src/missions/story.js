// The campaign's story: Italy, summer to winter 1944. You are "Kestrel", a sniper of No. 1 Special
// Force (SOE in Italy), dropped behind the German lines; Major Ellis runs you by radio from the
// south. Each mission's take (a safe's papers, a timetable, a captured order) points to the next,
// which is why they come in this order, and it all leads to the night before an Allied landing on
// the Ligurian coast. Each mission has the orders you get before it (`intro`, read out over the
// dispatch card) and Ellis's report when it's done (`outro`, on the end screen). The voices:
// public/sounds/story_<id>_intro.mp3 and _outro.mp3 (ElevenLabs, George).
export const HANDLER = 'Major Ellis, No. 1 Special Force';

export const STORY = {
  vineyard: {
    date: 'Tuscany · July 1944', title: 'The Colonel at the Vineyard',
    intro: `Kestrel, Ellis. Welcome to Italy. The Germans are falling back towards the Gothic Line, and every mile they give us they make us pay for. Oberst Krause commands their post at a vineyard farm south of Siena, and he knows where the next line will be drawn: his orders are in the safe in his villa. Kill him, open the safe, and get back to your hill. Nobody knows you're here. Let's keep it that way.`,
    outro: `Good work, Kestrel. Krause's orders give us more than the line. There's a list attached: names, partisans in the hill town of San Vito, marked for arrest by the Gestapo. Those people are your guides from here on. If they're taken, you're blind. You're going into the town.`,
  },
  town: {
    date: 'San Vito, Umbria · August 1944', title: 'The Bell Tower',
    intro: `The Gestapo have taken over the town hall in San Vito, and the arrests begin at dawn. Their commander has the lists in his safe. Kill him, take the lists, and silence the observers in the bell tower, or the whole valley will see you coming. The partisans will owe you their lives. We're going to need them.`,
    outro: `The network is safe, and grateful. And the arrest lists carried a surprise: shipping notes. The Kriegsmarine is fuelling U-boats out of the harbour at Porto Venere, right under our noses. A tanker's loading there now. You know what to do.`,
  },
  harbour: {
    date: 'Porto Venere · August 1944', title: 'Low Tide',
    intro: `A supply ship is taking on fuel for the U-boats at Porto Venere. Sink her at her moorings, blow the fuel depot, and take the convoy schedule from the harbourmaster's office. Every ton of diesel you burn tonight is a convoy that gets through in the Atlantic.`,
    outro: `The harbour's burning, Kestrel, and the Germans know someone's been helping us. The schedule shows their answer: a counter-sniper unit, sent into the mountains to hunt the partisans, and fuel trucks bound for their camp in the pines. They're coming for your friends.`,
  },
  forest: {
    date: 'The Apennines · September 1944', title: 'Black Pine',
    intro: `A German counter-sniper unit is hunting the partisans from a hunting lodge deep in the forest. They're good, Kestrel, and they're looking for you. Find their commander before he finds you, and destroy the fuel dump at the logging camp so they can't follow.`,
    outro: `The hunters are finished, and the partisans have news. The rail junction in the Po valley is moving everything south to the front, including a railway gun. Our bombers can't touch it: the flak battery on the ridge above shoots them out of the sky. That battery has to go first.`,
  },
  flak: {
    date: 'The Apennine foothills · October 1944', title: 'Flak Line',
    intro: `The raid on the rail junction goes in tomorrow, and the bombers must cross the ridge where an 8.8 centimetre battery waits for them. It sits behind a trench line and two belts of wire. Get through, destroy the four guns, and take their fire plan. If those guns are still firing at seven in the morning, a lot of young men won't come home.`,
    outro: `The bombers came through, Kestrel, every one of them, and the junction's a ruin. But the railway gun wasn't there. They'd already moved it out by night, on a train through a smaller junction to the west. We've found it. It's still moving.`,
  },
  railway: {
    date: 'The Po valley · October 1944', title: 'Iron Road',
    intro: `The railway gun is passing through the junction at Borgo, heading for the coast. Stop the train, destroy the gun, and take the stationmaster's timetables. That gun can shell a beach from fifteen miles away. Don't let it reach one.`,
    outro: `The gun's finished. The timetables tell us the rest: the Germans are sending an armoured column to the coast to replace it, and it crosses the Serchio gorge on a single stone bridge. Every road to the coast runs over that bridge.`,
  },
  bridge: {
    date: 'The Serchio valley · November 1944', title: 'Broken Span',
    intro: `The armoured column must not cross the gorge. Plant your charges on the bridge's supports and blow it before the tanks arrive, and kill the engineer who could build them another. You're the only thing between those tanks and the coast.`,
    outro: `The bridge is in the river, and the column is stuck on the wrong side of it. Now I can tell you what this has all been for, Kestrel. There's going to be a landing on the Ligurian coast. One thing could still stop it from the air: the night fighters at the airfield near Bergamo.`,
  },
  airfield: {
    date: 'Bergamo, Lombardy · December 1944', title: 'Night Owl',
    intro: `Those night fighters will tear apart our paratroopers and the transport planes on the night of the landing. Destroy them on the ground, wreck the radar that guides them, and take the flight plans from the control tower. After tonight, the sky belongs to us.`,
    outro: `No night fighters will fly from Bergamo again. There's one thing left between our men and the beaches: the radar station and the coastal battery on the headland above them. The landing is tomorrow night. So is your last job, Kestrel.`,
  },
  radar: {
    date: 'The Ligurian coast · December 1944', title: 'Sea Wall',
    intro: `This is it, Kestrel. Tomorrow the landing craft come in under that headland. The radars on the cliff will see them, and the guns will sink them. Blind the radars, silence the guns, take the codebooks from the command bunker, and get back down to the cove. The fishermen will take you home.`,
    outro: `Kestrel, Ellis. The first wave is ashore, and the guns on the headland never fired a shot. Thousands of men walked up that beach because of what you did these last six months, and they'll never know your name. Come home, Kestrel. It's over for you.`,
  },
};

// The campaign so far, for the menu: the line before this mission's briefing.
export function storyLine(id) {
  const s = STORY[id];
  return s ? `<p class="story"><b>${s.date} · ${s.title}.</b> ${s.intro.split('. ').slice(0, 2).join('. ')}.</p>` : '';
}

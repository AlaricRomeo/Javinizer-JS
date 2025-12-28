const { nfoToActor, actorToNFO } = require('./scrapers/actors/schema.js');

// Test 1: Create actor with altName and convert to NFO
const actor = {
  id: 'test-alt',
  name: 'Mao Hamasaki',
  altName: '浜崎真緒',
  birthdate: '1993-10-20',
  height: 165
};

console.log('=== Test 1: Actor to NFO ===');
const nfo = actorToNFO(actor);
console.log(nfo);

console.log('\n=== Test 2: NFO back to Actor ===');
const parsedActor = nfoToActor(nfo);
console.log(JSON.stringify(parsedActor, null, 2));

const { fetchWithFlareSolverr, createSession, destroySession } = require('./scrapers-dev/xslist/flaresolverr');
const { JSDOM } = require('jsdom');

async function test() {
  await createSession();
  
  const html = await fetchWithFlareSolverr('https://xslist.org/en/model/10.html');
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  
  // Debug: print relevant text
  const bodyText = doc.body.textContent;
  console.log('\n=== BODY TEXT (looking for measurements) ===');
  const lines = bodyText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('88') || line.includes('59') || line.includes('87') || 
        line.includes('Measure') || line.includes('Born') || 
        line.includes('Height') || line.match(/B\d/i) || line.match(/W\d/i)) {
      console.log(`Line ${i}: ${line}`);
    }
  }
  
  console.log('\n=== BWH REGEX TEST ===');
  const bwhMatch = bodyText.match(/(?:Measurements:\s*)?B(\d{2,3})[^\d]*W(\d{2,3})[^\d]*H(\d{2,3})/i);
  console.log('Match:', bwhMatch);
  
  await destroySession();
}

test().catch(console.error);

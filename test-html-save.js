const { fetchWithFlareSolverr, createSession, destroySession } = require('./scrapers-dev/xslist/flaresolverr');
const fs = require('fs');

async function test() {
  await createSession();
  
  const html = await fetchWithFlareSolverr('https://xslist.org/en/model/10.html');
  
  // Save HTML to file
  fs.writeFileSync('/tmp/xslist-yui-hatano.html', html);
  console.log('HTML saved to /tmp/xslist-yui-hatano.html');
  
  // Check if Measurements is in HTML
  if (html.includes('Measurements:')) {
    console.log('✓ "Measurements:" found in HTML');
    
    // Extract the relevant section
    const idx = html.indexOf('Measurements:');
    const snippet = html.substring(idx, idx + 200);
    console.log('\nSnippet around Measurements:');
    console.log(snippet);
  } else {
    console.log('✗ "Measurements:" NOT found in HTML');
  }
  
  await destroySession();
}

test().catch(console.error);

const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.goto('https://www.javdatabase.com/idols/mao-hamasaki/', { waitUntil: 'domcontentloaded' });
  
  // Search for Japanese name patterns
  const result = await page.evaluate(() => {
    const bodyText = document.body.textContent;
    
    // Look for "浜崎真緒" or similar patterns
    const japaneseRegex = /([ぁ-んァ-ヶー一-龯]{2,})/g;
    const matches = bodyText.match(japaneseRegex);
    
    // Get unique matches
    const unique = [...new Set(matches || [])];
    
    // Also check for any elements with Japanese text near "name" or "alias"
    const allElements = Array.from(document.querySelectorAll('*'));
    const nameRelated = allElements.filter(el => {
      const text = el.textContent;
      return text.includes('Alias') || text.includes('Name') || text.includes('別名');
    }).map(el => el.textContent.trim().substring(0, 100));
    
    return {
      japaneseMatches: unique.slice(0, 20),
      nameRelatedElements: nameRelated
    };
  });
  
  console.log('Japanese text found:', result.japaneseMatches);
  console.log('\nName-related elements:', result.nameRelatedElements);
  
  await browser.close();
})();

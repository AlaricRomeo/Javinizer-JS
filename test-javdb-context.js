const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.goto('https://www.javdatabase.com/idols/mao-hamasaki/', { waitUntil: 'domcontentloaded' });
  
  const result = await page.evaluate(() => {
    const bodyText = document.body.textContent;
    const japaneseName = '浜崎真緒';
    
    // Find the position and context
    const index = bodyText.indexOf(japaneseName);
    if (index === -1) return 'Not found';
    
    // Get 200 chars before and after
    const start = Math.max(0, index - 200);
    const end = Math.min(bodyText.length, index + japaneseName.length + 200);
    const context = bodyText.substring(start, end);
    
    return context;
  });
  
  console.log('Context around Japanese name:\n', result);
  
  await browser.close();
})();

const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.goto('https://www.javdatabase.com/idols/mao-hamasaki/', { waitUntil: 'domcontentloaded' });
  
  // Get page HTML for the top section
  const topHtml = await page.evaluate(() => {
    const container = document.querySelector('.idol-name')?.parentElement?.parentElement;
    return container ? container.innerHTML.substring(0, 1500) : 'Not found';
  });
  console.log('Top HTML:\n', topHtml);
  
  await browser.close();
})();

const { scrapeR18Dev } = require('./scrapers/movies/r18dev/scrape.js');

(async () => {
  const rawData = {
    actresses: [
      {
        name_romaji: "Remu Hayami",
        name_kanji: "早美れむ",
        image_url: "https://example.com/hayami_remu.jpg"
      }
    ]
  };
  
  console.log('Testing with sample data:');
  console.log(JSON.stringify(rawData, null, 2));
  
  const result = await scrapeR18Dev(rawData);
  console.log('\nResult:');
  console.log(JSON.stringify(result.actor[0], null, 2));
})();

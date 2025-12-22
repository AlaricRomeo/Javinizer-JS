const { saveNfoPatch, saveNfoFull } = require("./src/core/saveNfo");

async function testPatch() {
  console.log("\n=== TEST PATCH MODE ===");
  console.log("Modifica solo title e director, preservando customField...\n");

  await saveNfoPatch("/tmp/test_original.nfo", {
    title: "Titolo MODIFICATO",
    director: "New Director"
  });

  console.log("✓ Patch applicata. Verifica il file /tmp/test_original.nfo");
  console.log("Il campo <customField> dovrebbe essere ancora presente.\n");
}

async function testFull() {
  console.log("\n=== TEST FULL MODE (per scraper) ===");
  console.log("Crea un NFO completo da zero...\n");

  const model = {
    id: "FULL-001",
    code: "FULL-001",
    title: "Titolo da Scraper",
    originalTitle: "Scraper Original Title",
    releaseDate: "2024-06-15",
    runtime: 150,
    studio: "Scraper Studio",
    director: "Scraper Director",
    plot: "This is a plot from scraper",
    tagline: "Scraped tagline",
    contentRating: "XXX",
    series: "Scraper Series",
    genres: ["Drama", "Thriller", "Romance"],
    tags: ["tag1", "tag2"],
    rating: {
      value: 9.2,
      votes: 250
    },
    actor: [
      {
        name: "Scraped Actor 1",
        altName: "スクレイプ1",
        role: "Actress",
        thumb: "http://example.com/scraped1.jpg"
      },
      {
        name: "Scraped Actor 2",
        altName: "スクレイプ2",
        role: "Actress",
        thumb: "http://example.com/scraped2.jpg"
      }
    ]
  };

  await saveNfoFull("/tmp/test_full.nfo", model);

  console.log("✓ NFO completo creato. Verifica il file /tmp/test_full.nfo\n");
}

async function run() {
  try {
    await testPatch();
    await testFull();
    console.log("\n✅ Tutti i test completati!");
  } catch (err) {
    console.error("\n❌ Errore:", err.message);
    console.error(err.stack);
  }
}

run();

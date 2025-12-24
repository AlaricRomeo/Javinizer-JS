#!/usr/bin/env node

/**
 * SCRAPER TEMPLATE
 *
 * Replace "TEMPLATE" with your scraper name everywhere in this file.
 *
 * Usage: node run.js <CODE> [CODE2] [CODE3] ...
 * Example: node run.js SDDM-943
 * Example: node run.js SDDM-943 JUR-618
 *
 * IMPORTANT RULES:
 * - Output ONLY valid JSON to stdout
 * - Output logs/messages to stderr (console.error)
 * - Return array format: [{ code: "XXX", ... }]
 * - Include 'code' or 'dvd_id' field in every object
 * - Remove null values, empty strings, empty arrays
 * - On error, return [{ code: "XXX" }] for each code
 */

const { scrape } = require('./scrape');

async function main() {
  const codes = process.argv.slice(2);

  if (codes.length === 0) {
    console.error('Usage: node run.js <CODE> [CODE2] [CODE3] ...');
    console.error('Example: node run.js SDDM-943');
    console.error('Example: node run.js SDDM-943 JUR-618');
    process.exit(1);
  }

  try {
    const results = await scrape(codes);

    // Output ONLY valid JSON to stdout
    if (Array.isArray(results)) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(JSON.stringify([results], null, 2));
    }

  } catch (error) {
    console.error(`[TEMPLATE Error] ${error.message}`);
    // On error, output minimal JSON array
    console.log(JSON.stringify(codes.map(code => ({ code })), null, 2));
    process.exit(1);
  }
}

main();

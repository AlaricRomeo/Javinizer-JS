#!/usr/bin/env node

/**
 * CLI entrypoint for javlibrary-fs scraper
 * Usage: node run.js <CODE> [CODE2] [CODE3] ...
 * Example: node run.js SDDM-943
 * Example: node run.js SDDM-943 DVDES-590 ABC-123
 */

const { scrape } = require('./scrape');

async function main() {
  const codes = process.argv.slice(2);

  if (codes.length === 0) {
    console.error('Usage: node run.js <CODE> [CODE2] [CODE3] ...');
    console.error('Example: node run.js SDDM-943');
    console.error('Example: node run.js SDDM-943 DVDES-590');
    process.exit(1);
  }

  let hasError = false;

  try {
    const results = await scrape(codes);

    // Check if any results have errors
    if (Array.isArray(results)) {
      hasError = results.some(r => r.error || (!r.title && !r.id));
    }

    // Output ONLY valid JSON to stdout
    if (Array.isArray(results)) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(JSON.stringify([results], null, 2));
    }

    // Exit with appropriate code
    process.exit(hasError ? 1 : 0);

  } catch (error) {
    console.error(`[Error] ${error.message}`);
    // On error, output minimal JSON array
    console.log(JSON.stringify(codes.map(code => ({ code })), null, 2));
    process.exit(1);
  }
}

main();

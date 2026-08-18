#!/usr/bin/env node

/**
 * Usage: node run.js <CODE> [CODE2] ...
 * Example: node run.js SSIS-001
 */

const { scrape } = require('./scrape');

async function main() {
  const codes = process.argv.slice(2);

  if (codes.length === 0) {
    console.error('Usage: node run.js <CODE> [CODE2] ...');
    process.exit(1);
  }

  try {
    const results = await scrape(codes);
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error(`[LibreDMM Error] ${err.message}`);
    console.log(JSON.stringify(codes.map(code => ({ code })), null, 2));
    process.exit(1);
  }
}

main();

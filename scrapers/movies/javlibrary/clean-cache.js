#!/usr/bin/env node

/**
 * Utility to clean browser cache manually
 * Usage: node clean-cache.js
 */

const fs = require('fs');
const path = require('path');

const userDataDir = path.join(__dirname, '.browser-data');

if (fs.existsSync(userDataDir)) {
  console.log('Cleaning browser cache...');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log('Cache cleaned successfully!');
} else {
  console.log('No cache to clean.');
}

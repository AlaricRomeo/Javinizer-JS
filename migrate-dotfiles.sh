#!/bin/bash
# Migration script to rename hidden files for Windows compatibility
# This preserves existing data by renaming .files to regular files

echo "🔄 Migrating hidden files for Windows compatibility..."

# Migrate actor index
if [ -f "data/actors/.index.json" ]; then
  echo "  → Renaming data/actors/.index.json to actors-index.json"
  mv "data/actors/.index.json" "data/actors/actors-index.json"
fi

# Migrate javlibrary browser data
if [ -d "scrapers/movies/javlibrary/.browser-data" ]; then
  echo "  → Renaming scrapers/movies/javlibrary/.browser-data to browser-data"
  mv "scrapers/movies/javlibrary/.browser-data" "scrapers/movies/javlibrary/browser-data"
fi

# Migrate javlibrary cookies
if [ -f "scrapers/movies/javlibrary/.cookies.json" ]; then
  echo "  → Renaming scrapers/movies/javlibrary/.cookies.json to cookies.json"
  mv "scrapers/movies/javlibrary/.cookies.json" "scrapers/movies/javlibrary/cookies.json"
fi

echo "✅ Migration complete!"
echo ""
echo "Note: If you had hidden files, they have been renamed."
echo "You can now run the server and it will work on both Linux and Windows."

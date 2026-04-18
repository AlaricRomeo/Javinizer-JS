/**
 * Genre filter — applies user-defined rules to a genres array after scraping.
 *
 * Syntax (one rule per line):
 *   -Creampie          → remove (exact or comma-token match, case-insensitive)
 *   Actress Best->Best Of → replace
 *   +New Genre         → add if not already present
 *   # comment          → ignored
 *
 * Token matching: "-3P" removes both "3P" and combined genres like "3P, 4P"
 * because "3P" appears as a comma-separated token inside them.
 */

function parseGenreRules(rulesText) {
  if (!rulesText || !rulesText.trim()) return [];

  return rulesText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      if (line.startsWith('-')) {
        return { type: 'remove', from: line.slice(1).trim() };
      }
      if (line.startsWith('+')) {
        return { type: 'add', to: line.slice(1).trim() };
      }
      const arrowIdx = line.indexOf('->');
      if (arrowIdx !== -1) {
        return { type: 'replace', from: line.slice(0, arrowIdx).trim(), to: line.slice(arrowIdx + 2).trim() };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Returns true if `ruleFrom` matches `genre` either:
 * - exactly (case-insensitive), or
 * - as a comma-separated token within the genre string
 */
function matchesGenre(genre, ruleFrom) {
  const g = genre.toLowerCase();
  const f = ruleFrom.toLowerCase();
  if (g === f) return true;
  // Check comma-separated tokens (e.g. "3P, 4P" contains token "3P")
  return genre.split(',').map(t => t.trim().toLowerCase()).includes(f);
}

function applyGenreRules(genres, rulesText) {
  const rules = parseGenreRules(rulesText);
  if (!rules.length) return genres;

  let result = [...genres];

  for (const rule of rules) {
    if (rule.type === 'remove') {
      result = result.filter(g => !matchesGenre(g, rule.from));
    } else if (rule.type === 'replace') {
      result = result.map(g => matchesGenre(g, rule.from) ? rule.to : g);
    } else if (rule.type === 'add') {
      if (!result.some(g => g.toLowerCase() === rule.to.toLowerCase())) {
        result.push(rule.to);
      }
    }
  }

  // Deduplicate (case-insensitive, keep first occurrence)
  const seen = new Set();
  return result.filter(g => {
    const key = g.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { parseGenreRules, applyGenreRules };

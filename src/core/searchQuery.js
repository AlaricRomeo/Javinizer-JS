/**
 * Boolean search queries over the library search index (see getSearchIndex()
 * in src/server/routes.js).
 *
 * Syntax (only active when the query uses one of the operators, otherwise the
 * whole query is a plain substring search, as before):
 *   AND, OR, NOT / !   operators (uppercase); AND binds tighter than OR
 *   ( ... )            grouping
 *   "big tits"         multi-word term
 *   solowork !vr       adjacent terms are an implicit AND
 *
 * Every term is a case-insensitive substring match against the folder name,
 * title, genres and actors (aliases included) of a movie.
 */

const BOOLEAN_SYNTAX = /\bAND\b|\bOR\b|\bNOT\b|!|\(|\)/;

/**
 * Split a query into terms, operators and parentheses.
 */
function tokenize(query) {
  const tokens = [];
  const re = /\s*(?:(\()|(\))|(!)|"([^"]*)"|([^\s()!"]+))/g;
  let m;
  while ((m = re.exec(query)) !== null) {
    if (m[0].trim() === '') break;
    if (m[1]) tokens.push({ type: '(' });
    else if (m[2]) tokens.push({ type: ')' });
    else if (m[3]) tokens.push({ type: 'NOT' });
    else if (m[4] !== undefined) tokens.push({ type: 'TERM', value: m[4].toLowerCase() });
    else if (m[5] === 'AND' || m[5] === 'OR' || m[5] === 'NOT') tokens.push({ type: m[5] });
    else tokens.push({ type: 'TERM', value: m[5].toLowerCase() });
  }
  return tokens;
}

/**
 * Recursive descent parser producing a predicate (entry) => boolean.
 *   expr  := and ( OR and )*
 *   and   := unary ( [AND] unary )*
 *   unary := NOT unary | '(' expr ')' | TERM
 */
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    const parts = [parseAnd()];
    while (peek() && peek().type === 'OR') {
      next();
      parts.push(parseAnd());
    }
    return parts.length === 1 ? parts[0] : entry => parts.some(p => p(entry));
  }

  function parseAnd() {
    const parts = [parseUnary()];
    while (peek() && peek().type !== 'OR' && peek().type !== ')') {
      if (peek().type === 'AND') next();
      parts.push(parseUnary());
    }
    return parts.length === 1 ? parts[0] : entry => parts.every(p => p(entry));
  }

  function parseUnary() {
    const token = next();
    if (!token) throw new Error('Unexpected end of query');
    if (token.type === 'NOT') {
      const inner = parseUnary();
      return entry => !inner(entry);
    }
    if (token.type === '(') {
      const inner = parseExpr();
      if (!peek() || next().type !== ')') throw new Error('Missing )');
      return inner;
    }
    if (token.type === 'TERM') return entry => entryContains(entry, token.value);
    throw new Error(`Unexpected ${token.type}`);
  }

  const predicate = parseExpr();
  if (pos < tokens.length) throw new Error(`Unexpected ${tokens[pos].type}`);
  return predicate;
}

/**
 * Whether a search index entry contains a lowercase term in any searchable field.
 */
function entryContains(entry, term) {
  return entry.name.toLowerCase().includes(term) ||
    entry.title.toLowerCase().includes(term) ||
    entry.genres.some(g => g.toLowerCase().includes(term)) ||
    entry.actors.some(a => a.toLowerCase().includes(term));
}

/**
 * Build a predicate for a raw (not lowercased) query. Plain queries, and
 * boolean ones that fail to parse, fall back to a whole-query substring match.
 *
 * @param {string} query
 * @returns {(entry: object) => boolean}
 */
function compileSearchQuery(query) {
  const plain = query.toLowerCase();
  if (BOOLEAN_SYNTAX.test(query)) {
    try {
      return parse(tokenize(query));
    } catch (err) {
      console.error(`[search] Invalid boolean query "${query}": ${err.message}`);
    }
  }
  return entry => entryContains(entry, plain);
}

module.exports = { compileSearchQuery };

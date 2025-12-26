# Interactive Scraper Protocol

This document describes the protocol for creating interactive scrapers that can communicate bidirectionally with the WebUI via WebSocket.

## Overview

Scrapers can request user interaction (e.g., solving Cloudflare challenges, manual CAPTCHA entry) by sending special messages to `stdout` and receiving responses via `stdin`.

The communication flow:
1. **Scraper** sends prompt message to stdout
2. **ScraperManager** intercepts it and emits WebSocket event
3. **WebUI** shows dialog to user
4. **User** responds via WebUI
5. **WebSocket** sends response to ScraperManager
6. **ScraperManager** forwards response to scraper via stdin
7. **Scraper** continues execution

## Protocol Format

### Sending a Prompt (Scraper → ScraperManager)

Send a line to `stdout` in this format:

```
__PROMPT__:{"type":"confirm","message":"Your message here"}
```

**Important**:
- Use `console.log()` (not `console.error()`)
- Message must be on a single line ending with `\n`
- Must be valid JSON after the `__PROMPT__:` prefix

**Prompt Types**:
- `confirm` - Yes/No confirmation dialog

**Example**:
```javascript
const promptData = {
  type: 'confirm',
  message: 'Please solve the Cloudflare challenge in the browser, then click Continue.'
};
console.log(`__PROMPT__:${JSON.stringify(promptData)}`);
```

### Receiving a Response (ScraperManager → Scraper)

The response will arrive via `stdin` as JSON:

```json
{"response": true}
```

or

```json
{"response": false}
```

**Example**:
```javascript
async function waitForUserConfirmation(message) {
  return new Promise((resolve) => {
    // Send prompt
    const promptData = { type: 'confirm', message };
    console.log(`__PROMPT__:${JSON.stringify(promptData)}`);

    // Wait for response on stdin
    const onData = (data) => {
      try {
        const response = JSON.parse(data.toString().trim());
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        resolve(response.response === true);
      } catch (error) {
        console.error(`Error parsing response: ${error.message}`);
        resolve(false);
      }
    };

    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

// Usage
const confirmed = await waitForUserConfirmation(
  'Please complete the CAPTCHA, then click Continue.'
);

if (confirmed) {
  console.error('[Scraper] User confirmed - continuing...');
} else {
  throw new Error('User canceled operation');
}
```

## Complete Example: Javlibrary Scraper

See [scrapers/movies/javlibrary/browser.js](movies/javlibrary/browser.js) for a complete working example.

Key points:
1. Use `console.log()` for prompt messages (goes to stdout)
2. Use `console.error()` for progress logs (goes to stderr)
3. Never mix prompt messages with regular JSON output
4. Always handle user cancellation gracefully

## WebUI Integration

The WebUI automatically handles prompt events and shows a modal dialog:

```javascript
case 'prompt':
  const userResponse = await showConfirmDialog(
    `${data.scraperName} - User Action Required`,
    data.message,
    'Continue',
    'Cancel'
  );

  scrapingWebSocket.send(JSON.stringify({
    type: 'promptResponse',
    promptId: data.promptId,
    response: userResponse
  }));
  break;
```

## Testing

### In CLI Mode (without WebSocket)
When running scrapers directly via CLI, ScraperManager automatically sends `{"response": true}` to all prompts.

### In WebUI Mode (with WebSocket)
User interactions are handled via modal dialogs.

## Best Practices

1. **Clear Messages**: Make prompt messages clear and actionable
   - ✅ "Please solve the Cloudflare challenge in the browser window, then click Continue."
   - ❌ "Press ENTER when ready"

2. **Handle Cancellation**: Always check if user canceled and handle gracefully
   ```javascript
   if (!confirmed) {
     throw new Error('User canceled operation');
   }
   ```

3. **Progress Logging**: Use `console.error()` for all progress messages
   ```javascript
   console.error('[Scraper] Opening browser...');
   console.error('[Scraper] Waiting for user...');
   ```

4. **JSON Output**: Keep final JSON output separate from prompts
   - Prompts go to stdout with `__PROMPT__:` prefix
   - Final results go to stdout as plain JSON
   - Progress logs go to stderr

## Troubleshooting

**Prompt not showing in WebUI?**
- Check that you're using `console.log()` (not `console.error()`)
- Verify the message ends with `\n`
- Check JSON is valid

**Response not received?**
- Make sure stdin listener is set up before sending prompt
- Check that you're parsing the full JSON object
- Verify `process.stdin.resume()` is called

**Scraper hangs?**
- Check if you're waiting for stdin but no prompt was sent
- Verify the prompt message format is correct
- Check WebSocket connection in browser console

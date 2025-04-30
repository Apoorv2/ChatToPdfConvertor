# ChatGPT to PDF Converter Chrome Extension Prompt (Free Tier)

I need a Chrome extension that implements the free tier of a "ChatGPT to PDF Converter," distributed via the Chrome Web Store. The extension scrapes ChatGPT conversations from the web UI (https://chat.openai.com/*) using a **content script approach** (content.js) for long-term reliability and precise content capture, generating professional PDFs with messages, speaker labels ("User" or "Assistant"), timestamps, images, equations, tables, and emojis, limited to 5 exports per day. The solution must be cost-free (except $5 Chrome Web Store fee, deferred), using client-side JavaScript, jsPDF for PDF generation, and localStorage for tracking exports, with no external APIs, servers, or paid libraries. It bypasses CORS restrictions for images using preloaded `<img>` elements and canvas. Equations (raw LaTeX like `\(...\)` or `$$...$$`, code blocks, or KaTeX-rendered `<span class="katex">`) are extracted with regex and DOM parsing. Emojis (Unicode like 😊, HTML entities like `😊`, or `<img>` tags ≤32x32px) are extracted and rendered as text using a subsetted Noto Sans Symbols font (~50KB, externalized). Content extraction must use `content.js` with mutation observers and message passing, not `chrome.scripting.executeScript`, to keep `popup.js` concise (<5KB). To prevent `popup.js` bloat, consolidate rendering into `renderItem`, move UI logic to `popup-ui.js`, externalize fonts, and preserve `// CRITICAL` functions. It cannot be sold on ChatGPT’s platform (e.g., GPT Store) due to technical incompatibility and OpenAI’s ToS restrictions on scraping, so it uses the Chrome Web Store with a freemium model (5/day free, premium upsell). It differentiates from ChatGPT’s native PDF generation (server-side, prompt-based, less private) and competitors (e.g., chatgpt2pdf.app, PDFCrowd) by offering 100% local processing, a one-click UI, and clear freemium clarity.

### Requirements
1. **Functionality (Free Tier)**:
   - Scrape conversation messages from ChatGPT’s web UI (https://chat.openai.com/*) using a content script (content.js).
   - Extract:
     - Message text, speaker (User or Assistant), timestamp (use current time if unavailable).
     - Images (e.g., `<img>` tags, max 5 per export, converted to data URLs via canvas).
     - Equations (raw LaTeX like `\(...\)` or `$$...$$`, code blocks like ```latex\n...\n```, or `<span class="katex">`, extracted with regex and DOM parsing, max 10 per export).
     - Tables (e.g., `<table>`, markdown-style `| Col1 | Col2 |`, max 10 rows).
     - Emojis (Unicode like 😊, HTML entities like `😊`, or `<img>` tags ≤32x32px, extracted as text or images, max included in text/image limits).
     - Explanation text surrounding equations and emojis, preserving order.
   - Generate a PDF with:
     - Header: “ChatGPT Conversation, [Date]”
     - Messages formatted as: “[Speaker] ([Timestamp]): [Text with 😊]”
     - Images embedded below text (resized to 50% width, max 5) using data URLs from canvas.
     - Equations as plain text, prefixed with “Equation:” (e.g., “Equation: x^2 + y^2 = z^2”).
     - Tables as grids using jsPDF autoTable (max 10 rows).
     - Emojis rendered as text using Noto Sans Symbols font (~50KB, in `fonts/notoSansSymbols.js`).
     - Consistent, professional layout (no user prompt needed).
   - Limit to 5 PDF exports per day, tracked in localStorage (reset daily).
   - Display a pop-up UI with:
     - “Generate PDF” button.
     - Export counter (e.g., “2/5 exports used today”).
     - Notes: “Includes images, equations, tables, emojis”, “Privacy: 100% local, no data sent to servers”, “Some images/equations/emojis may not export if not loaded. Scroll to load and try again”, “Scrapes ChatGPT’s UI locally. Contact support@openai.com for concerns”, “Equations/emojis render as plain text in free tier. Upgrade for enhanced formatting.”
     - Premium upsell: “Upgrade for unlimited exports and formatted equations/emojis!” (link to https://your-site.com/premium).
   - If limit exceeded, show: “Daily limit reached. Try again tomorrow or upgrade to premium.”
   - Handle errors (e.g., “No messages found”, “CSP blocked”, “Image failed to load”, “Canvas tainted”, “Equation parsing failed”, “Emoji rendering failed”) with alerts: “Failed to process some images/equations/emojis. Scroll to load and try again.”
2. **Technical Details**:
   - Use vanilla JavaScript and jsPDF (free library) for PDF generation, with autoTable for tables.
   - Use localStorage to store export count and date.
   - Scrape using a content script (content.js) with DOM parsing (e.g., querySelectorAll) and generic selectors (e.g., `div[class*="message"]`, `article`, `[role="log"]`, `div[role="presentation"]`) to find messages, images (`<img>`), equations (`.katex`, LaTeX), tables (`<table>`, markdown), and emojis (Unicode, HTML entities).
   - Use mutation observers in `content.js` to capture dynamically loaded messages (e.g., scroll-loaded).
   - **Content Script Approach**:
     - Implement extraction in `content.js` (e.g., `extractChatGPTContent`), not `popup.js`.
     - Use `chrome.runtime.sendMessage` to send data to `popup.js`.
     - Avoid `chrome.scripting.executeScript` to prevent `popup.js` bloat and CSP issues.
   - **Equation Extraction**:
     - Use regex (`\$\$([^\$]+)\$\$|\$([^\$]+)\$|\\\[([^\]]+)\\\]|\\\((\S.*?\S)\\\)|\`{3}latex\n([\s\S]*?)\n\`{3}`) to detect raw LaTeX and code blocks.
     - Parse `<span class="katex">` for rendered equations, extracting text or `data-latex`.
     - Split message text to separate explanation text and equations, preserving order.
   - **Emoji Extraction**:
     - Use regex (`/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu`) to detect Unicode emojis.
     - Decode HTML entities (e.g., `😊`) using a textarea element.
     - Check `<img>` tags for small dimensions (≤32x32px) to handle potential emoji images, marking as `{ type: 'image', isEmoji: true }`.
     - Output as `{ type: 'text'|'equation'|'image', speaker, timestamp, content, isEmoji? }`.
   - **Bypass CORS for Images**:
     - Use preloaded `<img>` elements from the DOM, waiting for `img.onload`.
     - Draw images on a canvas to generate data URLs (e.g., `canvas.toDataURL('image/jpeg')`).
     - Handle canvas tainting errors by skipping affected images and logging: “Skipping tainted image due to CORS.”
   - **Emoji Rendering**:
     - Use a subsetted Noto Sans Symbols font (~50KB, in `fonts/notoSansSymbols.js`) with jsPDF’s `addFileToVFS` and `addFont`.
     - Render text with emojis using `doc.setFont('NotoSansSymbols', 'normal')`.
     - Fallback to Helvetica for non-emoji text or errors.
   - Communicate scraped data from `content.js` to `popup.js` via `chrome.runtime.sendMessage`.
   - No external APIs, servers, proxies, or paid libraries (e.g., no PDFCrowd API, CORS Anywhere, KaTeX/twemoji in free tier).
   - Host on Chrome Web Store (one-time $5 fee, deferred).
   - **Freemium Model**:
     - Free tier: 5 exports/day, plain text equations, text-based emojis.
     - Premium tier: Unlock unlimited exports and KaTeX-rendered equations/colored emoji images via in-app purchase or external subscription (link to https://your-site.com/premium).
     - Check licensing with `chrome.webstore.getLicenseInfo`.
   - **Code Optimization**:
     - Keep `popup.js` concise (<5KB, excluding external font) by consolidating rendering into `renderItem`, moving UI logic to `popup-ui.js`, and externalizing fonts.
     - Use `content.js` for all content extraction, with mutation observers and message passing.
     - Preserve functions marked `// CRITICAL` (e.g., `imageToDataURL`, `renderItem`, `extractEquations`) in all changes.
     - Provide diffs for targeted edits, avoiding full file overwrites.
     - Use modular functions (e.g., `extractEmojis`, `extractEquations`, `renderItem`) to isolate changes.
3. **Extension Structure**:
   - `manifest.json`: Define permissions (`activeTab`, `storage`, `downloads`), content scripts for `https://chat.openai.com/*`, and web-accessible resources (`fonts/notoSansSymbols.js`).
   - `content.js`: Scrape messages, images, equations (with regex), tables, emojis (Unicode, entities, small images), waiting for image loads, sending data via `chrome.runtime.sendMessage`.
   - `popup.html`: UI with button, counter, privacy note, ToS disclaimer, premium link, and `<script src="popup-ui.js">`.
   - `popup.js`: Handle PDF generation (jsPDF, `renderItem`), receive scraped data, generate data URLs via canvas, render equations/emojis as text, enforce export limits, and load external font.
   - `popup-ui.js`: Handle UI logic (button click, counter, premium upsell).
   - `fonts/notoSansSymbols.js`: Export Noto Sans Symbols base64 font (~50KB).
4. **Constraints**:
   - Client-side only; no backend, proxies, or server.
   - Use content script approach (content.js) for reliability, privacy, and precise content capture; explicitly avoid `chrome.scripting.executeScript`.
   - No AI models, external APIs, or paid libraries.
   - Handle ChatGPT’s dynamic UI and security policies (e.g., CSP, CORS) with generic selectors, mutation observers, and canvas-based image processing.
   - Keep code lightweight (~100KB total, like `chatgpt2pdf.app`) for performance; `popup.js` <5KB, font ~50KB, no KaTeX/twemoji in free tier.
   - Ensure privacy: no data collection, local processing only. Include comment: `// Privacy: All processing is local using jsPDF and localStorage; no data is sent to servers.`
   - Limit images to 5, equations to 10, tables to 10 rows, emojis included in text/image limits for performance.
   - Comply with OpenAI’s ToS by stating local processing and recommending users contact `support@openai.com` for concerns. Advise seeking OpenAI’s permission for commercial scraping.
   - Distribute via Chrome Web Store, not ChatGPT’s GPT Store, due to technical incompatibility and ToS restrictions.
5. **Output**:
   - Generate complete code for:
     - `manifest.json`
     - `content.js`
     - `popup.html`
     - `popup.js`
     - `popup-ui.js`
     - `fonts/notoSansSymbols.js` (with placeholder base64)
   - Include comments explaining key logic (e.g., mutation observers, canvas image processing, equation regex, emoji rendering, CORS bypass, freemium licensing, privacy, ToS compliance).
   - Provide diffs for changes to preserve existing fixes (e.g., `imageToDataURL`, `extractEquations`, `renderItem`).
   - Provide a setup guide for testing locally in Chrome and publishing to Chrome Web Store.
   - Use jsPDF via CDN (`https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js`).
   - Include placeholder for Noto Sans Symbols base64 font; advise using `https://fontsubset.com` to generate ~50KB subset.
6. **Additional Notes**:
   - If ChatGPT’s DOM is unclear, assume messages are in `<div>` with classes like `message` or `chat-bubble`, with sub-elements for speaker, timestamp, images (`<img>`), equations (`.katex`, LaTeX), tables (`<table>`, markdown), and emojis (Unicode, HTML entities, or small `<img>`).
   - Use mutation observers in `content.js` for dynamic content:
     ```javascript
     // CRITICAL: Do not modify; handles dynamic content
     const observer = new MutationObserver(() => {
       const messages = document.querySelectorAll('div[class*="message"]');
       const scrapedData = Array.from(messages).map((msg, index) => ({
         speaker: msg.querySelector('div[class*="user"]') ? 'User' : 'Assistant',
         timestamp: new Date().toLocaleTimeString(),
         content: extractContent(msg),
         index
       }));
       chrome.runtime.sendMessage({ action: 'contentScraped', data: scrapedData });
     });
     observer.observe(document.body, { childList: true, subtree: true });
     ```
   - Handle image CORS by using canvas:
     ```javascript
     // CRITICAL: Do not modify; handles CORS bypass for images
     function imageToDataURL(img) {
       try {
         const canvas = document.createElement('canvas');
         canvas.width = img.width;
         canvas.height = img.height;
         const ctx = canvas.getContext('2d');
         ctx.drawImage(img, 0, 0);
         return canvas.toDataURL('image/jpeg');
       } catch (error) {
         console.warn('Skipping tainted image due to CORS:', error);
         return null;
       }
     }
     ```
   - Extract equations with regex and DOM parsing:
     ```javascript
     // CRITICAL: Do not modify; handles equation extraction
     const latexRegex = /\$\$([^\$]+)\$\$|\$([^\$]+)\$|\\\[([^\]]+)\\\]|\\\((\S.*?\S)\\\)|\`{3}latex\n([\s\S]*?)\n\`{3}/g;
     function extractContent(node) {
       const items = [];
       const textContent = node.textContent;
       let lastIndex = 0;
       let match;
       while ((match = latexRegex.exec(textContent))) {
         const equation = match[1] || match[2] || match[3] || match[4] || match[5];
         const startIndex = match.index;
         if (startIndex > lastIndex) {
           items.push({ type: 'text', content: textContent.slice(lastIndex, startIndex).trim() });
         }
         items.push({ type: 'equation', content: equation.trim() });
         lastIndex = latexRegex.lastIndex;
       }
       if (lastIndex < textContent.length) {
         items.push({ type: 'text', content: textContent.slice(lastIndex).trim() });
       }
       node.querySelectorAll('span.katex').forEach(katex => {
         const equationText = katex.textContent || katex.getAttribute('data-latex') || '';
         if (equationText) {
           items.push({ type: 'equation', content: equationText.trim() });
         }
       });
       return items.filter(item => item.content);
     }
     ```
   - Extract and render emojis:
     ```javascript
     // CRITICAL: Do not modify; handles emoji extraction
     const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
     function decodeEntities(text) {
       const textarea = document.createElement('textarea');
       textarea.innerHTML = text;
       return textarea.value;
     }
     function extractContent(node) { ... } // Includes emoji regex
     ```
   - Consolidated rendering:
     ```javascript
     // CRITICAL: Do not modify; handles unified rendering
     function renderItem(doc, item, yPosition) {
       if (item.type === 'text') {
         doc.setFont('NotoSansSymbols', 'normal');
         doc.text(`${item.speaker} (${item.timestamp}): ${item.content}`, 10, yPosition);
         return yPosition + 10;
       } else if (item.type === 'equation') {
         doc.setFont('Helvetica', 'normal');
         doc.text(`Equation: ${item.content}`, 10, yPosition);
         return yPosition + 10;
       } else if (item.type === 'image') {
         const dataURL = imageToDataURL(item.content);
         if (dataURL) {
           doc.addImage(dataURL, 'JPEG', 10, yPosition, item.content.width * 0.5, item.content.height * 0.5);
           return yPosition + item.content.height * 0.5 + 10;
         }
       }
       return yPosition;
     }
     ```
   - Externalized font:
     ```javascript
     // fonts/notoSansSymbols.js
     export const notoSansSymbolsBase64 = 'data:font/ttf;base64,...'; // Generate via https://fontsubset.com
     ```
   - Implement freemium licensing:
     ```javascript
     // CRITICAL: Do not modify; handles freemium licensing
     chrome.webstore.getLicenseInfo((licenseInfo) => {
       if (licenseInfo && licenseInfo.accessLevel === 'FULL') {
         exportLimit = Infinity;
       }
     });
     ```
   - Handle errors (e.g., “No messages found”, “Image failed to load”, “Canvas tainted”, “Equation parsing failed”, “Emoji rendering failed”) with alerts.
   - Avoid premium features (e.g., AI summaries, KaTeX rendering, twemoji images, custom templates) in free tier.
   - Assume 5MB localStorage limit is sufficient.
   - Differentiate from:
     - **ChatGPT Native PDF**: Server-side, prompt-based, less private, inconsistent equation/emoji formatting, no dedicated UI.
     - **PDFCrowd**: API-based, privacy concerns, no freemium limit.
     - **chatgpt2pdf.app**: Unlimited free, no freemium, less upsell clarity.
     - Emphasize privacy, one-click UI, 5/day limit, professional PDFs, CORS bypass via canvas, robust equation/emoji extraction, Chrome Web Store distribution.

Please generate the code for the Chrome extension, ensuring it meets all requirements and constraints. Use a content script approach (`content.js`) with mutation observers and message passing for content extraction, avoiding `chrome.scripting.executeScript`. Keep `popup.js` concise (<5KB) by consolidating rendering into `renderItem`, moving UI logic to `popup-ui.js`, and externalizing fonts. Preserve functions marked `// CRITICAL` (e.g., `imageToDataURL`, `renderItem`, `extractContent`) and provide diffs for changes. Include a setup guide for testing locally and publishing to Chrome Web Store. Keep the code simple, well-commented, and focused on the free tier, with privacy, one-click UI, ToS transparency, and professional formatting to compete with ChatGPT’s native PDF generation.
# ChatGPT to PDF Converter Chrome Extension Prompt (Free Tier)

I need a Chrome extension that implements the free tier of a "ChatGPT to PDF Converter," distributed via the Chrome Web Store. The extension scrapes ChatGPT conversations from the web UI (https://chat.openai.com/*) using a **content script approach** for long-term reliability and precise content capture, generating professional PDFs with messages, speaker labels ("User" or "Assistant"), timestamps, images, equations, and tables, limited to 5 exports per day. The solution must be cost-free (except $5 Chrome Web Store fee, deferred), using client-side JavaScript, jsPDF for PDF generation, and localStorage for tracking exports, with no external APIs, servers, or paid libraries. It bypasses CORS restrictions for images using preloaded `<img>` elements and canvas. Equations (raw LaTeX like `\(...\)` or `$$...$$`, code blocks like ```latex\n...\n```, or KaTeX-rendered `<span class="katex">`) are extracted with explanation text using regex and DOM parsing, rendered as plain text in PDFs. It cannot be sold on ChatGPT’s platform (e.g., GPT Store) due to technical incompatibility and OpenAI’s ToS restrictions on scraping, so it uses the Chrome Web Store with a freemium model (5/day free, premium upsell). It differentiates from ChatGPT’s native PDF generation (server-side, prompt-based, less private) and competitors (e.g., chatgpt2pdf.app, PDFCrowd) by offering 100% local processing, a one-click UI, and clear freemium clarity.

### Requirements
1. **Functionality (Free Tier)**:
   - Scrape conversation messages from ChatGPT’s web UI (https://chat.openai.com/*) using a content script (content.js).
   - Extract:
     - Message text, speaker (User or Assistant), timestamp (use current time if unavailable).
     - Images (e.g., `<img>` tags, max 5 per export, converted to data URLs via canvas).
     - Equations (raw LaTeX like `\(...\)` or `$$...$$`, code blocks like ```latex\n...\n```, or `<span class="katex">`, extracted with regex and DOM parsing, max 10 per export).
     - Tables (e.g., `<table>`, markdown-style `| Col1 | Col2 |`, max 10 rows).
     - Explanation text surrounding equations, preserving order.
   - Generate a PDF with:
     - Header: “ChatGPT Conversation, [Date]”
     - Messages formatted as: “[Speaker] ([Timestamp]): [Text]”
     - Images embedded below text (resized to 50% width, max 5) using data URLs from canvas.
     - Equations as plain text, prefixed with “Equation:” (e.g., “Equation: x^2 + y^2 = z^2”).
     - Tables as grids using jsPDF autoTable (max 10 rows).
     - Consistent, professional layout (no user prompt needed).
   - Limit to 5 PDF exports per day, tracked in localStorage (reset daily).
   - Display a pop-up UI with:
     - “Generate PDF” button.
     - Export counter (e.g., “2/5 exports used today”).
     - Notes: “Includes images, equations, tables”, “Privacy: 100% local, no data sent to servers”, “Some images/equations may not export if not loaded. Scroll to load and try again”, “Scrapes ChatGPT’s UI locally. Contact support@openai.com for concerns”, “Equations render as plain text in free tier. Upgrade for formatted equations.”
     - Premium upsell: “Upgrade for unlimited exports and formatted equations!” (link to https://your-site.com/premium).
   - If limit exceeded, show: “Daily limit reached. Try again tomorrow or upgrade to premium.”
   - Handle errors (e.g., “No messages found”, “CSP blocked”, “Image failed to load”, “Canvas tainted”, “Equation parsing failed”) with alerts: “Failed to process some images/equations. Scroll to load and try again.”
2. **Technical Details**:
   - Use vanilla JavaScript and jsPDF (free library) for PDF generation, with autoTable for tables.
   - Use localStorage to store export count and date.
   - Scrape using a content script (content.js) with DOM parsing (e.g., querySelectorAll) and generic selectors (e.g., `div[class*="message"]`, `article`, `[role="log"]`, `div[role="presentation"]`) to find messages, images (`<img>`), equations (`.katex`, LaTeX), and tables (`<table>`, markdown).
   - Use mutation observers to capture dynamically loaded messages (e.g., scroll-loaded).
   - **Equation Extraction**:
     - Use regex (`\$\$([^\$]+)\$\$|\$([^\$]+)\$|\\\[([^\]]+)\\\]|\\\((\S.*?\S)\\\)|\`{3}latex\n([\s\S]*?)\n\`{3}`) to detect raw LaTeX and code blocks.
     - Parse `<span class="katex">` for rendered equations, extracting text or `data-latex`.
     - Split message text to separate explanation text and equations, preserving order.
     - Output as `{ type: 'text'|'equation', speaker, timestamp, content }`.
   - **Bypass CORS for Images**:
     - Use preloaded `<img>` elements from the DOM, waiting for `img.onload`.
     - Draw images on a canvas to generate data URLs (e.g., `canvas.toDataURL('image/jpeg')`).
     - Handle canvas tainting errors by skipping affected images and logging: “Skipping tainted image due to CORS.”
   - Communicate scraped data to popup.js via chrome.runtime.sendMessage.
   - No external APIs, servers, proxies, or paid libraries (e.g., no PDFCrowd API, CORS Anywhere, KaTeX in free tier).
   - Host on Chrome Web Store (one-time $5 fee, deferred).
   - **Freemium Model**:
     - Free tier: 5 exports/day, plain text equations.
     - Premium tier: Unlock unlimited exports and KaTeX-rendered equations via in-app purchase or external subscription (link to https://your-site.com/premium).
     - Check licensing with chrome.webstore.getLicenseInfo.
3. **Extension Structure**:
   - `manifest.json`: Define permissions (activeTab, storage, downloads) and content scripts for https://chat.openai.com/*.
   - `content.js`: Scrape messages, images, equations (with regex and DOM parsing), tables, waiting for image loads, sending data via chrome.runtime.sendMessage.
   - `popup.html`: UI with button, counter, privacy note, ToS disclaimer, error handling, and premium link.
   - `popup.js`: Handle button clicks, receive scraped data, generate data URLs via canvas, render equations as text, create PDF with jsPDF, enforce export limits, and check premium license.
4. **Constraints**:
   - Client-side only; no backend, proxies, or server.
   - Use content script approach (not chrome.scripting.executeScript) for reliability, privacy, and precise content capture.
   - No AI models, external APIs, or paid libraries.
   - Handle ChatGPT’s dynamic UI and security policies (e.g., CSP, CORS) with generic selectors, mutation observers, and canvas-based image processing.
   - Keep code lightweight (~100KB, like chatgpt2pdf.app) for performance; no KaTeX in free tier.
   - Ensure privacy: no data collection, local processing only. Include comment: `// Privacy: All processing is local using jsPDF and localStorage; no data is sent to servers.`
   - Limit images to 5, equations to 10, tables to 10 rows for performance.
   - Comply with OpenAI’s ToS by stating local processing and recommending users contact support@openai.com for concerns. Advise seeking OpenAI’s permission for commercial scraping.
   - Distribute via Chrome Web Store, not ChatGPT’s GPT Store, due to technical incompatibility and ToS restrictions.
5. **Output**:
   - Generate complete code for:
     - `manifest.json`
     - `content.js`
     - `popup.html`
     - `popup.js`
   - Include comments explaining key logic (e.g., mutation observers, canvas image processing, equation regex, CORS bypass, freemium licensing, privacy, ToS compliance).
   - Provide a setup guide for testing locally in Chrome and publishing to Chrome Web Store.
   - Use jsPDF via CDN (https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js).
6. **Additional Notes**:
   - If ChatGPT’s DOM is unclear, assume messages are in `<div>` with classes like “message” or “chat-bubble”, with sub-elements for speaker, timestamp, images (`<img>`), equations (`.katex`, LaTeX), and tables (`<table>`, markdown).
   - Use mutation observers for dynamic content:
     ```javascript
     const observer = new MutationObserver(() => {
       const messages = document.querySelectorAll('div[class*="message"]');
       chrome.runtime.sendMessage({ messages: processMessages(messages) });
     });
     observer.observe(document.body, { childList: true, subtree: true });
     ```
   - Handle image CORS by using canvas:
     ```javascript
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
     const latexRegex = /\$\$([^\$]+)\$\$|\$([^\$]+)\$|\\\[([^\]]+)\\\]|\\\((\S.*?\S)\\\)|\`{3}latex\n([\s\S]*?)\n\`{3}/g;
     function extractEquations(node) {
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
   - Implement freemium licensing:
     ```javascript
     chrome.webstore.getLicenseInfo((licenseInfo) => {
       if (licenseInfo && licenseInfo.accessLevel === 'FULL') {
         exportLimit = Infinity;
       }
     });
     ```
   - Handle errors (e.g., “No messages found”, “Image failed to load”, “Canvas tainted”, “Equation parsing failed”) with alerts.
   - Avoid premium features (e.g., AI summaries, KaTeX rendering, custom templates) in free tier.
   - Assume 5MB localStorage limit is sufficient.
   - Differentiate from:
     - **ChatGPT Native PDF**: Server-side, prompt-based, less private, inconsistent equation formatting, no dedicated UI.
     - **PDFCrowd**: API-based, privacy concerns, no freemium limit.
     - **chatgpt2pdf.app**: Unlimited free, no freemium, less upsell clarity.
     - Emphasize privacy, one-click UI, 5/day limit, professional PDFs, CORS bypass via canvas, robust equation extraction, Chrome Web Store distribution.

Please generate the code for the Chrome extension, ensuring it meets all requirements and constraints. Use the content script approach with canvas-based image processing to bypass CORS and regex-based DOM parsing to extract equations with explanation text. Include a setup guide for testing locally and publishing to Chrome Web Store. Keep the code simple, well-commented, and focused on the free tier, with privacy, one-click UI, ToS transparency, and professional formatting to compete with ChatGPT’s native PDF generation.
/**
 * ChatGPT to PDF Converter - Content Script
 * Handles all content extraction from ChatGPT's UI using DOM parsing
 * and mutation observers for reliable capture of dynamic content.
 * 
 * Privacy: All processing is local; no data is sent to external servers.
 */

// Add this at the top of content.js
console.log('Content script loaded at:', new Date().toISOString());

// Add error handling for script injection
window.onerror = function(msg, url, lineNo, columnNo, error) {
  console.error('Content script error:', {
    message: msg,
    url: url,
    lineNo: lineNo,
    columnNo: columnNo,
    error: error
  });
  return false;
};

// Send a console message to confirm loading
console.log('ChatGPT PDF Converter content script LOADED at', new Date().toISOString());

// Add at the top of the file
const DEBUG = true;

function debugLog(...args) {
  if (DEBUG) {
    console.log('[ChatGPT-PDF]', ...args);
  }
}

// Update the message listener in content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debugLog('Received message:', request);
  
  if (request.action === 'ping') {
    console.log('Received ping, responding with pong');
    sendResponse({status: 'pong'});
    return true;
  }
  
  // Add handling for extractContentDirect
  if (request.type === 'FROM_EXTENSION' && request.action === 'extractContentDirect') {
    debugLog('Starting content extraction...');
    try {
      const data = getConversationData();
      debugLog('Extraction complete:', data);
      
      if (!data.messages || data.messages.length === 0) {
        debugLog('No messages found in extracted data');
        sendResponse({ success: false, error: 'No messages found in conversation' });
        return false;
      }
      
      chrome.storage.local.set({ chatContent: data }, () => {
        debugLog('Content saved to storage');
        sendResponse({ success: true, messageCount: data.messages.length });
      });
      
      return true;
    } catch (error) {
      debugLog('Extraction error:', error);
      sendResponse({ success: false, error: error.message });
      return false;
    }
  }
  
  return false; // No response for other messages
});

// Add at the beginning of content.js
console.log('Content script loaded for ChatGPT to PDF conversion');

// Store extracted conversation data
let conversationData = {
  title: '',
  messages: []
};

// Track if we're currently observing
let isObserving = false;

// Initialize when the page loads
initializeExtraction();

// Debug helper
function logDOMStructure() {
  console.log('=== DOM Structure Analysis ===');
  
  // Check main containers
  const mainContainer = document.querySelector('div.flex.flex-col.items-center');
  console.log('Main container found:', !!mainContainer);
  
  // Check message containers
  const messageContainers = document.querySelectorAll('div.group.w-full');
  console.log('Message containers found:', messageContainers.length);
  
  // Check text content
  const textElements = document.querySelectorAll('div[class*="text-base"], div[class*="markdown"]');
  console.log('Text elements found:', textElements.length);
  
  console.log('=== End DOM Analysis ===');
}

// Call this when initializing
document.addEventListener('DOMContentLoaded', () => {
  console.log('Content script initializing...');
  logDOMStructure();
});

/**
 * Initialize the extraction process
 */
function initializeExtraction() {
  console.log('Initializing ChatGPT content extraction');
  
  // Clear any existing processed markers
  document.querySelectorAll('.processed').forEach(el => {
    el.classList.remove('processed');
  });
  
  // Reset conversation data
  conversationData = {
    title: '',
    messages: []
  };
  
  // Set page title
  updateConversationTitle();
  
  // Initial extraction of existing content
  extractCurrentContent();
  
  // Setup observer for dynamic content
  setupMutationObserver();
}

/**
 * Update the conversation title
 */
function updateConversationTitle() {
  const title = document.title.replace(' - ChatGPT', '').trim();
  conversationData.title = title || 'ChatGPT Conversation';
}

/**
 * Extract all current content on the page
 */
function extractCurrentContent() {
  debugLog('Extracting current content');
  // Clear previous markers
  document.querySelectorAll('.processed').forEach(el => el.classList.remove('processed'));

  // Strategy 1: Articles inside main
  let blocks = Array.from(document.querySelectorAll('main article'));
  debugLog('extractCurrentContent: articles found:', blocks.length);
  
  // Strategy 2: data-testid conversation turns
  if (blocks.length === 0) {
    blocks = Array.from(document.querySelectorAll('[data-testid="conversation-turn"]'));
    debugLog('extractCurrentContent: data-testid found:', blocks.length);
  }
  
  // Strategy 3: ChatGPT group style
  if (blocks.length === 0) {
    blocks = Array.from(document.querySelectorAll('div.group.w-full'));
    debugLog('extractCurrentContent: group.w-full found:', blocks.length);
  }

  // Strategy 4: fallback generic div patterns
  if (blocks.length === 0) {
    blocks = Array.from(document.querySelectorAll('div[class*="min-h-"]'));
    debugLog('extractCurrentContent: generic min-h- found:', blocks.length);
  }

  // Process each block, skipping duplicates
  let count = 0;
  let lastBlockText = '';
  blocks.forEach((block, idx) => {
    if (!isValidMessageBlock(block)) return;
    const text = block.innerText.trim();
    if (text && text === lastBlockText) return; // skip duplicate block
    lastBlockText = text;
    processMessageBlock(block, idx);
    count++;
  });
  debugLog('extractCurrentContent: processed count', count);

  if (blocks.length > 0) {
    debugLog('First block HTML snippet:', blocks[0].outerHTML.substring(0, 200));
  }
}

function isValidMessageBlock(block) {
  // Skip empty blocks or those with only whitespace/newlines
  if (!block.textContent.trim()) {
    return false;
  }
  
  // Skip system messages and UI elements
  const unwantedClasses = ['cursor-pointer', 'absolute', 'hidden'];
  if (unwantedClasses.some(cls => block.className.includes(cls))) {
    return false;
  }
  
  return true;
}

function extractMessageData(block) {
  try {
    // Determine if this is a user message
    const isUser = block.closest('div[class*="dark:bg-gray-800"]') || 
                  block.querySelector('[data-message-author-role="user"]');
    
    const speaker = isUser ? 'User' : 'Assistant';
    const timestamp = new Date().toLocaleTimeString();
    
    const items = [];
    
    // Extract code blocks first
    const codeBlocks = block.querySelectorAll('pre');
    codeBlocks.forEach(pre => {
      const code = pre.querySelector('code');
      if (code) {
        const language = getCodeLanguage(pre);
        items.push({
          type: 'code',
          content: code.textContent.trim(),
          language: language
        });
      }
    });
    
    // Extract text segments (multiple markdown/text containers)
    const textContainers = block.querySelectorAll(
      'div[class*="markdown"], div[class*="text-base"]'
    );
    textContainers.forEach(container => {
      // Skip code block containers
      if (container.querySelector('pre, code')) return;
      const rawText = container.innerText.trim();
      if (rawText) {
        items.push({ type: 'text', content: sanitizeTextForPDF(rawText) });
        debugLog('Found text:', rawText);
      }
    });
    
    // Only return if we have content
    if (items.length > 0) {
      return {
        speaker,
        timestamp,
        items
      };
    }
  } catch (error) {
    console.error('Error extracting message data:', error);
  }
  
  return null;
}

function getCodeLanguage(preElement) {
  const classes = preElement.className.split(' ');
  for (const cls of classes) {
    if (cls.startsWith('language-')) {
      return cls.replace('language-', '');
    }
  }
  return '';
}

/**
 * CRITICAL: Do not modify; handles image-to-data-URL conversion
 * Convert image to data URL
 */
function imageToDataURL(imgSrc) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = function() {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          const dataURL = canvas.toDataURL('image/jpeg');
          resolve(dataURL);
        } catch (error) {
          console.warn('Skipping tainted image due to CORS:', error);
          reject(error);
        }
      };
      
      img.onerror = function(error) {
        console.warn('Error loading image:', error);
        reject(error);
      };
      
      img.src = imgSrc;
    } catch (error) {
      console.warn('Error creating image:', error);
      reject(error);
    }
  });
}

/**
 * Sanitize text for PDF output
 */
function sanitizeTextForPDF(text) {
  if (!text) return '';
  // Remove any script-like content
  if (text.includes('window.') || text.includes('document.') || text.includes('function(')) {
    return '';
  }
  // Strip out non-ASCII and control characters (keep printable ASCII 0x20-0x7E)
  const cleaned = text.replace(/[^\x20-\x7E]+/g, ' ')
                      // Collapse whitespace
                      .replace(/\s+/g, ' ')
                      .trim();
  return cleaned;
}

/**
 * Extract and format equations
 */
function formatEquation(equation) {
  if (!equation) return '';
  
  // Fix repeated characters in variable names
  let formatted = equation.replace(/([A-Za-z])\1{2,}/g, '$1');
  
  // Remove excess whitespace
  formatted = formatted.trim();
  
  // Make fractions more readable
  formatted = formatted
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    .replace(/\\frac ([^{])(.) ([^{])(.)/g, '$1$2/$3$4');
  
  // Fix spacing around operators
  formatted = formatted
    .replace(/([0-9a-zA-Z])\+/g, '$1 + ')
    .replace(/\+([0-9a-zA-Z])/g, '+ $1')
    .replace(/([0-9a-zA-Z])-/g, '$1 - ')
    .replace(/-([0-9a-zA-Z])/g, '- $1')
    .replace(/([0-9a-zA-Z])\*/g, '$1 × ')
    .replace(/\*([0-9a-zA-Z])/g, '× $1');
  
  // Fix common symbols
  formatted = formatted
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\gamma/g, 'γ')
    .replace(/\\delta/g, 'δ')
    .replace(/\\theta/g, 'θ')
    .replace(/\\pi/g, 'π')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\mu/g, 'μ')
    .replace(/\\infty/g, '∞')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\div/g, '÷')
    .replace(/\\approx/g, '≈')
    .replace(/\\neq/g, '≠')
    .replace(/\\ne/g, '≠')
    .replace(/\\geq/g, '≥')
    .replace(/\\leq/g, '≤');
    
  // Clean up any remaining LaTeX commands
  formatted = formatted
    .replace(/\\[a-zA-Z]+/g, '') // Remove any other LaTeX commands
    .replace(/\{|\}/g, '')      // Remove curly braces
    .replace(/\\left|\\right/g, '');  // Remove left/right commands
    
  // Final cleanup
  formatted = formatted
    .replace(/\s+/g, ' ')       // Normalize spaces
    .trim();
    
  return formatted;
}

function isValidContent(text) {
  if (!text) return false;
  
  const unwantedPatterns = [
    'window.__oai',
    'window._oai',
    'request Animation Frame',
    'Search Reason',
    'HTML?window',
    'SSR_HTML',
    'TTI?window',
    'Date.now()',
    'undefined'
  ];
  
  text = text.trim();
  return text.length > 0 && 
         !unwantedPatterns.some(pattern => text.includes(pattern)) &&
         !/^[\s\d.]+$/.test(text); // Skip if only numbers/spaces/dots
}

// Add this function to content.js
function getConversationData() {
  debugLog('Getting conversation data for PDF generation');
  // Reset any previous messages and update title
  conversationData.messages = [];
  updateConversationTitle();
  debugLog('Title:', conversationData.title);
  
  // Run structured extraction to populate messages
  extractCurrentContent();
  debugLog(`After structured pass, found ${conversationData.messages.length} messages`);
  
  // --- Structured extraction logic ---
  // (find mainContainer, messageGroups, call processMessageBlock as before)
  // e.g.:
  // const mainContainer = document.querySelector('div[class*="react-scroll-to-bottom"], div[class*="flex-1 overflow-hidden"]');
  // if (mainContainer) { /* process messageGroups */ }
  
  // FALLBACK: if no structured messages, grab entire page text
  if (conversationData.messages.length === 0) {
    debugLog('No structured messages found – falling back to plain text');
    const raw = document.body.innerText.trim();
    if (raw) {
      conversationData.messages.push({
        speaker: 'ChatGPT Conversation',
        timestamp: new Date().toLocaleTimeString(),
        items: [{ type: 'text', content: sanitizeTextForPDF(raw) }]
      });
    }
  }

  // Always return at least one message
  return {
    title:    conversationData.title,
    messages: [...conversationData.messages]
  };
}

// Update the message processing function
function processMessageBlock(block, index) {
  debugLog(`Processing message block ${index}`);
  try {
    if (block.classList.contains('processed')) return;
    block.classList.add('processed');
    let isUser = false;
    const userRoleEl = block.querySelector('[data-message-author-role="user"]');
    if (userRoleEl) isUser = true;
    else {
      const parentRole = block.closest('[data-message-author-role]');
      if (parentRole) isUser = parentRole.getAttribute('data-message-author-role') === 'user';
      else if (block.classList.contains('dark:bg-gray-800')) isUser = true;
    }
    const speaker = isUser ? 'User' : 'Assistant';
    const timestamp = new Date().toLocaleTimeString();
    const items = [];
    const segs = block.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,' +
      'p,' +
      'div[class*="markdown"],div[class*="text-base"],' +
      'ul,ol,' +
      'pre,' +
      'table,' +
      'img,' +
      'span.katex'
    );
    debugLog('Block segments count:', segs.length);
    segs.forEach(el => {
      // 1) Extract code blocks first
      if (el.tagName === 'PRE') {
        const codeEl = el.querySelector('code');
        if (codeEl) {
          const content = codeEl.textContent.trim();
          const language = getCodeLanguage(el);
          items.push({ type: 'code', content, language });
          debugLog('Code block found:', language, content);
        }
        return;
      }
      // 2) Extract markdown/text-base paragraphs & lists, but skip if contains code
      if (el.tagName === 'DIV' && (el.className.includes('markdown') || el.className.includes('text-base'))) {
        // Instead of treating entire div as plain text, extract its structure properly
        debugLog('Processing structured markdown container...');
        
        // Check for headings first (h1-h6)
        el.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
          const txt = heading.innerText.trim();
          if (txt) {
            items.push({ type: 'text', content: sanitizeTextForPDF(txt) });
            debugLog('Heading:', txt);
          }
        });
        
        // Extract paragraphs that aren't inside other elements we handle separately
        const paragraphs = Array.from(el.querySelectorAll('p'))
          .filter(p => !p.closest('pre, ol, ul'));
        
        paragraphs.forEach(p => {
          const txt = p.innerText.trim();
          if (txt) {
            items.push({ type: 'text', content: sanitizeTextForPDF(txt) });
            debugLog('Paragraph:', txt);
          }
        });
        
        // Process lists and their items carefully
        el.querySelectorAll('ol, ul').forEach(list => {
          // Skip if already inside a processed list
          if (list.closest('ol, ul') !== list) return;
          
          Array.from(list.querySelectorAll('li')).forEach(li => {
            // Only process direct children of this list
            if (li.closest('ol, ul') !== list) return;
            
            const txt = li.innerText.trim();
            if (txt) {
              items.push({ type: 'text', content: '• ' + sanitizeTextForPDF(txt) });
              debugLog('List item:', txt);
            }
          });
        });
        
        // Find any loose text nodes or spans not in elements we've already processed
        const directTextContainers = Array.from(el.querySelectorAll('div'))
          .filter(div => {
            // Skip divs that contain elements we handle separately
            return !div.querySelector('pre, code, h1, h2, h3, h4, h5, h6, p, ol, ul, table');
          });
        
        directTextContainers.forEach(container => {
          const txt = container.innerText.trim();
          if (txt) {
            items.push({ type: 'text', content: sanitizeTextForPDF(txt) });
            debugLog('Direct text container:', txt);
          }
        });
        
        // Find all code blocks nested inside this markdown container
        el.querySelectorAll('pre code').forEach(code => {
          // Skip if we've already processed this PRE (parent) element
          if (code.closest('pre').classList.contains('processed')) return;
          
          const pre = code.closest('pre');
          pre.classList.add('processed');
          const content = code.textContent.trim();
          const language = getCodeLanguage(pre);
          items.push({ type: 'code', content, language });
          debugLog('Nested code block found:', language, content);
        });
        
        return;
      }
      try {
        const tag = el.tagName;
        if (/^H[1-6]$/.test(tag) || tag === 'P') {
          const txt = el.innerText.trim();
          if (txt) {
            items.push({ type: 'text', content: sanitizeTextForPDF(txt) });
            debugLog('Text:', txt);
          }
        } else if (tag === 'UL' || tag === 'OL') {
          Array.from(el.children).forEach(li => {
            const txt = li.innerText.trim();
            if (txt) {
              items.push({ type: 'text', content: '• ' + sanitizeTextForPDF(txt) });
              debugLog('List item:', txt);
            }
          });
        } else if (tag === 'TABLE') {
          const headers = Array.from(el.querySelectorAll('thead th'))
            .map(th => sanitizeTextForPDF(th.innerText.trim()))
            .filter(h => h);
          const rows = Array.from(el.querySelectorAll('tbody tr')).map(tr =>
            Array.from(tr.querySelectorAll('td'))
              .map(td => sanitizeTextForPDF(td.innerText.trim()))
          );
          items.push({ type: 'table', headers, rows });
          debugLog('Table rows:', rows.length);
        } else if (tag === 'IMG') {
          const src = el.src;
          if (src) {
            items.push({ type: 'image', content: src });
            debugLog('Image:', src);
          }
        } else if (el.classList.contains('katex')) {
          const latex = el.getAttribute('data-latex');
          if (latex) {
            items.push({ type: 'equation', content: latex.trim() });
            debugLog('KaTeX equation:', latex);
          }
        }
      } catch (err) {
        console.warn('Segment error:', err);
      }
    });
    if (items.length > 0) {
      conversationData.messages.push({ speaker, timestamp, items });
      debugLog(`Added ${speaker} message with ${items.length} items`);
    }
  } catch (error) {
    debugLog(`Error processing message block ${index}:`, error);
  }
}

// Add this helper function
function getCodeLanguage(preElement) {
  if (!preElement) return '';
  
  const classes = preElement.className.split(' ');
  for (const cls of classes) {
    if (cls.startsWith('language-')) {
      return cls.replace('language-', '');
    }
  }
  return '';
}

// Add this to help with debugging
function logDOMStructure() {
  debugLog('=== DOM Structure Analysis ===');
  
  const mainContainer = document.querySelector('div[class*="react-scroll-to-bottom"]');
  debugLog('Main container found:', !!mainContainer);
  
  if (mainContainer) {
    const messageGroups = mainContainer.querySelectorAll('div[class*="group w-full"]');
    debugLog('Message groups found:', messageGroups.length);
    
    const textElements = mainContainer.querySelectorAll('div[class*="markdown"]');
    debugLog('Text elements found:', textElements.length);
    
    const codeBlocks = mainContainer.querySelectorAll('pre code');
    debugLog('Code blocks found:', codeBlocks.length);
  }
  
  debugLog('=== End DOM Analysis ===');
}

// Call this when initializing
document.addEventListener('DOMContentLoaded', () => {
  debugLog('Content script initializing...');
  logDOMStructure();
}); 
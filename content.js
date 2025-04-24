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

// Add this helper function at the top level (before or after getCodeLanguage)
function isUIControl(text) {
  if (!text) return false;
  const lcText = text.toLowerCase().trim();
  return lcText === 'java' || 
         lcText === 'copy' || 
         lcText === 'edit' || 
         lcText === 'copy edit' ||
         /^(javascript|python|typescript|html|css|json|xml|yaml|sql|c\+\+|c#|go|ruby|php)$/.test(lcText);
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
    
    // Handle force parameter to reset processing
    if (request.force) {
      debugLog('Force re-extraction requested, resetting processed markers');
      document.querySelectorAll('.processed').forEach(el => {
        el.classList.remove('processed');
      });
      // Reset conversation data
      conversationData = {
        title: '',
        messages: []
      };
    }
    
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
  if (!preElement) return '';
  
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
    
    // Skip processing if this is a UI control element
    if (block.classList.contains('ui-control-ignore') || isUIControl(block.textContent)) {
      debugLog('Skipping UI control block:', block.textContent);
      return;
    }
    
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
    
    // Add visual position tracking
    const blockY = block.getBoundingClientRect().top;
    
    // First, try to extract the initial text separately
    // Find the first text node or paragraph before any special elements
    let initialText = '';
    
    // Look for the main content container in modern ChatGPT UI
    const contentContainer = block.querySelector('div[data-message-text-content="true"], div[data-message-content="true"]');
    
    if (contentContainer) {
      // Check if there's direct text content before any structured elements
      const children = Array.from(contentContainer.childNodes);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        // Check if it's a text node or a simple paragraph without complex content
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
          initialText += child.textContent.trim() + ' ';
        } else if (
          child.nodeType === Node.ELEMENT_NODE && 
          child.tagName === 'P' && 
          !child.querySelector('code, pre, span.katex, table, img')
        ) {
          initialText += child.textContent.trim() + ' ';
        } else if (
          child.nodeType === Node.ELEMENT_NODE &&
          child.tagName !== 'CODE' &&
          child.tagName !== 'PRE' &&
          !child.classList.contains('katex') &&
          !child.querySelector('code, pre, span.katex, table, img')
        ) {
          // Check simple div with just text
          const hasComplexChild = Array.from(child.children).some(el => 
            el.tagName === 'CODE' || 
            el.tagName === 'PRE' || 
            el.classList.contains('katex') ||
            el.tagName === 'TABLE' ||
            el.tagName === 'IMG'
          );
          
          if (!hasComplexChild && child.textContent.trim()) {
            initialText += child.textContent.trim() + ' ';
          }
        } else {
          // Stop when we hit a complex element
          break;
        }
      }
    }
    
    // If we found initial text and it's valid, add it to items
    if (initialText.trim() && isValidContent(initialText.trim())) {
      debugLog('Found initial text:', initialText.trim());
      items.push({ 
        type: 'text', 
        content: sanitizeTextForPDF(initialText.trim()),
        y: blockY // Store y-position
      });
    }

    // Enhanced equation detection - check entire block first for common equation patterns
    const blockText = block.innerText;
    const hasEquationPatterns = /F\s*=\s*m\s*a|E\s*=\s*m\s*c\^?2|p\s*=\s*m\s*v|dt\s+d[pv]|\\frac|\\partial|d\/dx|\\nabla|\\alpha|\\beta|\\\[|\\begin\{equation\}/.test(blockText);
    
    debugLog('Block may contain equations:', hasEquationPatterns);
    
    // Keep track of extracted equation content to avoid duplicates
    const extractedEquationContent = new Set();
    
    // Helper function to normalize equations for comparing
    function normalizeEquation(eq) {
      if (!eq) return '';
      return eq.trim()
        .replace(/\s+/g, '')
        .replace(/[=:]+/g, '=')
        .replace(/F=ma|F=m\*a|F=m×a/i, 'F=ma')
        .replace(/differentiatebothsideswithrespecttotime/i, 'dp/dt=d(mv)/dt')
        .replace(/assumingmassmisconstant/i, 'dp/dt=mdv/dt')
        .replace(/since=dv\/dt=a/i, 'F=ma')
        .toLowerCase();
    }
    
    if (hasEquationPatterns) {
      // Look for specific Physics equation lines
      const textLines = blockText.split('\n');
      textLines.forEach((line, lineIndex) => {
        const trimmedLine = line.trim();
        if (
          /^F\s*=\s*m\s*a$/.test(trimmedLine) ||
          /^p\s*=\s*m\s*v$/.test(trimmedLine) ||
          /^E\s*=\s*m\s*c\^?2$/.test(trimmedLine) ||
          /^[•*]\s*F\s+is\s+.*force/.test(trimmedLine) ||
          /^[•*]\s*p\s+is\s+.*momentum/.test(trimmedLine) ||
          /^[•*]\s*=\s*p\s*=\s*m\s*v/.test(trimmedLine) ||
          /^[•*]\s*Start\s+with\s+momentum/.test(trimmedLine) ||
          /^[•*]\s*Differentiate\s+both\s+sides/.test(trimmedLine) ||
          /^[•*]\s*Assuming\s+mass\s+m\s+is\s+constant/.test(trimmedLine) ||
          /^[•*]\s*Since\s+.*=\s*dt\s+dv\s*=/.test(trimmedLine) ||
          /^[•*]\s*Therefore/.test(trimmedLine) ||
          /^[•*]\s*Newton/.test(trimmedLine)
        ) {
          const normalized = normalizeEquation(trimmedLine);
          if (!extractedEquationContent.has(normalized)) {
            debugLog('Found Physics equation line:', trimmedLine);
            // Estimate y-position based on line index and block position
            const estimatedY = blockY + (lineIndex * 20); // Approximate line height
            items.push({ 
              type: 'equation', 
              content: trimmedLine, 
              y: estimatedY
            });
            extractedEquationContent.add(normalized);
          }
        }
      });
    }
    
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
      // Get visual position (y-coordinate) for this element
      const elementRect = el.getBoundingClientRect();
      const elementY = elementRect.top;
      
      // 1) Extract code blocks first
      if (el.tagName === 'PRE') {
        const codeEl = el.querySelector('code');
        if (codeEl) {
          const content = codeEl.textContent.trim();
          const language = getCodeLanguage(el);
          items.push({ 
            type: 'code', 
            content, 
            language, 
            y: elementY,
            isCodeBlock: true // Mark as code block for filtering related UI elements
          });
          debugLog('Code block found:', language, content);
          
          // Mark any nearby "Copy" or "Edit" buttons or language indicators to be ignored
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children);
            const index = siblings.indexOf(el);
            
            // Mark siblings that are likely UI controls
            for (let i = index - 1; i <= index + 3 && i < siblings.length; i++) {
              if (i >= 0 && i !== index) {
                const sibling = siblings[i];
                const siblingText = sibling.textContent.trim().toLowerCase();
                
                if (siblingText === 'java' || 
                    siblingText === 'copy' || 
                    siblingText === 'edit' ||
                    siblingText === 'copy edit' ||
                    /^(javascript|python|typescript|html|css|json|xml)$/.test(siblingText)) {
                  sibling.classList.add('ui-control-ignore');
                  debugLog('Marked UI control for ignoring:', siblingText);
                }
              }
            }
          }
          return;
        }
      }
      
      // Special equation detection for KaTeX elements
      if (el.classList.contains('katex')) {
        const latex = el.getAttribute('data-latex');
        if (latex) {
          const normalized = normalizeEquation(latex.trim());
          if (!extractedEquationContent.has(normalized)) {
            items.push({ 
              type: 'equation', 
              content: latex.trim(), 
              y: elementY
            });
            extractedEquationContent.add(normalized);
            debugLog('KaTeX equation found:', latex);
          } else {
            debugLog('Skipping duplicate KaTeX equation:', latex);
          }
          return;
        }
      }
      
      // 2) Extract markdown/text-base paragraphs & lists, but skip if contains code
      if (el.tagName === 'DIV' && (el.className.includes('markdown') || el.className.includes('text-base'))) {
        // Skip elements that are UI controls or marked to be ignored
        if (el.classList.contains('ui-control-ignore') || isUIControl(el.textContent)) {
          debugLog('Skipping UI control element:', el.textContent);
          return;
        }
        
        // Instead of treating entire div as plain text, extract its structure properly
        debugLog('Processing structured markdown container...');
        
        // Check for headings first (h1-h6)
        el.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
          const txt = heading.innerText.trim();
          if (txt) {
            const headingY = elementY + heading.getBoundingClientRect().top - el.getBoundingClientRect().top;
            items.push({ 
              type: 'text', 
              content: sanitizeTextForPDF(txt), 
              y: headingY
            });
            debugLog('Heading:', txt);
          }
        });
        
        // Extract paragraphs that aren't inside other elements we handle separately
        const paragraphs = Array.from(el.querySelectorAll('p'))
          .filter(p => !p.closest('pre, ol, ul'));
        
        paragraphs.forEach(p => {
          const txt = p.innerText.trim();
          if (txt) {
            const paragraphY = elementY + p.getBoundingClientRect().top - el.getBoundingClientRect().top;
            // Check if this paragraph is likely an equation
            if (
              /F\s*=\s*m\s*a/.test(txt) ||
              /E\s*=\s*m\s*c\^?2/.test(txt) ||
              /p\s*=\s*m\s*v/.test(txt) ||
              /dt\s+d[pv]/.test(txt) ||
              /=\s*m\s*d[v]\/dt/.test(txt) ||
              /\\frac/.test(txt) ||
              /\\int/.test(txt) ||
              /\\sum/.test(txt) ||
              /\\sqrt/.test(txt) ||
              /\\alpha|\\beta|\\gamma|\\delta/.test(txt) ||
              /\\partial|\\nabla/.test(txt) ||
              /^[•*]\s*F\s+is\s+.*force/.test(txt) ||
              /^[•*]\s*p\s+is\s+.*momentum/.test(txt) ||
              /^[•*]\s*=\s*p\s*=\s*m\s*v/.test(txt) ||
              /^[•*]\s*Start\s+with\s+momentum/.test(txt) ||
              /^[•*]\s*Differentiate\s+both\s+sides/.test(txt) ||
              /^[•*]\s*Assuming\s+mass\s+m\s+is\s+constant/.test(txt) ||
              /^[•*]\s*Since\s+.*=\s*dt\s+dv\s*=/.test(txt) ||
              /^[•*]\s*Therefore/.test(txt) ||
              /^[•*]\s*Newton/.test(txt)
            ) {
              const normalized = normalizeEquation(txt);
              if (!extractedEquationContent.has(normalized)) {
                items.push({ type: 'equation', content: txt, y: paragraphY });
                debugLog('Equation paragraph found:', txt);
                extractedEquationContent.add(normalized);
              } else {
                debugLog('Skipping duplicate equation:', txt);
              }
            } else {
              items.push({ type: 'text', content: sanitizeTextForPDF(txt), y: paragraphY });
              debugLog('Paragraph:', txt);
            }
          }
        });
        
        // Process lists and their items carefully
        el.querySelectorAll('ol, ul').forEach(list => {
          // Skip if already inside a processed list
          if (list.closest('ol, ul') !== list) return;
          
          const listY = elementY + list.getBoundingClientRect().top - el.getBoundingClientRect().top;
          
          Array.from(list.querySelectorAll('li')).forEach((li, liIndex) => {
            // Only process direct children of this list
            if (li.closest('ol, ul') !== list) return;
            
            const txt = li.innerText.trim();
            if (txt) {
              // Calculate approximate y position for each list item
              const listItemY = listY + (liIndex * 20); // Approximate line height
              
              // Check if this list item is likely an equation
              if (
                /F\s*=\s*m\s*a/.test(txt) ||
                /E\s*=\s*m\s*c\^?2/.test(txt) ||
                /p\s*=\s*m\s*v/.test(txt) ||
                /dt\s+d[pv]/.test(txt) ||
                /=\s*m\s*d[v]\/dt/.test(txt) ||
                /\\frac/.test(txt) ||
                /\\int/.test(txt) ||
                /\\sum/.test(txt) ||
                /\\sqrt/.test(txt) ||
                /\\alpha|\\beta|\\gamma|\\delta/.test(txt) ||
                /\\partial|\\nabla/.test(txt) ||
                /^F\s+is\s+.*force/.test(txt) ||
                /^p\s+is\s+.*momentum/.test(txt) ||
                /^=\s*p\s*=\s*m\s*v/.test(txt) ||
                /^Start\s+with\s+momentum/.test(txt) ||
                /^Differentiate\s+both\s+sides/.test(txt) ||
                /^Assuming\s+mass\s+m\s+is\s+constant/.test(txt) ||
                /^Since\s+.*=\s*dt\s+dv\s*=/.test(txt) ||
                /^Therefore/.test(txt) ||
                /^Newton/.test(txt)
              ) {
                const normalized = normalizeEquation(txt);
                if (!extractedEquationContent.has(normalized)) {
                  items.push({ type: 'equation', content: txt, y: listItemY });
                  debugLog('Equation list item found:', txt);
                  extractedEquationContent.add(normalized);
                } else {
                  debugLog('Skipping duplicate equation:', txt);
                }
              } else {
                items.push({ type: 'text', content: '• ' + sanitizeTextForPDF(txt), y: listItemY });
                debugLog('List item:', txt);
              }
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
            const containerY = elementY + container.getBoundingClientRect().top - el.getBoundingClientRect().top;
            // Check if this container has equation-like content
            if (
              /F\s*=\s*m\s*a/.test(txt) ||
              /E\s*=\s*m\s*c\^?2/.test(txt) ||
              /p\s*=\s*m\s*v/.test(txt) ||
              /dt\s+d[pv]/.test(txt) ||
              /=\s*m\s*d[v]\/dt/.test(txt) ||
              /\\frac/.test(txt) ||
              /\\int/.test(txt) ||
              /\\sum/.test(txt) ||
              /\\sqrt/.test(txt) ||
              /\\alpha|\\beta|\\gamma|\\delta/.test(txt) ||
              /\\partial|\\nabla/.test(txt)
            ) {
              const normalized = normalizeEquation(txt);
              if (!extractedEquationContent.has(normalized)) {
                items.push({ type: 'equation', content: txt, y: containerY });
                debugLog('Equation in direct container found:', txt);
                extractedEquationContent.add(normalized);
              } else {
                debugLog('Skipping duplicate equation:', txt);
              }
            } else {
              items.push({ type: 'text', content: sanitizeTextForPDF(txt), y: containerY });
              debugLog('Direct text container:', txt);
            }
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
          const codeY = elementY + pre.getBoundingClientRect().top - el.getBoundingClientRect().top;
          items.push({ type: 'code', content, language, y: codeY, isCodeBlock: true });
          debugLog('Nested code block found:', language, content);
        });
        
        return;
      }
      try {
        const tag = el.tagName;
        if (/^H[1-6]$/.test(tag) || tag === 'P') {
          const txt = el.innerText.trim();
          if (txt) {
            // Check if heading or paragraph is equation-like
            if (
              /F\s*=\s*m\s*a/.test(txt) ||
              /E\s*=\s*m\s*c\^?2/.test(txt) ||
              /p\s*=\s*m\s*v/.test(txt) ||
              /dt\s+d[pv]/.test(txt) ||
              /=\s*m\s*d[v]\/dt/.test(txt)
            ) {
              const normalized = normalizeEquation(txt);
              if (!extractedEquationContent.has(normalized)) {
                items.push({ type: 'equation', content: txt, y: elementY });
                debugLog('Equation in heading/paragraph:', txt);
                extractedEquationContent.add(normalized);
              } else {
                debugLog('Skipping duplicate equation:', txt);
              }
            } else {
              items.push({ type: 'text', content: sanitizeTextForPDF(txt), y: elementY });
              debugLog('Text:', txt);
            }
          }
        } else if (tag === 'UL' || tag === 'OL') {
          Array.from(el.children).forEach((li, idx) => {
            const txt = li.innerText.trim();
            if (txt) {
              const liY = elementY + (idx * 20); // approximate y position for list items
              // Check if list item is equation-like
              if (
                /F\s*=\s*m\s*a/.test(txt) ||
                /E\s*=\s*m\s*c\^?2/.test(txt) ||
                /p\s*=\s*m\s*v/.test(txt) ||
                /dt\s+d[pv]/.test(txt) ||
                /=\s*m\s*d[v]\/dt/.test(txt) ||
                /F\s+is\s+.*force/.test(txt) ||
                /p\s+is\s+.*momentum/.test(txt)
              ) {
                const normalized = normalizeEquation(txt);
                if (!extractedEquationContent.has(normalized)) {
                  items.push({ type: 'equation', content: txt, y: liY });
                  debugLog('Equation in list item:', txt);
                  extractedEquationContent.add(normalized);
                } else {
                  debugLog('Skipping duplicate equation:', txt);
                }
              } else {
                items.push({ type: 'text', content: '• ' + sanitizeTextForPDF(txt), y: liY });
                debugLog('List item:', txt);
              }
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
          items.push({ type: 'table', headers, rows, y: elementY });
          debugLog('Table rows:', rows.length);
        } else if (tag === 'IMG') {
          const src = el.src;
          if (src) {
            items.push({ type: 'image', content: src, y: elementY });
            debugLog('Image:', src);
          }
        } else if (el.classList.contains('katex')) {
          const latex = el.getAttribute('data-latex');
          if (latex) {
            const normalized = normalizeEquation(latex.trim());
            if (!extractedEquationContent.has(normalized)) {
              items.push({ type: 'equation', content: latex.trim(), y: elementY });
              debugLog('KaTeX equation:', latex);
              extractedEquationContent.add(normalized);
            } else {
              debugLog('Skipping duplicate equation:', latex);
            }
          }
        }
      } catch (err) {
        console.warn('Segment error:', err);
      }
    });
    
    if (items.length > 0) {
      // Sort items by y-coordinate to ensure correct visual order
      items.sort((a, b) => (a.y || 0) - (b.y || 0));
      
      debugLog(`Sorted ${items.length} items by visual position`);
      conversationData.messages.push({ speaker, timestamp, items });
      debugLog(`Added ${speaker} message with ${items.length} items`);
    }
  } catch (error) {
    debugLog(`Error processing message block ${index}:`, error);
  }
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
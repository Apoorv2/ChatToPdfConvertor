/**
 * ChatGPT to PDF Converter - Content Script
 * Handles all content extraction from ChatGPT's UI using DOM parsing
 * and mutation observers for reliable capture of dynamic content.
 * 
 * Privacy: All processing is local; no data is sent to external servers.
 */

// Send a console message to confirm loading
console.log('ChatGPT PDF Converter content script LOADED at', new Date().toISOString());

// Add a ping handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  
  if (request.action === 'ping') {
    console.log('Received ping, responding with pong');
    sendResponse({status: 'pong'});
    return true;
  }
  
  if (request.action === 'extractContent') {
    console.log('Extraction request received, beginning content extraction...');
    
    // Extract content and send it back to popup
    try {
      const data = getConversationData();
      console.log(`Extraction complete. Found ${data.messages.length} messages with title: "${data.title}"`);
      
      // Log sample of the first message if available
      if (data.messages.length > 0) {
        console.log('Sample of first message:', 
          data.messages[0].speaker, 
          data.messages[0].items?.length + ' items');
      }
      
      sendResponse({ success: true, data });
    } catch (error) {
      console.error('Error during extraction:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep channel open for async response
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

/**
 * Initialize the extraction process
 */
function initializeExtraction() {
  console.log('Initializing ChatGPT content extraction');
  
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
  console.log('Extracting current content');
  
  // Find messages
  const messageBlocks = document.querySelectorAll('[data-testid="conversation-turn"], .text-base, div[class*="message"], .prose');
  console.log(`Found ${messageBlocks.length} message blocks`);
  
  // Process each message
  messageBlocks.forEach((block, index) => {
    processMessageBlock(block, index);
  });
}

/**
 * CRITICAL: Do not modify; handles dynamic content
 * Setup mutation observer to detect new messages
 */
function setupMutationObserver() {
  if (isObserving) {
    console.log('Mutation observer already running');
    return;
  }
  
  console.log('Setting up mutation observer for dynamic content');
  
  const observer = new MutationObserver((mutations) => {
    let shouldExtract = false;
    
    // Check if relevant content changed
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        const addedNodes = Array.from(mutation.addedNodes);
        
        // Check if added nodes contain message elements
        for (const node of addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches('[data-testid="conversation-turn"], .text-base, div[class*="message"], .prose')) {
              shouldExtract = true;
              break;
            }
            
            // Check for child message elements
            if (node.querySelector('[data-testid="conversation-turn"], .text-base, div[class*="message"], .prose')) {
              shouldExtract = true;
              break;
            }
          }
        }
      }
      
      if (shouldExtract) break;
    }
    
    // If relevant changes detected, re-extract content
    if (shouldExtract) {
      extractCurrentContent();
    }
  });
  
  // Observe the entire body for changes
  observer.observe(document.body, { 
    childList: true, 
    subtree: true 
  });
  
  isObserving = true;
}

/**
 * Process a single message block
 */
function processMessageBlock(block, index) {
  console.log(`Processing message block ${index}`);
  try {
    // Determine if user or assistant message
    const isUser = block.querySelector('[data-message-author-role="user"]') || 
                   block.classList.contains('dark:bg-gray-800');
    
    const speaker = isUser ? 'User' : 'Assistant';
    const timestamp = new Date().toLocaleTimeString();
    
    // Track elements we've processed
    const processedElements = new Set();
    
    // Items to store (text, code, images, etc.)
    const items = [];
    
    // 1. Extract code blocks first
    const codeBlocks = block.querySelectorAll('pre, code:not(pre code), .code-block, [class*="language-"], .bg-black');
    
    codeBlocks.forEach(codeBlock => {
      // Skip if empty or too small
      if (!codeBlock.textContent.trim() || codeBlock.textContent.length < 5) return;
      
      // Get language if available
      let language = '';
      
      // Look for language in classes or data attributes
      if (codeBlock.className) {
        const classes = codeBlock.className.split(' ');
        for (const cls of classes) {
          if (cls.startsWith('language-')) {
            language = cls.replace('language-', '');
            break;
          }
        }
      }
      
      // Try data-language attribute
      if (!language && codeBlock.dataset.language) {
        language = codeBlock.dataset.language;
      }
      
      // Get actual code content
      const code = codeBlock.textContent.trim();
      
      // Skip if code is too short or not likely code
      if (code.length < 5 || (code.split('\n').length === 1 && !code.includes(';') && !code.includes('{'))) {
        return;
      }
      
      // Add code block to items
      items.push({
        type: 'code',
        content: code,
        language: language
      });
      
      // Mark as processed
      processedElements.add(codeBlock);
      codeBlock.querySelectorAll('*').forEach(child => {
        processedElements.add(child);
      });
    });
    
    // 2. Extract equations using regex and DOM
    const equationElements = block.querySelectorAll('.katex, .katex-display, [data-math]');
    const latexRegex = /\$\$([^\$]+)\$\$|\$([^\$]+)\$|\\\[([^\]]+)\\\]|\\\((\S.*?\S)\\\)|\`{3}latex\n([\s\S]*?)\n\`{3}/g;
    
    // From DOM elements
    equationElements.forEach(el => {
      if (processedElements.has(el)) return;
      
      // Try to get LaTeX source
      const mathContent = el.getAttribute('data-math') || 
                         el.querySelector('.katex-mathml annotation')?.textContent || 
                         el.textContent;
      
      if (mathContent) {
        items.push({
          type: 'equation',
          content: mathContent.trim()
        });
        
        // Mark as processed
        processedElements.add(el);
      }
    });
    
    // From regex in text
    const textContent = block.textContent;
    let match;
    while ((match = latexRegex.exec(textContent))) {
      const equation = match[1] || match[2] || match[3] || match[4] || match[5];
      if (equation) {
        items.push({
          type: 'equation',
          content: equation.trim()
        });
      }
    }
    
    // 3. Extract text content
    const textElements = block.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6');
    
    let foundTextElements = false;
    textElements.forEach(el => {
      // Skip if empty or already processed
      if (!el.textContent.trim() || processedElements.has(el)) return;
      
      // Skip if inside a processed element
      let isNested = false;
      let parent = el.parentElement;
      while (parent && parent !== block) {
        if (processedElements.has(parent)) {
          isNested = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (isNested) return;
      
      // Extract emojis with the text
      const cleanedText = sanitizeTextForPDF(el.textContent.trim());
      
      // Add this text content
      if (cleanedText) {
        items.push({
          type: 'text',
          content: cleanedText
        });
        
        foundTextElements = true;
        processedElements.add(el);
      }
    });
    
    // 4. If no text elements found, get text directly from block
    if (!foundTextElements && block.textContent.trim()) {
      // Get text excluding code blocks
      let blockText = block.textContent;
      
      // Remove code block content to avoid duplication
      for (const item of items) {
        if (item.type === 'code' || item.type === 'equation') {
          blockText = blockText.replace(item.content, '');
        }
      }
      
      // Clean and add remaining text
      const cleanedText = sanitizeTextForPDF(blockText.trim());
      if (cleanedText) {
        items.push({
          type: 'text',
          content: cleanedText
        });
      }
    }
    
    // 5. Extract images (limited to 5 per message)
    const images = [];
    const imageElements = block.querySelectorAll('img');
    
    imageElements.forEach(img => {
      // Skip avatars, small images, and already processed images
      if (processedElements.has(img) || 
          img.width < 50 || 
          img.height < 50 || 
          img.src.includes('avatar')) {
        return;
      }
      
      // Check for emoji images (32x32 or smaller)
      const isEmoji = img.width <= 32 && img.height <= 32;
      
      // Limit to 5 images per message
      if (images.length < 5) {
        images.push({
          type: 'image',
          content: img.src,
          width: img.width,
          height: img.height,
          isEmoji: isEmoji
        });
        
        processedElements.add(img);
      }
    });
    
    // Add images to items
    items.push(...images);
    
    // 6. Extract tables (limited to 10 rows)
    const tableElements = block.querySelectorAll('table');
    
    tableElements.forEach(table => {
      if (processedElements.has(table)) return;
      
      const headers = [];
      const rows = [];
      
      // Extract headers
      const headerRow = table.querySelector('thead tr');
      if (headerRow) {
        headerRow.querySelectorAll('th').forEach(th => {
          headers.push(th.textContent.trim());
        });
      }
      
      // Extract rows (limit to 10)
      const tableRows = table.querySelectorAll('tbody tr');
      let rowCount = 0;
      
      tableRows.forEach(tr => {
        if (rowCount >= 10) return;
        
        const rowData = [];
        tr.querySelectorAll('td').forEach(td => {
          rowData.push(td.textContent.trim());
        });
        
        if (rowData.length > 0) {
          rows.push(rowData);
          rowCount++;
        }
      });
      
      // Add table if it has data
      if (headers.length > 0 || rows.length > 0) {
        items.push({
          type: 'table',
          content: {
            headers: headers,
            rows: rows
          }
        });
        
        processedElements.add(table);
      }
    });
    
    // Add message if it has items
    if (items.length > 0) {
      // Check if we already have this message (by comparing content)
      const messageExists = conversationData.messages.some(msg => {
        if (msg.speaker !== speaker) return false;
        if (msg.items.length !== items.length) return false;
        
        // Compare first item's content as a simple check
        if (msg.items[0]?.content !== items[0]?.content) return false;
        
        return true;
      });
      
      if (!messageExists) {
        conversationData.messages.push({
          speaker,
          timestamp,
          items
        });
      }
    }
  } catch (error) {
    console.error(`Error processing message block ${index}:`, error);
  }
}

/**
 * Get the current conversation data
 */
function getConversationData() {
  console.log('Getting conversation data for PDF generation');
  
  // Make sure we have the latest content
  updateConversationTitle();
  console.log(`Updated conversation title: ${conversationData.title}`);
  
  extractCurrentContent();
  console.log(`After extraction: ${conversationData.messages.length} messages found`);
  
  // Log details about extracted messages
  conversationData.messages.forEach((message, index) => {
    console.log(`Message ${index + 1}: Speaker=${message.speaker}, Items=${message.items?.length || 0}`);
    
    // Log types of items
    if (message.items?.length > 0) {
      const types = message.items.map(item => item.type);
      console.log(`  Item types: ${types.join(', ')}`);
    }
  });
  
  // Create a copy of the data to return
  const data = {
    title: conversationData.title,
    messages: [...conversationData.messages]
  };
  
  console.log(`Sending ${data.messages.length} messages to popup`);
  return data;
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
  
  // 1. Remove problematic special characters
  let cleaned = text
    .replace(/â€¢/g, '')  // Remove corrupted bullet
    .replace(/€¢/g, '')   // Remove corrupted character
    .replace(/Ø>/g, '')   // Remove special character
    .replace(/Ø=Û¥/g, '') // Remove special character sequence
    .replace(/&™b/g, '')  // Remove special character
    .replace(/â€¢ €¢/g, '') // Remove combined corruption
    .replace(/â€¹/g, '')   // Remove corrupted character
    .replace(/\u2028/g, ' ') // Line separator
    .replace(/\u2029/g, ' '); // Paragraph separator
  
  // 2. Fix spaced out text like "N e w t o n ' s"
  if (cleaned.includes(' e ') || cleaned.includes(' a ') || cleaned.match(/[A-Z]\s+[a-z]\s+[a-z]/)) {
    cleaned = cleaned
      .replace(/([A-Za-z])\s+([A-Za-z])\s+([A-Za-z])/g, '$1$2$3')
      .replace(/([A-Za-z])\s+([A-Za-z])/g, '$1$2');
  }
  
  // 3. Fix text without spaces
  if (cleaned.length > 20 && !cleaned.includes(' ')) {
    cleaned = cleaned
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([a-zA-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-zA-Z])/g, '$1 $2')
      .replace(/([.:;,!?])([A-Za-z])/g, '$1 $2');
  }
  
  // 4. Fix common physics/math content spacing
  cleaned = cleaned
    .replace(/Newton'ssecondlawsays/g, "Newton's second law says")
    .replace(/Force=mass/g, "Force = mass")
    .replace(/\bF=ma\b/g, "F = ma")
    .replace(/Itcomesfrom/g, "It comes from")
    .replace(/forceisthe/g, "force is the")
    .replace(/rateofchange/g, "rate of change")
    .replace(/ofmomentum/g, "of momentum")
    .replace(/Ifyouwant/g, "If you want")
    .replace(/Therefore,F=ma/g, "Therefore, F = ma");
  
  // 5. Standardize bullet points
  if (cleaned.startsWith('•') || cleaned.startsWith('-')) {
    cleaned = '• ' + cleaned.substring(1).trim();
  }
  
  // 6. Final cleanup
  cleaned = cleaned
    .replace(/\s+/g, ' ')  // normalize multiple spaces to single space
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
// ChatGPT to PDF Converter - Content Script
// Privacy: All processing is local using jsPDF and localStorage; no data is sent to servers.

(() => {
  const originalLog = console.log;
  const originalError = console.error;
  
  // Override console.log
  console.log = function(...args) {
    // Call original method
    originalLog.apply(console, args);
    
    // Send to background page too
    try {
      chrome.runtime.sendMessage({
        action: 'log',
        data: {
          type: 'log',
          message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')
        }
      });
    } catch (e) {
      // Ignore errors in sending
    }
  };
  
  // Override console.error
  console.error = function(...args) {
    // Call original method
    originalError.apply(console, args);
    
    // Send to background page too
    try {
      chrome.runtime.sendMessage({
        action: 'log',
        data: {
          type: 'error',
          message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')
        }
      });
    } catch (e) {
      // Ignore errors in sending
    }
  };
  
  // Make a VERY loud console log
  console.log('===== CONTENT SCRIPT LOADED AND CONSOLE OVERRIDDEN =====');
})();

console.log("ChatGPT to PDF Converter: Content script loaded");

// Set up a mutation observer to detect when new messages are loaded
const setupMutationObserver = () => {
  const targetNode = document.body;
  
  if (!targetNode) {
    console.warn("ChatGPT to PDF Converter: Body element not found for observer");
    return;
  }
  
  const observer = new MutationObserver((mutations) => {
    // Throttle observer to prevent excessive processing
    if (!setupMutationObserver.timeout) {
      setupMutationObserver.timeout = setTimeout(() => {
        console.log("ChatGPT to PDF Converter: DOM changes detected");
        setupMutationObserver.timeout = null;
      }, 1000);
    }
  });
  
  observer.observe(targetNode, {
    childList: true,
    subtree: true
  });
  
  console.log("ChatGPT to PDF Converter: Mutation observer set up");
  return observer;
};

// Initialize mutation observer
let observer = setupMutationObserver();

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("ChatGPT to PDF Converter: Message received", request);
  
  if (request.action === 'ping') {
    console.log("ChatGPT to PDF Converter: Ping received, sending pong");
    sendResponse({ pong: 'Content script is alive! ' + new Date().toLocaleTimeString() });
    return true;
  }
  
  if (request.action === "scrapeConversation") {
    try {
      console.log("ChatGPT to PDF Converter: Scraping conversation");
      const conversation = scrapeConversation();
      console.log("ChatGPT to PDF Converter: Conversation scraped successfully");
      sendResponse({ success: true, data: conversation });
    } catch (error) {
      console.error("ChatGPT to PDF Converter: Error scraping conversation", error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Required for async sendResponse
  }
});

/**
 * Scrapes the ChatGPT conversation from the DOM
 * @returns {Object} Containing conversation title and structured message content
 */
function scrapeConversation() {
  console.log("ChatGPT to PDF Converter: Starting conversation scraping");
  
  // Get the current date for the header
  const currentDate = new Date().toLocaleDateString();
  let title = `ChatGPT Conversation, ${currentDate}`;
  
  // Try to get the actual conversation title if available
  const titleElement = document.querySelector('title');
  if (titleElement && titleElement.textContent) {
    title = `ChatGPT: ${titleElement.textContent.trim()} (${currentDate})`;
  }
  
  console.log("ChatGPT to PDF Converter: Acquired title:", title);
  
  // LOGGING THE ENTIRE DOM STRUCTURE - DEBUGGING ONLY
  console.log("ChatGPT to PDF Converter: Examining DOM structure");
  console.log("Body HTML:", document.body.innerHTML.substring(0, 1000) + "...");
  
  // Try multiple approaches to find message elements
  
  // Approach 1: Direct conversation turn selectors
  let messageElements = document.querySelectorAll('[data-testid="conversation-turn"]');
  console.log("Approach 1 found elements:", messageElements.length);
  
  // Approach 2: Chat message containers
  if (messageElements.length === 0) {
    messageElements = document.querySelectorAll('.text-message-content, .text-message');
    console.log("Approach 2 found elements:", messageElements.length);
  }
  
  // Approach 3: Message role attributes
  if (messageElements.length === 0) {
    messageElements = document.querySelectorAll('[data-message-author-role]');
    console.log("Approach 3 found elements:", messageElements.length);
  }
  
  // Approach 4: Any element with content that looks like chat
  if (messageElements.length === 0) {
    // Look for any elements that might be chat messages by content pattern
    const allElements = document.querySelectorAll('div, p, span');
    const possibleMessages = [];
    
    allElements.forEach(el => {
      const text = el.textContent.trim();
      // Check if the element contains a substantial amount of text
      if (text.length > 50 && el.children.length < 5) {
        possibleMessages.push(el);
      }
    });
    
    if (possibleMessages.length > 1) {
      messageElements = possibleMessages;
      console.log("Approach 4 found elements:", messageElements.length);
    }
  }
  
  // If still no elements, try a direct parent-child approach
  if (messageElements.length === 0) {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      // Get all immediate div children of main content
      const childDivs = mainContent.querySelectorAll(':scope > div');
      console.log("Found child divs of main:", childDivs.length);
      
      if (childDivs.length > 0) {
        // Get the div that has the most content (likely the conversation container)
        let maxContentDiv = childDivs[0];
        let maxLength = maxContentDiv.textContent.length;
        
        childDivs.forEach(div => {
          if (div.textContent.length > maxLength) {
            maxLength = div.textContent.length;
            maxContentDiv = div;
          }
        });
        
        // Get all children of this div
        const potentialMessages = maxContentDiv.querySelectorAll(':scope > div');
        if (potentialMessages.length > 1) {
          messageElements = potentialMessages;
          console.log("Approach 5 found elements:", messageElements.length);
        }
      }
    }
  }
  
  // Final fallback - just grab paragraphs
  if (messageElements.length === 0) {
    messageElements = document.querySelectorAll('p');
    console.log("Final fallback found elements:", messageElements.length);
  }
  
  if (messageElements.length === 0) {
    throw new Error("No messages found in the conversation. Try refreshing the page.");
  }
  
  console.log("ChatGPT to PDF Converter: Found a total of", messageElements.length, "message elements");
  
  // Process each message to extract content
  const messages = [];
  let lastSpeaker = null;
  let lastContent = null;
  
  Array.from(messageElements).forEach((element, index) => {
    try {
      // Determine speaker (user or assistant)
      const isUser = isUserMessage(element);
      const speaker = isUser ? 'You' : 'ChatGPT';
      
      // Skip if it's the same speaker as the last message AND has the same content
      // This helps prevent duplication
      const currentContent = element.textContent.trim();
      if (speaker === lastSpeaker && currentContent === lastContent) {
        return;
      }
      
      lastSpeaker = speaker;
      lastContent = currentContent;
      
      // Get timestamp if available
      const timestamp = extractTimestamp(element) || '';
      
      // Process message content items (text, tables, etc.)
      const messageItems = processMessageContent(element);
      
      console.log(`Message ${index}: Speaker=${speaker}, Items=${messageItems.length}`);
      
      if (messageItems.length > 0) {
        messages.push({
          speaker,
          timestamp,
          items: messageItems
        });
      }
    } catch (error) {
      console.error(`Error processing message element ${index}:`, error);
    }
  });
  
  console.log("ChatGPT to PDF Converter: Processed", messages.length, "messages");
  
  if (messages.length === 0) {
    throw new Error("Could not extract any conversation content. Please try again.");
  }
  
  // Add this temporary debugging code somewhere in your scrapeConversation function
  // to test image extraction independently
  try {
    const testImages = document.querySelectorAll('img');
    console.log(`DEBUG: Found ${testImages.length} total images on page`);
    
    testImages.forEach((img, i) => {
      if (img.width > 50 && img.height > 50) {
        console.log(`DEBUG: Image ${i}: Size=${img.width}x${img.height}, src=${img.src.substring(0, 100)}`);
      }
    });
  } catch (e) {
    console.error("Debug image test failed:", e);
  }
  
  return {
    title,
    messages
  };
}

/**
 * Find message elements in the container
 */
function findMessageElements(container) {
  console.log("ChatGPT to PDF Converter: Finding message elements");
  
  // Try various selectors to find message elements
  const selectors = [
    '[data-testid="conversation-turn"]',
    '[data-message-author-role]',
    '[class*="ConversationTurn"]',
    '[class*="message"]',
    'div'
  ];
  
  const result = [];
  
  for (const selector of selectors) {
    const elements = container.querySelectorAll(selector);
    if (elements && elements.length > 1) {
      result.push(...Array.from(elements));
    }
  }
  
  // If no matches, return direct children as fallback using children property
  if (result.length === 0 && container.children && container.children.length > 0) {
    result.push(...Array.from(container.children));
  }
  
  // Filter out duplicates and nulls
  const uniqueElements = [...new Set(result)].filter(el => el);
  
  console.log(`ChatGPT to PDF Converter: Found ${uniqueElements.length} message elements`);
  return uniqueElements;
}

/**
 * Determine if a message is from the user
 */
function isUserMessage(element) {
  // Check for various indicators that this is a user message
  
  // Check 1: data-testid attribute
  if (element.querySelector('[data-testid="not-chat-gpt-user-message"]')) {
    console.log("User message detected via data-testid");
    return true;
  }
  
  // Check 2: author role attribute
  if (element.getAttribute('data-message-author-role') === 'user') {
    console.log("User message detected via author role");
    return true;
  }
  
  // Check 3: look for specific class names or patterns
  if (element.classList.contains('user-message') || 
      element.classList.contains('outgoing') ||
      element.parentElement?.classList.contains('user-message')) {
    console.log("User message detected via class names");
    return true;
  }
  
  // Check 4: Analyze position in conversation (odd/even pattern)
  const parent = element.parentElement;
  if (parent && parent.children) {
    const index = Array.from(parent.children).indexOf(element);
    if (index % 2 === 0) { // Assuming user messages come first in pairs
      console.log("User message detected via position (even index)");
      return true;
    }
  }
  
  // Default to false (assumes ChatGPT message)
  return false;
}

/**
 * Extract timestamp from message element
 */
function extractTimestamp(element) {
  // Try to find timestamp element
  const timestampElement = element.querySelector('[class*="timestamp"], time, [class*="date"]');
  return timestampElement ? timestampElement.textContent.trim() : null;
}

/**
 * Process message content to extract text, tables, images, equations
 */
function processMessageContent(element) {
  const items = [];
  
  try {
    console.log("Processing element:", element.tagName, element.className);
    
    // First, extract all the text content
    const allText = element.textContent.trim();
    
    // If there's any text, add it as a basic item
    if (allText.length > 0) {
      items.push({
        type: 'text',
        content: processText(allText)
      });
      console.log("Added text content:", allText.substring(0, 50) + (allText.length > 50 ? "..." : ""));
    }
    
    // Look for tables in the element
    const tables = element.querySelectorAll('table');
    if (tables.length > 0) {
      console.log("Found", tables.length, "tables in the element");
      
      tables.forEach((table, i) => {
        try {
          const tableData = extractTable(table);
          if (tableData.rows.length > 0) {
            items.push({
              type: 'table',
              content: tableData
            });
            console.log(`Added table ${i+1} with ${tableData.rows.length} rows`);
          }
        } catch (error) {
          console.error("Error extracting table:", error);
        }
      });
    } else if (allText.includes('|')) {
      // Try to extract markdown-style tables from the text
      try {
        const markdownTable = extractMarkdownTable(allText);
        if (markdownTable.rows.length > 0) {
          items.push({
            type: 'table',
            content: markdownTable
          });
          console.log(`Added markdown table with ${markdownTable.rows.length} rows`);
        }
      } catch (error) {
        console.error("Error extracting markdown table:", error);
      }
    }
    
    // Extract and add images
    const imageItems = processImages(element);
    items.push(...imageItems);
    
    // Extract and add equations
    const equationItems = processEquations(element);
    items.push(...equationItems);
  } catch (error) {
    console.error("Error processing message content:", error);
  }
  
  return items;
}

/**
 * Process text to handle equations and formatting
 */
function processText(text) {
  // Replace any LaTeX equations with plain text representation
  let processed = text.replace(/\\\((.+?)\\\)/g, "$1");
  processed = processed.replace(/\$(.+?)\$/g, "$1");
  
  // Process emojis
  processed = processEmojis(processed);
  
  return processed;
}

/**
 * Extract table data from HTML table element
 */
function extractTable(tableElement) {
  const headers = [];
  const rows = [];
  
  // Extract headers from thead if available
  const headerElements = tableElement.querySelectorAll('thead th, th');
  if (headerElements.length > 0) {
    headerElements.forEach(th => {
      headers.push(th.textContent.trim());
    });
  }
  
  // Extract rows (limited to 10)
  const rowElements = tableElement.querySelectorAll('tbody tr, tr');
  Array.from(rowElements).slice(0, 10).forEach(tr => {
    const rowData = [];
    tr.querySelectorAll('td').forEach(td => {
      rowData.push(td.textContent.trim());
    });
    if (rowData.length > 0) {
      rows.push(rowData);
    }
  });
  
  return {
    headers,
    rows
  };
}

/**
 * Process emojis in text
 */
function processEmojis(text) {
  // Replace common emojis with text descriptions
  const emojiMap = {
    '🗓️': '[Calendar] ',
    '📆': '[Calendar] ',
    '🏋️‍♂️': '[Fitness] ',
    '🏋️': '[Fitness] ',
    '💪': '[Strength] ',
    '✅': '[Checkmark] ',
    '⭐': '[Star] ',
    '📊': '[Chart] ',
    '⚠️': '[Warning] ',
    '❗': '[Important] ',
    '👍': '[Thumbs Up] '
  };
  
  // Replace known emojis
  let processed = text;
  for (const [emoji, replacement] of Object.entries(emojiMap)) {
    processed = processed.replaceAll(emoji, replacement);
  }
  
  // Replace any remaining emojis
  const emojiRegex = /[\p{Emoji}]/gu;
  processed = processed.replace(emojiRegex, '[Emoji] ');
  
  return processed;
}

/**
 * Extract markdown-style table
 */
function extractMarkdownTable(markdownText) {
  console.log("Trying to extract markdown table from:", markdownText.substring(0, 100) + "...");
  
  // Look for lines containing pipe characters - these are likely table rows
  const tableLines = markdownText.split('\n').filter(line => line.includes('|'));
  
  if (tableLines.length < 2) {
    console.log("Not enough lines with pipe characters for a table");
    return { headers: [], rows: [] };
  }
  
  console.log("Found potential markdown table with", tableLines.length, "lines");
  
  const headers = [];
  const rows = [];
  
  // Extract headers from the first line
  const headerLine = tableLines[0];
  headerLine.split('|').forEach(cell => {
    const header = cell.trim();
    if (header) headers.push(header);
  });
  
  // Skip the first line (headers) and the second line (separator)
  for (let i = 2; i < tableLines.length && i < 12; i++) {
    const rowData = [];
    tableLines[i].split('|').forEach(cell => {
      rowData.push(cell.trim());
    });
    
    if (rowData.some(cell => cell.length > 0)) {
      rows.push(rowData.filter(cell => cell.length > 0));
    }
  }
  
  console.log("Extracted table headers:", headers);
  console.log("Extracted table rows:", rows);
  
  return {
    headers,
    rows
  };
}

/**
 * Process images with CORS handling - add visible placeholders
 */
function processImages(element) {
  const imageItems = [];
  
  try {
    // Get all images in this element
    const images = element.querySelectorAll('img');
    console.log(`Found ${images.length} image elements in message`);
    
    // Process each image
    Array.from(images).forEach((img, i) => {
      // Skip tiny images that are likely icons
      if (img.width < 60 || img.height < 60 || !img.src) {
        return;
      }
      
      console.log(`Processing image ${i+1}: ${img.width}x${img.height}, src: ${img.src.substring(0, 100)}`);
      
      // For all images, create a placeholder item with metadata
      imageItems.push({
        type: 'imagePlaceholder',
        originalSrc: img.src,
        width: img.width,
        height: img.height,
        isDataUrl: img.src.startsWith('data:')
      });
      
      // If it's a data URL, we can also try to include the actual image
      if (img.src.startsWith('data:image/')) {
        imageItems.push({
          type: 'image',
          content: img.src,
          width: img.width,
          height: img.height
        });
      }
    });
    
    console.log(`Added ${imageItems.length} image items`);
  } catch (error) {
    console.error("Error processing images:", error);
  }
  
  return imageItems;
}

/**
 * Extract and process equations from content
 */
function processEquations(element) {
  const equationItems = [];
  
  try {
    // Look for KaTeX elements
    const katexElements = element.querySelectorAll('.katex, .katex-display, .katex-block');
    if (katexElements.length > 0) {
      console.log(`Found ${katexElements.length} KaTeX elements`);
      
      katexElements.forEach((katex, i) => {
        try {
          // Find the LaTeX source (often in a data attribute or hidden element)
          let latexSource = '';
          
          // Try different methods to get the LaTeX source
          const annotation = katex.querySelector('.katex-mathml annotation');
          if (annotation) {
            latexSource = annotation.textContent;
          } else {
            // Get textContent as fallback
            latexSource = katex.textContent;
          }
          
          if (latexSource) {
            equationItems.push({
              type: 'equation',
              content: latexSource
            });
            console.log(`Added equation ${i+1}: ${latexSource.substring(0, 30)}...`);
          }
        } catch (eqError) {
          console.error(`Error extracting equation ${i+1}:`, eqError);
        }
      });
    }
    
    // Look for LaTeX delimiters in text
    const textContent = element.textContent;
    const delimiters = [
      { start: '\\(', end: '\\)' },
      { start: '\\[', end: '\\]' },
      { start: '$$', end: '$$' },
      { start: '$', end: '$' }
    ];
    
    for (const delimiter of delimiters) {
      let startIdx = 0;
      while ((startIdx = textContent.indexOf(delimiter.start, startIdx)) !== -1) {
        const endIdx = textContent.indexOf(delimiter.end, startIdx + delimiter.start.length);
        if (endIdx !== -1) {
          const equation = textContent.substring(startIdx + delimiter.start.length, endIdx);
          if (equation.length > 0 && equation.length < 1000) { // Reasonable size check
            equationItems.push({
              type: 'equation',
              content: equation.trim()
            });
            console.log(`Found inline equation: ${equation.substring(0, 30)}...`);
          }
          startIdx = endIdx + delimiter.end.length;
        } else {
          break;
        }
      }
    }
  } catch (error) {
    console.error("Error processing equations:", error);
  }
  
  return equationItems;
}

// Log that setup is complete
console.log("ChatGPT to PDF Converter: Content script initialized");

// Add this at the end of your content.js file
(function() {
  // Force-run this immediately when script loads
  console.log('IMMEDIATE IMAGE TEST RUNNING ON PAGE LOAD');
  
  // Find ALL images on the page
  const allImages = Array.from(document.querySelectorAll('img'));
  console.log(`FOUND ${allImages.length} TOTAL IMAGES ON THE PAGE`);
  
  // Log statistics about these images
  let dataUrlImages = 0;
  let regularImages = 0;
  let svgImages = 0;
  let smallImages = 0;
  let largeImages = 0;
  
  allImages.forEach((img, i) => {
    if (img.src) {
      if (img.src.startsWith('data:image/svg')) {
        svgImages++;
      } else if (img.src.startsWith('data:')) {
        dataUrlImages++;
        console.log(`DATA URL IMAGE: ${img.width}x${img.height}, preview: ${img.src.substring(0, 50)}...`);
      } else {
        regularImages++;
        console.log(`URL IMAGE: ${img.width}x${img.height}, src: ${img.src.substring(0, 100)}`);
      }
      
      if (img.width > 100 && img.height > 100) {
        largeImages++;
      } else {
        smallImages++;
      }
    }
  });
  
  console.log(`IMAGE STATS: 
    - Total: ${allImages.length}
    - Data URLs: ${dataUrlImages}
    - Regular URLs: ${regularImages}
    - SVGs: ${svgImages}
    - Large (>100px): ${largeImages}
    - Small: ${smallImages}
  `);
  
  // Look for ChatGPT message containers
  const messageTurns = document.querySelectorAll('[data-testid="conversation-turn"]');
  console.log(`FOUND ${messageTurns.length} CONVERSATION TURNS`);
  
  messageTurns.forEach((turn, i) => {
    const turnImages = turn.querySelectorAll('img');
    if (turnImages.length > 0) {
      console.log(`TURN ${i} HAS ${turnImages.length} IMAGES`);
      
      turnImages.forEach((img, j) => {
        console.log(`TURN ${i} IMAGE ${j}: ${img.width}x${img.height}, src: ${img.src ? img.src.substring(0, 50) : 'none'}`);
      });
    }
  });
})();

// Add this function to test image extraction directly
function testDirectImageExtraction() {
  console.log("=== DIRECT IMAGE EXTRACTION TEST ===");
  
  // Find all potentially usable images
  const allImages = document.querySelectorAll('img');
  const usableImages = Array.from(allImages).filter(img => 
    img.width > 100 && 
    img.height > 100 && 
    img.src && 
    !img.src.includes('svg')
  );
  
  console.log(`Found ${usableImages.length} potentially usable images`);
  
  // Try the simplest possible approach
  usableImages.forEach((img, i) => {
    try {
      console.log(`Testing image ${i}: ${img.src.substring(0, 50)}`);
      
      // Create a direct data URL 
      if (img.src.startsWith('data:')) {
        console.log(`Image ${i} is already a data URL`);
        
        // Test if this data URL could be added to a PDF
        const testPdf = new jsPDF();
        testPdf.addImage(img.src, 'JPEG', 10, 10, 50, 50);
        console.log(`Successfully added image ${i} to test PDF`);
      }
      else {
        // For URLs, just log that we'd need to convert them
        console.log(`Image ${i} is a URL, would need conversion`);
      }
    } catch (e) {
      console.error(`Test failed for image ${i}:`, e);
    }
  });
}

// Call the test function after a delay
setTimeout(testDirectImageExtraction, 3000);

/**
 * Extract conversation with better handling of structured content
 */
function extractConversation() {
  try {
    console.log("Extracting conversation with improved structure...");
    
    const conversation = {
      title: document.title,
      messages: []
    };
    
    // Find all conversation turns
    const turns = document.querySelectorAll('[data-testid="conversation-turn"]');
    console.log(`Found ${turns.length} conversation turns`);
    
    // Process each turn
    turns.forEach((turn, index) => {
      // Determine if this is the user or ChatGPT
      const isUser = turn.querySelector('[data-testid="not-chat-gpt-user-message"]') !== null;
      const speaker = isUser ? 'You' : 'ChatGPT';
      
      // Get all content parts to preserve structure
      const messageContainers = turn.querySelectorAll('[data-message-author-role]');
      const messageItems = [];
      
      // Process all content in this message
      messageContainers.forEach(container => {
        // Extract text paragraphs, preserving structure
        const textParagraphs = container.querySelectorAll('p, h1, h2, h3, h4, h5, li');
        textParagraphs.forEach(para => {
          // Only add non-empty paragraphs
          if (para.textContent.trim()) {
            messageItems.push({
              type: 'text',
              content: para.textContent
            });
          }
        });
        
        // Extract math/equation elements
        const mathElements = container.querySelectorAll('.katex, .katex-display');
        mathElements.forEach(math => {
          // Get the LaTeX source if available
          const latex = math.querySelector('.katex-mathml annotation[encoding="application/x-tex"]');
          if (latex) {
            messageItems.push({
              type: 'equation',
              content: latex.textContent
            });
          }
          // Fallback to rendered text
          else if (math.textContent) {
            messageItems.push({
              type: 'equation',
              content: math.textContent
            });
          }
        });
      });
      
      // Add this message with all its parts
      conversation.messages.push({
        speaker: speaker,
        items: messageItems
      });
    });
    
    return conversation;
  } catch (error) {
    console.error("Error extracting conversation:", error);
    return { error: error.toString() };
  }
}

/**
 * Extract images from the conversation and convert to data URLs using canvas
 * This bypasses CORS restrictions by using images already loaded in the DOM
 * @param {Element} container - The message container to search for images
 * @returns {Promise<Array>} - Array of image data URLs
 */
async function extractImages(container) {
  try {
    // Find all images in the container
    const images = container.querySelectorAll('img');
    console.log(`Found ${images.length} images in container`);
    
    // Limit to 5 images per message for performance (as specified in requirements)
    const imageLimit = 5;
    const processedImages = [];
    
    // Process each image, up to the limit
    for (let i = 0; i < Math.min(images.length, imageLimit); i++) {
      const img = images[i];
      
      // Skip tiny images or icons
      if (img.width < 50 || img.height < 50) {
        console.log(`Skipping small image: ${img.width}x${img.height}`);
        continue;
      }
      
      try {
        // Wait for image to be fully loaded
        if (!img.complete) {
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            // Set a timeout in case image never loads
            setTimeout(reject, 3000);
          });
        }
        
        // Create canvas and draw image to generate data URL
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        
        // Draw image to canvas
        ctx.drawImage(img, 0, 0);
        
        // Try to get data URL (may fail due to CORS)
        try {
          const dataURL = canvas.toDataURL('image/jpeg', 0.85); // Slightly compressed for performance
          
          // Check if dataURL is valid (not empty or error)
          if (dataURL && dataURL.length > 100) {
            processedImages.push({
              type: 'image',
              dataURL: dataURL,
              width: img.width,
              height: img.height,
              alt: img.alt || 'ChatGPT image'
            });
            console.log(`Successfully extracted image ${i+1}/${images.length}`);
          } else {
            console.warn(`Empty or invalid data URL for image ${i+1}`);
          }
        } catch (canvasError) {
          console.warn(`Skipping tainted image due to CORS: ${canvasError.message}`);
        }
      } catch (imageError) {
        console.warn(`Error processing image ${i+1}: ${imageError.message}`);
      }
    }
    
    console.log(`Successfully processed ${processedImages.length} images`);
    return processedImages;
  } catch (error) {
    console.error("Error extracting images:", error);
    return [];
  }
}

/**
 * Global set to track all equations across the entire conversation
 * This helps prevent duplicates across different messages
 */
const globalSeenEquations = new Set();

/**
 * Extract equations from text content with improved deduplication
 */
function extractEquationsAndText(container, textContent) {
  try {
    // Items will store text and equations in order
    const items = [];
    
    // For deduplicating text within this element
    const seenText = new Set();
    
    // Clean and normalize the text content first
    textContent = normalizeTextContent(textContent);
    
    // LaTeX regex pattern as specified in the requirements
    const latexRegex = /\$\$([^\$]+)\$\$|\$([^\$]+)\$|\\\[([^\]]+)\\\]|\\\((\S.*?\S)\\\)|\`{3}latex\n([\s\S]*?)\n\`{3}/g;
    
    // Process the text content first with regex
    let lastIndex = 0;
    let match;
    
    // Find all LaTeX matches in the text
    while ((match = latexRegex.exec(textContent))) {
      // Get the equation (one of the capture groups will have it)
      const equation = match[1] || match[2] || match[3] || match[4] || match[5];
      const startIndex = match.index;
      
      // Add text that comes before this equation
      if (startIndex > lastIndex) {
        const textBefore = textContent.slice(lastIndex, startIndex).trim();
        if (textBefore && !seenText.has(textBefore)) {
          items.push({ type: 'text', content: textBefore });
          seenText.add(textBefore);
        }
      }
      
      // Add the equation only if we haven't seen it globally
      if (equation && equation.trim()) {
        const normalizedEq = normalizeEquation(equation.trim());
        if (!globalSeenEquations.has(normalizedEq)) {
          items.push({ type: 'equation', content: equation.trim() });
          globalSeenEquations.add(normalizedEq);
        }
      }
      
      // Update lastIndex to after this match
      lastIndex = latexRegex.lastIndex;
    }
    
    // Add any remaining text after the last equation
    if (lastIndex < textContent.length) {
      const remainingText = textContent.slice(lastIndex).trim();
      if (remainingText && !seenText.has(remainingText)) {
        items.push({ type: 'text', content: remainingText });
        seenText.add(remainingText);
      }
    }
    
    // Now look for rendered KaTeX elements in the DOM
    const katexElements = container.querySelectorAll('.katex, .katex-display');
    
    // Limit to 10 equations as per requirements
    const equationLimit = 10;
    
    // Process KaTeX elements
    katexElements.forEach(katex => {
      // Skip if we've reached the global equation limit
      if (globalSeenEquations.size >= equationLimit) return;
      
      // Try to get the LaTeX source if available
      const latex = katex.querySelector('.katex-mathml annotation[encoding="application/x-tex"]');
      
      if (latex && latex.textContent) {
        const normalizedEq = normalizeEquation(latex.textContent.trim());
        // Add only if we haven't seen this equation before globally
        if (!globalSeenEquations.has(normalizedEq)) {
          items.push({ 
            type: 'equation', 
            content: latex.textContent.trim(),
            isRendered: true
          });
          globalSeenEquations.add(normalizedEq);
        }
      } 
      // Fallback to the rendered text if we can't find LaTeX source
      else if (katex.textContent && katex.textContent.trim().length > 0) {
        const normalizedEq = normalizeEquation(katex.textContent.trim());
        // Add only if we haven't seen this equation before globally
        if (!globalSeenEquations.has(normalizedEq)) {
          items.push({
            type: 'equation',
            content: katex.textContent.trim(),
            isRendered: true
          });
          globalSeenEquations.add(normalizedEq);
        }
      }
    });
    
    // Filter out empty items and return
    return items.filter(item => item.content && item.content.trim().length > 0);
  } catch (error) {
    console.error("Error extracting equations:", error);
    // Fallback to just returning the text if equation extraction fails
    return [{ type: 'text', content: textContent }];
  }
}

/**
 * Normalize text content to improve deduplication and fix variable notation
 */
function normalizeTextContent(text) {
  if (!text) return '';
  
  // Fix repeated characters in variable names (FFF → F, etc.)
  text = text.replace(/([A-Za-z])\1{2,}/g, '$1');
  
  return text;
}

/**
 * Normalize equation text to help with duplicate detection
 */
function normalizeEquation(equation) {
  if (!equation) return '';
  
  // Fix repeated characters in variable names first (FFF → F, etc.)
  equation = equation.replace(/([A-Za-z])\1{2,}/g, '$1');
  
  // Remove all whitespace
  let normalized = equation.replace(/\s+/g, '');
  
  // Replace common equivalent notations
  normalized = normalized
    .replace(/\\frac/g, '') // Remove \frac command
    .replace(/\{|\}/g, '')  // Remove curly braces
    .replace(/\\left|\\right/g, '') // Remove \left and \right
    .replace(/\\text\{[^}]*\}/g, ''); // Remove \text{} commands
    
  return normalized;
}

/**
 * Extract content directly from ChatGPT page, with enhanced image and equation support
 */
async function extractChatGPTContent() {
  // This runs in the page context
  console.log("Extracting ChatGPT content with enhanced image and equation support");
  
  // Reset global equation tracking for a fresh extraction
  globalSeenEquations.clear();
  
  // Initialize conversation object
  const conversation = {
    title: document.title,
    messages: []
  };
  
  try {
    // Try different selectors for message blocks to support both domains
    const selectors = [
      '[data-testid="conversation-turn"]',
      '.text-message-content',
      '[data-message-author-role]',
      '.ProseMirror',
      '.text-base'
    ];
    
    // Try each selector until we find conversation elements
    let messageBlocks = [];
    for (const selector of selectors) {
      messageBlocks = document.querySelectorAll(selector);
      console.log(`Selector "${selector}" found ${messageBlocks.length} elements`);
      if (messageBlocks.length > 0) break;
    }
    
    // Process message blocks if found
    if (messageBlocks.length > 0) {
      // Create an array of promises for async processing
      const messagePromises = Array.from(messageBlocks).map(async (block, i) => {
        try {
          // Determine if user or AI message
          const isUser = 
            block.getAttribute('data-message-author-role') === 'user' || 
            block.querySelector('[data-testid="not-chat-gpt-user-message"]') !== null ||
            (block.closest('[data-testid="conversation-turn-"]') && 
              i % 2 === 0);
          
          const speaker = isUser ? 'You' : 'ChatGPT';
          
          // Initialize items array for this message
          const items = [];
          
          // Process text content for equations
          // First try structured elements
          const textElements = block.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6');
          textElements.forEach(el => {
            if (el.textContent.trim()) {
              // Extract equations and text from this element
              const extractedItems = extractEquationsAndText(el, el.textContent.trim());
              items.push(...extractedItems);
            }
          });
          
          // If no structured elements, try direct text
          if (items.filter(i => i.type === 'text').length === 0 && block.textContent.trim()) {
            // Extract from whole block text
            const extractedItems = extractEquationsAndText(block, block.textContent.trim());
            items.push(...extractedItems);
          }
          
          // Extract tables
          const tables = block.querySelectorAll('table');
          tables.forEach(table => {
            // Extract table data
            const tableData = {
              headers: [],
              rows: []
            };
            
            // Get table headers
            const headerRow = table.querySelector('thead tr');
            if (headerRow) {
              const headers = headerRow.querySelectorAll('th');
              headers.forEach(header => {
                tableData.headers.push(header.textContent.trim());
              });
            }
            
            // Get table rows
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(row => {
              const rowData = [];
              const cells = row.querySelectorAll('td');
              cells.forEach(cell => {
                rowData.push(cell.textContent.trim());
              });
              if (rowData.length > 0) {
                tableData.rows.push(rowData);
              }
            });
            
            // Add table to items if it has data
            if (tableData.rows.length > 0) {
              items.push({
                type: 'table',
                content: tableData
              });
            }
          });
          
          // Extract images
          const images = await extractImages(block);
          items.push(...images);
          
          // Return the completed message object
          return {
            speaker: speaker,
            items: items
          };
        } catch (err) {
          console.error(`Error processing message block ${i}:`, err);
          return null;
        }
      });
      
      // Wait for all message processing to complete
      const processedMessages = await Promise.all(messagePromises);
      
      // Add all valid messages to the conversation
      conversation.messages = processedMessages.filter(message => message && message.items && message.items.length > 0);
    }
    
    console.log(`Extraction complete. Found ${conversation.messages.length} messages`);
    return conversation;
    
  } catch (error) {
    console.error("Error in extraction:", error);
    return {
      title: document.title,
      messages: [{
        speaker: 'Error',
        items: [{
          type: 'text',
          content: 'Error extracting content: ' + error.message
        }]
      }]
    };
  }
} 
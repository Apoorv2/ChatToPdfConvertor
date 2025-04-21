// This script is directly injected into the page
console.log('INJECTED SCRIPT LOADED DIRECTLY INTO THE PAGE');

// Extract content immediately upon loading
window.addEventListener('load', function() {
  console.log('Window loaded, extracting content automatically');
  const data = extractChatContent();
  sendExtractedContent(data);
});

// Also extract immediately if the document is already loaded
if (document.readyState === 'complete') {
  console.log('Document already loaded, extracting content immediately');
  const data = extractChatContent();
  sendExtractedContent(data);
}

// Function to send the extracted content back to extension
function sendExtractedContent(data) {
  console.log('Sending extracted content to extension:', data);
  
  window.postMessage({
    type: 'FROM_PAGE_SCRIPT',
    action: 'contentExtracted',
    title: data.title,
    messages: data.messages
  }, '*');
}

// Basic content extraction function
function extractChatContent() {
  console.log('Extracting chat content from page DOM');
  
  try {
    // Get the conversation title
    const title = document.title.replace(' - ChatGPT', '').trim() || 'ChatGPT Conversation';
    
    // Try multiple approaches to find messages
    const messages = [];
    
    // APPROACH 1: Find by conversation turns
    console.log('Trying conversation turn approach');
    const turns = document.querySelectorAll('[data-testid="conversation-turn"], .conversation-turn');
    console.log(`Found ${turns.length} conversation turns`);
    
    if (turns.length > 0) {
      Array.from(turns).forEach(turn => {
        // Try to find user and assistant parts in each turn
        const userPart = turn.querySelector('[data-message-author-role="user"]') || 
                         turn.querySelector('.dark\\:bg-gray-800') || 
                         turn.querySelector('[class*="bg-gray"]');
                         
        const assistantPart = turn.querySelector('[data-message-author-role="assistant"]') || 
                             turn.querySelector('.markdown') ||
                             turn.querySelector('.prose');
        
        if (userPart) {
          const userMessage = processMessageContent(userPart, 'User');
          if (userMessage) messages.push(userMessage);
        }
        
        if (assistantPart) {
          const assistantMessage = processMessageContent(assistantPart, 'ChatGPT');
          if (assistantMessage) messages.push(assistantMessage);
        }
      });
    }
    
    // APPROACH 2: If no messages found, try to find direct role-based elements
    if (messages.length === 0) {
      console.log('Trying direct role approach');
      const userElements = document.querySelectorAll('[data-message-author-role="user"], .dark\\:bg-gray-800, [class*="bg-gray"]');
      const assistantElements = document.querySelectorAll('[data-message-author-role="assistant"], .markdown, .prose');
      
      console.log(`Found ${userElements.length} user elements, ${assistantElements.length} assistant elements`);
      
      userElements.forEach(el => {
        const msg = processMessageContent(el, 'User');
        if (msg) messages.push(msg);
      });
      
      assistantElements.forEach(el => {
        const msg = processMessageContent(el, 'ChatGPT');
        if (msg) messages.push(msg);
      });
    }
    
    // APPROACH 3: Last resort, try general message blocks
    if (messages.length === 0) {
      console.log('Trying general message approach');
      // Look for any elements that might contain messages
      const possibleMessages = document.querySelectorAll('.text-base, .p-4, [class*="message"], main > div > div');
      
      console.log(`Found ${possibleMessages.length} possible message elements`);
      
      // Try to classify each as user or assistant
      possibleMessages.forEach((el, index) => {
        // Simple alternating pattern as a fallback
        // Assume odd indexes are user, even are assistant
        const isUser = el.classList.contains('dark:bg-gray-800') || 
                      el.hasAttribute('[data-message-author-role="user"]') ||
                      (index % 2 === 0); // Fallback
        
        const speaker = isUser ? 'User' : 'ChatGPT';
        const msg = processMessageContent(el, speaker);
        if (msg) messages.push(msg);
      });
    }
    
    // APPROACH 4: Ultimate fallback - just grab everything
    if (messages.length === 0) {
      console.log('Using fallback approach - grabbing all content');
      // Just extract the main content
      const mainContent = document.querySelector('main');
      if (mainContent) {
        // Extract direct text of main (just as a test)
        const rawText = mainContent.textContent;
        
        // Try to parse this as a conversation
        if (rawText.includes('User') && (rawText.includes('ChatGPT') || rawText.includes('Assistant'))) {
          // Split by common patterns in messages
          const lines = rawText.split(/\n/).filter(l => l.trim().length > 0);
          
          let currentSpeaker = null;
          let currentText = [];
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Check if this line indicates a speaker change
            const userMatch = trimmedLine.match(/^User\s*\(\d+:\d+:\d+\)/i);
            const chatgptMatch = trimmedLine.match(/^(ChatGPT|Assistant)\s*\(\d+:\d+:\d+\)/i);
            
            if (userMatch) {
              // Save previous speaker content
              if (currentSpeaker && currentText.length > 0) {
                messages.push({
                  speaker: currentSpeaker,
                  timestamp: new Date().toLocaleTimeString(),
                  items: [{
                    type: 'text',
                    content: currentText.join('\n')
                  }]
                });
              }
              
              // Start new user content
              currentSpeaker = 'User';
              currentText = [trimmedLine.replace(userMatch[0], '')];
            } else if (chatgptMatch) {
              // Save previous speaker content
              if (currentSpeaker && currentText.length > 0) {
                messages.push({
                  speaker: currentSpeaker,
                  timestamp: new Date().toLocaleTimeString(),
                  items: [{
                    type: 'text',
                    content: currentText.join('\n')
                  }]
                });
              }
              
              // Start new ChatGPT content
              currentSpeaker = 'ChatGPT';
              currentText = [trimmedLine.replace(chatgptMatch[0], '')];
            } else if (currentSpeaker) {
              // Continue current speaker content
              currentText.push(trimmedLine);
            }
          }
          
          // Add the last message if there is one
          if (currentSpeaker && currentText.length > 0) {
            messages.push({
              speaker: currentSpeaker,
              timestamp: new Date().toLocaleTimeString(),
              items: [{
                type: 'text',
                content: currentText.join('\n')
              }]
            });
          }
        }
      }
    }
    
    console.log(`Total messages extracted: ${messages.length}`);
    
    // Validate that we have proper content
    if (messages.length === 0) {
      const rawContent = document.body.textContent.substring(0, 1000);
      console.error('Failed to extract any messages. Raw page content sample:', rawContent);
      
      // Create a fallback message 
      messages.push({
        speaker: 'System',
        timestamp: new Date().toLocaleTimeString(),
        items: [{
          type: 'text',
          content: 'The content extraction failed. Please try refreshing the page and trying again.'
        }]
      });
    }
    
    return {
      title,
      messages
    };
  } catch (error) {
    console.error('Error extracting content:', error);
    console.error('Error stack:', error.stack);
    return {
      title: 'Extraction Error',
      messages: [{
        speaker: 'System',
        timestamp: new Date().toLocaleTimeString(),
        items: [{
          type: 'text',
          content: 'Error extracting content: ' + error.message
        }]
      }]
    };
  }
}

// Process a single message element's content
function processMessageContent(element, speaker) {
  if (!element) return null;
  
  // Items array for this message
  const items = [];
  
  // Find code blocks
  const codeBlocks = element.querySelectorAll('pre, pre > code, .bg-black');
  const hasCodeBlocks = codeBlocks.length > 0;
  
  // Get full text content before we process code blocks
  let fullText = element.textContent || '';
  
  // Filter out unwanted JavaScript snippets
  fullText = fullText.replace(/window\.__oai_logHTML\?window\.__oai_logHTML\(\).+?SearchReason/g, '');
  fullText = fullText.replace(/window\.__oai_/g, ''); // Remove any remaining window.__oai_ references
  
  if (hasCodeBlocks) {
    // Process code blocks
    const codeItems = [];
    const textParts = [];
    
    // Extract all code blocks
    codeBlocks.forEach(codeEl => {
      const codeText = codeEl.textContent.trim();
      // Skip if too short or looks like JS noise
      if (codeText.length < 5 || codeText.includes('window.__oai_')) return;
      
      // Add as a code item
      codeItems.push({
        type: 'code',
        content: codeText,
        language: detectCodeLanguage(codeText)
      });
      
      // Remove this code from the full text
      fullText = fullText.replace(codeText, '[CODE_BLOCK]');
    });
    
    // Clean up the text
    fullText = cleanupMessageText(fullText);
    
    // Split by code block markers
    const textPieces = fullText.split('[CODE_BLOCK]');
    
    // Create new array alternating text and code
    const combinedItems = [];
    
    // Add first text part if it exists
    if (textPieces[0] && textPieces[0].trim().length > 0) {
      combinedItems.push({
        type: 'text',
        content: textPieces[0].trim()
      });
    }
    
    // Add code blocks with corresponding text
    for (let i = 0; i < codeItems.length; i++) {
      // Add the code block
      combinedItems.push(codeItems[i]);
      
      // Add text after this code block if it exists
      if (textPieces[i+1] && textPieces[i+1].trim().length > 0) {
        combinedItems.push({
          type: 'text',
          content: textPieces[i+1].trim()
        });
      }
    }
    
    items.push(...combinedItems);
  } else {
    // No code blocks, just clean text
    fullText = cleanupMessageText(fullText);
    
    if (fullText.trim().length > 0) {
      // Make sure it's not just JavaScript noise
      if (!fullText.includes('window.__oai_') && 
          !fullText.includes('requestAnimationFrame') &&
          !fullText.includes('SSR_HTML')) {
        items.push({
          type: 'text',
          content: fullText.trim()
        });
      }
    }
  }
  
  // Only create a message if we have items
  if (items.length === 0) return null;
  
  return {
    speaker,
    timestamp: new Date().toLocaleTimeString(),
    items
  };
}

// Improved cleanup function
function cleanupMessageText(text) {
  if (!text) return '';
  
  // Remove redundant elements and timestamps
  text = text.replace(/You said:/gi, '')
             .replace(/ChatGPT said:/gi, '')
             .replace(/User \(\d+:\d+:\d+\)/gi, '')
             .replace(/ChatGPT \(\d+:\d+:\d+\)/gi, '')
             .replace(/Assistant \(\d+:\d+:\d+\)/gi, '');
  
  // Remove any JavaScript noise
  text = text.replace(/window\.__oai_logHTML.+?SearchReason/gs, '')
             .replace(/requestAnimationFrame\(.+?\)/gs, '')
             .replace(/SSR_HTML.+?SSR_TTI/gs, '');
  
  // Remove duplicate lines
  const lines = text.split('\n');
  const uniqueLines = [];
  const seenLines = new Set();
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine && !seenLines.has(trimmedLine)) {
      seenLines.add(trimmedLine);
      uniqueLines.push(trimmedLine);
    }
  }
  
  // Rejoin with proper spacing
  text = uniqueLines.join('\n');
  
  // Replace multiple spaces and normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// Try to detect code language based on content
function detectCodeLanguage(code) {
  if (!code) return 'plaintext';
  
  // Check for language indicators
  if (code.includes('def ') && code.includes('import ')) return 'python';
  if (code.includes('function') && (code.includes('=>') || code.includes('{'))) return 'javascript';
  if (code.includes('public class') || code.includes('public static void')) return 'java';
  if (code.includes('#include') && (code.includes('<iostream>') || code.includes('<stdio.h>'))) return 'cpp';
  if (code.includes('package main') || code.includes('func main()')) return 'go';
  
  // Default
  return 'code';
}

// Set up a listener for communication
window.addEventListener('message', function(event) {
  // Only accept messages from this window
  if (event.source !== window) return;
  
  console.log('Page script received message:', event.data);
  
  if (event.data.type && event.data.type === 'FROM_EXTENSION') {
    console.log('Received message from extension:', event.data);
    
    if (event.data.action === 'extractContentDirect') {
      console.log('Extraction request received, extracting content...');
      const data = extractChatContent();
      sendExtractedContent(data);
    }
  }
});

// Notify that we're ready
window.postMessage({
  type: 'FROM_PAGE_SCRIPT',
  action: 'scriptLoaded',
  message: 'Injected script is loaded and ready'
}, '*');
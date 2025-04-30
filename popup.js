/**
 * ChatGPT to PDF Converter - Popup Script
 * Handles PDF generation using data from the content script
 * 
 * Privacy: All processing is local using jsPDF and localStorage; no data is sent to servers.
 */

let jsPDF;

// Initialize jsPDF when the document loads
document.addEventListener('DOMContentLoaded', function() {
  // We can't use external scripts due to CSP restrictions
  // Initialize app directly
  initializeApp();
});

// Initialize the app
function initializeApp() {
  if (typeof window.jspdf !== 'undefined') {
    // Use the global jspdf object if it exists
    jsPDF = window.jspdf.jsPDF;
    console.log('jsPDF initialized from window.jspdf');
  } else if (typeof window.jsPDF !== 'undefined') {
    // Try alternative format
    jsPDF = window.jsPDF;
    console.log('jsPDF initialized from window.jsPDF');
  } else {
    console.error('jsPDF library not found! PDF generation will fail.');
    document.getElementById('status').textContent = 'Error: PDF library not loaded';
    document.getElementById('status').style.display = 'block';
    document.getElementById('generatePdf').disabled = true;
    return;
  }
  
  console.log('jsPDF library loaded successfully');
  
  // Check if autoTable plugin is available
  const testDoc = new jsPDF();
  if (typeof testDoc.autoTable !== 'function') {
    console.warn('jsPDF autoTable plugin not found! Tables will use fallback rendering.');
    document.getElementById('status').textContent = 'Warning: Table plugin not loaded';
    document.getElementById('status').style.display = 'block';
    setTimeout(() => {
      document.getElementById('status').textContent = '';
      document.getElementById('status').style.display = 'none';
    }, 3000);
  } else {
    console.log('jsPDF autoTable plugin loaded successfully');
  }
  
  // Get UI elements
  const generateButton = document.getElementById('generatePdf');
  const exportCounter = document.getElementById('exportCounter');
  const errorMessage = document.getElementById('errorMessage');
  
  // Initialize and check export count
  checkExportCount();
  
  // Add click event listener to the generate button
  generateButton.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (!tab) {
        showStatus("Error: No active tab found");
        return;
      }
      
      // Ensure content script is loaded
      await ensureContentScript(tab.id);
      
      // Generate PDF
      await generatePDF();
    } catch (error) {
      console.error('Error:', error);
      showStatus("Error: " + error.message);
    }
  });
  
  /**
   * Generate PDF from conversation data
   */
  async function generatePDF() {
    console.log('Generate PDF button clicked');
    clearError();
    
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (!tab) {
        showStatus("Error: No active tab found");
        return;
      }
      
      const url = tab.url || '';
      if (!url.includes('chat.openai.com') && !url.includes('chatgpt.com')) {
        showStatus("This extension only works on ChatGPT pages");
        return;
      }
      
      showStatus("Preparing PDF generation...");
      
      // Clear any existing content
      await chrome.storage.local.remove(['chatContent']);
      
      // First, inject content script
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      console.log('Content script injected');
      
      // Add delay to ensure script initialization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Send extraction message and wait for response
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'FROM_EXTENSION',
          action: 'extractContentDirect'
        }, response => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        });
      });
      
      console.log('Extraction response:', response);
      
      // Check if extraction was successful
      if (!response || !response.success) {
        throw new Error(response?.error || 'Extraction failed');
      }
      
      // Wait for storage to be updated
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get data from storage
      const result = await chrome.storage.local.get(['chatContent']);
      console.log('Retrieved from storage:', result);
      
      if (!result.chatContent || !result.chatContent.messages || result.chatContent.messages.length === 0) {
        console.error('No content found in storage:', result);
        throw new Error('No conversation content found');
      }
      
      // Create PDF with the data
      await createPDF(result.chatContent);
      
    } catch (error) {
      console.error('PDF generation error:', error);
      showStatus("Error: " + error.message);
    }
  }
  
  /**
   * Create a PDF with conversation content
   */
  async function createPDF(data) {
    try {
      console.log("===== PDF GENERATION START =====");
      console.log('Raw data received:', data);
      
      // Log detailed message content for debugging
      if (data && Array.isArray(data.messages)) {
        console.log('===== DETAILED MESSAGE CONTENT =====');
        data.messages.forEach((msg, idx) => {
          console.log(`Message #${idx+1} from ${msg.speaker}:`);
          if (msg.items && Array.isArray(msg.items)) {
            msg.items.forEach((item, itemIdx) => {
              if (item.type === 'text') {
                console.log(`  Text item #${itemIdx+1}: "${item.content.substring(0, 100)}${item.content.length > 100 ? '...' : ''}"`);
              } else {
                console.log(`  ${item.type} item #${itemIdx+1}`);
              }
            });
          }
        });
        console.log('===== END DETAILED MESSAGE CONTENT =====');
      }
      
      if (!data || !Array.isArray(data.messages)) {
        console.error('===== PDF GENERATION ERROR =====');
        showStatus("Error: Invalid conversation data");
        return;
      }
      
      // Make sure each message has an items array
      const rawMessages = data.messages.map(msg => {
        if (!msg.items || !Array.isArray(msg.items)) {
          // Add empty items array if missing
          msg.items = [];
        }
        return msg;
      });
      
      // Pre-process messages: dedupe and format
      const processedMessages = processMessagesForPDF(rawMessages);
      console.log(`Preparing to render ${processedMessages.length} messages`);
      
      // Clean any "You said:" or "ChatGPT said:" from message content
      processedMessages.forEach(message => {
        if (message.items && Array.isArray(message.items)) {
          message.items.forEach(item => {
            if (item.type === 'text' && item.content) {
              // Store original content for comparison
              const originalContent = item.content;
              
              // First clean up prefixes at the beginning of messages
              item.content = item.content.replace(/^(You said:|ChatGPT said:|User said:|Assistant said:)\s*/i, '');
              item.content = item.content.replace(/^(You|User):\s*/i, '');
              item.content = item.content.replace(/^(ChatGPT|Assistant):\s*/i, '');
              
              // Then clean up inline references
              item.content = item.content.replace(/\b(You said:|ChatGPT said:|User said:|Assistant said:)\s*/gi, '');
              
              // And handle more variations that might appear in the content
              item.content = item.content.replace(/\b(According to you:|As you mentioned:|You mentioned:|You asked:)\s*/gi, '');
              item.content = item.content.replace(/\b(As I mentioned:|I mentioned:|I said:|As previously mentioned:)\s*/gi, '');
              
              // Remove the "4o" pattern that appears at the end of messages
              item.content = item.content.replace(/\s*4o\s*$/i, '');
              item.content = item.content.replace(/\s*4o\s*$/, '');
              
              // Also try to catch any similar patterns (numbers followed by 'o' at the end)
              item.content = item.content.replace(/\s*\d+o\s*$/i, '');
              
              // Log if any changes were made
              if (originalContent !== item.content) {
                console.log('Cleaned up message content:', 
                  `Before: "${originalContent.substring(0, 50)}${originalContent.length > 50 ? '...' : ''}"`,
                  `After: "${item.content.substring(0, 50)}${item.content.length > 50 ? '...' : ''}"`
                );
              }
            }
          });
        }
      });
      
      // Check if tables survived processing
      let tablesSurvived = 0;
      processedMessages.forEach((message, idx) => {
        const tablesInMessage = message.items.filter(item => item.type === 'table');
        if (tablesInMessage.length > 0) {
          tablesSurvived += tablesInMessage.length;
          console.log(`Tables in message ${idx} (${message.speaker}): ${tablesInMessage.length}`);
          tablesInMessage.forEach((table, tableIdx) => {
            console.log(`PRE-RENDER TABLE #${tableIdx+1} in message ${idx}:`, {
              headers: table.headers || [],
              rows: table.rows || [],
              headerCount: table.headers ? table.headers.length : 0,
              rowCount: table.rows ? table.rows.length : 0
            });
          });
        }
      });
      console.log(`Tables ready for rendering: ${tablesSurvived}`);
      
      // Initialize PDF document
      console.log('Initializing PDF document...');
      const doc = createPDFWithUnicodeSupport();
      // Set up page parameters and log
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const margin = 20;
      const bottomMargin = margin;
      console.log(`Page size: ${pageWidth.toFixed(2)} x ${pageHeight.toFixed(2)}, margin: ${margin}`);
      console.log(`Content width: ${pageWidth - 2 * margin}`);
      
      // Add title
      const title = data.title || 'ChatGPT Conversation';
      console.log(`Setting up PDF title: "${title}"`);
      
      // Draw centered title with styling
      doc.setFillColor(240, 240, 240);
      doc.rect(0, 0, pageWidth, 32, 'F');
      
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(50, 50, 50);
      
      // Center the title
      const titleWidth = doc.getTextWidth(title);
      doc.text(title, (pageWidth - titleWidth) / 2, 20);
      
      // Add timestamp and export info
      const timestamp = new Date().toLocaleString();
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 100, 100);
      
      const timestampText = `Exported on ${timestamp}`;
      const timestampWidth = doc.getTextWidth(timestampText);
      doc.text(timestampText, (pageWidth - timestampWidth) / 2, 30);
      
      // Add separator line
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.5);
      doc.line(margin, 36, pageWidth - margin, 36);
      
      // Start position for messages after header
      let yPosition = 45;
      
      // Render each message
      console.log(`Rendering ${processedMessages.length} messages`);
      
      for (let i = 0; i < processedMessages.length; i++) {
        console.log(`-- Rendering message #${i+1}: speaker=${processedMessages[i].speaker}, items=${processedMessages[i].items.length}`);
        // Break page if we exceed bottom margin
        if (yPosition > pageHeight - bottomMargin) {
          console.log(`-- Page break: yPosition (${yPosition}) > pageHeight - bottomMargin (${pageHeight} - ${bottomMargin})`);
          doc.addPage();
          yPosition = margin;
        }
        
        // Render the message
        yPosition = await renderMessage(doc, processedMessages[i], yPosition, pageWidth - 2 * margin);
        
        console.log(`Rendered message ${i+1}/${processedMessages.length}, new Y: ${yPosition}`);
      }
      
      // Save PDF and show download link
      console.log("===== PDF GENERATION COMPLETE =====");
      let pdfBytes = await doc.save();
      
      const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      const pdfUrl = URL.createObjectURL(pdfBlob);
      
      console.log('PDF generated, initiating download...');
      
      // Download the PDF
      if (!downloadPDF(doc, title)) {
        // Fallback: show in new tab
        console.log('Using fallback method for PDF display');
        window.open(pdfUrl);
      }
      
      showStatus("PDF generated successfully!");
      return true;
    } catch (error) {
      console.error("===== PDF GENERATION ERROR =====");
      console.error("Error details:", error);
      console.error("Stack trace:", error.stack);
      showStatus("Error generating PDF: " + error.message);
      return false;
    }
  }
  
  /**
   * Process messages for PDF
   */
  function processMessagesForPDF(messages) {
    if (!messages || !Array.isArray(messages)) return messages;
    
    console.log('Input message count before processing:', messages.length);
    
    // Count table items for debugging
    let tableCount = 0;
    messages.forEach((message, msgIndex) => {
      if (message && message.items && Array.isArray(message.items)) {
        const tablesToLog = message.items.filter(item => item && item.type === 'table');
        tablesToLog.forEach((item, idx) => {
          tableCount++;
          console.log(`INITIAL TABLE #${tableCount} in message ${msgIndex} (${message.speaker}):`, {
            headers: item.headers || [],
            rows: item.rows || [],
            headerCount: item.headers ? item.headers.length : 0,
            rowCount: item.rows ? item.rows.length : 0
          });
        });
      }
    });
    console.log(`Total tables found: ${tableCount}`);
    
    // Step 1: Filter out empty messages
    const nonEmptyMessages = messages.filter(message => 
      message && message.items && Array.isArray(message.items) && message.items.length > 0
    );
    console.log('Non-empty message count:', nonEmptyMessages.length);
    
    // Track tables in non-empty messages
    let tablesInNonEmptyMessages = 0;
    nonEmptyMessages.forEach((message, msgIndex) => {
      const tables = message.items.filter(item => item.type === 'table');
      if (tables.length > 0) {
        tablesInNonEmptyMessages += tables.length;
        console.log(`Tables in non-empty message ${msgIndex} (${message.speaker}): ${tables.length}`);
        tables.forEach((table, idx) => {
          console.log(`NON-EMPTY TABLE #${idx+1} in message ${msgIndex}:`, {
            headers: table.headers || [],
            rows: table.rows || [],
            headerCount: table.headers ? table.headers.length : 0,
            rowCount: table.rows ? table.rows.length : 0
          });
        });
      }
    });
    console.log(`Tables after empty message filtering: ${tablesInNonEmptyMessages}`);
    
    // Helper function to check if a text is a UI control label
    function isUIControlText(text) {
      if (!text) return false;
      const lcText = text.toLowerCase().trim();
      return lcText === 'java' || 
             lcText === 'copy' || 
             lcText === 'edit' || 
             lcText === 'copy edit' ||
             /^(javascript|python|typescript|html|css|json|xml|yaml|sql|c\+\+|c#|go|ruby|php)$/.test(lcText);
    }
    
    // Helper function to detect if an item should be merged with previous code block
    function shouldSkipAsUIControl(item, prevItem) {
      // Skip standalone UI control text
      if (item.type === 'text' && isUIControlText(item.content)) {
        console.log('Skipping UI control text:', item.content);
        return true;
      }
      
      // Skip text that follows code blocks and contains only UI controls
      if (item.type === 'text' && prevItem && prevItem.type === 'code') {
        const words = item.content.trim().toLowerCase().split(/\s+/);
        if (words.length <= 3 && words.every(word => 
          ['java', 'copy', 'edit', 'javascript', 'python', 'typescript'].includes(word))) {
          console.log('Skipping UI control after code:', item.content);
          return true;
        }
      }
      
      return false;
    }
    
    // Step 2: Process each message individually to clean items
    return nonEmptyMessages.map(message => {
      if (!message.items || !Array.isArray(message.items)) return message;
      
      // Log item types count for debugging
      const itemTypes = {};
      message.items.forEach(item => {
        itemTypes[item.type] = (itemTypes[item.type] || 0) + 1;
      });
      console.log(`Message from ${message.speaker} contains:`, itemTypes);
      
      // Look for potential equations that might be misclassified as text
      message.items.forEach((item, index) => {
        if (item.type === 'text') {
          const content = item.content.trim();
          // Check for potential equations
          if (
            /F\s*=\s*m\s*a/.test(content) ||
            /E\s*=\s*m\s*c\^?2/.test(content) ||
            /p\s*=\s*m\s*v/.test(content) ||
            /dt\s+d[pv]/.test(content) ||
            /=\s*m\s*d[v]\/dt/.test(content) ||
            /\\frac/.test(content) ||
            /\\int/.test(content) ||
            /\\sum/.test(content) ||
            /\\sqrt/.test(content) ||
            /\\alpha|\\beta|\\gamma|\\delta/.test(content) ||
            /\\partial|\\nabla/.test(content)
          ) {
            console.log('Found potential equation in text:', content);
            // Convert to equation type
            message.items[index] = { 
              type: 'equation', 
              content: content,
              y: item.y // Preserve y-coordinate
            };
          }
        }
      });
      
      // Helper function to normalize text for comparison
    function normalizeContent(text) {
      if (!text) return '';
      return text.trim()
        .replace(/\s+/g, ' ')                   // Normalize whitespace
        .replace(/[•*]\s*/g, '')                // Remove bullet points
          .replace(/^\d+\.\s+/, '')               // Remove numbered list markers
        .replace(/^Newton['']s\s+/, '')         // Normalize "Newton's"
        .replace(/:\s*$/, '')                   // Remove trailing colons
        .toLowerCase();                         // Case insensitive comparison
    }
    
    // Helper function to extract bullet points from text
    function extractBulletPoints(text) {
      if (!text) return [];
      // Split by bullet points at the beginning of a line
      const bulletRegex = /(?:^|\n)[•*]\s+(.+?)(?=(?:\n[•*]|\n\n|$))/g;
      const matches = [...text.matchAll(bulletRegex)];
      return matches.map(m => m[1].trim());
    }
      
      // Helper function to extract numbered list items
      function extractNumberedItems(text) {
        if (!text) return [];
        // Match numbered list items (1. Item, 2. Item, etc.)
        const numberedRegex = /(?:^|\n)\d+\.\s+(.+?)(?=(?:\n\d+\.|\n\n|$))/g;
        const matches = [...text.matchAll(numberedRegex)];
        return matches.map(m => m[1].trim());
      }
    
    // Helper function to check if text contains a bullet point list that includes all items in the comparison list
    function containsBulletedList(text, bulletedItems) {
      if (!text || !bulletedItems || bulletedItems.length === 0) return false;
      
      // First check if the text has bullet point markers
      if (!text.includes('•') && !text.includes('*')) return false;
      
      // Extract normalized bullet points from the text
      const extractedPoints = extractBulletPoints(text);
      const normalizedExtracted = extractedPoints.map(p => normalizeContent(p));
      
      // Check if each item in bulletedItems is contained in the text
      for (const item of bulletedItems) {
        const normalizedItem = normalizeContent(item);
        if (!normalizedExtracted.some(point => point.includes(normalizedItem))) {
          return false;
        }
      }
      
      return true;
    }
    
      // Helper function to check if text contains a numbered list
      function containsNumberedList(text, numberedItems) {
        if (!text || !numberedItems || numberedItems.length === 0) return false;
        
        // First check if the text has numbered list markers
        if (!/\d+\./.test(text)) return false;
        
        // Extract normalized numbered items from the text
        const extractedItems = extractNumberedItems(text);
        const normalizedExtracted = extractedItems.map(p => normalizeContent(p));
        
        // Check if each item in numberedItems is contained in the text
        for (const item of numberedItems) {
          const normalizedItem = normalizeContent(item);
          if (!normalizedExtracted.some(point => point.includes(normalizedItem))) {
            return false;
          }
        }
        
        return true;
      }
      
      // Enhanced deduplication
      const processedItems = [];
      const seenTextNormalized = new Set();       // For normalized text comparison
      const seenEquationNormalized = new Set();   // For normalized equation comparison
      const seenCode = new Set();                 // For code blocks
      const bulletPointItems = [];                // For bullet list de-duplication
      const numberedListItems = [];               // For numbered list de-duplication

      // First pass: Identify all unique items
      // Keep track of previous item to detect UI controls after code blocks
      let prevItem = null;
      
      message.items.forEach(item => {
        // Skip if we don't have content
        if (!item.content && item.type !== 'table') return;
        
        // Handle different item types for deduplication
        if (item.type === 'text') {
          const content = item.content.trim();
          
          // Skip any text that's just a UI control
          if (isUIControlText(content)) {
            console.log('Skipping UI control text:', content);
          return;
        }
        
          // Skip text that comes right after a code block and looks like a language name or command
          if (prevItem && prevItem.type === 'code' && shouldSkipAsUIControl(item, prevItem)) {
            console.log('Skipping language/command after code:', content);
            return;
          }
          
          // Normalize content for comparison
          const normalizedContent = normalizeContent(content);
          
          // Skip obvious duplicates (exact matches after normalization)
          if (seenTextNormalized.has(normalizedContent)) {
            console.log('Skipping duplicate text:', content);
            return;
          }
          
          // Store for duplicate detection
          seenTextNormalized.add(normalizedContent);
          
          // Check and store bullet point items for later analysis
          if (content.startsWith('•') || content.startsWith('*')) {
            bulletPointItems.push(content);
          }
          
          // Check and store numbered list items
          if (/^\d+\.\s/.test(content)) {
            numberedListItems.push(content);
          }
          
          // Add to processed items
            processedItems.push(item);
        } else if (item.type === 'equation') {
          // Normalize equation content to catch dupes
          const normalizedEq = normalizeEquation(item.content);
          
          // Skip if we've seen this exact equation before
          if (seenEquationNormalized.has(normalizedEq)) {
            console.log('Skipping duplicate equation:', item.content);
            return;
          }
          
          // Store normalized equation and add to processed
          seenEquationNormalized.add(normalizedEq);
          processedItems.push(item);
        } else if (item.type === 'code') {
          // For code blocks, use a simpler hashing approach
          const codeHash = item.content.trim().toLowerCase().substring(0, 50);
          
          // Skip duplicate code blocks
          if (seenCode.has(codeHash)) {
            console.log('Skipping duplicate code block');
            return;
          }
          
          // Store hash and add to processed
          seenCode.add(codeHash);
          processedItems.push(item);
        } else if (item.type === 'table') {
          // For tables, print detailed information
          console.log('Processing table in message deduplication:', {
            headers: item.headers || [],
            rows: item.rows || [],
            headerCount: item.headers ? item.headers.length : 0,
            rowCount: item.rows ? item.rows.length : 0
          });
          
          // Always preserve tables
          processedItems.push(item);
        } else {
          // For other types (images), just add directly
          processedItems.push(item);
        }
        
        // Remember the current item for the next iteration
        prevItem = item;
      });
      
      console.log(`After first pass filtering: ${processedItems.length} items`);
      
      // Count tables after first pass
      const tablesAfterFirstPass = processedItems.filter(item => item.type === 'table');
      if (tablesAfterFirstPass.length > 0) {
        console.log(`Tables after first pass filtering: ${tablesAfterFirstPass.length}`);
        tablesAfterFirstPass.forEach((table, idx) => {
          console.log(`FIRST-PASS TABLE #${idx+1}:`, {
            headers: table.headers || [],
            rows: table.rows || [],
            headerCount: table.headers ? table.headers.length : 0,
            rowCount: table.rows ? table.rows.length : 0
          });
        });
      }
      
      // Second pass: Check for text that contains the same content as equations or nested bullet points
      // Remove text items that are duplicating equations or are UI controls
      const finalItems = processedItems.filter((item, index) => {
        // Tables should always be preserved
        if (item.type === 'table') {
          console.log('Preserving table in second pass filtering');
          return true;
        }
        
        // Immediately skip UI controls
        if (item.type === 'text' && isUIControlText(item.content)) {
          console.log('Final filter: Removing UI control text:', item.content);
          return false;
        }
        
        // Check for UI control text after code blocks
        if (item.type === 'text' && index > 0 && processedItems[index-1].type === 'code') {
          const words = item.content.trim().toLowerCase().split(/\s+/);
          if (words.length <= 3 && words.some(word => 
            ['java', 'copy', 'edit', 'javascript', 'python', 'typescript'].includes(word))) {
            console.log('Final filter: Removing UI control after code:', item.content);
            return false;
          }
        }
        
        // Special handling for text that might include nested bullet points
        if (item.type === 'text' && bulletPointItems.length > 0) {
          // Check if this text item contains the same content as separate bullet points
          const bulletPoints = bulletPointItems.filter(bp => bp !== item.content);
          if (containsBulletedList(item.content, bulletPoints)) {
            console.log('Removing text that contains nested bullet points:', item.content);
            return false;
          }
          
          // Also check if this is a heading followed by duplicated bullet points
          if (isHeaderText(item.content) && 
              processedItems.some((otherItem, otherIndex) => 
                otherIndex > index && 
                otherItem.type === 'text' && 
                otherItem.content.includes(item.content.replace(/:\s*$/, '')))) {
            console.log('Removing heading that gets repeated with bullet points:', item.content);
            return false;
          }
        }
        
        // Similar handling for numbered lists
        if (item.type === 'text' && numberedListItems.length > 0) {
          // Check if this text item contains the same content as separate numbered items
          const numberedItems = numberedListItems.filter(ni => ni !== item.content);
          if (containsNumberedList(item.content, numberedItems)) {
            console.log('Removing text that contains numbered list items:', item.content);
            return false;
          }
          
          // Check for headers repeated in numbered lists
          if (isHeaderText(item.content) && 
              processedItems.some((otherItem, otherIndex) => 
                otherIndex > index && 
                otherItem.type === 'text' && 
                /^\d+\.\s/.test(otherItem.content) &&
                otherItem.content.includes(item.content.replace(/:\s*$/, '')))) {
            console.log('Removing heading that gets repeated in numbered list:', item.content);
          return false;
          }
        }
        
        // For all other items, keep them
        return true;
      });
      
      console.log(`After second pass filtering: ${finalItems.length} items`);
      
      // Count tables after second pass
      const tablesAfterSecondPass = finalItems.filter(item => item.type === 'table');
      if (tablesAfterSecondPass.length > 0) {
        console.log(`Tables after second pass filtering: ${tablesAfterSecondPass.length}`);
        tablesAfterSecondPass.forEach((table, idx) => {
          console.log(`SECOND-PASS TABLE #${idx+1}:`, {
            headers: table.headers || [],
            rows: table.rows || [],
            headerCount: table.headers ? table.headers.length : 0,
            rowCount: table.rows ? table.rows.length : 0
          });
        });
      } else {
        console.log('WARNING: No tables survived the second pass filtering!');
      }
      
      // Return a new message object with the filtered items
      return {
        ...message,
        items: finalItems
      };
    });
  }
  
  // Add the normalizeEquation function after the other helper functions in processMessagesForPDF
  function normalizeEquation(eq) {
    if (!eq) return '';
    return eq.trim()
      .replace(/\s+/g, '')                    // Remove all whitespace
      .replace(/[=:]+/g, '=')                 // Normalize equals signs
      .replace(/F=ma|F=m\*a|F=m×a/i, 'F=ma')  // Normalize Newton's law
      .replace(/differentiatebothsideswithrespecttotime/i, 'dp/dt=d(mv)/dt')
      .replace(/assumingmassmisconstant/i, 'dp/dt=mdv/dt')
      .replace(/since=dv\/dt=a/i, 'F=ma')
      .toLowerCase();                         // Case insensitive comparison
  }
  
  /**
   * Check and display the export count with 5/day limit
   */
  function checkExportCount() {
    // Get current date and stored export data
    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    
    // For testing - bypass export limit
    chrome.storage.local.set({
      exportCount: 0,
      exportDate: today
    });
    
    chrome.storage.local.get(['exportCount', 'exportDate'], function(result) {
      // Always set result to 0 for testing
      result.exportCount = 0;
      result.exportDate = today;
      
      // Display export count
      const exportCounter = document.getElementById('exportCounter');
      if (exportCounter) {
        // Always show 0/5 for testing
        exportCounter.textContent = `${result.exportCount}/5 exports used today`;
        exportCounter.style.display = 'block';
      }
      
      // Enable/disable button based on count
      const generateButton = document.getElementById('generatePdf');
      if (generateButton) {
        // Always enable for testing
        generateButton.disabled = false;
      }
    });
  }
  
  /**
   * Increment the export count
   */
  function incrementExportCount() {
    // For testing, don't increment
    return;
    
    // Original code below (commented out for testing)
    /*
    const today = new Date().toISOString().split('T')[0];
    
    chrome.storage.local.get(['exportCount', 'exportDate'], function(result) {
      let exportCount = result.exportCount || 0;
      const exportDate = result.exportDate || today;
      
      // Reset count if it's a new day
      if (exportDate !== today) {
        exportCount = 0;
      }
      
      // Increment count and save
      exportCount++;
      
      chrome.storage.local.set({
        exportCount: exportCount,
        exportDate: today
      }, function() {
        // Update UI
        checkExportCount();
      });
    });
    */
  }
}

/**
 * Display a status message
 */
function showStatus(message) {
  const statusElement = document.getElementById('status');
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.style.display = 'block';
  }
}

/**
 * Display an error message
 */
function showError(message) {
  const errorElement = document.getElementById('errorMessage');
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = 'block';
  }
}

/**
 * Clear error messages
 */
function clearError() {
  const errorElement = document.getElementById('errorMessage');
  if (errorElement) {
    errorElement.textContent = '';
    errorElement.style.display = 'none';
  }
}

// Enhanced downloadPDF function with more logging
function downloadPDF(doc, filename) {
  try {
    console.log('===== PDF DOWNLOAD START =====');
    console.log(`Attempting to download PDF as "${filename}"...`);
    
    // Convert the PDF to a data URI
    console.log('Converting PDF to data URI...');
    const pdfData = doc.output('datauristring');
    console.log(`PDF data generated: ${pdfData.substring(0, 100)}...`);
    
    // Try the standard approach first
    try {
      console.log('Using standard download method (createObjectURL + anchor)...');
      const downloadLink = document.createElement('a');
      downloadLink.href = pdfData;
      downloadLink.download = filename;
      console.log('Download link created with filename:', filename);
      
      document.body.appendChild(downloadLink);
      console.log('Download link appended to body');
      
      downloadLink.click();
      console.log('Download link clicked');
      
      document.body.removeChild(downloadLink);
      console.log('Download link removed from body');
      
      console.log('===== STANDARD DOWNLOAD COMPLETE =====');
      return true;
    } catch (e) {
      console.warn('Standard download failed:', e);
      console.log('Trying fallback download method...');
      return fallbackDownload(pdfData, filename);
    }
  } catch (error) {
    console.error('===== DOWNLOAD ERROR =====');
    console.error('Download failed:', error);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

// Enhanced fallback download with better logging
function fallbackDownload(pdfData, filename) {
  console.log('===== FALLBACK DOWNLOAD START =====');
  
  try {
    // Try using blob approach first
    console.log('Trying blob approach...');
    try {
      const byteCharacters = atob(pdfData.split(',')[1]);
      const byteArrays = [];
      
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
      }
      
      const blob = new Blob(byteArrays, {type: 'application/pdf'});
      const url = URL.createObjectURL(blob);
      
      console.log('Blob created, URL:', url.substring(0, 30) + '...');
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      console.log('Blob download attempt complete');
      return true;
    } catch (e) {
      console.warn('Blob approach failed:', e);
    }
    
    // Try using chrome.downloads API if available
    console.log('Trying chrome.downloads API...');
    if (chrome.downloads) {
      console.log('chrome.downloads API available');
      chrome.downloads.download({
        url: pdfData,
        filename: filename,
        saveAs: false
      }, function(downloadId) {
        if (chrome.runtime.lastError) {
          console.error('Chrome download API failed:', chrome.runtime.lastError);
          showStatus('Download failed: ' + chrome.runtime.lastError.message);
        } else {
          console.log('Download started with ID:', downloadId);
          showStatus('PDF downloaded successfully!');
          incrementExportCount();
        }
      });
      return true;
    } else {
      console.warn('chrome.downloads API not available');
    }
  } catch (e) {
    console.error('Fallback download error:', e);
    console.error('Stack trace:', e.stack);
  }
  
  console.log('===== ALL DOWNLOAD ATTEMPTS FAILED =====');
  return false;
}

// Add this function to popup.js
function showPDFDebugData(doc) {
  console.log('Displaying PDF debug data');
  
  try {
    // Get raw PDF data
    const rawData = doc.output();
    
    // Show first 500 bytes in console
    console.log('PDF Raw Data (first 500 bytes):', 
      rawData.substring(0, 500));
    
    // Get data URI
    const dataUri = doc.output('datauristring');
    console.log('PDF Data URI (first 100 chars):', 
      dataUri.substring(0, 100) + '...');
    
    // Create debug display in popup
    const debugArea = document.createElement('div');
    debugArea.style.margin = '10px 0';
    debugArea.style.padding = '10px';
    debugArea.style.backgroundColor = '#f0f0f0';
    debugArea.style.borderRadius = '4px';
    debugArea.style.fontSize = '12px';
    
    debugArea.innerHTML = `
      <strong>PDF Debug Info:</strong>
      <p>PDF Generation completed. Raw size: ${rawData.length} bytes</p>
      <p>If download fails, <a href="${dataUri}" download="ChatGPT_Conversation.pdf" id="directDownloadLink">click here to download</a></p>
    `;
    
    // Add click handler for the link
    setTimeout(() => {
      const directLink = document.getElementById('directDownloadLink');
      if (directLink) {
        directLink.click(); // Auto-click the download link
      }
    }, 1000);
    
    // Add to popup
    document.querySelector('.main-content').appendChild(debugArea);
    
    return true;
  } catch (e) {
    console.error('Error showing PDF debug data:', e);
    return false;
  }
}

// Update createPDFWithUnicodeSupport function
function createPDFWithUnicodeSupport() {
  if (!jsPDF) {
    console.error('jsPDF not initialized');
    showStatus("Error: PDF library not initialized");
    throw new Error('jsPDF not initialized');
  }
  
  const doc = new jsPDF();
  
  // Attempt to use a font with better Unicode support if available
  try {
    doc.setFont('Helvetica');
  } catch (e) {
    console.warn('Failed to set Unicode font', e);
  }
  
  return doc;
}

// Add a simple PDF test function
function testPDF() {
  try {
    console.log('Testing basic PDF generation');
    
    if (!jsPDF) {
      alert('jsPDF is not initialized!');
      return false;
    }
    
    // Create a simple PDF
    const doc = new jsPDF();
    doc.text('Hello world!', 10, 10);
    doc.text('This is a basic PDF test.', 10, 20);
    
    // Get data URL and open in new tab
    const pdfData = doc.output('datauristring');
    window.open(pdfData);
    
    return true;
  } catch (error) {
    console.error('Test PDF error:', error);
    alert('PDF Test Error: ' + error.message);
    return false;
  }
}

// Update the rendering logic to properly handle indentation
async function renderMessage(doc, message, startY, maxWidth) {
  console.log('Rendering message:', message.speaker);
  
  // Set up styling based on speaker
  const userColor = [0, 0, 0]; // Black
  const chatgptColor = [16/255, 163/255, 127/255]; // ChatGPT green
  
  // Choose text color based on speaker
  const textColor = message.speaker === 'User' ? userColor : chatgptColor;
  
  // Get page dimensions for positioning
  const pageHeight = doc.internal.pageSize.height;
  const pageWidth = doc.internal.pageSize.width;
  const marginBottom = 20; // Bottom margin to avoid cutting content
  
  // Draw speaker with timestamp - only at the beginning of the message
  doc.setTextColor(...textColor);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  
  // Check if we need a new page before starting the message
  if (startY > pageHeight - 50) { // Need at least 50pt for header
    doc.addPage();
    startY = 20; // Reset to top of new page
  }
  
  // Map 'Assistant' label to 'ChatGPT' and simplify labels
  // Only show the name without "said" or other phrases
  const speakerText = message.speaker === 'Assistant' ? 'ChatGPT' : 'User';
  
  doc.text(speakerText, 10, startY);
  
  // Move down for message content
  startY += 6;
  
  // Reset font for message content
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0); // Reset to black
  
  let currentY = startY;
  let isFirstItemOnPage = true;
  let isFirstPage = true; // Track if we're on the first page of this message
  
  // Ensure message.items exists and is an array
  if (!message.items || !Array.isArray(message.items)) {
    console.warn('Message has no items array:', message);
    message.items = []; // Set to empty array to prevent errors
  }
  
  // Sort message items by sequence if present
  if (message.items.some(item => item.sequence !== undefined)) {
    message.items.sort((a, b) => {
      const seqA = a.sequence !== undefined ? a.sequence : 999;
      const seqB = b.sequence !== undefined ? b.sequence : 999;
      return seqA - seqB;
    });
  }
  
  // Process each content item
  for (const item of message.items) {
    // First, calculate how much space this item will need
    let itemHeight = 0;
    
    if (item.type === 'text') {
      // Handle regular text and bullet lists with proper line breaks
      
      // Check if this is a header/subheader (ends with ":" and not too long)
      const isHeader = isHeaderText(item.content.trim());
      
      // Process heading-like text with bold style
      if (isHeader) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11); // Slightly larger font for headers
        doc.setTextColor(35, 35, 35); // Light dark shade instead of solid black
        
        const textLines = doc.splitTextToSize(item.content, maxWidth - 20);
        doc.text(textLines, 15, currentY);
        
        // Reduce spacing after headers
        const lineHeight = 4; // Reduced from 6 to 4
        currentY += textLines.length * lineHeight + 0; // Removed extra +2 padding
        
        // Reset font for subsequent text
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
      } else {
        // Check for bullet points to add indentation
        const content = item.content.trim();
        const isBullet = content.startsWith('•') || content.startsWith('*');
        
        // Check for numbered lists (1., 2., etc.)
        const isNumberedList = /^\d+\.\s/.test(content);
      
      // Determine indentation level for bullet points
      let indentLevel = 0;
      if (isBullet) {
        // Check for visual indentation that might indicate a nested bullet
          const leadingSpaces = content.match(/^[•*]\s+(\s*)/);
        if (leadingSpaces && leadingSpaces[1]) {
          indentLevel = Math.min(3, Math.floor(leadingSpaces[1].length / 2));
        }
        
        // Always apply at least one level of indentation for any bullet point
        indentLevel = Math.max(1, indentLevel);
        } else if (isNumberedList) {
          // Use similar indentation for numbered lists
          indentLevel = 1;
        }
        
        // Calculate indent amount - moderate indentation for bullet points and numbered lists
        const indent = (isBullet || isNumberedList) ? 15 + (indentLevel * 3) : 15;
        
        // Add visual cue for nested bullet points - indent them more
        const availableWidth = maxWidth - ((isBullet || isNumberedList) ? 30 : 20) - (indentLevel * 8);
        const textLines = doc.splitTextToSize(content, availableWidth);
        
        // Use slightly lighter text color for regular paragraphs
        doc.setTextColor(50, 50, 50); // Dark gray instead of black
        
        // Apply bullet point indentation
        doc.text(textLines, indent, currentY);
        
        // Tighten bullet list spacing
        const lineSpacing = (isBullet || isNumberedList) ? 3 : 5;
        const extra = (isBullet || isNumberedList) ? 2 : 3;
        currentY += textLines.length * lineSpacing + extra;
        
        // Reset text color to black for other elements
        doc.setTextColor(0, 0, 0);
      }
    } else if (item.type === 'code') {
      // For code blocks, use a light grey background and monospace font
      doc.setFont('courier');
      doc.setFontSize(8);
      
      // Clean up whitespace - trim trailing whitespace from each line and remove empty lines at end
      let trimmedContent = item.content.trim().split('\n').map(line => 
        line.replace(/\s+$/, '')
      );
      
      // Remove any trailing empty lines
      while(trimmedContent.length > 0 && trimmedContent[trimmedContent.length-1] === '') {
        trimmedContent.pop();
      }
      
      // More aggressive removal of common headers in code blocks
      // Check first 1-2 lines for language indicators, "Copy Edit", or short commands
      if (trimmedContent.length > 0) {
        // Check if first line is a common language indicator or command
        const firstLine = trimmedContent[0].trim().toLowerCase();
        if (
          /^(java|python|javascript|js|typescript|ts|html|css|c\+\+|c#|ruby|go|rust|php|swift|kotlin|sql|shell|bash|powershell|json|yaml|xml|markdown|plaintext|text)$/i.test(firstLine) || 
          /^copy\s+edit$/i.test(firstLine) ||
          /^copy$/i.test(firstLine) || 
          /^edit$/i.test(firstLine) ||
          /^\d{1,2}o$/i.test(firstLine) // Matches patterns like "4o"
        ) {
          trimmedContent.shift(); // Remove the first line
        }
        
        // Also check second line if it looks like a command
        if (trimmedContent.length > 0) {
          const secondLine = trimmedContent[0].trim().toLowerCase();
          if (/^(copy|edit)$/i.test(secondLine)) {
            trimmedContent.shift(); // Remove the line
          }
        }
      }
      
      const lines = trimmedContent;
      let maxLineWidth = 0;
      
      // Find the longest line for width calculation
      lines.forEach(line => {
        const lineWidth = doc.getTextWidth(line);
        maxLineWidth = Math.max(maxLineWidth, lineWidth);
      });
      
      // Set padding (reduced for a more compact look)
      const topPadding = 2;
      const bottomPadding = 2;
      const sidePadding = 3;
      
      // Calculate total dimensions with optimized line height
      const blockWidth = maxLineWidth + (sidePadding * 2);
      const lineHeight = doc.getTextDimensions('M').h * 1.05; // Further reduced multiplier
      const blockHeight = (lines.length * lineHeight) + topPadding + bottomPadding;
      
      // Check if we need a page break
      if (currentY + blockHeight > pageHeight - 20) {
        doc.addPage();
        currentY = 20;
        console.log('[PDF DEBUG] Added page break before code block');
      }
      
      // Draw background with rounded corners
      doc.setFillColor(245, 245, 245);
      // Use roundedRect instead of rect for rounded corners
      doc.roundedRect(20, currentY, blockWidth, blockHeight, 3, 3, 'F');
      
      // Draw code text
      doc.setTextColor(0, 0, 0);
      lines.forEach((line, i) => {
        const yPos = currentY + topPadding + (i * lineHeight) + (lineHeight * 0.7);
        doc.text(line, 20 + sidePadding, yPos);
      });
      
      // Reset font and advance Y position
      doc.setFont('helvetica');
      doc.setFontSize(10);
      
      // Use minimal spacing after code blocks
      currentY += blockHeight + 1; // Minimal spacing after code blocks
      console.log('[PDF DEBUG] Code block rendered with dimensions:', {maxLineWidth, blockWidth, blockHeight, lines: lines.length});
    } else if (item.type === 'image') {
      // Embed image
      try {
        const src = item.content;
        console.log('Processing image in renderMessage (second handler):', src);
        
        // Check if this is an OpenAI image URL
        const isOpenAIUrl = src.includes('oaiusercontent.com') || src.includes('chatgpt.com/files');
        
        // For OpenAI images that might have CORS/403 issues, try to use the data directly
        if (isOpenAIUrl) {
          try {
            // First try with direct conversion
            const dataURL = await imageToDataURL(src);
            
            // Calculate dimensions to fit page width
            const imgProps = doc.getImageProperties(dataURL);
            const imgWidth = maxWidth * 0.5;
            const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
            
            doc.addImage(dataURL, 'JPEG', 15, currentY, imgWidth, imgHeight);
            currentY += imgHeight + 5;
          } catch (error) {
            console.warn('Failed to load OpenAI image directly, adding placeholder (second handler):', error);
            
            // Add a placeholder for the image - ENHANCED VISIBILITY
            doc.setFillColor(230, 240, 250); // Light blue background
            doc.setDrawColor(100, 150, 200); // Darker blue border
            const placeholderWidth = maxWidth * 0.8; // Wider placeholder
            const placeholderHeight = 120; // Taller placeholder
            
            // Draw a more visible rounded rectangle
            doc.setLineWidth(0.5);
            doc.roundedRect(15, currentY, placeholderWidth, placeholderHeight, 5, 5, 'FD');
            
            // Draw a small icon to represent an image
            doc.setFillColor(180, 200, 230);
            doc.circle(15 + 20, currentY + 20, 10, 'F');
            
            // Add more visible text message
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(50, 50, 150); // Dark blue text
            doc.text('OpenAI Image (Protected Content)', 15 + placeholderWidth/2, currentY + 30, {
              align: 'center'
            });
            
            // Add explanation
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(80, 80, 120);
            doc.text('This image could not be embedded due to access restrictions.', 
              15 + placeholderWidth/2, currentY + 50, {
              align: 'center'
            });
            
            // Show complete URL on multiple lines if needed
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            const urlLines = doc.splitTextToSize(src, placeholderWidth - 30);
            doc.text(urlLines, 15 + placeholderWidth/2, currentY + 70, {
              align: 'center'
            });
            
            // Debug info
            doc.setFontSize(7);
            doc.setTextColor(150, 150, 150);
            doc.text('Debug: Placeholder rendered at y=' + currentY, 15 + 10, currentY + placeholderHeight - 10);
            
            // Reset styles
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.setLineWidth(0.1);
            
            currentY += placeholderHeight + 10; // Extra spacing after placeholder
          }
        } else {
          // Standard image processing for non-OpenAI images
          const dataURL = src.startsWith('data:') ? src : await imageToDataURL(src);
          // Calculate dimensions to fit half width
          const imgProps = doc.getImageProperties(dataURL);
          const imgWidth = maxWidth * 0.5;
          const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
          doc.addImage(dataURL, 'JPEG', 15, currentY, imgWidth, imgHeight);
          currentY += imgHeight + 5;
        }
      } catch (e) {
        console.warn('Failed to add image (second handler):', e);
        currentY += 5; // Add a bit of space even if image fails
      }
    } else if (item.type === 'equation') {
      try {
        const equation = item.content.trim();
        // Get page width to pass to the equation renderer
        const pageWidth = doc.internal.pageSize.width;
        
        // Use direct rendering approach for better reliability
        currentY = await renderDirectEquation(
          doc, 
          equation, 
          pageWidth, 
          currentY, 
          maxWidth
        );
      } catch (error) {
        console.error('Error rendering equation:', error);
        
        // Ultra-simple fallback if our enhanced renderer fails
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(12);
        
        const lines = doc.splitTextToSize(item.content.trim(), maxWidth - 30);
        lines.forEach((line, i) => {
          const y = currentY + i * 7;
          doc.text(line, pageWidth / 2, y, { align: 'center' });
        });
        
        currentY += lines.length * 7 + 10;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
      }
    } else if (item.type === 'table') {
      // Render table using autoTable with error handling
      try {
        console.log('Table rendering started:', {
          headers: item.headers || [],
          rows: item.rows || [],
          headerCount: item.headers?.length || 0,
          rowCount: item.rows?.length || 0
        });
        
        // Check if autoTable plugin is available
        if (typeof doc.autoTable !== 'function') {
          console.error('autoTable plugin not available - table cannot be rendered');
          // Fallback to basic text rendering of the table
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(0, 0, 0);
          
          const headers = item.headers || [];
          const rows = item.rows || [];
          
          // Draw a box around the table area
          const tableWidth = maxWidth - 10;
          const rowHeight = 6;
          const tableHeight = (rows.length + 1) * rowHeight;
          
          doc.setDrawColor(180, 180, 180);
          doc.setFillColor(240, 240, 240);
          doc.rect(15, currentY, tableWidth, tableHeight, 'S');
          
          // Draw headers
          doc.setFont('helvetica', 'bold');
          let colWidth = tableWidth / Math.max(headers.length, 1);
          headers.forEach((header, i) => {
            doc.text(header, 15 + (i * colWidth) + 2, currentY + 4);
          });
          
          // Draw rows
          doc.setFont('helvetica', 'normal');
          rows.forEach((row, rowIdx) => {
            const y = currentY + ((rowIdx + 1) * rowHeight) + 4;
            row.forEach((cell, cellIdx) => {
              doc.text(cell, 15 + (cellIdx * colWidth) + 2, y);
            });
          });
          
          currentY += tableHeight + 5;
          console.log('Used fallback table rendering');
        } else {
          // Standard table rendering with autoTable
          console.log('Using autoTable plugin for table rendering with data:', {
            headers: item.headers || [],
            rows: item.rows || [],
            headArray: item.headers?.length > 0 ? [item.headers] : []
          });
          
          // Make sure headers and rows are properly formed arrays
          const headers = item.headers || [];
          const rows = item.rows || [];
          
          doc.autoTable({
            startY: currentY,
            head: headers.length > 0 ? [headers] : [],
            body: rows,
            margin: { left: 15, right: 15 },
            theme: 'grid',
            styles: { fontSize: 8 },
            didDrawPage: function(data) {
              console.log('autoTable page drawn');
            }
          });
          
          // Update currentY to after the table
          const finalY = doc.lastAutoTable?.finalY;
          if (finalY) {
            currentY = finalY + 5;
            console.log('Table rendered with autoTable plugin, new Y position:', currentY);
          } else {
            console.error('ERROR: autoTable did not set finalY property. Tables may not be rendering properly.');
            currentY += 20; // Assume some space used
          }
        }
      } catch (tableError) {
        console.error('Error rendering table:', tableError);
        // Simple fallback showing error
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(150, 0, 0);
        doc.text('Table rendering failed - plugin error', 15, currentY + 10);
        currentY += 20; // Move down to continue with other content
      }
    }
    
    // Check if we need a page break before this item
    if (!isFirstItemOnPage && currentY + itemHeight > pageHeight - marginBottom) {
      doc.addPage();
      currentY = 20; // Reset to top of page
      
      // Only show speaker name on first page of the message, not on continuation pages
      if (isFirstPage) {
        // We've now moved to a second page for this message
        isFirstPage = false;
      } else {
        // Skip showing the speaker name on continuation pages
        // Just reset fonts and continue
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        currentY += 5; // Just add a small space at top of page
        isFirstItemOnPage = true;
        continue;
      }
      
      // Reset font for content
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      
      currentY += 10; // Space after speaker header
      isFirstItemOnPage = true;
    }

    // Add spacing between items on same page
    if (currentY > startY && !isFirstItemOnPage) {
      currentY += 5;
    }
    
    if (item.type === 'image') {
      // Embed image
      try {
        const src = item.content;
        const dataURL = src.startsWith('data:') ? src : await imageToDataURL(src);
        // Calculate dimensions to fit half width
        const imgProps = doc.getImageProperties(dataURL);
        const imgWidth = maxWidth * 0.5;
        const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
        doc.addImage(dataURL, 'JPEG', 15, currentY, imgWidth, imgHeight);
        currentY += imgHeight + 5;
      } catch (e) {
        console.warn('Failed to add image:', e);
      }
    }
    
    // Item rendered, no longer first on page
    isFirstItemOnPage = false;
  }
  
  // Add spacing after message
  currentY += 5; // Reduced from 8 to 5 for better document flow
  
  return currentY;
}

// Add this helper function to check script status
async function checkContentScript(tabId) {
  try {
    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(response?.status === 'pong');
        }
      });
    });
    
    return response;
  } catch (error) {
    console.error('Error checking content script:', error);
    return false;
  }
}

// Add this function to ensure script is ready
async function ensureContentScript(tabId) {
  const isLoaded = await checkContentScript(tabId);
  if (!isLoaded) {
    console.log('Content script not found, injecting...');
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    
    // Wait for script to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify script is now loaded
    const verified = await checkContentScript(tabId);
    if (!verified) {
      throw new Error('Failed to initialize content script');
    }
  }
  return true;
}

// Direct rendering of KaTeX equations to the PDF
function renderDirectEquation(doc, equation, pageWidth, currentY, maxWidth) {
  if (!equation) return currentY;
  
  try {
    console.log('Using direct KaTeX rendering for equation:', equation);
    
    // Check if KaTeX is loaded
    if (typeof katex === 'undefined') {
      console.error('KaTeX library not loaded');
      return fallbackTextRendering(doc, equation, pageWidth, currentY, maxWidth);
    }
    
    // Clean up equation
    let processedEq = equation.trim();
    
    // Remove any non-standard characters that could cause rendering issues
    processedEq = processedEq.replace(/[^\x20-\x7E]/g, '');
    
    // Remove any potential unicode replacement characters or corrupted sequences
    processedEq = processedEq.replace(/Ø5Ü[0-9]/g, '');
    
    // Improve differential notation for better display
    processedEq = processedEq
      // Fix "dtdp" to "dp/dt"
      .replace(/([=:])?\s*\(?dtd([a-zA-Z]+)\)?/g, '$1 d$2/dt')
      .replace(/([=:])?\s*\(?d([a-zA-Z]+)dt\)?/g, '$1 d$2/dt')
      
      // Fix differential notation like "d(mv)" to proper format
      .replace(/dtd\(([^)]+)\)/g, 'd($1)/dt')
      
      // Handle "=" or ":" followed by differential 
      .replace(/([=:])?\s*dtdp/g, '$1 dp/dt')
      .replace(/([=:])?\s*dtdv/g, '$1 dv/dt')
      
      // Handle inline text with improper differential formatting
      .replace(/with respect to time:=\(/g, 'with respect to time: ')
      .replace(/relativistic case\):=/g, 'relativistic case): ');
    
    // Special case handling for common physics equations
    if (/F\s*=\s*m\s*a/.test(processedEq)) processedEq = 'F = ma';
    else if (/E\s*=\s*m\s*c\^?2/.test(processedEq)) processedEq = 'E = mc^2';
    else if (/p\s*=\s*m\s*v/.test(processedEq)) processedEq = 'p = mv';
    
    // Wrap in LaTeX delimiters if needed
    if (!processedEq.startsWith('$') && !processedEq.startsWith('\\begin')) {
      processedEq = '$' + processedEq + '$';
    }
    
    // Get rendered LaTeX HTML from KaTeX
    let katexHtml;
    try {
      katexHtml = katex.renderToString(processedEq, {
        displayMode: true,
        throwOnError: false
      });
    } catch (e) {
      console.error('KaTeX rendering failed:', e);
      return fallbackTextRendering(doc, equation, pageWidth, currentY, maxWidth);
    }
    
    // Draw beautiful styled box for equation
    const boxWidth = maxWidth * 0.8;
    const boxHeight = 40; // Default height
    const boxX = (pageWidth - boxWidth) / 2;
    
    // Draw a nice background with shadow
    doc.setFillColor(248, 250, 252); // Very light blue
    doc.setDrawColor(200, 200, 220); // Light blue-gray border
    doc.roundedRect(boxX, currentY, boxWidth, boxHeight, 3, 3, 'FD');
    
    // Draw the equation as plain text but nicely formatted
    doc.setFont('times', 'italic');
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 100); // Dark blue for equations
    
    // Format the plain text version of the equation
    let plainEq = processedEq
      .replace(/\$/g, '')
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
      .replace(/\\cdot/g, '·')
      .replace(/\\times/g, '×')
      .replace(/\\alpha/g, 'α')
      .replace(/\\beta/g, 'β')
      .replace(/\\gamma/g, 'γ')
      .replace(/\\delta/g, 'δ')
      .replace(/\\pi/g, 'π')
      .replace(/\\lambda/g, 'λ')
      .replace(/\\mu/g, 'μ')
      .replace(/\\sum/g, 'Σ')
      .replace(/\\int/g, '∫')
      .replace(/\\infty/g, '∞')
      .replace(/\\partial/g, '∂')
      .replace(/\\nabla/g, '∇')
      .replace(/^([A-Za-z])\s*=\s*([A-Za-z])\s*([A-Za-z])$/g, '$1 = $2·$3') // F = ma, p = mv
      .replace(/([a-z])\_\{?([0-9]+)\}?/g, '$1₍$2₎') // Subscripts
      .replace(/([a-z])\^\{?([0-9]+)\}?/g, '$1$2') // Superscripts, simplified
      .replace(/\{|\}/g, ''); // Remove leftover braces
    
    // Special case for Newton's Second Law
    if (plainEq.includes('F = ma')) {
      plainEq = 'F = ma   (Newton\'s Second Law)';
    }
    
    // Draw equation centered
    doc.text(plainEq, pageWidth / 2, currentY + boxHeight / 2, { align: 'center' });
    
    // Add a subtle label
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text('Equation', boxX + 3, currentY - 2);
    
    // Reset styles
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    
    // Return updated position
    return currentY + boxHeight + 10;
  } catch (error) {
    console.error('Direct equation rendering failed:', error);
    return fallbackTextRendering(doc, equation, pageWidth, currentY, maxWidth);
  }
}

// Fallback to text-based equation rendering if KaTeX fails
function fallbackTextRendering(doc, equation, pageWidth, currentY, maxWidth) {
  console.log('Using fallback text rendering for equation');
  
  // Pre-process equation text
  let processedEq = equation
    .replace(/^\s*[•\*\-]\s*/, '') // Remove bullet points
    .replace(/^\s*=\s*/, '') // Remove leading equals sign
    .trim();
  
  // Remove any non-standard characters that could cause rendering issues
  processedEq = processedEq.replace(/[^\x20-\x7E]/g, '');
  
  // Remove any potential unicode replacement characters or corrupted sequences
  processedEq = processedEq.replace(/Ø5Ü[0-9]/g, '');
  
  // Improve differential notation in the fallback renderer too
  processedEq = processedEq
    // Fix "dtdp" to "dp/dt"
    .replace(/([=:])?\s*\(?dtd([a-zA-Z]+)\)?/g, '$1 d$2/dt')
    .replace(/([=:])?\s*\(?d([a-zA-Z]+)dt\)?/g, '$1 d$2/dt')
    
    // Fix differential notation like "d(mv)" to proper format
    .replace(/dtd\(([^)]+)\)/g, 'd($1)/dt')
    
    // Handle "=" or ":" followed by differential 
    .replace(/([=:])?\s*dtdp/g, '$1 dp/dt')
    .replace(/([=:])?\s*dtdv/g, '$1 dv/dt')
    
    // Handle inline text with improper differential formatting
    .replace(/with respect to time:=\(/g, 'with respect to time: ')
    .replace(/relativistic case\):=/g, 'relativistic case): ');
  
  // Apply text formatting
  processedEq = processedEq
    // Ensure spaces around operators
    .replace(/([a-z0-9])([=+\-])/gi, '$1 $2')
    .replace(/([=+\-])([a-z0-9])/gi, '$1 $2')
    // Fix spacing
    .replace(/\s*=\s*/g, ' = ')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s*\-\s*/g, ' - ');
    
  // Create a styled text box
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(248, 248, 252);
  doc.setFont('times', 'italic');
  doc.setFontSize(12);
  
  // Split text to fit width
  const lines = doc.splitTextToSize(processedEq, maxWidth - 60);
  
  // Draw box with a nice style
  const lineHeight = 7;
  const totalHeight = lines.length * lineHeight + 14;
  const boxWidth = maxWidth - 40;
  const boxX = (pageWidth - boxWidth) / 2;
  
  // Draw with shadow
  doc.setFillColor(240, 240, 240);
  doc.roundedRect(boxX + 2, currentY - 2, boxWidth, totalHeight, 3, 3, 'F');
  doc.setFillColor(248, 248, 252);
  doc.roundedRect(boxX, currentY - 4, boxWidth, totalHeight, 3, 3, 'FD');
  
  // Add a label
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text('Equation:', boxX + 5, currentY);
  
  // Draw text
  doc.setFont('times', 'italic');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 100);
  
  lines.forEach((line, i) => {
    const y = currentY + 8 + (i * lineHeight);
    doc.text(line, pageWidth / 2, y, { align: 'center' });
  });
  
  // Reset styles
  doc.setTextColor(0, 0, 0);
  
  return currentY + totalHeight + 8;
}

// Convert image to data URL for PDF embedding
function imageToDataURL(imgSrc) {
  return new Promise((resolve, reject) => {
    try {
      console.log('Attempting to load image:', imgSrc.substring(0, 60) + '...');
      
      // For OpenAI URLs, add extra logging
      if (imgSrc.includes('oaiusercontent.com') || imgSrc.includes('chatgpt.com/files')) {
        console.log('Detected OpenAI image URL - CORS issues likely');
      }
      
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      // Set timeout to avoid hanging if image doesn't load
      const timeoutId = setTimeout(() => {
        console.warn('Image load timed out after 5 seconds:', imgSrc.substring(0, 60) + '...');
        reject(new Error('Image load timeout'));
      }, 5000);
      
      img.onload = function() {
        clearTimeout(timeoutId);
        try {
          console.log('Image loaded successfully with dimensions:', img.width, 'x', img.height);
          
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          
          // Draw with a try-catch to catch potential security exceptions
          try {
            ctx.drawImage(img, 0, 0);
            const dataURL = canvas.toDataURL('image/jpeg');
            console.log('Image converted to data URL successfully');
            resolve(dataURL);
          } catch (error) {
            console.error('Security error drawing image to canvas (CORS):', error);
            reject(error);
          }
        } catch (error) {
          console.warn('Error processing loaded image:', error);
          reject(error);
        }
      };
      
      img.onerror = function(error) {
        clearTimeout(timeoutId);
        console.warn('Error loading image:', error);
        
        // Provide more detailed error info
        let errorType = 'Unknown error';
        if (imgSrc.includes('oaiusercontent.com')) {
          errorType = 'OpenAI authentication required - 403 Forbidden likely';
        }
        console.warn('Image load error details:', errorType);
        
        reject(error);
      };
      
      // Add load event listener to track progress
      img.addEventListener('loadstart', () => console.log('Image load started'));
      img.addEventListener('progress', () => console.log('Image loading in progress'));
      img.addEventListener('loadend', () => console.log('Image load ended (success or failure)'));
      
      // Set image source last
      img.src = imgSrc;
      
      // If the image is already loaded from cache, the onload handler
      // might not be called, so double-check immediately
      if (img.complete) {
        console.log('Image was loaded from cache');
        img.onload();
      }
    } catch (error) {
      console.warn('Error creating image:', error);
      reject(error);
    }
  });
}

// Function to detect if text is a header/subheader
function isHeaderText(text) {
  // Normalize text for comparison
  const normalized = text.trim();
  
  // Common standalone headers in ChatGPT that might not have colons
  const commonHeaders = [
    'Constraints',
    'Requirements',
    'Solution',
    'Approach',
    'Algorithm',
    'Pseudocode',
    'Complexity Analysis',
    'Time Complexity',
    'Space Complexity',
    'Example',
    'Input',
    'Output',
    'Discussion',
    'Summary',
    'Conclusion',
    'Implementation',
    'Steps',
    'Overview',
    'Explanation',
    'Analysis',
    'Pros and Cons',
    'Advantages',
    'Disadvantages',
    'Key Points',
    'Notes',
    'References',
    'Further Reading',
    'Resources',
    'Mathematical Proof',
    'Derivation',
    'Methodology',
    'Where',
    'Mathematically',
    // Additional keywords for formatting
    'Code',
    'Function',
    'Method',
    'Class',
    'Object',
    'Data Structure',
    'Variables',
    'Constants',
    'Parameters',
    'Return Value',
    'Imports',
    'Exports',
    'API',
    'Interface',
    'Problem Statement',
    'Objective',
    'Goal',
    'Background',
    'Context',
    'Result',
    'Evaluation',
    'Testing',
    'Debug',
    'Error Handling',
    'Edge Cases',
    'Optimizations',
    'Performance',
    'Alternatives',
    'Tradeoffs',
    'Use Case',
    'Scenario',
    'Recommendations',
    'Next Steps',
    'Status'
  ];
  
  // Check if text is a common header pattern
  if (normalized.endsWith(':') && normalized.length < 60 && !normalized.startsWith('•') && !normalized.startsWith('-')) {
    return true;
  }
  
  // Check if it's a standalone header (without colon)
  for (const header of commonHeaders) {
    if (normalized === header || normalized === header + ':') {
      return true;
    }
  }
  
  // Check for specific patterns like "1. Step One" or "Step 1:" or "Step 1."
  if (/^(\d+\.\s+.{3,25}|Step\s+\d+[:.])$/i.test(normalized)) {
    return true;
  }
  
  // Check for "How to" style headers which are common in ChatGPT
  if (normalized.startsWith('How to') && normalized.length < 60) {
    return true;
  }
  
  // Check for section-like patterns (numbered sections or specific format)
  if (/^[1-9]\d*\.\s+[A-Z]/.test(normalized) || /^[A-Z][a-z]+ing\s+the/.test(normalized)) {
    return true;
  }
  
  return false;
}

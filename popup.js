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
      
      if (!data || !Array.isArray(data.messages)) {
        console.error('===== PDF GENERATION ERROR =====');
        showStatus("Error: Invalid conversation data");
        return;
      }
      
      // Pre-process messages: dedupe and format
      const messages = processMessagesForPDF(data.messages);
      console.log(`Preparing to render ${messages.length} messages`);
      
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
      
      // Draw title and date
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(title, margin, margin);
      
      // Add date
      const date = new Date().toLocaleDateString();
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.text(date, margin, margin + 8);
      
      // Start position for messages
      let yPosition = margin + 20;
      
      // Render each message
      console.log(`Rendering ${messages.length} messages`);
      
      for (let i = 0; i < messages.length; i++) {
        console.log(`-- Rendering message #${i+1}: speaker=${messages[i].speaker}, items=${messages[i].items.length}`);
        // Break page if we exceed bottom margin
        if (yPosition > pageHeight - bottomMargin) {
          doc.addPage();
          yPosition = margin;
        }
        
        // Render the message
        yPosition = await renderMessage(doc, messages[i], yPosition, pageWidth - 2 * margin);
        
        console.log(`Rendered message ${i+1}/${messages.length}, new Y: ${yPosition}`);
      }
      
      // Generate the final PDF
      console.log('Generating final PDF file...');
      
      const pdfBlob = doc.output('blob');
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
    
    console.log("Processing raw messages:", JSON.stringify(messages.slice(0, 2))); // Log first 2 messages
    
    return messages.map(message => {
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
          .replace(/^Newton['']s\s+/, '')         // Normalize "Newton's"
          .replace(/:\s*$/, '')                   // Remove trailing colons
          .toLowerCase();                         // Case insensitive comparison
      }
      
      // Helper function to normalize equations
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
      
      // Enhanced deduplication
      const processedItems = [];
      const seenTextNormalized = new Set();       // For normalized text comparison
      const seenEquationNormalized = new Set();   // For normalized equation comparison
      const seenCode = new Set();

      // First pass: Identify all unique items
      message.items.forEach(item => {
        if (item.type === 'text') {
          const txt = item.content.trim();
          if (!txt) return;
          
          // Skip specific UI labels
          if (/^You said:?$/i.test(txt) || /^ChatGPT said:?$/i.test(txt)) return;
          
          // Skip duplicate text with normalized comparison
          const normalizedTxt = normalizeContent(txt);
          if (normalizedTxt && !seenTextNormalized.has(normalizedTxt)) {
            seenTextNormalized.add(normalizedTxt);
            processedItems.push(item);
          } else {
            console.log('Skipping duplicate text:', txt);
          }
        } 
        else if (item.type === 'equation') {
          const eq = item.content.trim();
          if (!eq) return;
          
          // Skip duplicate equations with normalized comparison
          const normalizedEq = normalizeEquation(eq);
          if (normalizedEq && !seenEquationNormalized.has(normalizedEq)) {
            seenEquationNormalized.add(normalizedEq);
            processedItems.push(item);
          } else {
            console.log('Skipping duplicate equation:', eq);
          }
        }
        else if (item.type === 'code') {
          const code = item.content.trim();
          if (!code || seenCode.has(code)) return;
          seenCode.add(code);
          processedItems.push(item);
        }
        else {
          // Keep other item types (images, tables)
          processedItems.push(item);
        }
      });
      
      // Second pass: Check for text that contains the same content as equations
      // Remove text items that are duplicating equations
      const finalItems = processedItems.filter(item => {
        if (item.type !== 'text') return true;
        
        // Check if this text item appears to be an equation that we've already included
        const normalized = normalizeEquation(item.content);
        if (normalized && seenEquationNormalized.has(normalized) && 
            (/=/.test(item.content) || /differentiate both sides/i.test(item.content) || 
             /assuming mass/i.test(item.content) || /since.*dv\/dt/i.test(item.content))) {
          console.log('Removing text that duplicates equation:', item.content);
          return false;
        }
        
        return true;
      });
      
      // Make sure we maintain visual ordering by sorting by y-coordinate
      if (finalItems.some(item => item.y !== undefined)) {
        finalItems.sort((a, b) => {
          const yA = a.y !== undefined ? a.y : Number.MAX_SAFE_INTEGER;
          const yB = b.y !== undefined ? b.y : Number.MAX_SAFE_INTEGER;
          return yA - yB;
        });
        
        console.log(`Sorted ${finalItems.length} items by visual position for PDF`);
      }
      
      return { ...message, items: finalItems };
    });
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

// Add a test button event
document.addEventListener('DOMContentLoaded', function() {
  // Add test button
  const testButton = document.createElement('button');
  testButton.textContent = 'Test PDF';
  testButton.style.backgroundColor = '#ff9800';
  testButton.style.marginTop = '10px';
  
  // Insert after generate button
  const generateButton = document.getElementById('generatePdf');
  if (generateButton && generateButton.parentNode) {
    generateButton.parentNode.insertBefore(testButton, generateButton.nextSibling);
  }
  
  // Add click handler
  testButton.addEventListener('click', testPDF);
});

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
  
  // Map 'Assistant' label to 'ChatGPT'
  const speakerText = message.speaker === 'Assistant' ? 'ChatGPT' : message.speaker;
  
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
  
  // Sort message items by sequence if present
  if (message.items && message.items.some(item => item.sequence !== undefined)) {
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
      // Estimate text height - most jsPDF versions don't support direct dimension measurement
      const textLines = doc.splitTextToSize(item.content, maxWidth - 20);
      const isBullet = item.content.trim().startsWith('•');
      const lineSpacing = isBullet ? 3 : 5;
      const extra = isBullet ? 2 : 3;
      itemHeight = textLines.length * lineSpacing + extra + 5; // +5 for item spacing
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
      
      // Draw background
      doc.setFillColor(245, 245, 245);
      doc.rect(20, currentY, blockWidth, blockHeight, 'F');
      
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
        console.log('Processing image in renderMessage:', src);
        
        // Create a new image element
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Try to avoid CORS issues
        
        // Set onload handler
        await new Promise((resolve, reject) => {
          img.onload = function() {
            try {
              console.log('Image loaded with dimensions:', img.width, 'x', img.height);
              
              // Create a canvas to draw the image
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              
              // Draw the image to canvas
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              
              // Get data URL
              const dataURL = canvas.toDataURL('image/jpeg', 0.95);
              
              // Calculate dimensions to fit the page width - REDUCE SIZE
              const maxImgWidth = maxWidth * 0.5; // Reduced from 0.8 to 0.5 (50% of page width)
              
              // Also enforce a maximum height for very tall images
              const maxImgHeight = pageHeight * 0.4; // Maximum 40% of page height
              
              // Calculate width based on width constraint
              const imgWidth = Math.min(img.width, maxImgWidth);
              let imgHeight = (img.height * imgWidth) / img.width;
              
              // If height exceeds maximum, recalculate dimensions
              if (imgHeight > maxImgHeight) {
                imgHeight = maxImgHeight;
                // Recalculate width to maintain aspect ratio
                const recalcWidth = (img.width * imgHeight) / img.height;
                // Use the smaller of the recalculated width or the maxImgWidth
                const finalWidth = Math.min(recalcWidth, maxImgWidth);
                
                // Apply the final dimensions
                doc.addImage(dataURL, 'JPEG', 20, currentY, finalWidth, imgHeight);
              } else {
                // Use the originally calculated dimensions
                doc.addImage(dataURL, 'JPEG', 20, currentY, imgWidth, imgHeight);
              }
              
              // Add 10pt padding after the image
              currentY += imgHeight + 10;
              resolve();
            } catch (e) {
              console.error('Error processing image for PDF:', e);
              currentY += 5; // Skip ahead anyway
              resolve();
            }
          };
          
          img.onerror = function(e) {
            console.error('Failed to load image:', e);
            currentY += 5; // Skip ahead anyway
            resolve();
          };
          
          // Start loading the image
          img.src = src;
        });
      } catch (e) {
        console.warn('Failed to add image:', e);
        currentY += 5;
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
    
    if (item.type === 'text') {
      // Handle regular text and bullet lists with proper line breaks
      const textLines = doc.splitTextToSize(item.content, maxWidth - 20);
      doc.text(textLines, 15, currentY);
      // Tighten bullet list spacing
      const isBullet = item.content.trim().startsWith('•');
      const lineSpacing = isBullet ? 3 : 5;
      const extra = isBullet ? 2 : 3;
      currentY += textLines.length * lineSpacing + extra;
    } else if (item.type === 'image') {
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
    } else if (item.type === 'table') {
      // Render table using autoTable
      doc.autoTable({
        startY: currentY,
        head: [item.headers || []],
        body: item.rows || [],
        margin: { left: 15, right: 15 },
        theme: 'grid',
        styles: { fontSize: 8 }
      });
      currentY = doc.lastAutoTable.finalY + 5;
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

// Add a document ready listener for the test equation button
document.addEventListener('DOMContentLoaded', function() {
  // Add test equation button if in development mode
  const testEquationBtn = document.createElement('button');
  testEquationBtn.textContent = 'Test Equation';
  testEquationBtn.style.backgroundColor = '#9c27b0';
  testEquationBtn.style.marginTop = '5px';
  
  // Insert after debug button
  const debugButton = document.getElementById('debugConnection');
  if (debugButton && debugButton.parentNode) {
    debugButton.parentNode.insertBefore(testEquationBtn, debugButton.nextSibling);
  }
  
  // Add Re-Extract button
  const reExtractBtn = document.createElement('button');
  reExtractBtn.textContent = 'Re-Extract Content';
  reExtractBtn.style.backgroundColor = '#ff5722';
  reExtractBtn.style.marginTop = '5px';
  
  // Insert after test equation button
  if (testEquationBtn.parentNode) {
    testEquationBtn.parentNode.insertBefore(reExtractBtn, testEquationBtn.nextSibling);
  }
  
  // Add click handlers
  testEquationBtn.addEventListener('click', testKatexRendering);
  reExtractBtn.addEventListener('click', forceReExtractContent);
});

// Add a function to test KaTeX rendering directly
function testKatexRendering() {
  console.log('Testing KaTeX rendering...');
  
  // Create container for rendering
  const container = document.getElementById('katex-container');
  if (!container) {
    console.error('KaTeX container not found');
    showStatus('Error: KaTeX container not found');
    return;
  }
  
  // Make container visible for this test
  container.style.visibility = 'visible';
  container.style.position = 'absolute';
  container.style.top = '50px';
  container.style.left = '10px';
  container.style.width = '300px';
  container.style.height = 'auto';
  container.style.backgroundColor = '#fff';
  container.style.padding = '10px';
  container.style.border = '1px solid #ccc';
  container.style.zIndex = '1000';
  container.style.overflow = 'visible';
  
  // Clear previous content
  container.innerHTML = '';
  
  const testEquations = [
    'E = mc^2',
    'F = ma',
    'p = mv',
    '\\frac{d}{dx}x^2 = 2x',
    '\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}'
  ];
  
  // Check if KaTeX is loaded
  if (typeof katex === 'undefined') {
    container.innerHTML = '<div style="color: red;">Error: KaTeX not loaded!</div>';
    console.error('KaTeX not loaded');
    showStatus('KaTeX library not loaded. Check console for details.');
    return;
  }
  
  // Try to render each equation
  testEquations.forEach((eq, i) => {
    try {
      const eqDiv = document.createElement('div');
      eqDiv.style.margin = '10px 0';
      eqDiv.style.padding = '5px';
      eqDiv.style.backgroundColor = '#f8f8f8';
      
      const inputDiv = document.createElement('div');
      inputDiv.textContent = eq;
      inputDiv.style.fontFamily = 'monospace';
      inputDiv.style.marginBottom = '5px';
      inputDiv.style.fontSize = '12px';
      eqDiv.appendChild(inputDiv);
      
      const outputDiv = document.createElement('div');
      katex.render(eq, outputDiv, {
        throwOnError: false,
        displayMode: true
      });
      eqDiv.appendChild(outputDiv);
      
      container.appendChild(eqDiv);
      console.log(`Rendered equation ${i+1}: ${eq}`);
    } catch (e) {
      console.error(`Failed to render equation ${i+1}:`, e);
      const errorDiv = document.createElement('div');
      errorDiv.style.color = 'red';
      errorDiv.textContent = `Error rendering ${eq}: ${e.message}`;
      container.appendChild(errorDiv);
    }
  });
  
  // Add a close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.marginTop = '10px';
  container.appendChild(closeBtn);
  
  closeBtn.addEventListener('click', () => {
    container.style.visibility = 'hidden';
    showStatus('KaTeX rendering test completed. Check console for details.');
  });
  
  // Also try the SVG approach
  const testSVG = document.createElement('div');
  testSVG.innerHTML = '<h4>SVG Test</h4>';
  container.appendChild(testSVG);
  
  try {
    const svgData = `
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="50">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml">
            ${katex.renderToString('F = ma', {throwOnError: false})}
          </div>
        </foreignObject>
      </svg>
    `;
    
    const img = document.createElement('img');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
    img.style.border = '1px solid #ddd';
    testSVG.appendChild(img);
    
    console.log('SVG image created');
  } catch (e) {
    console.error('SVG test failed:', e);
    testSVG.innerHTML += `<div style="color: red;">SVG Error: ${e.message}</div>`;
  }
}

// Add a function to force re-extraction of content
async function forceReExtractContent() {
  try {
    showStatus("Re-extracting content...");
    console.log("Force re-extracting content from page");
    
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab) {
      showStatus("Error: No active tab found");
      return;
    }
    
    // Clear previous content
    await chrome.storage.local.remove(['chatContent']);
    
    // Ensure content script is loaded and fresh
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    
    console.log('Content script re-injected');
    
    // Add delay to ensure script initialization
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send extraction message with force flag
    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'FROM_EXTENSION',
        action: 'extractContentDirect',
        force: true
      }, response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
    
    console.log('Forced extraction response:', response);
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Extraction failed');
    }
    
    // Get data from storage
    const result = await chrome.storage.local.get(['chatContent']);
    console.log('Re-extracted content:', result);
    
    if (!result.chatContent || !result.chatContent.messages || result.chatContent.messages.length === 0) {
      throw new Error('No conversation content found after re-extraction');
    }
    
    showStatus(`Re-extraction successful: found ${result.chatContent.messages.length} messages`);
    
    // Add additional info about item types
    const itemTypes = {};
    let totalEquations = 0;
    
    result.chatContent.messages.forEach(msg => {
      if (msg.items) {
        msg.items.forEach(item => {
          itemTypes[item.type] = (itemTypes[item.type] || 0) + 1;
          if (item.type === 'equation') {
            totalEquations++;
          }
        });
      }
    });
    
    const typesInfo = Object.entries(itemTypes)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    
    console.log(`Item types: ${typesInfo}`);
    if (totalEquations > 0) {
      console.log(`Found ${totalEquations} equations!`);
      showStatus(`Re-extraction successful: found ${totalEquations} equations in ${result.chatContent.messages.length} messages`);
    }
    
  } catch (error) {
    console.error('Re-extraction error:', error);
    showStatus("Error during re-extraction: " + error.message);
  }
} 
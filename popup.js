/**
 * ChatGPT to PDF Converter - Popup Script
 * Handles PDF generation using data from the content script
 * 
 * Privacy: All processing is local using jsPDF and localStorage; no data is sent to servers.
 */

let jsPDF;

// Initialize jsPDF when the document loads
document.addEventListener('DOMContentLoaded', function() {
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
    
    return messages.map(message => {
      if (!message.items || !Array.isArray(message.items)) return message;
      
      // Filter and process items
      const processedItems = [];
      const seenText = new Set();
      const seenEquations = new Set();
      const seenCode = new Set();
      
      message.items.forEach(item => {
        if (item.type === 'text') {
          // Skip empty, duplicate, or UI labels ('You said:', 'ChatGPT said:')
          const txt = item.content.trim();
          if (!txt || seenText.has(txt)) return;
          if (/^You said:?$/i.test(txt) || /^ChatGPT said:?$/i.test(txt)) return;
          seenText.add(txt);
          processedItems.push(item);
        } 
        else if (item.type === 'equation') {
          // Format and deduplicate equations
          const eq = item.content;
          if (!eq || seenEquations.has(eq)) return;
          seenEquations.add(eq);
          processedItems.push(item);
        }
        else if (item.type === 'code') {
          // Preserve code blocks exactly
          const code = item.content.trim();
          if (!code || seenCode.has(code)) return;
          seenCode.add(code);
          processedItems.push(item);
        }
        else {
          // Keep other item types
          processedItems.push(item);
        }
      });
      
      return { ...message, items: processedItems };
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
});

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
  
  // Get page height for page break detection
  const pageHeight = doc.internal.pageSize.height;
  const marginBottom = 20; // Bottom margin to avoid cutting content
  
  // Draw speaker with timestamp
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
      // Rough estimate for images
      itemHeight = (maxWidth * 0.5 * 0.75) + 5; // Assuming width:height ratio of 4:3 and 50% width
    } else if (item.type === 'table') {
      // Tables are harder to estimate - just use a minimum height
      itemHeight = 50;
    } else if (item.type === 'equation') {
      const eqText = `Equation: ${item.content}`;
      const lines = doc.splitTextToSize(eqText, maxWidth - 20);
      itemHeight = lines.length * 7 + 15; // 7pt per line, 15 for spacing
    }
    
    // Check if we need a page break before this item
    if (!isFirstItemOnPage && currentY + itemHeight > pageHeight - marginBottom) {
      doc.addPage();
      currentY = 20; // Reset to top of page
      
      // Repeat the speaker on the new page for context
      doc.setTextColor(...textColor);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`${speakerText} (continued)`, 10, currentY);
      
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
    } else if (item.type === 'equation') {
      // Render equation as centered, italicized text with prefix 'Equation:'
      const eqText = `Equation: ${item.content}`;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(12);
      // Split to fit page width
      const lines = doc.splitTextToSize(eqText, maxWidth - 20);
      const pageWidth = doc.internal.pageSize.width;
      lines.forEach((line, i) => {
        const y = currentY + i * 7;
        doc.text(line, pageWidth / 2, y, { align: 'center' });
      });
      currentY += lines.length * 7 + 10; // extra spacing after equation
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
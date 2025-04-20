// Initialize jsPDF with Unicode support
const { jsPDF } = window.jspdf;

// Add a function to create PDFs with better Unicode support
function createPDFWithUnicodeSupport() {
  const doc = new jsPDF();
  
  // Attempt to use a font with better Unicode support if available
  try {
    doc.setFont('Helvetica');
  } catch (e) {
    console.warn('Failed to set Unicode font', e);
  }
  
  return doc;
}

// Enhance console logging
function debugLog(message, data = null) {
  const timestamp = new Date().toLocaleTimeString();
  if (data) {
    console.log(`[Popup ${timestamp}] ${message}`, data);
  } else {
    console.log(`[Popup ${timestamp}] ${message}`);
  }
}

// Log errors more thoroughly
window.addEventListener('error', function(event) {
  console.error('Unhandled error:', event.error);
});

// Log Chrome API errors
function logChromeError() {
  if (chrome.runtime.lastError) {
    console.error('Chrome API error:', chrome.runtime.lastError);
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const generateButton = document.getElementById('generatePdf');
  const exportCounter = document.getElementById('exportCounter');
  const errorMessage = document.getElementById('errorMessage');
  
  // Initialize and check export count
  checkExportCount();
  
  // Add initial debug info to console only
  debugLog('Popup initialized');
  chrome.runtime.sendMessage({action: 'debugStatus'}, function(response) {
    if (!chrome.runtime.lastError) {
      debugLog(`Loaded tabs: ${JSON.stringify(response?.loadedTabs || [])}`);
    }
  });

  // Add click event listener to the generate button
  generateButton.addEventListener('click', generatePDF);

  // Add this in your DOMContentLoaded handler
  document.getElementById('testImages').addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || !tabs.length) {
        console.error("No active tab found");
        return;
      }
      
      // Run a direct image test script
      chrome.scripting.executeScript({
        target: {tabId: tabs[0].id},
        function: function() {
          console.log("DIRECT IMAGE TEST FROM POPUP");
          
          // Count all images
          const allImages = document.querySelectorAll('img');
          console.log(`Found ${allImages.length} images in total`);
          
          // Log the first 10 images
          for (let i = 0; i < Math.min(10, allImages.length); i++) {
            const img = allImages[i];
            console.log(`Image ${i}: ${img.width}x${img.height}, src=${img.src?.substring(0, 50) || 'none'}`);
            
            // Test if we can extract a dataURL
            if (img.width > 50 && img.height > 50) {
              try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                try {
                  const dataURL = canvas.toDataURL('image/jpeg');
                  console.log(`Image ${i}: Successfully converted to data URL`);
                } catch (e) {
                  console.error(`Image ${i}: Canvas error:`, e);
                }
              } catch (e) {
                console.error(`Image ${i}: General error:`, e);
              }
            }
          }
          
          return {status: "complete", imageCount: allImages.length};
        }
      }, (results) => {
        console.log("Direct image test results:", results);
      });
    });
  });

  /**
   * Check and display the export count - simplified without the 5/day limit
   */
  function checkExportCount() {
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      chrome.storage.local.get(['exportCount', 'exportDate'], function(result) {
        let { exportCount = 0, exportDate = '' } = result;
        
        // Reset count if it's a new day (still track for statistics, but don't limit)
        if (exportDate !== today) {
          chrome.storage.local.set({ exportCount: 0, exportDate: today });
          exportCount = 0;
        }
        
        // Update counter text but don't add the limit
        exportCounter.textContent = `${exportCount} exports today`;
        exportCounter.style.display = 'block';
        
        // Always enable the button - no limit restriction
        generateButton.disabled = false;
      });
    } catch (error) {
      console.error("Error checking export count:", error);
      // Default to enabled
      generateButton.disabled = false;
    }
  }
  
  /**
   * Increment the export count - simplified without the 5/day limit
   */
  function incrementExportCount() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    chrome.storage.local.get(['exportCount', 'exportDate'], function(result) {
      let { exportCount = 0, exportDate = '' } = result;
      
      // Reset if it's a new day
      if (exportDate !== today) {
        exportCount = 0;
        exportDate = today;
      }
      
      // Increment count (still track for statistics)
      exportCount++;
      
      // Update storage
      chrome.storage.local.set({ 
        exportCount, 
        exportDate 
      }, function() {
        // Update UI without limit
        exportCounter.textContent = `${exportCount} exports today`;
        
        // Always keep button enabled
        generateButton.disabled = false;
      });
    });
  }
  
  /**
   * Generate PDF with simplified approach
   */
  function generatePDF() {
    console.log('Generate PDF button clicked');
    
    try {
      // Get the active tab
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || !tabs.length) {
          showStatus("Error: No active tab found");
          return;
        }
        
        const activeTab = tabs[0];
        
        // Check if we're on a ChatGPT page - accept both domains
        if (!activeTab.url.includes('chat.openai.com') && !activeTab.url.includes('chatgpt.com')) {
          showStatus("This extension only works on ChatGPT pages");
          return;
        }
        
        // Show the user that we're working
        showStatus("Generating PDF...");
        
        // Execute the extraction script
        chrome.scripting.executeScript({
          target: {tabId: activeTab.id},
          function: extractChatGPTContent
        }).then(results => {
          if (!results || !results[0]) {
            showStatus("Error: No data received from ChatGPT page");
            return;
          }
          
          const conversation = results[0].result;
          
          // Check if we have valid messages
          if (!conversation.messages || conversation.messages.length === 0) {
            showStatus("Error: No conversation content found. Try scrolling through your chat first.");
            return;
          }
          
          // Generate the PDF
          createPDF(conversation);
        }).catch(error => {
          console.error("Error executing script:", error);
          showStatus("Error: " + error.message);
        });
      });
    } catch (error) {
      console.error("Error generating PDF:", error);
      showStatus("Error: " + error.message);
    }
  }
  
  /**
   * Create a PDF with improved equation formatting and table support
   */
  function createPDF(data) {
    try {
      console.log("Creating PDF with equation and table support...");
      
      // Create PDF document
      const doc = new jsPDF();
      
      // Page setup
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      
      // Add title
      doc.setFontSize(16);
      doc.setFont('Helvetica', 'bold');
      doc.text(data.title || 'ChatGPT Conversation', margin, 20);
      
      // Reset to normal styling
      doc.setFontSize(11);
      doc.setFont('Helvetica', 'normal');
      
      // Current position
      let y = 40;
      
      // Process each message in the conversation
      if (Array.isArray(data.messages)) {
        data.messages.forEach((message) => {
          if (!message) return;
          
          // Add speaker header
          doc.setFont('Helvetica', 'bold');
          doc.text(`${message.speaker || 'Speaker'}:`, margin, y);
          doc.setFont('Helvetica', 'normal');
          y += 10;
          
          // Process all items in proper sequence
          if (Array.isArray(message.items)) {
            // Create a set to track processed content to avoid duplication
            const processedContent = new Set();
            
            message.items.forEach(item => {
              if (!item) return;
              
              // Skip duplicate items
              if (item.type === 'text' || item.type === 'equation') {
                const contentKey = `${item.type}:${item.content?.substring(0, 50)}`;
                if (processedContent.has(contentKey)) return;
                processedContent.add(contentKey);
              }
              
              // Check if we need a new page
              if (y > pageHeight - 40) {
                doc.addPage();
                y = 20;
              }
              
              // Process different item types
              if (item.type === 'text') {
                const text = item.content?.trim();
                if (!text) return;
                
                // Check for derivation header
                if (text.includes("Step-by-step Derivation")) {
                  doc.setFont('Helvetica', 'bold');
                  doc.text("Step-by-step Derivation:", margin, y);
                  doc.setFont('Helvetica', 'normal');
                  y += 10;
                }
                // Check for numbered step
                else if (/^\d+\.\s/.test(text)) {
                  // Extract number and content
                  const match = text.match(/^(\d+)\.\s+(.*)/);
                  if (match) {
                    const stepNumber = match[1];
                    const stepContent = match[2];
                    
                    // Add step number in bold
                    doc.setFont('Helvetica', 'bold');
                    doc.text(`${stepNumber}.`, margin, y);
                    doc.setFont('Helvetica', 'normal');
                    
                    // Add step content with wrapping
                    const contentLines = doc.splitTextToSize(stepContent, contentWidth - 15);
                    doc.text(contentLines, margin + 15, y);
                    
                    // Move position
                    y += contentLines.length * 7 + 5;
                  }
                } 
                else {
                  // Regular text with wrapping
                  const textLines = doc.splitTextToSize(text, contentWidth);
                  doc.text(textLines, margin, y);
                  
                  // Move position
                  y += textLines.length * 7 + 3;
                }
              }
              // Process equation
              else if (item.type === 'equation') {
                const equation = item.content?.trim();
                
                // Skip if empty
                if (!equation) return;
                
                // Format equation
                const formattedEquation = formatEquation(equation);
                
                // Add spacing
                y += 5;
                
                // Use monospaced font for equations
                doc.setFont('Courier', 'normal');
                
                // Center the equation
                const eqLines = doc.splitTextToSize(formattedEquation, contentWidth - 40);
                eqLines.forEach(line => {
                  if (line.trim()) {
                    doc.text(line, pageWidth / 2, y, { align: 'center' });
                    y += 7;
                  }
                });
                
                // Reset font and add space after
                doc.setFont('Helvetica', 'normal');
                y += 5;
              }
              // Process table
              else if (item.type === 'table' && item.content) {
                const tableData = item.content;
                
                // Add spacing before table
                y += 5;
                
                // Prepare table for autoTable plugin
                try {
                  // Create header and row data
                  const headers = tableData.headers.length > 0 ? 
                    tableData.headers : 
                    Array(tableData.rows[0]?.length || 0).fill('').map((_, i) => `Column ${i+1}`);
                  
                  const rows = tableData.rows;
                  
                  // Add the table with autoTable
                  doc.autoTable({
                    startY: y,
                    head: [headers],
                    body: rows,
                    margin: { left: margin, right: margin },
                    headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0] },
                    alternateRowStyles: { fillColor: [248, 248, 248] },
                    tableWidth: contentWidth
                  });
                  
                  // Update position based on the final position of the table
                  y = doc.lastAutoTable.finalY + 10;
                  
                } catch (tableError) {
                  console.error("Error creating table:", tableError);
                  
                  // Fallback to simple text if autoTable fails
                  doc.text("Table data (fallback format):", margin, y);
                  y += 7;
                  
                  // Add headers if any
                  if (tableData.headers && tableData.headers.length) {
                    doc.text("Headers: " + tableData.headers.join(", "), margin, y);
                    y += 7;
                  }
                  
                  // Add rows as text
                  if (tableData.rows && tableData.rows.length) {
                    tableData.rows.forEach((row, i) => {
                      doc.text(`Row ${i+1}: ${row.join(", ")}`, margin, y);
                      y += 7;
                    });
                  }
                  
                  y += 5;
                }
              }
            });
          }
          
          // Add spacing between messages
          y += 15;
        });
      }
      
      // Save the PDF
      const filename = `ChatGPT_Conversation.pdf`;
      doc.save(filename);
      
      // Show success
      showSuccess("PDF generated successfully!");
      incrementExportCount();
      
    } catch (error) {
      console.error("Error creating PDF:", error);
      showStatus("Error creating PDF: " + error.message);
    }
  }

  // Helper function to clean up emoji text
  function cleanEmojiText(text) {
    // Replace common emoji placeholders
    return text
      .replace(/Ø=ÝÓþ/g, '📆 ')
      .replace(/Ø<ßËþ &Bþ/g, '💪 ')
      .replace(/\[Emoji\]/g, '')
      .replace(/(\d+)–(\d+)%/g, '$1-$2%')  // Fix percentage ranges
      .replace(/(\d+)–(\d+)/g, '$1-$2');   // Fix number ranges
  }

  // Helper function to extract tables from text
  function extractTablesFromText(text) {
    const result = {
      textBeforeTables: '',
      tables: [],
      textAfterTables: ''
    };
    
    // Split by empty line to find potential table sections
    const sections = text.split(/\n\s*\n/);
    let foundTable = false;
    let currentSection = '';
    
    for (const section of sections) {
      // Check if this section looks like a table
      if (
        (section.includes('|') && section.includes('\n')) || 
        (section.includes('Time') && section.includes('Activity') && section.includes('Notes')) ||
        (section.includes('Day') && section.includes('Focus'))
      ) {
        foundTable = true;
        
        // Handle different table formats
        let headers = [];
        let rows = [];
        let title = '';
        
        // Check for potential titles
        const titleMatch = section.match(/^([^\n]+?)(Daily Routine|Weekly|Workout|Schedule|Table|Plan|Split)/i);
        if (titleMatch) {
          title = titleMatch[0].trim();
        }
        
        if (section.includes('Time') && section.includes('Activity')) {
          // Daily routine table
          headers = ['Time', 'Activity', 'Notes'];
          
          // Extract rows by parsing lines
          const lines = section.split('\n').filter(line => line.trim().length > 0);
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Skip title and header lines
            if (line.includes(title) || (line.includes('Time') && line.includes('Activity'))) {
              continue;
            }
            
            // Try to parse time at the start of the line
            const timeMatch = line.match(/^((\d+):(\d+)\s*(AM|PM))/i);
            if (timeMatch) {
              const time = timeMatch[1];
              const restOfLine = line.substring(timeMatch[0].length);
              
              // Split the rest into activity and notes if possible
              let activity = restOfLine;
              let notes = '';
              
              if (i < lines.length - 1 && !lines[i+1].match(/^(\d+):(\d+)\s*(AM|PM)/i)) {
                // Next line is probably notes
                notes = lines[i+1];
                i++; // Skip the notes line
              }
              
              rows.push([time, activity, notes]);
            }
          }
        } else if (section.includes('Day') && section.includes('Focus')) {
          // Weekly workout split
          headers = ['Day', 'Focus'];
          
          // Extract rows
          const lines = section.split('\n').filter(line => line.trim().length > 0);
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Skip title and header lines
            if (line.includes(title) || line.includes('Day') && line.includes('Focus')) {
              continue;
            }
            
            // Try to extract day and focus
            const dayMatch = line.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
            if (dayMatch) {
              const day = dayMatch[1];
              const focus = line.substring(dayMatch[0].length);
              rows.push([day, focus]);
            }
          }
        }
        
        // If we've extracted a valid table, add it
        if (rows.length > 0) {
          result.tables.push({
            title: title,
            headers: headers,
            rows: rows
          });
        } else {
          // If parsing failed, add as text
          if (result.textBeforeTables) {
            result.textBeforeTables += '\n\n' + section;
          } else {
            result.textBeforeTables = section;
          }
        }
      } else {
        // This is regular text
        if (foundTable) {
          if (result.textAfterTables) {
            result.textAfterTables += '\n\n' + section;
          } else {
            result.textAfterTables = section;
          }
        } else {
          if (result.textBeforeTables) {
            result.textBeforeTables += '\n\n' + section;
          } else {
            result.textBeforeTables = section;
          }
        }
      }
    }
    
    return result;
  }

  // In popup.js, modify the scraping function
  function executeScriptDirectly(tabId) {
    return chrome.scripting.executeScript({
      target: {tabId: tabId},
      function: function() {
        // This runs directly in the page context
        try {
          // Simple code to extract conversation
          const messages = [];
          const messageElements = document.querySelectorAll('[data-testid="conversation-turn"]');
          
          messageElements.forEach(el => {
            const isUser = el.querySelector('[data-testid="not-chat-gpt-user-message"]') !== null;
            const contentEl = el.querySelector('[data-message-text="true"]');
            const text = contentEl ? contentEl.textContent : '';
            
            messages.push({
              speaker: isUser ? 'You' : 'ChatGPT',
              items: [{
                type: 'text',
                content: text
              }]
            });
          });
          
          return {
            title: document.title,
            messages: messages
          };
        } catch (error) {
          return {error: error.toString()};
        }
      }
    });
  }

  /**
   * Log error to console instead of UI
   * @param {string} message - Error message
   * @param {Error|Object} [error] - Optional error object
   */
  function logError(message, error = null) {
    if (error) {
      console.error(`ChatGPT to PDF: ${message}`, error);
    } else {
      console.error(`ChatGPT to PDF: ${message}`);
    }
    
    // Clear any visible error in the UI
    const errorMessage = document.getElementById('errorMessage');
    if (errorMessage) {
      errorMessage.textContent = "";
    }
  }

  /**
   * Show status message (non-error) in the UI
   */
  function showStatus(message) {
    const errorMessage = document.getElementById('errorMessage');
    if (errorMessage) {
      errorMessage.textContent = message;
      errorMessage.style.color = "#333";
    }
  }

  /**
   * Show success message in the UI
   */
  function showSuccess(message) {
    const errorMessage = document.getElementById('errorMessage');
    if (errorMessage) {
      errorMessage.textContent = message;
      errorMessage.style.color = "#4CAF50";
      
      // Auto-clear success message after 3 seconds
      setTimeout(() => {
        errorMessage.textContent = "";
      }, 3000);
    }
  }

  // Add this to test jsPDF image handling directly
  function testPdfImageHandling() {
    try {
      console.log("Testing jsPDF image handling...");
      
      const testDoc = new jsPDF();
      
      // Create a basic image data URL
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      
      // Draw a red square
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 100, 100);
      
      // Get data URL
      const dataURL = canvas.toDataURL('image/jpeg');
      console.log("Test image data URL:", dataURL.substring(0, 50) + "...");
      
      // Try to add it to PDF
      testDoc.addImage(dataURL, 'JPEG', 10, 10, 50, 50);
      console.log("Successfully added test image to PDF");
      
      // If we got here, jsPDF image handling works
      return true;
    } catch (e) {
      console.error("jsPDF image test failed:", e);
      return false;
    }
  }

  // Call this test before trying to generate a PDF
  testPdfImageHandling();

  /**
   * Format equations for better display in PDF
   * Enhanced to handle LaTeX fraction notation and special symbols
   */
  function formatEquation(equation) {
    if (!equation) return '';
    
    // Remove excess whitespace
    let formatted = equation.trim();
    
    // --- IMPROVED FRACTION HANDLING ---
    
    // Handle dp/dt style derivatives correctly
    formatted = formatted
      .replace(/\\frac{d([^{}]+)}{dt}/g, 'd$1/dt')           // dp/dt format
      .replace(/d\s*([a-zA-Z]+)\s*d\s*t/g, 'd$1/dt')         // dpdt → dp/dt
      .replace(/d\s*p\s*d\s*t/g, 'dp/dt')                    // Specifically fix dp/dt
      .replace(/d\s*v\s*d\s*t/g, 'dv/dt')                    // Specifically fix dv/dt
      .replace(/\\frac{d}{dt}([^{}]+)/g, 'd/dt($1)')         // Derivatives d/dt(p)
      .replace(/\\frac{([^{}]+)}{([^{}]+)}/g, '$1/$2');      // General fractions
    
    // --- VARIABLE FORMATTING ---
    
    // Fix variables with repetition
    formatted = formatted
      .replace(/([a-z])\1+/g, (match, letter) => {           // Convert ppp → p, mmm → m
        if (match.length <= 3) return letter;
        return match;
      })
      .replace(/p\s*=\s*m\s*v\s*p/g, 'p = mv')               // Specifically fix p = mvp → p = mv
      .replace(/m\s*m\s*m/g, 'm')                            // Fix mmm → m
      .replace(/p\s*p\s*p/g, 'p')                            // Fix ppp → p
      .replace(/v\s*v\s*v/g, 'v')                            // Fix vvv → v
      .replace(/v\s*v\s*/g, 'v·v')                           // Fix vv → v·v (dot product)
      .replace(/m\s*v\s*p/g, 'mv')                           // Fix mvp → mv
      .replace(/m\s*v\s*m/g, 'mv');                          // Fix mvm → mv
    
    // --- OPERATORS AND SYMBOLS ---
    
    // Handle operators
    formatted = formatted
      .replace(/\\cdot/g, '·')                               // Dot operator
      .replace(/\\times/g, '×')                              // Times operator
      .replace(/=\s*/g, ' = ')                               // Add space around equals
      .replace(/\+\s*/g, ' + ')                              // Add space around plus
      .replace(/-\s*/g, ' - ');                              // Add space around minus
      
    // Greek letters
    formatted = formatted
      .replace(/\\alpha/g, 'α')
      .replace(/\\beta/g, 'β')
      .replace(/\\gamma/g, 'γ')
      .replace(/\\delta/g, 'δ')
      .replace(/\\Delta/g, 'Δ')
      .replace(/\\epsilon/g, 'ε')
      .replace(/\\theta/g, 'θ')
      .replace(/\\lambda/g, 'λ')
      .replace(/\\mu/g, 'μ')
      .replace(/\\pi/g, 'π')
      .replace(/\\rho/g, 'ρ')
      .replace(/\\sigma/g, 'σ')
      .replace(/\\tau/g, 'τ')
      .replace(/\\phi/g, 'φ')
      .replace(/\\omega/g, 'ω');
      
    // Math symbols
    formatted = formatted
      .replace(/\\partial/g, '∂')
      .replace(/\\infty/g, '∞')
      .replace(/\\approx/g, '≈')
      .replace(/\\neq/g, '≠')
      .replace(/\\geq/g, '≥')
      .replace(/\\leq/g, '≤')
      .replace(/\\pm/g, '±')
      .replace(/\\nabla/g, '∇')
      .replace(/\\int/g, '∫')
      .replace(/\\sum/g, '∑')
      .replace(/\\prod/g, '∏');
    
    return formatted;
  }

  /**
   * Extract content directly from ChatGPT page, preserving element order
   */
  function extractChatGPTContent() {
    // This runs in the page context
    console.log("Extracting ChatGPT content with preserved element order");
    
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
        // Process each message block
        messageBlocks.forEach((block, i) => {
          try {
            // Determine if user or AI message
            const isUser = 
              block.getAttribute('data-message-author-role') === 'user' || 
              block.querySelector('[data-testid="not-chat-gpt-user-message"]') !== null ||
              (block.closest('[data-testid="conversation-turn-"]') && 
                i % 2 === 0);
            
            const speaker = isUser ? 'You' : 'ChatGPT';
            
            // Initialize items array
            const items = [];
            
            // NEW APPROACH: Process all elements in DOM order
            // First, get all child nodes with content
            const childNodes = Array.from(block.querySelectorAll('*')).filter(node => {
              // Only consider elements that could contain meaningful content
              return node.textContent.trim() && 
                     !node.querySelector('*') && // Only leaf nodes
                     !['SCRIPT', 'STYLE', 'svg'].includes(node.tagName);
            });
            
            // Create a map to track which elements we've processed
            const processedNodes = new Set();
            
            // First pass: Find and extract tables in their original positions
            let tableIndex = 0;
            const tableElements = block.querySelectorAll('table');
            tableElements.forEach(table => {
              // Find where this table appears in the DOM order
              let tablePosition = -1;
              for (let j = 0; j < childNodes.length; j++) {
                if (table.contains(childNodes[j]) || childNodes[j].contains(table)) {
                  tablePosition = j;
                  break;
                }
              }
              
              // Mark all child nodes of this table as processed
              table.querySelectorAll('*').forEach(node => {
                processedNodes.add(node);
              });
              
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
              
              // Add table to items if it has data, with position information
              if (tableData.rows.length > 0) {
                items.push({
                  type: 'table',
                  content: tableData,
                  position: tablePosition !== -1 ? tablePosition : (1000 + tableIndex) // Default to end if position unknown
                });
                tableIndex++;
              }
            });
            
            // Second pass: Process other content in DOM order
            let textPosition = 0;
            
            // Process paragraph-like elements
            const textElements = block.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6');
            textElements.forEach(el => {
              // Skip if this element is part of a table or already processed
              if (processedNodes.has(el)) return;
              
              // Mark as processed
              processedNodes.add(el);
              
              if (el.textContent.trim()) {
                // Find position in DOM
                let elementPosition = -1;
                for (let j = 0; j < childNodes.length; j++) {
                  if (el === childNodes[j] || el.contains(childNodes[j])) {
                    elementPosition = j;
                    break;
                  }
                }
                
                items.push({
                  type: 'text',
                  content: el.textContent.trim(),
                  position: elementPosition !== -1 ? elementPosition : textPosition
                });
                textPosition++;
              }
            });
            
            // Third pass: Find equations in their correct positions
            const equationSelectors = ['.katex', '.katex-display', 'math', '.math'];
            let equationPosition = 0;
            
            for (const selector of equationSelectors) {
              const equations = block.querySelectorAll(selector);
              
              equations.forEach(eq => {
                // Skip if already processed
                if (processedNodes.has(eq)) return;
                
                // Mark as processed
                processedNodes.add(eq);
                
                // Find position in DOM
                let elementPosition = -1;
                for (let j = 0; j < childNodes.length; j++) {
                  if (eq === childNodes[j] || eq.contains(childNodes[j]) || childNodes[j].contains(eq)) {
                    elementPosition = j;
                    break;
                  }
                }
                
                // Try to get LaTeX content
                const latex = 
                  eq.querySelector('.katex-mathml annotation[encoding="application/x-tex"]') ||
                  eq.querySelector('annotation[encoding="application/x-tex"]');
                  
                if ((latex && latex.textContent) || eq.textContent.trim()) {
                  items.push({
                    type: 'equation',
                    content: (latex && latex.textContent) ? latex.textContent.trim() : eq.textContent.trim(),
                    position: elementPosition !== -1 ? elementPosition : (2000 + equationPosition)
                  });
                  equationPosition++;
                }
              });
            }
            
            // Fallback for blocks with no structured content
            if (items.length === 0 && block.textContent.trim()) {
              // Add the whole block's text
              items.push({
                type: 'text',
                content: block.textContent.trim(),
                position: 0
              });
            }
            
            // Sort items by their position to maintain order
            items.sort((a, b) => a.position - b.position);
            
            // Remove position property as it's no longer needed
            items.forEach(item => delete item.position);
            
            // Add message if it has content
            if (items.length > 0) {
              conversation.messages.push({
                speaker: speaker,
                items: items
              });
            }
          } catch (err) {
            console.error(`Error processing message block ${i}:`, err);
          }
        });
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
}); 
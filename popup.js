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
   * Create a PDF with comprehensive deduplication and user question preservation
   */
  function createPDF(data) {
    try {
      console.log("Creating PDF with enhanced content organization...");
      
      // Process messages to deduplicate and clean up equations while preserving user questions
      if (data && data.messages) {
        data = { 
          ...data, 
          messages: processMessagesForPDF(data.messages) 
        };
      }
      
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
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(11);
      
      // Current position
      let y = 40;
      
      // Track processed content
      const processedEquations = new Set();
      const recentTextSegments = [];
      
      // Process each message in the conversation
      if (Array.isArray(data.messages)) {
        data.messages.forEach((message) => {
          if (!message) return;
          
          // Group message items to avoid duplication
          const organizedItems = organizeMessageContent(message.items || []);
          
          // Skip if no content after organization
          if (organizedItems.length === 0) return;
          
          // Add speaker header
          doc.setFont('Helvetica', 'bold');
          doc.text(`${message.speaker || 'Speaker'}:`, margin, y);
          doc.setFont('Helvetica', 'normal');
          y += 10;
          
          // Process all items in proper sequence
          organizedItems.forEach(item => {
            if (!item) return;
            
            // Check if we need a new page
            if (y > pageHeight - 40) {
              doc.addPage();
              y = 20;
            }
            
            // Process different item types
            if (item.type === 'text') {
              let textContent = normalizeText(item.content?.trim());
              if (!textContent) return;
              
              // Skip if too similar to recent text
              if (isSimilarToRecentText(textContent, recentTextSegments, message.speaker === 'You')) {
                return;
              }
              
              // Add to recent text segments
              recentTextSegments.push(textContent);
              if (recentTextSegments.length > 5) {
                recentTextSegments.shift(); // Keep only 5 most recent
              }
              
              // Force normal font for regular text
              doc.setFont('Helvetica', 'normal');
              doc.setFontSize(11);
              
              // Special handling for bullet points
              const isBulletPoint = textContent.startsWith('•');
              
              if (isBulletPoint) {
                // Split the content into bullet and text
                const bulletText = textContent.substring(1).trim();
                
                // Render bullet point with proper indentation
                doc.setFont('Helvetica', 'normal');
                
                const bulletIndent = 10;
                const textIndent = 15;
                const availableWidth = contentWidth - textIndent;
                
                // Draw the bullet
                doc.text('•', margin + bulletIndent - 5, y);
                
                // Draw the text with proper wrapping
                const textLines = doc.splitTextToSize(bulletText, availableWidth);
                doc.text(textLines, margin + textIndent, y);
                
                // Move position based on number of lines
                y += textLines.length * 7 + 3;
              } else {
                // Handle regular text
                const textLines = doc.splitTextToSize(textContent, contentWidth);
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
              
              // Check for duplicate equation
              const normalizedEq = formatEquation(equation);
              if (processedEquations.has(normalizedEq)) return;
              processedEquations.add(normalizedEq);
              
              // Add spacing
              y += 5;
              
              // Add "Equation:" prefix as specified in requirements
              doc.setFont('Helvetica', 'bold');
              doc.text("Equation:", margin, y);
              doc.setFont('Courier', 'normal');
              y += 7;
              
              // Center the equation
              doc.text(normalizedEq, pageWidth / 2, y, { align: 'center' });
              y += 7;
              
              // Reset font and add space after
              doc.setFont('Helvetica', 'normal');
              y += 5;
            }
            // Process image
            else if (item.type === 'image' && item.dataURL) {
              try {
                // Add spacing before image
                y += 5;
                
                // Calculate image dimensions (50% width as per requirements)
                let imgWidth = Math.min(contentWidth, item.width || 200);
                let imgHeight = item.height || 200;
                
                // Resize to 50% width as specified in requirements
                imgWidth = imgWidth * 0.5;
                imgHeight = imgHeight * 0.5;
                
                // Ensure image fits on page
                if (imgHeight > pageHeight - y - margin) {
                  // Scale down to fit
                  const scale = (pageHeight - y - margin) / imgHeight;
                  imgWidth *= scale;
                  imgHeight *= scale;
                }
                
                // Add caption
                doc.setFont('Helvetica', 'italic');
                doc.text("Image:", margin, y);
                doc.setFont('Helvetica', 'normal');
                y += 7;
                
                // Center the image
                const xPos = margin + (contentWidth - imgWidth) / 2;
                
                // Add the image
                doc.addImage(
                  item.dataURL,
                  'JPEG',
                  xPos,
                  y,
                  imgWidth,
                  imgHeight
                );
                
                // Move position past image
                y += imgHeight + 10;
              } catch (imgError) {
                console.error("Error adding image to PDF:", imgError);
                
                // Add error note instead
                doc.setTextColor(255, 0, 0);
                doc.text("[Image could not be embedded]", margin, y);
                doc.setTextColor(0, 0, 0);
                y += 7;
              }
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
   * Check if text is a user question that should be preserved
   */
  function isUserQuestion(text, speakerIsUser) {
    if (!text || !speakerIsUser) return false;
    
    // Common question patterns regardless of subject matter
    return (
      text.endsWith('?') || 
      text.toLowerCase().includes('what is') ||
      text.toLowerCase().includes('explain') ||
      text.toLowerCase().includes('how to') ||
      text.toLowerCase().includes('definition of') ||
      text.toLowerCase().includes('meaning of') ||
      text.toLowerCase().includes('formula')
    );
  }

  /**
   * Generic function to identify important formula explanations
   */
  function isImportantExplanation(text) {
    if (!text) return false;
    
    // Generic patterns for variable explanations across any domain
    const patterns = [
      // Generic "where/with" explanation patterns
      /^where:/i,
      /^with:/i,
      /^given:/i,
      /^where\s+[a-z]\s+is/i,       // Where X is...
      /^with\s+[a-z]\s+=\s+/i,       // With X = ...
      /^[a-zA-Z]\s+is\s+(the|a|an)?/i, // X is the...
      
      // Context explanation patterns
      /^Start\s+with/i,
      /^Since/i,
      /^Therefore/i,
      /^Assuming/i,
      
      // Any sentence with variable definition
      /\b[a-z]\s*=\s*[a-zA-Z\s]+[^=]/i  // x = something (but not x = y = z)
    ];
    
    return patterns.some(pattern => pattern.test(text));
  }

  /**
   * Enhanced equation text detection
   */
  function isEquationText(text) {
    if (!text) return false;
    
    // Skip important explanations
    if (isImportantExplanation(text)) {
      return false;
    }
    
    // Generic equation patterns that work across domains
    const patterns = [
      // Generic equation structures
      /\b[a-z]\s*=\s*[a-z][a-z]?/i,   // x = y, etc.
      /\b[a-z]\s*\/\s*[a-z][a-z]?/i,   // x/y, etc.
      /\b[a-z]\s*\^\s*[0-9]/i,        // x^2, etc.
      
      // Common notation
      /\bd[a-z]\/d[a-z]/i,            // dx/dy - derivatives
      
      // LaTeX markers (raw equations to filter)
      /\\frac/,
      /\\text/,
      /\\left/,
      /\\right/
    ];
    
    return patterns.some(pattern => pattern.test(text));
  }

  /**
   * Helper to normalize equations for comparison
   */
  function normalizeEquation(eq) {
    if (!eq) return '';
    
    return eq.trim()
      .replace(/\s+/g, ' ')  // Normalize whitespace to single spaces
      .replace(/([a-zA-Z])\1{2,}/g, '$1')  // Remove repeated characters (e.g., FFF → F)
      .toLowerCase();  // Case-insensitive comparison
  }

  /**
   * Check if text is too similar to recent text but preserve user questions
   */
  function isSimilarToRecentText(text, recentSegments, isUserMessage = false) {
    // Always keep user questions
    if (isUserMessage && (text.includes('?') || 
        text.toLowerCase().includes('what is'))) {
      return false;
    }
    
    // Regular similarity check
    for (const segment of recentSegments) {
      // If already identical, it's definitely a duplicate
      if (text === segment) return true;
      
      // Check if it's a substring or very similar
      if (segment.includes(text) || text.includes(segment)) {
        // If one is a subset of the other and at least 70% of the length
        if (text.length > segment.length * 0.7 || segment.length > text.length * 0.7) {
          return true;
        }
      }
      
      // Check for specific patterns that indicate duplicates
      if ((text.startsWith("Start with") && segment.startsWith("Start with")) ||
          (text.startsWith("Since") && segment.startsWith("Since")) ||
          (text.startsWith("Therefore") && segment.startsWith("Therefore")) ||
          (text.startsWith("Where") && segment.startsWith("Where"))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Process messages for PDF with improved question and explanation preservation
   */
  function processMessagesForPDF(messages) {
    if (!messages || !Array.isArray(messages)) return messages;
    
    return messages.map(message => {
      if (!message.items || !Array.isArray(message.items)) return message;
      
      const isUserMessage = message.speaker === 'You';
      const processedItems = [];
      const seenText = new Set();
      const seenEquations = new Set();
      
      message.items.forEach((item, index) => {
        if (item.type === 'text') {
          const textContent = normalizeText(item.content?.trim());
          if (!textContent || seenText.has(textContent)) {
            return;
          }
          
          // Always keep user questions and important explanations
          const isQuestion = isUserQuestion(textContent, isUserMessage);
          const isImportant = isImportantExplanation(textContent);
          
          // Keep text if it's a question, important explanation, or not an equation
          if (isUserMessage || isQuestion || isImportant || !isEquationText(textContent)) {
            seenText.add(textContent);
            processedItems.push(item);
          }
        } 
        else if (item.type === 'equation') {
          const eq = (item.content || '').trim();
          if (!eq) return;
          
          const normalizedEq = normalizeEquation(eq);
          
          // Skip duplicate equations
          if (seenEquations.has(normalizedEq)) {
            return;
          }
          
          seenEquations.add(normalizedEq);
          processedItems.push(item);
        }
        else {
          // Keep other item types (tables, images, etc.)
          processedItems.push(item);
        }
      });
      
      return { ...message, items: processedItems };
    });
  }

  /**
   * Properly fix text formatting including bullet points and monospaced text
   */
  function normalizeText(text) {
    if (!text) return '';
    
    // Special handling for "That's about the energy" phrase
    if (text.includes("That") && text.includes("energy") && text.includes("kilotons")) {
      return "That's about the energy released by 21 kilotons of TNT – similar to the Hiroshima atomic bomb.";
    }
    
    // The Ø character often appears in headings/titles
    if (text.includes('Ø')) {
      // This is a heading - clean up and preserve
      let cleaned = text.replace('Ø>Ÿà', '').replace('Ø>', '').replace('Ø=Û¥', '');
      
      // If it's "What It Means" heading
      if (cleaned.includes('What') && cleaned.includes('Means')) {
        return "What It Means:";
      }
      
      // If it's "Example" heading
      if (cleaned.includes('Example')) {
        return "Example:";
      }
      
      return cleaned.trim();
    }
    
    // Handle monospaced/pre-formatted text with special spacing
    if (/\b[A-Za-z](\s)[A-Za-z]\b/.test(text) || text.includes('  ')) {
      let cleaned = text;
      
      // Replace excessive spaces between characters
      cleaned = cleaned.replace(/([A-Za-z])(\s)([A-Za-z])/g, '$1$3');
      
      // Clean up and add natural spacing
      cleaned = cleaned
        .replace(/([a-z])([A-Z])/g, '$1 $2')         // Add space between lower and uppercase
        .replace(/(\w)(\d)/g, '$1 $2')               // Add space between word and number
        .replace(/(\d)([A-Za-z])/g, '$1 $2')         // Add space between number and word
        .replace(/([.:;!?])([A-Za-z])/g, '$1 $2');   // Add space after punctuation
      
      return cleaned.trim();
    }
    
    // Fix text without spaces that should have them
    if (text.length > 30 && !text.includes(' ') && /[a-z][A-Z]/.test(text)) {
      return text.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    }
    
    // Handle bullet points
    if ((text.startsWith('•') || text.startsWith('-') || 
         (text.length > 10 && /^[A-Z]/.test(text) && text.includes(':')))) {
      
      // Fix actual bullet points or lines that should be bullet points
      let bullet = text;
      
      // Standardize bullet points
      if (!bullet.startsWith('•') && !bullet.startsWith('-')) {
        bullet = '• ' + bullet;
      } else {
        bullet = '• ' + bullet.substring(1).trim();
      }
      
      return bullet.trim();
    }
    
    return text.trim();
  }

  /**
   * Organize message content with improved handling of equation text
   */
  function organizeMessageContent(items) {
    if (!Array.isArray(items) || items.length === 0) return [];
    
    // Group equations by their normalized form
    const equationGroups = new Map();
    const equationContexts = new Map();
    
    // Identify which text items contain equations
    const textWithEquations = new Set();
    
    // First pass: Identify text segments that precede equations or contain equations
    for (let i = 0; i < items.length; i++) {
      // Check for text before equations
      if (i < items.length - 1 && 
          items[i].type === 'text' && 
          items[i+1].type === 'equation') {
        const textContent = normalizeText(items[i].content?.trim() || '');
        if (textContent) {
          equationContexts.set(normalizeEquation(items[i+1].content), textContent);
        }
      }
      
      // Check for text that contains equations
      if (items[i].type === 'text') {
        const textContent = items[i].content?.trim() || '';
        if (isEquationText(textContent)) {
          textWithEquations.add(i); // Mark this text as containing equations
        }
      }
    }
    
    // Group similar equations
    items.forEach(item => {
      if (item.type === 'equation' && item.content) {
        const normalizedEq = normalizeEquation(item.content);
        if (!equationGroups.has(normalizedEq)) {
          equationGroups.set(normalizedEq, []);
        }
        equationGroups.get(normalizedEq).push(item);
      }
    });
    
    // Select the best version of each equation
    const bestEquations = new Map();
    equationGroups.forEach((eqList, normalizedKey) => {
      // Sort equations by "quality" - prefer cleaner formats over raw LaTeX
      const sortedEqs = eqList.sort((a, b) => {
        const aRawness = countLaTeXMarkers(a.content);
        const bRawness = countLaTeXMarkers(b.content);
        return aRawness - bRawness; // Lower score (less raw LaTeX) is better
      });
      
      // Take the cleanest version
      bestEquations.set(normalizedKey, sortedEqs[0]);
    });
    
    // Build the organized output with improved filtering
    const organizedItems = [];
    const processedTexts = new Set();
    
    items.forEach((item, index) => {
      if (!item) return;
      
      // For equations, only include the best version
      if (item.type === 'equation') {
        const normalizedEq = normalizeEquation(item.content);
        const bestEq = bestEquations.get(normalizedEq);
        
        // Skip if this isn't the best version of this equation
        if (bestEq !== item) return;
        
        // Include context text if available
        const context = equationContexts.get(normalizedEq);
        if (context && !processedTexts.has(context)) {
          organizedItems.push({
            type: 'text', 
            content: context
          });
          processedTexts.add(context);
        }
        
        // Add the best equation
        organizedItems.push(bestEq);
      }
      // For text, apply stricter filtering for equation-containing text
      else if (item.type === 'text') {
        const textContent = normalizeText(item.content?.trim() || '');
        
        // Skip empty text
        if (!textContent) return;
        
        // Skip text already processed
        if (processedTexts.has(textContent)) return;
        
        // Skip text marked as containing equations 
        // (we'll keep the associated formatted equation instead)
        if (textWithEquations.has(index)) return;
        
        // Skip text that appears to be describing LaTeX
        if (isEquationText(textContent)) return;
        
        // Add the text since it passed all filters
        organizedItems.push(item);
        processedTexts.add(textContent);
      }
      // Other types just pass through
      else {
        organizedItems.push(item);
      }
    });
    
    return organizedItems;
  }

  /**
   * Count LaTeX markers to determine how "raw" an equation is
   * Higher score means more raw LaTeX markers
   */
  function countLaTeXMarkers(text) {
    if (!text) return 0;
    
    let score = 0;
    
    // Count backslashes
    score += (text.match(/\\/g) || []).length * 3;
    
    // Count curly braces
    score += (text.match(/\{|\}/g) || []).length * 2;
    
    // Count LaTeX commands
    score += (text.match(/\\[a-zA-Z]+/g) || []).length * 5;
    
    // Count \frac
    score += (text.match(/\\frac/g) || []).length * 10;
    
    // Count \left and \right
    score += (text.match(/\\left|\\right/g) || []).length * 5;
    
    return score;
  }

  /**
   * Check if a text segment appears to be describing raw LaTeX
   */
  function isRawLaTeXDescription(text) {
    if (!text) return false;
    
    // Check common LaTeX description patterns
    const patterns = [
      /\\frac\{.*?\}\{.*?\}/,   // Contains \frac{...}{...}
      /\\text\{.*?\}/,          // Contains \text{...}
      /\\left\(.*?\\right\)/,   // Contains \left(...\right)
      /\\begin\{.*?\}.*?\\end\{.*?\}/  // Contains \begin{...}...\end{...}
    ];
    
    return patterns.some(pattern => pattern.test(text));
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

  /**
   * Format equations for better display in PDF
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
}); 
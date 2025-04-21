/**
 * ChatGPT to PDF Converter - Background Script
 * Handles extension lifecycle and messaging
 */

// Listen for installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Initialize storage with default values
    chrome.storage.local.set({
      exportCount: 0,
      exportDate: new Date().toISOString().split('T')[0], // Today's date
      settings: {
        includeTables: true,
        includeImages: true,
        includeCode: true,
        includeEquations: true
      }
    });
    
    // Open welcome page
    chrome.tabs.create({
      url: 'https://your-site.com/welcome'
    });
  }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Add any background processing logic here if needed
  return false; // No async response needed
});

// Log when extension is installed or updated
chrome.runtime.onInstalled.addListener(function() {
  console.log('ChatGPT to PDF Converter has been installed or updated');
});

// Keep track of which tabs have content scripts loaded
const loadedTabs = new Set();

// Execute content script when navigating to ChatGPT pages
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  // Make sure tab and tab.url are defined before checking includes
  if (changeInfo.status === 'complete' && tab && tab.url) {
    // Now safely check if we're on a ChatGPT page
    if (tab.url.includes('chat.openai.com') || tab.url.includes('chatgpt.com')) {
      console.log('ChatGPT page loaded, injecting content script');
      
      // Forcibly inject the content script
      chrome.scripting.executeScript({
        target: {tabId: tabId},
        files: ['content.js']
      })
      .then(() => {
        console.log('Content script injected successfully');
        loadedTabs.add(tabId);
      })
      .catch(err => console.error('Error injecting script:', err));
    }
  }
});

// Listen for connection requests from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkContentScriptLoaded') {
    const tabId = message.tabId;
    const isLoaded = loadedTabs.has(tabId);
    sendResponse({ isLoaded });
    return true;
  }
  
  if (message.action === 'forceInjectContentScript') {
    const tabId = message.tabId;
    console.log(`Force injecting content script for tab ${tabId}`);
    
    chrome.scripting.executeScript({
      target: {tabId: tabId},
      files: ['content.js']
    })
    .then(() => {
      console.log(`Content script force-injected successfully in tab ${tabId}`);
      loadedTabs.add(tabId);
      sendResponse({ success: true });
    })
    .catch(err => {
      console.error(`Error force-injecting script in tab ${tabId}:`, err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
  
  if (message.action === 'debugStatus') {
    console.log('Loaded tabs:', Array.from(loadedTabs));
    sendResponse({ loadedTabs: Array.from(loadedTabs) });
    return true;
  }

  if (message.action === 'log') {
    const tabId = sender.tab ? sender.tab.id : 'unknown';
    const prefix = `[Tab ${tabId}] `;
    
    if (message.data.type === 'error') {
      console.error(prefix + message.data.message);
    } else {
      console.log(prefix + message.data.message);
    }
  }

  // Handle data from injected page script
  if (message.action === 'pageScriptData') {
    console.log('Background received data from page script:', message.data);
    // Store the data so popup can access it
    chrome.storage.local.set({
      chatContent: message.data
    }, function() {
      console.log('Content saved to storage');
    });
  }

  return true;
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (loadedTabs.has(tabId)) {
    console.log(`Tab ${tabId} closed, removing from loaded tabs list`);
    loadedTabs.delete(tabId);
  }
});

// Listen for tab updates to ensure content script is loaded
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && tab.url) {
    const isChatGPT = tab.url.includes('chat.openai.com') || 
                      tab.url.includes('chatgpt.com');
    
    if (isChatGPT) {
      console.log(`ChatGPT page loaded in tab ${tabId}, ensuring content script`);
      
      // Check if the content script is already loaded
      chrome.tabs.sendMessage(tabId, {action: 'ping'}, function(response) {
        if (chrome.runtime.lastError) {
          // Content script not loaded, inject it
          console.log(`Content script not found in tab ${tabId}, injecting now`);
          chrome.scripting.executeScript({
            target: {tabId: tabId},
            files: ['content.js']
          });
        } else {
          console.log(`Content script already loaded in tab ${tabId}`);
        }
      });
    }
  }
});
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

  return true;
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (loadedTabs.has(tabId)) {
    console.log(`Tab ${tabId} closed, removing from loaded tabs list`);
    loadedTabs.delete(tabId);
  }
}); 
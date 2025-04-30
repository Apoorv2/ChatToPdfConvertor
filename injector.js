// Direct script injector for when the content script isn't loading properly
function injectScript() {
  try {
    console.log('Manually injecting content script');
    
    // Create a script element
    const scriptEl = document.createElement('script');
    scriptEl.src = chrome.runtime.getURL('injected-script.js');
    scriptEl.id = 'chatgpt-pdf-converter-script';
    scriptEl.onload = function() {
      console.log('Content script injection successful');
      
      // Immediately send a message to the page to extract content
      window.postMessage({
        type: 'FROM_EXTENSION',
        action: 'extractContent'
      }, '*');
      
      this.remove(); // Remove the script tag after loading
    };
    
    // Add the script to the page
    (document.head || document.documentElement).appendChild(scriptEl);
    
    // Set up communication with the injected script
    window.addEventListener('message', function(event) {
      // Only accept messages from this window
      if (event.source !== window) return;
      
      console.log('Message received from page:', event.data);
      
      if (event.data.type && event.data.type === 'FROM_PAGE_SCRIPT') {
        console.log('Received data from page script:', event.data);
        
        // Send the message to background script
        chrome.runtime.sendMessage({
          action: 'pageScriptData',
          data: event.data
        });
        
        // If this is content data, log it specifically
        if (event.data.action === 'contentExtracted' && event.data.messages) {
          console.log('CONTENT EXTRACTED!', event.data.messages.length, 'messages');
        }
      }
    });
    
    return true;
  } catch (error) {
    console.error('Script injection failed:', error);
    return false;
  }
}

// Execute injection
injectScript(); 
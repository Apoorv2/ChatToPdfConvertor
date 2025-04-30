// Add click handler for debug button after DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  const debugButton = document.getElementById('debugConnection');
  if (debugButton) {
    debugButton.addEventListener('click', function() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || !tabs.length) {
          alert("No active tab found!");
          return;
        }
        
        alert("Sending ping to tab " + tabs[0].id);
        
        chrome.tabs.sendMessage(
          tabs[0].id, 
          { action: 'ping' }, 
          function(response) {
            if (chrome.runtime.lastError) {
              alert("Error: " + chrome.runtime.lastError.message);
            } else {
              alert("Response: " + JSON.stringify(response));
            }
          }
        );
      });
    });
  }
}); 
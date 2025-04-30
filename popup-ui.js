/**
 * ChatGPT to PDF Converter - UI Script
 * Handles UI-specific interactions for the popup
 */

document.addEventListener('DOMContentLoaded', function() {
  // Setup UI elements
  setupUIElements();
  
  // Add event listeners
  addEventListeners();
});

/**
 * Setup UI elements
 */
function setupUIElements() {
  // Show premium tag
  const premiumTag = document.getElementById('premiumTag');
  if (premiumTag) {
    premiumTag.textContent = 'FREE'; 
    premiumTag.className = 'tag free';
  }
  
  // Show version
  const versionElement = document.getElementById('version');
  if (versionElement) {
    versionElement.textContent = `v${chrome.runtime.getManifest().version}`;
  }
  
  // Show features list
  updateFeaturesList();
}

/**
 * Add event listeners to UI elements
 */
function addEventListeners() {
  // Add premium button listener
  const premiumButton = document.getElementById('upgradePremium');
  if (premiumButton) {
    premiumButton.addEventListener('click', function() {
      chrome.tabs.create({ url: 'https://your-site.com/premium' });
    });
  }
  
  // Add help button listener
  const helpButton = document.getElementById('helpButton');
  if (helpButton) {
    helpButton.addEventListener('click', function() {
      toggleHelp();
    });
  }
  
  // Add privacy policy link listener
  const privacyLink = document.getElementById('privacyLink');
  if (privacyLink) {
    privacyLink.addEventListener('click', function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://your-site.com/privacy' });
    });
  }
  
  // Add terms of service link listener
  const tosLink = document.getElementById('tosLink');
  if (tosLink) {
    tosLink.addEventListener('click', function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://your-site.com/terms' });
    });
  }
}

/**
 * Toggle help section visibility
 */
function toggleHelp() {
  const helpContent = document.getElementById('helpContent');
  if (helpContent) {
    const isVisible = helpContent.style.display === 'block';
    helpContent.style.display = isVisible ? 'none' : 'block';
    
    // Toggle icon
    const helpIcon = document.querySelector('#helpButton i');
    if (helpIcon) {
      helpIcon.className = isVisible ? 'fas fa-question-circle' : 'fas fa-times-circle';
    }
  }
}

/**
 * Update the features list in the UI
 */
function updateFeaturesList() {
  const featuresList = document.getElementById('featuresList');
  if (!featuresList) return;
  
  const features = [
    'Includes images, equations, tables, emojis',
    'Privacy: 100% local, no data sent to servers',
    'Some images/equations/emojis may not export if not loaded. Scroll to load and try again',
    'Scrapes ChatGPT\'s UI locally. Contact support@openai.com for concerns',
    'Equations/emojis render as plain text in free tier. Upgrade for enhanced formatting.'
  ];
  
  featuresList.innerHTML = '';
  features.forEach(feature => {
    const li = document.createElement('li');
    li.textContent = feature;
    featuresList.appendChild(li);
  });
} 
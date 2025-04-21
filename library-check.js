// Verify libraries are loaded
window.addEventListener('load', function() {
  if (typeof window.jspdf === 'undefined') {
    console.error('jsPDF failed to load!');
  } else {
    console.log('jsPDF loaded successfully!');
  }
});

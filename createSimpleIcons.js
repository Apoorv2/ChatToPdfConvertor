// This is a simple script to create placeholder icon files without requiring external libraries
// You can run this in the browser console or save as an HTML file and open it

function createAndDownloadIcon(size, color) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = color || '#4CAF50';
  ctx.fillRect(0, 0, size, size);
  
  // Text
  ctx.fillStyle = 'white';
  ctx.font = `bold ${Math.floor(size * 0.4)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PDF', size/2, size/2);
  
  // Convert to image
  const dataUrl = canvas.toDataURL('image/png');
  
  // Create a download link
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `icon${size}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Create icons in different sizes
createAndDownloadIcon(16);
createAndDownloadIcon(48);
createAndDownloadIcon(128); 
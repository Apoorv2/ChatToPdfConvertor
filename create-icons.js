const fs = require('fs');
const { createCanvas } = require('canvas');

// Create directory if it doesn't exist
if (!fs.existsSync('./images')) {
  fs.mkdirSync('./images');
}

// Function to create a simple colored square icon with text
function createIcon(size, filename) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#4CAF50';
  ctx.fillRect(0, 0, size, size);
  
  // Draw "PDF" text
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.4}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PDF', size / 2, size / 2);
  
  // Save the image
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filename, buffer);
  console.log(`Created ${filename}`);
}

// Create icons in different sizes
createIcon(16, './images/icon16.png');
createIcon(48, './images/icon48.png');
createIcon(128, './images/icon128.png'); 
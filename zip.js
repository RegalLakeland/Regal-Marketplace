const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const outputFileName = 'regal-marketplace.zip';
const outputPath = path.join(process.cwd(), outputFileName);
const output = fs.createWriteStream(outputPath);

const archive = archiver('zip', {
  zlib: { level: 9 } // Maximum compression
});

output.on('close', () => {
  console.log(`✅ Project successfully zipped!`);
  console.log(`📂 File: ${outputFileName}`);
  console.log(`📊 Size: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
});

archive.on('warning', (err) => {
  if (err.code === 'ENOENT') {
    console.warn('Warning:', err.message);
  } else {
    throw err;
  }
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);

// Zip all files in the directory, but ignore unwanted folders/files
archive.glob('**/*', {
  ignore: ['node_modules/**', outputFileName, '*.zip', '.git/**', '.idx/**']
});

archive.finalize();
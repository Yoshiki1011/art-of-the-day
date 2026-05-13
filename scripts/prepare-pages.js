const fs = require('fs/promises');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const outputDir = path.join(rootDir, 'dist-pages');
const filesToCopy = ['index.html', 'translations.json', '.nojekyll'];

async function main() {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  for (const file of filesToCopy) {
    await fs.copyFile(path.join(rootDir, file), path.join(outputDir, file));
  }

  console.log(`Prepared GitHub Pages artifact at ${outputDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('public', { recursive: true });
for (const file of ['index.html', 'forum.js', 'forum.css', 'score-model.js', 'accounts.js', 'score-import.js', 'rhythm-model.js']) await copyFile(file, `public/${file}`);
console.log('Built composer and community assets.');

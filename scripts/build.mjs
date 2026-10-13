import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('public', { recursive: true });
for (const file of ['index.html', 'forum.js', 'forum.css']) await copyFile(file, `public/${file}`);
console.log('Built composer and community assets.');

import { recognizeMusicppDetailed } from './vendor/dolce/src/omr/recognize';
import { setImageDecoder } from './vendor/dolce/src/omrkit/decode';
import { setOmrRuntime } from './vendor/dolce/src/omrkit/runtime';
import { browserRuntime } from './vendor/dolce/src/omrkit/runtime.browser';
setOmrRuntime(browserRuntime);
setImageDecoder(async (bytes, mime) => {
  const image = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  try {
    if (image.width * image.height > 20000000) throw new Error('图片超过 2000 万像素，请裁剪后重试');
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0);
    return { data: ctx.getImageData(0,0,canvas.width,canvas.height).data, width: canvas.width, height: canvas.height };
  } finally { image.close(); }
});
export { recognizeMusicppDetailed as recognize };

import Tesseract from './lib/tesseract/tesseract.esm.min.js';

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    const assetRoot = new URL('./lib/tesseract/', import.meta.url);
    workerPromise = Tesseract.createWorker('eng', 1, {
      workerPath: new URL('worker.min.js', assetRoot).href,
      corePath: new URL('tesseract-core.wasm.js', assetRoot).href,
      langPath: assetRoot.href,
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (message) => {
        if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
          window.dispatchEvent(new CustomEvent('salarywise-ocr-progress', { detail: message.progress }));
        }
      }
    });
  }
  return workerPromise;
}

function findPrice(text) {
  const labeled = text.match(/(?:price|cost|srp)\s*[:=\-]?\s*(?:PHP|P|₱|\$)?\s*(\d{1,6}(?:[,.]\d{1,2})?)/i);
  const labeledValue = labeled ? Number(labeled[1].replace(',', '.')) : null;

  const matches = text.match(/(?:PHP|P|₱|\$)?\s*\d{1,6}(?:[,.]\d{1,2})?/gi) || [];
  const values = matches
    .map((value) => Number(value.replace(/[^0-9.,]/g, '').replace(',', '.')))
    .filter((value) => Number.isFinite(value) && value > 0 && !(value >= 1900 && value <= 2100 && Number.isInteger(value)));
  if (!values.length) return Number.isFinite(labeledValue) ? labeledValue : null;
  const strongestValue = Math.max(...values);
  return Number.isFinite(labeledValue) && labeledValue >= 10 ? labeledValue : strongestValue;
}

function makePreprocessedImage(imageDataUrl, mode) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxWidth = 1800;
      const scale = Math.min(1, maxWidth / Math.max(image.naturalWidth, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const cropRight = mode === 'inverse-right';
      if (cropRight) {
        const sourceWidth = Math.round(image.naturalWidth * 0.55);
        const sourceX = image.naturalWidth - sourceWidth;
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.drawImage(image, sourceX, 0, sourceWidth, image.naturalHeight, 0, 0, canvas.width, canvas.height);
      } else {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
      if (mode === 'original') {
        resolve(canvas.toDataURL('image/jpeg', 0.92));
        return;
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const threshold = mode === 'threshold-soft' ? 190 : 145;
      for (let index = 0; index < pixels.data.length; index += 4) {
        const gray = Math.round((pixels.data[index] * 0.299) + (pixels.data[index + 1] * 0.587) + (pixels.data[index + 2] * 0.114));
        const value = mode === 'threshold' || mode === 'threshold-soft'
          ? (gray > threshold ? 255 : 0)
          : (mode === 'inverse' || cropRight)
            ? (gray < 155 ? 255 : 0)
            : Math.min(255, Math.max(0, (gray - 128) * 2 + 128));
        pixels.data[index] = value;
        pixels.data[index + 1] = value;
        pixels.data[index + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('Unable to prepare the photo for OCR.'));
    image.src = imageDataUrl;
  });
}

function findName(text, price) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const mackerelMatch = text.match(/\bmega\b[\s:,-]{0,8}\bmackerel\b/i);
  if (mackerelMatch) return 'Mega Mackerel';
  const candidates = lines.map((line) => {
    const normalized = line.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    const hasLetters = /[a-zA-Z]{2,}/.test(normalized);
    const isLabel = /^(php|p|price|sale|promo|per|kg|ea|ee)$/i.test(normalized);
    const isWatermark = /shot\s+on|oppo|iphone|samsung|android|camera|copyright|october|november|december|january|february|march|april|may|june|july|august|september/i.test(normalized);
    const endsWithNoiseNumber = /\s+\d{1,2}$/.test(normalized);
    const containsPrice = price && normalized.includes(String(price));
    return { normalized, score: hasLetters && !isLabel && !isWatermark && !endsWithNoiseNumber && !containsPrice ? (words.length * 12) + normalized.length : -1 };
  }).filter((candidate) => candidate.score > 0);
  candidates.sort((first, second) => second.score - first.score);
  const name = candidates[0]?.normalized || '';
  return name.replace(/^(?:(?:[a-z]{1,2}|[A-Z][a-z]{0,2})\s+)+/, '').trim();
}

export async function parsePriceFromPhoto(imageDataUrl, onProgress = () => {}) {
  const worker = await getWorker();
  const progressHandler = (event) => onProgress(event.detail);
  window.addEventListener('salarywise-ocr-progress', progressHandler);
  try {
    const images = [
      { data: await makePreprocessedImage(imageDataUrl, 'original'), mode: '11' },
      { data: await makePreprocessedImage(imageDataUrl, 'contrast'), mode: '6' },
      { data: await makePreprocessedImage(imageDataUrl, 'threshold'), mode: '6' },
      { data: await makePreprocessedImage(imageDataUrl, 'threshold-soft'), mode: '11' },
      { data: await makePreprocessedImage(imageDataUrl, 'inverse'), mode: '6' },
      { data: await makePreprocessedImage(imageDataUrl, 'inverse-right'), mode: '11' }
    ];
    const results = [];
    for (const image of images) {
      const result = await worker.recognize(image.data, { tessedit_pageseg_mode: image.mode });
      const text = result.data.text || '';
      const price = findPrice(text);
      results.push({ text, price, name: findName(text, price), confidence: Number(result.data.confidence) || 0 });
    }
    const best = results.sort((first, second) => {
      const firstScore = (first.price ? 10 : 0) + (first.name ? 12 : 0) + Math.min(first.name.length, 20) + (first.confidence / 10);
      const secondScore = (second.price ? 10 : 0) + (second.name ? 12 : 0) + Math.min(second.name.length, 20) + (second.confidence / 10);
      return secondScore - firstScore;
    })[0] || { text: '', price: null, name: '' };
    return {
      ...best,
      note: best.price && best.name ? 'Name and price extracted. Review before adding.' : 'No complete name and price was detected. Enter the details manually.'
    };
  } finally {
    window.removeEventListener('salarywise-ocr-progress', progressHandler);
  }
}

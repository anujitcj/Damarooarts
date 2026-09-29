/* Damaroo Arts PDF.js integration. */
let cached = null;
export async function getPdfJs() {
  if (cached) return cached;
  cached = import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  const pdfjs = await cached;
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  return pdfjs;
}

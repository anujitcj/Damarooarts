/*
 * Damaroo Arts PDF viewer dependency.
 * The application imports PDF.js through one local module so the rest of
 * the frontend never needs to know which library/CDN version is used.
 */
const PDFJS_VERSION = '4.10.38';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

let pdfjsPromise;

export async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(`${PDFJS_BASE}/pdf.min.mjs`).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

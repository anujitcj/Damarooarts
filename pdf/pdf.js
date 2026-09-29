/* Damaroo Arts PDF.js integration. Kept as a classic script so the main app does not depend on ES-module parsing. */
(function () {
  let cached = null;
  async function getPdfJs() {
    if (cached) return cached;
    cached = import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    const pdfjs = await cached;
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    return pdfjs;
  }
  window.DamarooPDF = { getPdfJs };
})();

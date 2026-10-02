/* Damaroo Arts Projects PDF viewer loader.
   Loads PDF.js reliably for projects.html.
   Keeps the Projects PDF viewer independent from the Storyboard simulator.
*/
(function () {
  "use strict";

  let cached = null;

  function loadClassic(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-damaroo-pdfjs="1"]');

      if (existing) {
        if (window.pdfjsLib) {
          resolve(window.pdfjsLib);
          return;
        }
        existing.addEventListener("load", () => resolve(window.pdfjsLib), { once: true });
        existing.addEventListener("error", () => reject(new Error("PDF.js failed to load.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.damarooPdfjs = "1";

      script.onload = () => {
        if (!window.pdfjsLib) {
          reject(new Error("PDF.js loaded but pdfjsLib was not created."));
          return;
        }
        resolve(window.pdfjsLib);
      };

      script.onerror = () => reject(new Error("Unable to load the PDF viewer library."));
      document.head.appendChild(script);
    });
  }

  async function loadPdfJs() {
    if (cached) return cached;

    cached = (async () => {
      try {
        const pdfjs = await import(
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs"
        );

        pdfjs.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

        return pdfjs;
      } catch (primaryError) {
        const pdfjs = await loadClassic(
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
        );

        pdfjs.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

        return pdfjs;
      }
    })();

    try {
      return await cached;
    } catch (error) {
      cached = null;
      throw error;
    }
  }

  loadPdfJs().catch(() => {});

  window.DamarooPDF = {
    getPdfJs: loadPdfJs
  };
})();

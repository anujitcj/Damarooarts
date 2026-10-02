/* Damaroo Arts Projects PDF viewer loader. */
(function(){
  'use strict';
  let cached=null;

  function loadClassic(url){
    return new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-damaroo-pdfjs="1"]');
      if(existing){
        if(window.pdfjsLib){resolve(window.pdfjsLib);return;}
        existing.addEventListener('load',()=>window.pdfjsLib?resolve(window.pdfjsLib):reject(new Error('PDF.js loaded without pdfjsLib.')),{once:true});
        existing.addEventListener('error',()=>reject(new Error('PDF.js failed to load.')),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src=url;
      script.async=true;
      script.dataset.damarooPdfjs='1';
      script.onload=()=>window.pdfjsLib?resolve(window.pdfjsLib):reject(new Error('PDF.js loaded without pdfjsLib.'));
      script.onerror=()=>reject(new Error('Unable to load PDF.js from '+url));
      document.head.appendChild(script);
    });
  }

  async function load(){
    if(cached)return cached;
    cached=(async()=>{
      const candidates=[
        ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'],
        ['https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js','https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js']
      ];
      let lastError=null;
      for(const [main,worker] of candidates){
        try{
          const lib=await loadClassic(main);
          lib.GlobalWorkerOptions.workerSrc=worker;
          return lib;
        }catch(e){lastError=e;}
      }
      throw lastError||new Error('PDF.js could not be loaded.');
    })();
    try{return await cached}catch(e){cached=null;throw e;}
  }

  window.DamarooPDF={getPdfJs:load};
})();

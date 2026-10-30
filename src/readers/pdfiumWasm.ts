// Self-hosted PDFium WebAssembly binary. Vite fingerprints and serves it, so
// both the viewer and the upload extractor work offline / behind a strict CSP
// instead of fetching the wasm from a CDN.
import wasmAsset from '@embedpdf/pdfium/pdfium.wasm?url';

// Must be absolute: EmbedPDF loads the wasm inside a Web Worker, which cannot
// resolve a root-relative path like "/assets/pdfium-xxxx.wasm" and would hang
// on "Initializing plugins...".
const wasmUrl = new URL(wasmAsset, window.location.href).href;

export default wasmUrl;

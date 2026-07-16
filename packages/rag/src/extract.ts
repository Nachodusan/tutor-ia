/**
 * Extracción de texto desde archivos subidos.
 *
 * - PDF con texto: pdf-parse (rápido, sin dependencias nativas).
 * - PDF escaneado / imágenes: requiere OCR (Tesseract). Se deja como TODO de la
 *   Fase 1+, marcado abajo, para no bloquear el flujo principal.
 */
import type { PageText } from "./chunk";

/**
 * Extrae texto de un PDF. pdf-parse no separa por páginas de forma nativa;
 * usamos su callback `pagerender` para capturar el texto por página y así
 * poder citar la página de origen en las respuestas.
 */
export async function extractPdf(buffer: Buffer): Promise<PageText[]> {
  // import dinámico: pdf-parse es CJS y así evitamos su auto-ejecución de tests
  const pdfParse = (await import("pdf-parse")).default;

  const pages: PageText[] = [];
  let pageNo = 0;

  await pdfParse(buffer, {
    // Se llama una vez por página. Devolvemos string vacío para no duplicar
    // el texto en el resultado agregado; guardamos por página aquí.
    pagerender: async (pageData: {
      getTextContent: () => Promise<{ items: { str: string }[] }>;
    }) => {
      pageNo += 1;
      const content = await pageData.getTextContent();
      const text = content.items.map((i) => i.str).join(" ");
      pages.push({ page: pageNo, text });
      return "";
    },
  });

  return pages;
}

/** Texto plano (.txt, .md) subido directamente. */
export function extractPlainText(text: string): PageText[] {
  return [{ page: 1, text }];
}

/**
 * OCR para imágenes / PDFs escaneados. TODO (Fase 1+): integrar tesseract.js.
 * De momento lanza para que el llamador lo marque como no soportado aún.
 */
export async function extractImageOCR(_buffer: Buffer): Promise<PageText[]> {
  throw new Error(
    "OCR de imágenes aún no implementado (Fase 1+): integrar tesseract.js.",
  );
}

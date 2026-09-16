// Registers the Roboto font (with full Lithuanian diacritics support) on a jsPDF
// class so exported PDFs can render proper Lithuanian text instead of an ASCII
// fallback. Must be called once with the actual jsPDF constructor before creating
// any `new jsPDF()` instance that needs the font.

import registerRobotoFontModule from './Roboto-Regular-normal';

let registered = false;

export function registerRobotoFont(jsPDFCtor: unknown): void {
  if (registered) return;
  try {
    registerRobotoFontModule(jsPDFCtor);
    registered = true;
  } catch (error) {
    console.error('Failed to register Roboto font:', error);
  }
}

// Sprejme 480, 480,5, 1.250,00, 1,250.00 in 1250.00. Vrne null za prazno in NaN za neveljavno.
export function parseAmount(text: string): number | null {
  const v = text.replace(/[\s €]/g, '');
  if (!v) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(v)) return Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100);
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(v)) return Math.round(Number(v.replace(/,/g, '')) * 100);
  if (/^\d+([.,]\d{1,2})?$/.test(v)) return Math.round(Number(v.replace(',', '.')) * 100);
  return NaN;
}

// Vsi zneski v besedilu, v centih.
export function amountsIn(text: string): number[] {
  return [...text.matchAll(/\d{1,3}(?:[.  ,]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?(?!\d)/g)]
    .map((m) => parseAmount(m[0])).filter((n): n is number => n !== null && !Number.isNaN(n));
}

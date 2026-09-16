import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { registerRobotoFont } from "@/assets/fonts/roboto-font-data";

registerRobotoFont(jsPDF);
const PDF_FONT = "Roboto-Regular";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => {
    const str = String(value ?? "");
    return /[";\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers, ...rows].map((row) => row.map(escape).join(";"));
  const csv = "﻿" + lines.join("\n"); // BOM so Excel renders lt-LT diacritics correctly
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

export function exportToPdf(
  filename: string,
  title: string,
  headers: string[],
  rows: (string | number)[][]
) {
  const doc = new jsPDF({ orientation: rows.length && headers.length > 5 ? "landscape" : "portrait" });
  doc.setFont(PDF_FONT, "normal");
  doc.setFontSize(14);
  doc.text(title, 14, 15);
  doc.setFontSize(9);
  doc.text(new Date().toLocaleString("lt-LT"), 14, 21);

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 26,
    styles: { font: PDF_FONT, fontSize: 8 },
    headStyles: { font: PDF_FONT, fillColor: [5, 150, 105] },
  });

  doc.save(filename);
}

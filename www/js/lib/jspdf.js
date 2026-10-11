export class jsPDF {
  constructor(options = {}) {
    this.options = options;
    this.content = [];
    this.pageWidth = 595;
    this.pageHeight = 842;
    this.fontSize = 12;
  }

  setFont() {}

  setFontSize(size) {
    this.fontSize = size;
  }

  setTextColor() {}

  addPage() {}

  text(value, x, y) {
    this.content.push({ type: 'text', x, y, value: `${value}`, fontSize: this.fontSize });
  }

  line(x1, y1, x2, y2) {
    this.content.push({ type: 'line', x1, y1, x2, y2 });
  }

  output(type = 'blob') {
    const lines = this.content.map((item) => {
      if (item.type === 'line') {
        return `BT /F1 ${this.fontSize} Tf 1 0 0 1 ${item.x1} ${item.y1} Td 1 0 0 1 ${item.x2 - item.x1} ${item.y2 - item.y1} Td ET`;
      }
      const safe = String(item.value)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
      return `BT /F1 ${item.fontSize || 10} Tf 1 0 0 1 ${item.x} ${item.y} Tm (${safe}) Tj ET`;
    }).join('\n');

    const encoded = new TextEncoder().encode(lines);
    const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length ${encoded.length} >>\nstream\n${lines}\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\ntrailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n0\n%%EOF`;

    if (type === 'arraybuffer') {
      return new TextEncoder().encode(pdf).buffer;
    }

    return new Blob([pdf], { type: 'application/pdf' });
  }

  save(fileName) {
    const blob = this.output('blob');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return blob;
  }
}

export default jsPDF;

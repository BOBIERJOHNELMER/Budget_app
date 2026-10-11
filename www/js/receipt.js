import { jsPDF } from './lib/jspdf.js';
import { CURRENCY_SYMBOL, formatMoney, formatDateTime, sanitizeText } from './state.js';

const getFilename = (prefix) => `${prefix}_${new Date().toISOString().slice(0, 10)}_${new Date().toTimeString().slice(0, 5).replace(':', '')}.pdf`;
const receiptText = (value) => sanitizeText(value).replace(/[^\x20-\x7E]/g, '?');
const receiptMoney = (cents) => formatMoney(Number(cents)).replace(CURRENCY_SYMBOL, 'PHP ');

export function buildReceiptText(transaction) {
  const items = transaction.items || [];
  const grouped = items.reduce((acc, item) => {
    const store = item.store || 'General';
    acc[store] = acc[store] || [];
    acc[store].push(item);
    return acc;
  }, {});

  const storeLines = Object.entries(grouped).flatMap(([store, list]) => {
    const storeTotal = list.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
    const lines = [
      `Store: ${receiptText(store)}`,
      ...list.map((item) => `${item.qty}x ${receiptText(item.name)} - ${receiptMoney(Number(item.price))} = ${receiptMoney(Number(item.price) * Number(item.qty))}`),
      `Sub-total: ${receiptMoney(storeTotal)}`,
      '---'
    ];
    return lines;
  });

  return [
    'SalaryWise',
    'Simulated Purchase',
    `Date: ${formatDateTime(transaction.timestamp)}`,
    `Transaction ID: ${receiptText(transaction.id)}`,
    '----------------------------------------',
    ...storeLines,
    ...(Number(transaction.additionalCharges || 0) > 0
      ? [`Additional charges: ${receiptMoney(Number(transaction.additionalCharges))}`]
      : []),
    `TOTAL: ${receiptMoney(Number(transaction.total))}`,
    `Balance before: ${receiptMoney(Number(transaction.balanceBefore))}`,
    `Balance after: ${receiptMoney(Number(transaction.balanceAfter))}`,
    'Thank you / Simulated purchase',
    '----------------------------------------'
  ].join('\n');
}

export function buildReceiptPdfBlob(transaction) {
  const doc = new jsPDF();
  const pageWidth = doc.internal?.pageSize?.getWidth?.() || doc.pageWidth || 595;
  const pageHeight = doc.internal?.pageSize?.getHeight?.() || doc.pageHeight || 842;
  const left = 18;
  const right = pageWidth - 18;
  const lineHeight = 18;
  let y = 18;
  const textAt = (value, x, top) => doc.text(value, x, pageHeight - top);
  const lineAt = (x1, top1, x2, top2) => doc.line(x1, pageHeight - top1, x2, pageHeight - top2);

  const ensureSpace = (height = lineHeight) => {
    if (y + height > pageHeight - 18) {
      doc.addPage();
      y = 18;
    }
  };

  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  textAt('SalaryWise', left, y);
  y += 25;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  textAt('Simulated Purchase', left, y);
  y += 18;
  textAt(`Date: ${formatDateTime(transaction.timestamp)}`, left, y);
  y += 18;
  textAt(`Transaction ID: ${receiptText(transaction.id)}`, left, y);
  y += 20;
  lineAt(left, y, right, y);
  y += 20;
  const items = transaction.items || [];
  items.forEach((item) => {
    ensureSpace(lineHeight * 4);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    textAt(receiptText(item.name).slice(0, 80), left, y);
    y += 16;
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    textAt(`Market: ${receiptText(item.store || 'General')}`, left, y);
    y += 15;
    doc.setFontSize(10);
    textAt(`Qty: ${Math.max(1, Number(item.qty) || 1)}    Price: ${receiptMoney(Number(item.price))}`, left, y);
    y += 17;
    lineAt(left, y, right, y);
    y += 10;
  });

  ensureSpace(lineHeight * 4);
  lineAt(left, y, right, y);
  y += 20;
  if (Number(transaction.additionalCharges || 0) > 0) {
    doc.setFont(undefined, 'normal');
    textAt(`Additional charges: ${receiptMoney(Number(transaction.additionalCharges))}`, left, y);
    y += 18;
  }
  doc.setFont(undefined, 'bold');
  textAt(`TOTAL: ${receiptMoney(Number(transaction.total))}`, left, y);
  doc.setFont(undefined, 'normal');
  y += 18;
  textAt(`Balance before: ${receiptMoney(Number(transaction.balanceBefore))}`, left, y);
  y += 18;
  textAt(`Balance after: ${receiptMoney(Number(transaction.balanceAfter))}`, left, y);
  y += 7;
  textAt('Thank you / Simulated purchase', left, y);
  return doc.output('blob');
}

export async function saveReceiptFile(transaction) {
  const safeId = sanitizeText(transaction.id || 'receipt').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `receipt_${new Date().toISOString().slice(0, 10)}_${new Date().toTimeString().slice(0, 5).replace(':', '')}`;
  const body = buildReceiptText(transaction);

  try {
    const pdfBlob = buildReceiptPdfBlob(transaction);
    if (window.cordova && cordova.file && window.resolveLocalFileSystemURL) {
      const roots = [
        cordova.file.externalRootDirectory ? `${cordova.file.externalRootDirectory}Download/` : null,
        cordova.file.externalDataDirectory,
        cordova.file.documentsDirectory,
        cordova.file.dataDirectory
      ].filter(Boolean);
      for (const rootDir of roots) {
        try {
          const record = await writeReceiptToDirectory(rootDir, fileName, pdfBlob);
          if (record) return record;
        } catch (error) {
          console.warn('Receipt location unavailable:', rootDir, error);
        }
      }
    }

    const fallbackUrl = URL.createObjectURL(pdfBlob);
    return { fileName: `${fileName}.pdf`, path: fallbackUrl, blob: pdfBlob, type: 'pdf' };
  } catch (error) {
    const fallbackPdf = buildReceiptPdfBlob(transaction);
    return { fileName: `${fileName}.pdf`, path: URL.createObjectURL(fallbackPdf), blob: fallbackPdf, type: 'pdf' };
  }
}

function writeReceiptToDirectory(rootDir, fileName, pdfBlob) {
  return new Promise((resolve, reject) => {
    window.resolveLocalFileSystemURL(rootDir, (rootEntry) => {
      rootEntry.getDirectory('SalaryWise', { create: true }, (salaryDir) => {
        salaryDir.getDirectory('Receipts', { create: true }, (receiptDir) => {
          receiptDir.getFile(`${fileName}.pdf`, { create: true, exclusive: false }, (fileEntry) => {
            fileEntry.createWriter((writer) => {
              writer.onwriteend = () => resolve({ fileName: `${fileName}.pdf`, path: fileEntry.nativeURL || fileEntry.fullPath, type: 'pdf' });
              writer.onerror = () => reject(new Error('Failed to write receipt PDF.'));
              writer.write(pdfBlob);
            }, reject);
          }, reject);
        }, reject);
      }, reject);
    }, reject);
  });
}

export async function openReceiptFile(record) {
  if (!record || !window.cordova || !cordova.plugins || !cordova.plugins.fileOpener2) {
    if (record && record.path) {
      if (window.navigator.msSaveOrOpenBlob && record.blob) {
        window.navigator.msSaveOrOpenBlob(record.blob, record.fileName || 'salarywise-receipt.pdf');
        return true;
      }
      const link = document.createElement('a');
      link.href = record.path;
      link.download = record.fileName || 'salarywise-receipt.pdf';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(record.path), 1500);
    }
    return true;
  }

  return new Promise((resolve, reject) => {
    cordova.plugins.fileOpener2.open(record.path, 'application/pdf', {
      error: () => reject(new Error('Unable to open receipt on this device.')),
      success: () => resolve(true)
    });
  });
}

export function getReceiptFileName() {
  return `${new Date().toISOString().slice(0, 10).replace(/-/g, '-')}_${new Date().toTimeString().slice(0, 5).replace(':', '')}`;
}

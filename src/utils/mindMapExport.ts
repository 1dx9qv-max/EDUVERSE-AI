import type { MindMapDocument, MindMapNodeCategory } from '../types/phase3.ts';
import { computeMindMapLayout } from './mindMapEngine.ts';

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Pure deterministic PDF 1.4 binary builder wrapping a single high-res JPEG raster
 * with valid cross-reference table and %%EOF trailer. Zero external library dependencies.
 */
export function buildPdfFromJpegBytes(
  jpegBytes: Uint8Array,
  imageWidthPx: number,
  imageHeightPx: number
): Uint8Array {
  const safeW = Math.max(100, Math.round(imageWidthPx));
  const safeH = Math.max(100, Math.round(imageHeightPx));

  // Scale canvas proportionally to fit A4 Landscape (842 x 595 pt) cleanly with margin
  const pageW = 842;
  const pageH = 595;
  const margin = 20;
  const maxDrawW = pageW - margin * 2;
  const maxDrawH = pageH - margin * 2;
  const scale = Math.min(maxDrawW / safeW, maxDrawH / safeH);
  const drawW = Number((safeW * scale).toFixed(2));
  const drawH = Number((safeH * scale).toFixed(2));
  const offsetX = Number(((pageW - drawW) / 2).toFixed(2));
  const offsetY = Number(((pageH - drawH) / 2).toFixed(2));

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let bytePos = 0;

  const pushStr = (s: string) => {
    const b = encoder.encode(s);
    chunks.push(b);
    bytePos += b.length;
  };
  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    bytePos += b.length;
  };

  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // 1: Catalog
  offsets.push(bytePos);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2: Pages
  offsets.push(bytePos);
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // 3: Page
  offsets.push(bytePos);
  pushStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  // 4: Image XObject (DCTDecode JPEG)
  offsets.push(bytePos);
  pushStr(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${safeW} /Height ${safeH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  pushBytes(jpegBytes);
  pushStr('\nendstream\nendobj\n');

  // 5: Content stream
  const contentStream = `q\n${drawW} 0 0 ${drawH} ${offsetX} ${offsetY} cm\n/Im0 Do\nQ\n`;
  offsets.push(bytePos);
  pushStr(`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`);

  // Cross-reference table
  const xrefStart = bytePos;
  pushStr(`xref\n0 ${offsets.length}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  const out = new Uint8Array(bytePos);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

const CATEGORY_COLORS: Record<MindMapNodeCategory, { fill: string; stroke: string; text: string }> = {
  root: { fill: '#312e81', stroke: '#818cf8', text: '#ffffff' },
  pillar: { fill: '#1e293b', stroke: '#38bdf8', text: '#f8fafc' },
  concept: { fill: '#0f172a', stroke: '#6366f1', text: '#e2e8f0' },
  formula: { fill: '#1e1b4b', stroke: '#a855f7', text: '#f3e8ff' },
  example: { fill: '#064e3b', stroke: '#34d399', text: '#ecfdf5' },
};

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function renderMindMapToCanvas(map: MindMapDocument): HTMLCanvasElement {
  const layout = computeMindMapLayout(map.nodes, map.crossLinks);
  const headerH = 88;
  const footerH = 44;
  const totalW = Math.max(1000, layout.width);
  const totalH = layout.height + headerH + footerH;
  const dpr = 1.5;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(totalW * dpr);
  canvas.height = Math.round(totalH * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.scale(dpr, dpr);

  // Clean deep navy academic backdrop
  ctx.fillStyle = '#090d1a';
  ctx.fillRect(0, 0, totalW, totalH);

  // Subtle dot grid
  ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
  for (let gx = 24; gx < totalW; gx += 32) {
    for (let gy = headerH + 16; gy < totalH - footerH; gy += 32) {
      ctx.fillRect(gx, gy, 1.5, 1.5);
    }
  }

  // Header metadata bar
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, totalW, headerH);
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, headerH);
  ctx.lineTo(totalW, headerH);
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 22px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(map.title, 32, 38);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    `EDUVERSE AI  ·  ${map.board}  ·  ${map.classGrade}  ·  ${map.subject}  ·  ${map.language}`,
    32,
    64
  );

  ctx.save();
  ctx.translate(0, headerH);

  // Cross-links (dashed amber curves)
  for (const cl of layout.visibleCrossLinks) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cl.x1, cl.y1);
    const ctrlX = (cl.x1 + cl.x2) / 2 + 40;
    const ctrlY = Math.min(cl.y1, cl.y2) - 48;
    ctx.quadraticCurveTo(ctrlX, ctrlY, cl.x2, cl.y2);
    ctx.stroke();
    ctx.restore();
  }

  // Parent-Child curved connectors + relationship labels
  for (const edge of layout.edges) {
    const midX = (edge.x1 + edge.x2) / 2;
    ctx.strokeStyle = 'rgba(129, 140, 248, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(edge.x1, edge.y1);
    ctx.bezierCurveTo(midX, edge.y1, midX, edge.y2, edge.x2, edge.y2);
    ctx.stroke();

    if (edge.label) {
      const lx = midX;
      const ly = (edge.y1 + edge.y2) / 2;
      ctx.font = '600 10px "Plus Jakarta Sans", system-ui, sans-serif';
      const tw = ctx.measureText(edge.label).width + 12;
      ctx.fillStyle = '#1e293b';
      drawRoundedRect(ctx, lx - tw / 2, ly - 9, tw, 18, 6);
      ctx.fill();
      ctx.fillStyle = '#c7d2fe';
      ctx.textAlign = 'center';
      ctx.fillText(edge.label, lx, ly + 3);
      ctx.textAlign = 'left';
    }
  }

  // Nodes
  for (const item of layout.positionedNodes) {
    const palette = CATEGORY_COLORS[item.node.category] || CATEGORY_COLORS.concept;
    ctx.fillStyle = palette.fill;
    ctx.strokeStyle = palette.stroke;
    ctx.lineWidth = item.depth === 0 ? 2.4 : 1.5;
    drawRoundedRect(ctx, item.x, item.y, item.width, item.height, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = palette.text;
    ctx.font = item.depth === 0
      ? 'bold 14px "Plus Jakarta Sans", system-ui, sans-serif'
      : '600 12.5px "Plus Jakarta Sans", system-ui, sans-serif';
    const lines = wrapCanvasText(ctx, item.node.label, item.width - 24);
    lines.forEach((line, idx) => {
      ctx.fillText(line, item.x + 12, item.y + 24 + idx * 16);
    });

    if (item.node.hindiLabel) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText(item.node.hindiLabel.slice(0, 28), item.x + 12, item.y + item.height - 12);
    }
  }

  ctx.restore();

  // Footer disclaimer
  ctx.fillStyle = '#64748b';
  ctx.font = '11px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    map.syllabusNote || 'Generated conceptual mind map — confirm exact board weightage with your verified curriculum.',
    32,
    totalH - 16
  );

  return canvas;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function exportMindMapAsPng(map: MindMapDocument): Promise<string> {
  const canvas = renderMindMapToCanvas(map);
  const slug = (map.topic || 'mindmap').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'mindmap';
  const fileName = `eduverse-mindmap-${slug}.png`;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to generate PNG image from mind map canvas.'));
    }, 'image/png');
  });

  triggerBlobDownload(blob, fileName);
  return fileName;
}

export function exportMindMapAsPdf(map: MindMapDocument): string {
  const canvas = renderMindMapToCanvas(map);
  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.94);
  const base64Part = jpegDataUrl.split(',')[1] || '';
  const jpegBytes = base64ToUint8Array(base64Part);
  const pdfBytes = buildPdfFromJpegBytes(jpegBytes, canvas.width, canvas.height);

  const slug = (map.topic || 'mindmap').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'mindmap';
  const fileName = `eduverse-mindmap-${slug}.pdf`;
  const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
  new Uint8Array(pdfBuffer).set(pdfBytes);
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
  triggerBlobDownload(blob, fileName);
  return fileName;
}

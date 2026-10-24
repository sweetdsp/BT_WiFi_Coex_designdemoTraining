// Browser-side exports (spec 7B.12): SVG, PNG, CSV, JSON and a one-page PDF. Nothing leaves the browser.
import type { EngineResult } from '../engine';
import { blocksCsv } from './csv';
export { download, fileSafe } from './download';

const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor'];

/** Copy the computed look of every element into the clone so the file looks the same outside the page (colour variables resolved). */
function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  let style = '';
  for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v) style += `${p}:${v};`; }
  (dst as SVGElement).setAttribute('style', style);
  for (let i = 0; i < src.children.length; i++) if (dst.children[i]) inlineStyles(src.children[i], dst.children[i]);
}

export interface SvgLabel { text: string; y: number; bold?: boolean }

/** A standalone SVG of one diagram. Optional row labels are drawn in a left column so the lane names are in the file too. */
export function svgFrom(svg: SVGSVGElement, opts: { title: string; labels?: SvgLabel[]; labelWidth?: number; bg: string; fg: string }): { text: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  const w0 = svg.width.baseVal.value, h0 = svg.height.baseVal.value;
  const lw = opts.labels ? opts.labelWidth ?? 180 : 0, top = 28;
  const W = w0 + lw, H = h0 + top;
  const ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('xmlns', ns); root.setAttribute('width', String(W)); root.setAttribute('height', String(H)); root.setAttribute('viewBox', `0 0 ${W} ${H}`);
  root.setAttribute('role', 'img'); root.setAttribute('aria-label', opts.title);
  const t = document.createElementNS(ns, 'title'); t.textContent = opts.title; root.appendChild(t);
  const bg = document.createElementNS(ns, 'rect'); bg.setAttribute('width', String(W)); bg.setAttribute('height', String(H)); bg.setAttribute('fill', opts.bg); root.appendChild(bg);
  const head = document.createElementNS(ns, 'text'); head.setAttribute('x', '8'); head.setAttribute('y', '18'); head.setAttribute('font-size', '14'); head.setAttribute('font-family', 'sans-serif'); head.setAttribute('fill', opts.fg); head.textContent = opts.title; root.appendChild(head);
  for (const l of opts.labels ?? []) {
    const e = document.createElementNS(ns, 'text'); e.setAttribute('x', '8'); e.setAttribute('y', String(top + l.y)); e.setAttribute('font-size', '12'); e.setAttribute('font-family', 'sans-serif'); e.setAttribute('fill', opts.fg); if (l.bold) e.setAttribute('font-weight', '700'); e.textContent = l.text; root.appendChild(e);
  }
  const g = document.createElementNS(ns, 'g'); g.setAttribute('transform', `translate(${lw},${top})`);
  // Interactive-only parts do not belong in a picture.
  clone.querySelectorAll('[data-testid="time-cursor"]').forEach((n) => n.remove());
  g.appendChild(clone); root.appendChild(g);
  return { text: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}`, width: W, height: H };
}

/** Lane and group labels of the time view, positioned from the page so they line up with the diagram. */
export function timeViewLabels(section: Element): SvgLabel[] {
  const col = section.querySelector('.tv-labels') as HTMLElement | null;
  if (!col) return [];
  const base = col.getBoundingClientRect().top;
  const out: SvgLabel[] = [];
  col.querySelectorAll('.tv-group, .tv-lane-label').forEach((el) => {
    const r = el.getBoundingClientRect();
    const name = el.classList.contains('tv-group') ? el.textContent!.replace(/[▸▾]/g, '').trim() : el.querySelector('.lane-name')?.textContent ?? '';
    out.push({ text: name, y: r.top - base + r.height / 2 + 4, bold: el.classList.contains('tv-group') });
  });
  return out;
}

export function svgToPngBlob(svgText: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = Math.round(width * scale); c.height = Math.round(height * scale);
      const x = c.getContext('2d')!; x.scale(scale, scale); x.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be created.'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The picture could not be created.')); };
    img.src = url;
  });
}

export const resultJson = (r: EngineResult) => JSON.stringify({ format: 'coex-result', version: 1, config: r.config, metrics: r.metrics, conflicts: r.conflicts, decisions: r.decisions, afh: r.afh, blocks: r.blocks }, null, 1);
export { blocksCsv };

export interface PdfInput { result: EngineResult; png?: { blob: Blob; width: number; height: number }; lines: string[]; conflictLines: string[]; footer: string }

/** One page: the diagram, the headline numbers, and the explanations of the most serious conflicts. */
export async function makePdf(inp: PdfInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth(), M = 28;
  let y = M + 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(inp.result.config.name, M, y); y += 18;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  if (inp.png) {
    const url = await new Promise<string>((res) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.readAsDataURL(inp.png!.blob); });
    const maxW = W - 2 * M, h = Math.min(190, (inp.png.height / inp.png.width) * maxW), w = (inp.png.width / inp.png.height) * h;
    doc.addImage(url, 'PNG', M, y, Math.min(maxW, w), h); y += h + 10;
  }
  for (const l of inp.lines) { doc.text(l, M, y); y += 11; }
  y += 6; doc.setFont('helvetica', 'bold'); doc.text('Most serious conflicts', M, y); y += 12; doc.setFont('helvetica', 'normal');
  for (const l of inp.conflictLines) { for (const part of doc.splitTextToSize(l, W - 2 * M) as string[]) { if (y > doc.internal.pageSize.getHeight() - 30) break; doc.text(part, M, y); y += 11; } }
  doc.setFontSize(8); doc.text(inp.footer, M, doc.internal.pageSize.getHeight() - 14);
  return doc.output('blob');
}

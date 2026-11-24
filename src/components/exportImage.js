// Сохранение схемы картинкой: svg → файл (SVG как есть, PNG — через canvas, вдвое чётче).
export async function saveSvg(svgEl, { width, height, pad = 24, bg = '#0E1310', name = 'схема', ext = 'png', prepare } = {}) {
  const clone = svgEl.cloneNode(true);
  clone.querySelectorAll('[data-noexport]').forEach((n) => n.remove());
  if (prepare) prepare(clone, pad);
  const w = Math.ceil(width + pad * 2), h = Math.ceil(height + pad * 2);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w)); clone.setAttribute('height', String(h));
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  clone.removeAttribute('class'); clone.removeAttribute('style');
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  r.setAttribute('width', String(w)); r.setAttribute('height', String(h)); r.setAttribute('fill', bg);
  clone.insertBefore(r, clone.firstChild);
  const text = new XMLSerializer().serializeToString(clone);
  let data = text;
  if (ext === 'png') {
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('не удалось нарисовать')); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`; });
    const scale = Math.min(2, 16000 / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    data = cv.toDataURL('image/png').split(',')[1];
  }
  return window.mimis.saveImage(name, ext, data);
}

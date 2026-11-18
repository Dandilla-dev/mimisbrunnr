import { useEffect, useState } from 'react';

// ---- код файла: грузим из главного процесса, держим в памяти ----
const codeCache = new Map();
export function useCode(view, file) {
  const key = `${view.id}:${view.commit?.hash}:${file}`;
  const [code, setCode] = useState(codeCache.get(key) ?? null);
  useEffect(() => {
    let alive = true;
    if (codeCache.has(key)) { setCode(codeCache.get(key)); return undefined; }
    setCode(null);
    window.mimis.code(view.id, file).then((c) => { codeCache.set(key, c || ''); if (alive) setCode(c || ''); });
    return () => { alive = false; };
  }, [key, view.id, file]);
  return code;
}


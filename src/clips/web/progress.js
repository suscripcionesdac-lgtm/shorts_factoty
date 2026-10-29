// Texto corto del avance de una descarga para la ficha de cada video. yt-dlp manda lineas como
// «45.3% of ~ 1.20GiB at 3.10MiB/s ETA 02:10 (frag 3/50)»: en la ficha cabe «descargando 45 % · quedan 2:10».

/** Etiqueta de la ficha; sin porcentaje, el aviso tal cual (p. ej. «preparando el video…»). */
export function dlShort(progress) {
  const m = /([\d.]+)%/.exec(progress || '');
  if (!m) return progress || 'descargando';
  const eta = /ETA\s+([\d:]+)/.exec(progress), left = eta && !/^0?0:00$/.test(eta[1]) ? ` · quedan ${eta[1].replace(/^0(\d:)/, '$1')}` : '';
  return `descargando ${Math.floor(+m[1])} %${left}`;
}

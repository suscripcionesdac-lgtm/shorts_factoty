/** Transiciones: categorias y miniaturas. */
import { $, esc, fmt } from '/web/app.js';
import { joinOn, segs } from './geometry.js';
import { assetsCache, E } from './state.js';

// ---------- transiciones: categorias en pestañas y miniaturas que se mueven al pasar el raton ----------
/** Las que mas se usan en shorts (destellos, humo, zoom de golpe, latigazos): la primera pestaña. */
const TRANS_PICKS = ['flash', 'smoke', 'zoom-punch', 'whip-left', 'zoom-through', 'glitch', 'spin', 'light-leak', 'flash-zoom', 'shake', 'fade', 'slideleft'];
export const transInfo = (id) => (assetsCache?.transitions || []).find((t) => t.id === id);
const tprev = (id, kind) => `/api/transprev?id=${encodeURIComponent(id)}${kind === 'mp4' ? '&kind=mp4' : ''}`;
const tvideo = (id) => `<video src="${tprev(id, 'mp4')}" muted loop autoplay playsinline aria-hidden="true"></video>`;
export function transPanel(part) {
  const sp = E.spec, all = assetsCache.transitions || [], cats = ['Populares', ...new Set(all.map((t) => t.cat))];
  const cat = cats.includes(E.tcat) ? E.tcat : 'Populares';
  const list = cat === 'Populares' ? TRANS_PICKS.map(transInfo).filter(Boolean) : all.filter((t) => t.cat === cat);
  const cur = transInfo(sp.transition), joins = segs().length - 1, canHook = E.dur >= 12, d = sp.transDur || cur?.dur || 0.4;
  const tile = (t) => {
    const on = sp.transition === t.id;
    return `<button class="ttile ${on ? 'on' : ''}" data-e="settrans" data-k="${t.id}" aria-pressed="${on}"><span class="tthumb"><img loading="lazy" alt="" width="120" height="160" src="${tprev(t.id)}" />${on ? tvideo(t.id) : ''}</span><span class="tname">${esc(t.name)}</span></button>`;
  };
  const none = `<button class="ttile ${cur ? '' : 'on'}" data-e="settrans" data-k="" aria-pressed="${!cur}"><span class="tthumb tnone" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8"/></svg></span><span class="tname">Ninguna</span></button>`;
  const hidden = cur && !(sp.hook && canHook) && !segs().slice(1).some((x) => joinOn(x.a));
  if (part === 'lib') return `<div class="tcats" role="tablist" aria-label="Categorías de transiciones">${cats.map((c) => `<button role="tab" class="${c === cat ? 'on' : ''}" aria-selected="${c === cat}" data-e="tcat" data-k="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="tgrid">${cat === 'Populares' ? none : ''}${list.map(tile).join('')}</div>
    <div class="mut lnote">Pasa el ratón por encima para verlas en movimiento y toca una para usarla.</div>`;
  return `<h2>Transiciones</h2>
    ${cur ? `<div class="tset">
      <div class="row"><b class="grow">${esc(cur.name)}</b><span class="mut">${esc(cur.cat)}</span></div>
      <label class="f">Duración <output id="tdur" class="mono">${d.toFixed(1)} s</output><input type="range" data-i="transDur" min="2" max="12" step="1" value="${Math.round(d * 10)}" /></label>
      <div class="mut" style="margin:12px 0 4px">Dónde se aplica</div>
      <label class="c"><input type="checkbox" data-i="hook" ${sp.hook ? 'checked' : ''} ${canHook ? '' : 'disabled'} /> Después del gancho${canHook ? '' : ' (el clip es muy corto)'}</label>
      <label class="c"><input type="checkbox" data-i="transCuts" ${sp.transCuts ? 'checked' : ''} ${joins ? '' : 'disabled'} /> En cada corte${joins ? ` (${joins})` : ' (este clip no tiene cortes)'}</label>
      ${joins && !sp.transCuts ? segs().slice(1).map((x) => `<label class="c"><input type="checkbox" data-e="transjoin" data-k="${x.a}" ${joinOn(x.a) ? 'checked' : ''} /> Corte en ${fmt(x.a)}</label>`).join('') : ''}
      ${hidden ? '<div class="twarn">Así no se verá: marca «Después del gancho» o «En cada corte».</div>' : sp.transCuts && joins > 4 ? `<div class="twarn">${joins} cortes con la misma transición se ve recargado: los clips que funcionan cortan en seco y la usan una o dos veces.</div>` : ''}
    </div>` : '<div class="mut" style="margin-top:10px">Elige una en «Transición», a la izquierda.</div>'}
    <div class="mut" style="margin-top:10px">En tu clip se ven al exportar. Cada transición acorta el clip lo que dura, porque los dos tramos se solapan.</div>`;
}
/** Menu «Sugerencias» de la linea de tiempo: se cierra al elegir, al hacer clic fuera o con Esc. */
export function closeSug(focus) { const m = $('sugMenu'); if (!m || m.hidden) return false; m.hidden = true; const b = document.querySelector('[data-e=sugmenu]'); b?.setAttribute('aria-expanded', 'false'); if (focus) b?.focus(); return true; }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('.menuwrap')) closeSug(); });
document.addEventListener('click', (e) => { if (e.target.closest?.('#sugMenu [role=menuitem]')) closeSug(); }, true);

/** Miniatura en movimiento: el video solo se carga al pasar el raton o al llegar con el teclado. */
function tilePlay(b, on) {
  const box = b?.querySelector('.tthumb');
  if (!box || !b.dataset.k || b.classList.contains('on')) return;
  const v = box.querySelector('video');
  if (on && !v) box.insertAdjacentHTML('beforeend', tvideo(b.dataset.k));
  else if (!on && v) v.remove();
}
// La rueda del raton desplaza las pestañas de categorias de lado.
document.addEventListener('wheel', (e) => { const t = e.target.closest?.('.tcats'); if (t && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { t.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
for (const [ev, on] of [['pointerover', true], ['pointerout', false], ['focusin', true], ['focusout', false]]) {
  document.addEventListener(ev, (e) => { const b = e.target.closest?.('.ttile'); if (b && !b.contains(e.relatedTarget)) tilePlay(b, on); });
}

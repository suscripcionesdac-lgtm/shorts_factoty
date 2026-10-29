import Anthropic from '@anthropic-ai/sdk';

/**
 * IA opcional, siempre gratis primero: un modelo local con Ollama (por defecto qwen2.5:7b, sin configurar nada).
 * Claude por API es el ultimo recurso: solo si Ollama no esta disponible y hay clave de Anthropic.
 */
const OLLAMA = () => process.env.OLLAMA_URL || 'http://localhost:11434';
export const ollamaModel = () => process.env.OLLAMA_MODEL || 'qwen2.5:7b';
let ollamaOk: boolean | null = null, checkedAt = 0;
/** Si Ollama esta en marcha y tiene el modelo. Se comprueba como mucho una vez por minuto. */
export async function ollamaReady(): Promise<boolean> {
  if (process.env.CLIPPER_NO_AI === '1') return (ollamaOk = false); // pruebas reproducibles, sin IA
  if (ollamaOk != null && Date.now() - checkedAt < 60_000) return ollamaOk;
  checkedAt = Date.now();
  try {
    const j = (await (await fetch(OLLAMA() + '/api/tags', { signal: AbortSignal.timeout(1500) })).json()) as { models?: { name: string }[] };
    const m = ollamaModel();
    const was = ollamaOk;
    ollamaOk = (j.models || []).some((x) => x.name === m || x.name === m + ':latest');
    if (ollamaOk && !was) void fetch(OLLAMA() + '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m, keep_alive: '30m' }) }).catch(() => {});
  } catch { ollamaOk = false; }
  return ollamaOk;
}
void ollamaReady();
const claudeOk = () => !!process.env.ANTHROPIC_API_KEY && process.env.CLIPPER_NO_AI !== '1';

export function llmName(): string | null {
  if (ollamaOk) return 'ollama:' + ollamaModel();
  if (groqOk()) return 'groq:' + groqModel();
  if (claudeOk()) return process.env.LLM_MODEL || 'claude-sonnet-5-5';
  return null;
}

/**
 * Groq (gratis con limite diario, clave en .env: GROQ_API_KEY): un modelo mucho mayor que el local, solo para las
 * tareas dificiles (`smart`). Si falla o se acaba el cupo del dia, se sigue con Ollama.
 */
const groqOk = () => !!process.env.GROQ_API_KEY && process.env.CLIPPER_NO_AI !== '1';
export const groqModel = () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
/** Ultimo fallo de Groq (vacio si la ultima vez fue bien): para decir por que se uso la IA local. */
export let groqError = '';
async function groq(system: string, user: string, o: { temperature?: number; timeoutMs?: number }, retry = true): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.GROQ_API_KEY },
    signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
    body: JSON.stringify({ model: groqModel(), temperature: o.temperature ?? 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  // Demasiadas seguidas (limite por minuto del plan gratis): se espera lo que diga Groq (hasta 30 s) y se reintenta una vez.
  if (res.status === 429 && retry) {
    await new Promise((r) => setTimeout(r, Math.min(30, Number(res.headers.get('retry-after')) || 10) * 1000));
    return groq(system, user, o, false);
  }
  if (!res.ok) throw new Error('Groq respondió ' + res.status);
  return ((await res.json()) as any).choices[0].message.content as string;
}

type Opts = { temperature?: number; timeoutMs?: number; smart?: boolean };
/** Un proveedor de IA. Anadir otro es anadir un objeto a la lista, sin tocar `chat`. `null` = paso al siguiente. */
type Provider = { ready: () => boolean | Promise<boolean>; ask: (system: string, user: string, o: Opts) => Promise<string | null> };

const ollama: Provider = {
  ready: ollamaReady,
  async ask(system, user, o) {
    const res = await fetch(OLLAMA() + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
      body: JSON.stringify({ model: ollamaModel(), stream: false, format: 'json', keep_alive: '30m', options: { temperature: o.temperature ?? 0.3, num_ctx: 8192 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error('Ollama respondió ' + res.status);
    return ((await res.json()) as any).message.content;
  },
};
/** Groq nunca corta la cadena: sin red o sin cupo hoy, se apunta el fallo y sigue el siguiente. */
const groqP: Provider = {
  ready: groqOk,
  async ask(system, user, o) {
    try { const r = await groq(system, user, o); groqError = ''; return r; } catch (e) { groqError = (e as Error).message; return null; }
  },
};
const claude: Provider = {
  ready: claudeOk,
  async ask(system, user) {
    const res = await new Anthropic().messages.create({
      model: process.env.LLM_MODEL || 'claude-sonnet-5-5', max_tokens: 3000, system,
      messages: [{ role: 'user', content: user }],
    });
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  },
};

/**
 * Pregunta a la IA y devuelve su respuesta (JSON). Ollama primero; con `smart` (tareas dificiles) Groq antes si hay
 * clave; Claude solo si no hay ninguna otra.
 */
export async function chat(system: string, user: string, o: Opts = {}): Promise<string> {
  for (const p of o.smart ? [groqP, ollama, claude] : [ollama, groqP, claude]) {
    if (!(await p.ready())) continue;
    const r = await p.ask(system, user, o);
    if (r !== null) return r;
  }
  throw new Error('No hay IA disponible: instala Ollama y su modelo (gratis).');
}

export type Verdict = { id: string; score: number; title: string; why: string };

/** El "agente": lee lo que se dice en cada momento y decide cuales tienen madera de clip. */
export async function judge(streamer: string, items: { id: string; seconds: number; text: string }[]): Promise<Verdict[]> {
  const system = `Eres editor de clips virales de streamers en espanol para TikTok y Shorts.
Recibes un momento candidato de un directo${streamer ? ' de ' + streamer : ''}, con su transcripcion.
Decide si funciona como clip suelto: tiene que entenderse sin contexto, tener un gancho en los primeros 3 segundos y un remate (reaccion, chiste, jugada, polemica, momento emotivo).
Responde SOLO con JSON: {"score":0-10,"title":"titulo de maximo 70 caracteres, sin clickbait falso","why":"una frase"}
Puntua bajo (0-3) lo que es relleno, lectura de chat sin gracia, o ruido sin contenido.`;
  // De uno en uno: muchos momentos juntos pasan del contexto del modelo local, que entonces pierde las instrucciones
  // (se corta el principio) y no devuelve nada; y un modelo pequeño acierta mas con un solo momento.
  const out: Verdict[] = [];
  for (const i of items) {
    try {
      const raw = await chat(system, `(${i.seconds.toFixed(0)} s)\n${i.text || '(sin transcripcion)'}`, { smart: true });
      const c = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      out.push({
        id: i.id, score: Math.max(0, Math.min(10, Number(c.score) || 0)), title: String(c.title || '').slice(0, 100),
        why: String(c.why || ''),
      });
    } catch { /* ese momento se queda con su nota sin IA */ }
  }
  return out;
}

/** Describe lo que se ve en unos fotogramas (IA de vision opcional): muerte, victoria, jugada, reaccion... */
export async function describeFrames(jpegs: Buffer[], game = ''): Promise<{ label: string; boost: number } | null> {
  const prompt = `Son fotogramas consecutivos de un directo de videojuegos${game ? ' (' + game + ')' : ''}. Di en JSON que ocurre: {"label":"muerte|victoria|jugada|susto|reaccion|menu|nada","boost":0-3} donde boost es cuanto merece ser clip.`;
  let raw = '';
  // Gratis primero: el modelo de vision local; Claude solo si no hay uno y se activo expresamente.
  if (process.env.OLLAMA_VISION_MODEL) {
    const res = await fetch(OLLAMA() + '/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.OLLAMA_VISION_MODEL, stream: false, format: 'json', messages: [{ role: 'user', content: prompt, images: jpegs.map((b) => b.toString('base64')) }] }),
    });
    if (!res.ok) return null;
    raw = ((await res.json()) as any).message.content;
  } else if (claudeOk() && process.env.VISION_IA === '1') {
    const res = await new Anthropic().messages.create({
      model: process.env.LLM_MODEL || 'claude-sonnet-5-5', max_tokens: 200,
      messages: [{ role: 'user', content: [...jpegs.map((b) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: b.toString('base64') } })), { type: 'text' as const, text: prompt }] }],
    });
    raw = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  } else return null;
  try {
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    return { label: String(j.label || 'nada'), boost: Math.max(0, Math.min(3, Number(j.boost) || 0)) };
  } catch { return null; }
}
export const hasVision = () => !!process.env.OLLAMA_VISION_MODEL || (claudeOk() && process.env.VISION_IA === '1');

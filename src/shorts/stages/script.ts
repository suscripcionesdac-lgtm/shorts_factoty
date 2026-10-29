import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { Script } from '../types';
import { ROOT, addCost, loadAssets, markStage, runFile, writeJson, hash } from '../runs';

const SCHEMA_HELP = `{
  "format": "confirmado_vs_rumor" | "comparacion" | "historia" | "guia" | "analisis",
  "hook": "primera frase, maximo 90 caracteres",
  "beats": [   // de 4 a 8 frases narradas, una idea por frase
    { "narration": "texto que se lee en voz alta",
      "visual": { "kind": "card" | "image" | "clip", "asset": "archivo.mp4 (solo image/clip)", "startSec": 0, "text": "rotulo corto opcional" },
      "claimIds": ["c1"] }
  ],
  "claims": [  // cada dato comprobable que aparece en la narracion
    { "id": "c1", "text": "afirmacion", "status": "confirmado" | "rumor" | "opinion", "sources": ["https://..."] }
  ],
  "title": "maximo 100 caracteres", "description": "2 o 3 lineas", "hashtags": ["#GTA6"]
}`;

export function manualTemplate(topic: string): Script {
  return {
    format: 'analisis',
    hook: `ESCRIBE AQUI EL GANCHO SOBRE: ${topic}`.slice(0, 90),
    beats: [
      { narration: 'Primera frase: el gancho, dicho en voz alta.', visual: { kind: 'card', text: 'GANCHO' }, claimIds: [] },
      { narration: 'Segunda frase: el dato o la idea principal.', visual: { kind: 'card', text: 'IDEA' }, claimIds: [] },
      { narration: 'Tercera frase: el cierre, con una pregunta.', visual: { kind: 'card', text: 'CIERRE' }, claimIds: [] },
    ],
    claims: [],
    title: topic.slice(0, 100),
    description: topic,
    hashtags: [],
  };
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

export async function generateScript(id: string, topic: string, notes = '') {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Falta ANTHROPIC_API_KEY en .env. Alternativa sin clave: new "<tema>" --manual');
  }
  const client = new Anthropic();
  const model = process.env.LLM_MODEL || 'claude-sonnet-5-5';
  const channel = fs.readFileSync(path.join(ROOT, 'channel.md'), 'utf8');
  const assets = loadAssets();
  const assetList = assets.length
    ? assets.map((a) => `- ${a.file} (${a.origen}${a.autor ? ', de ' + a.autor : ''}${a.nota ? ': ' + a.nota : ''})`).join('\n')
    : '(no hay archivos: usa solo visual "card")';

  const system = `Eres el guionista de un canal de videos cortos verticales. Sigue esta guia editorial:\n\n${channel}\n
Reglas:
- Busca en la web antes de escribir. Fecha de hoy: ${new Date().toISOString().slice(0, 10)}.
- Cada dato comprobable va en "claims" con la URL donde lo leiste. Solo es "confirmado" lo que publica la fuente primaria (el estudio o la editora) o prensa que la cita. Lo demas es "rumor" y la narracion debe decir que es un rumor.
- No inventes fechas, cifras ni citas. Si no encuentras fuente, no lo afirmes.
- La narracion aporta analisis propio: explica por que importa, no leas la noticia.
- Para "visual" solo puedes usar estos archivos de public/assets:\n${assetList}
- Responde SOLO con un objeto JSON con esta forma:\n${SCHEMA_HELP}`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Tema del video: ${topic}\n${notes ? 'Indicaciones mias: ' + notes : ''}` },
  ];

  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await client.messages.create({
      model,
      max_tokens: 4000,
      system,
      messages,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as any],
    });
    addCost(id, 'script', model, res.usage.input_tokens + res.usage.output_tokens, 'tokens', 0);
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
    try {
      const parsed = Script.safeParse(extractJson(text));
      if (parsed.success) {
        writeJson(runFile(id, 'script.json'), parsed.data);
        markStage(id, 'script', { hash: hash(parsed.data) });
        return parsed.data;
      }
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (e) {
      lastError = 'La respuesta no era JSON valido: ' + (e as Error).message;
    }
    messages.push({ role: 'assistant', content: text || '(vacio)' });
    messages.push({ role: 'user', content: `El JSON no paso la validacion: ${lastError}. Corrigelo y responde solo con el JSON completo.` });
  }
  throw new Error('No se obtuvo un guion valido tras 3 intentos. Ultimo error: ' + lastError);
}

import { afterEach, describe, expect, it, vi } from 'vitest';

// Groq y Ollama falsos: se mira a quien pregunta chat() y que hace cuando Groq dice 429 o falla.
const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
async function load(groqReplies: Response[]) {
  vi.resetModules();
  process.env.GROQ_API_KEY = 'x';
  delete process.env.CLIPPER_NO_AI;
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url).includes('groq') ? 'groq' : String(url).includes('/api/tags') ? 'tags' : 'ollama');
    if (String(url).includes('groq')) return groqReplies.shift()!;
    if (String(url).includes('/api/tags')) return ok({ models: [{ name: 'qwen2.5:7b' }] });
    return ok({ message: { content: '{"de":"ollama"}' } });
  });
  return { llm: await import('../src/clips/ai/llm'), calls };
}
afterEach(() => { vi.unstubAllGlobals(); delete process.env.GROQ_API_KEY; });

describe('IA en la nube (Groq) para las tareas dificiles', () => {
  it('con «smart» pregunta a Groq; tras un 429 espera y reintenta una vez', async () => {
    const { llm, calls } = await load([ok({}, 429, { 'retry-after': '0.01' }), ok({ choices: [{ message: { content: '{"de":"groq"}' } }] })]);
    expect(await llm.chat('s', 'u', { smart: true })).toBe('{"de":"groq"}');
    expect(calls.filter((c) => c === 'groq')).toHaveLength(2);
    expect(llm.groqError).toBe('');
  });
  it('si Groq sigue fallando, contesta la IA local y queda dicho por que', async () => {
    const { llm } = await load([ok({}, 500)]);
    expect(await llm.chat('s', 'u', { smart: true })).toBe('{"de":"ollama"}');
    expect(llm.groqError).toMatch(/500/);
  });
  it('sin «smart» no gasta cupo de Groq', async () => {
    const { llm, calls } = await load([]);
    expect(await llm.chat('s', 'u')).toBe('{"de":"ollama"}');
    expect(calls).not.toContain('groq');
  });
});

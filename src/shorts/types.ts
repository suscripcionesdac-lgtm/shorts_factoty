import { z } from 'zod';

export const Visual = z.object({
  kind: z.enum(['card', 'image', 'clip']),
  /** Nombre de archivo dentro de public/assets (obligatorio en image y clip). */
  asset: z.string().optional(),
  /** Segundo del clip desde el que empieza a reproducirse. */
  startSec: z.number().min(0).optional(),
  /** Texto grande en pantalla (tarjetas) o rotulo corto sobre imagen/clip. */
  text: z.string().max(80).optional(),
});

export const Beat = z.object({
  narration: z.string().min(3),
  visual: Visual,
  claimIds: z.array(z.string()).default([]),
});

export const Claim = z.object({
  id: z.string(),
  text: z.string(),
  status: z.enum(['confirmado', 'rumor', 'opinion']),
  sources: z.array(z.string().url()).default([]),
});

export const Script = z
  .object({
    format: z.enum(['confirmado_vs_rumor', 'comparacion', 'historia', 'guia', 'analisis']),
    hook: z.string().max(90),
    beats: z.array(Beat).min(3).max(10),
    claims: z.array(Claim).default([]),
    title: z.string().max(100),
    description: z.string(),
    hashtags: z.array(z.string()).max(5).default([]),
  })
  .superRefine((s, ctx) => {
    const ids = new Set(s.claims.map((c) => c.id));
    for (const c of s.claims) {
      if (c.status !== 'opinion' && c.sources.length === 0) {
        ctx.addIssue({ code: 'custom', message: `La afirmacion "${c.id}" (${c.status}) no tiene fuente` });
      }
    }
    s.beats.forEach((b, i) => {
      for (const id of b.claimIds) {
        if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `Frase ${i + 1}: claimId "${id}" no existe` });
      }
      if (b.visual.kind !== 'card' && !b.visual.asset) {
        ctx.addIssue({ code: 'custom', message: `Frase ${i + 1}: visual "${b.visual.kind}" necesita "asset"` });
      }
    });
  });

export type Script = z.infer<typeof Script>;

export const Asset = z.object({
  file: z.string(),
  /** propio = lo grabaste tu; permiso = el autor te autorizo; oficial = material de prensa/trailer; licencia = stock o musica con licencia */
  origen: z.enum(['propio', 'permiso', 'oficial', 'licencia']),
  autor: z.string().optional(),
  url: z.string().optional(),
  nota: z.string().optional(),
});
export type Asset = z.infer<typeof Asset>;

export type VoiceMode = 'recorded' | 'clone' | 'none';

export type VoiceBeat = {
  file: string; // relativo a public/
  durationSec: number;
  hash: string;
  /** Marcas por caracter (solo voz clonada por API). */
  alignment?: { chars: string[]; starts: number[]; ends: number[] };
};
export type VoiceFile = { mode: VoiceMode; beats: VoiceBeat[] };

import WebSocket from 'ws';

/**
 * Lee el chat del directo mientras se graba y cuenta mensajes por segundo.
 * Twitch: IRC anonimo. Kick: su canal publico de Pusher.
 */
const HYPE = /clip|jaj|kekw|lol|lmao|xd+|omg|wtf|no+ puede|nooo|😂|💀|🔥|pog|gg/i;

const CLIP = /(^|\s)!?(clip|clipea|clipeen|clipealo|clipéalo|clipenlo|clippeen)(\s|$|!)/i;

export type ChatData = { rate: number[]; hype: number[]; clip?: number[] };

export class ChatTap {
  data: ChatData = { rate: [], hype: [], clip: [] };
  /** Ultimos mensajes, para verlos en la app mientras se graba. No se guardan en disco. */
  recent: { t: number; u: string; m: string; h?: boolean }[] = [];
  status = 'conectando';
  private ws?: WebSocket;
  private closed = false;
  constructor(private url: string, private t0: () => number) {}

  private add(text: string, user = '') {
    const i = Math.max(0, Math.floor((Date.now() - this.t0()) / 1000));
    this.recent.push({ t: i, u: user.slice(0, 30), m: text.slice(0, 200), h: HYPE.test(text) || CLIP.test(text) || undefined });
    if (this.recent.length > 80) this.recent.splice(0, this.recent.length - 80);
    while (this.data.rate.length <= i) this.data.rate.push(0), this.data.hype.push(0), this.data.clip!.push(0);
    this.data.rate[i]++;
    if (HYPE.test(text)) this.data.hype[i]++;
    if (CLIP.test(text)) this.data.clip![i]++;
  }

  async start() {
    try {
      const u = new URL(this.url);
      const channel = u.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
      if (!channel) throw new Error('enlace sin canal');
      if (u.hostname.includes('twitch.tv')) this.twitch(channel);
      else if (u.hostname.includes('kick.com')) await this.kick(channel);
      else this.status = 'no disponible en esta plataforma';
    } catch (e) {
      const m = (e as Error).message;
      this.status = /fetch failed|ENOTFOUND|ECONN/i.test(m) ? 'no se pudo conectar con el chat' : 'sin chat: ' + m.slice(0, 80);
    }
    return this;
  }

  private twitch(channel: string) {
    const ws = (this.ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'));
    ws.on('open', () => {
      ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
      ws.send('JOIN #' + channel);
      this.status = 'leyendo chat';
    });
    ws.on('message', (d) => {
      for (const line of String(d).split('\r\n')) {
        if (line.startsWith('PING')) ws.send('PONG :tmi.twitch.tv');
        const m = line.match(/^:([^!\s]+)!\S+ PRIVMSG #\S+ :(.*)$/);
        if (m) this.add(m[2], m[1]);
      }
    });
    this.common(ws, () => this.twitch(channel));
  }

  private async kick(channel: string) {
    const res = await fetch(`https://kick.com/api/v2/channels/${channel}`, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' },
    });
    if (!res.ok) throw new Error(`Kick no dio acceso al chat (${res.status})`);
    const ch = (await res.json()) as any, id = ch?.chatroom?.id;
    if (!id) throw new Error('no encontre la sala de chat');
    // La clave del chat la da Kick al conectar (como hace su web): la cambia de vez en cuando. Si no responde, la ultima conocida.
    const creds = async () => {
      try {
        const r = await fetch(`https://web.kick.com/api/v1/realtime/channels/${ch.id}/chat/connection`, {
          method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' },
          body: JSON.stringify({ client: { id: crypto.randomUUID(), type: 'web' }, capabilities: { accepted_providers: [{ provider: 'pusher' }] } }),
        });
        const c = ((await r.json()) as any)?.data?.connections?.find((x: any) => x.provider === 'pusher')?.credentials;
        if (c?.app_key && c?.cluster) return { key: String(c.app_key), cluster: String(c.cluster) };
      } catch { /* se usa la conocida */ }
      return { key: process.env.KICK_PUSHER_KEY || '34bf7a0ff419a2a775b9', cluster: 'us2' };
    };
    const connect = async () => {
      const { key, cluster } = await creds();
      if (this.closed) return;
      const ws = (this.ws = new WebSocket(`wss://ws-${cluster}.pusher.com/app/${key}?protocol=7&client=js&version=8.4.0&flash=false`));
      ws.on('open', () => ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${id}.v2` } })));
      ws.on('message', (d) => {
        try {
          const m = JSON.parse(String(d));
          if (m.event === 'pusher_internal:subscription_succeeded') this.status = 'leyendo chat';
          if (m.event === 'pusher:ping') ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
          if (String(m.event).includes('ChatMessageEvent')) { const j = JSON.parse(m.data); this.add(String(j.content || ''), String(j.sender?.username || '')); }
        } catch { /* mensaje no reconocido */ }
      });
      this.common(ws, connect);
    };
    void connect();
  }

  private common(ws: WebSocket, retry: () => void) {
    ws.on('error', () => (this.status = 'no se pudo conectar con el chat; se reintenta solo'));
    ws.on('close', () => { if (!this.closed) setTimeout(() => !this.closed && retry(), 5000); });
  }

  stop() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* ya cerrado */ }
  }
}

/**
 * Chat guardado de un directo ya terminado, tal como lo descarga yt-dlp:
 * Twitch ("rechat": una lista JSON) o YouTube ("live_chat": una linea JSON por mensaje).
 * `offset` son los segundos que hay que restar cuando solo se descargo un tramo del video.
 */
export function parseChatFile(raw: string, offset = 0): ChatData {
  const data: ChatData = { rate: [], hype: [], clip: [] };
  const add = (sec: number, text: string) => {
    const i = Math.floor(sec - offset);
    if (!(i >= 0) || i > 86_400 * 2) return;
    while (data.rate.length <= i) data.rate.push(0), data.hype.push(0), data.clip!.push(0);
    data.rate[i]++;
    if (HYPE.test(text)) data.hype[i]++;
    if (CLIP.test(text)) data.clip![i]++;
  };
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      for (const c of JSON.parse(trimmed)) add(+c.content_offset_seconds, String(c.message?.body ?? ''));
    } catch { /* archivo incompleto */ }
    return data;
  }
  for (const line of trimmed.split('\n')) {
    try {
      const j = JSON.parse(line), r = j.replayChatItemAction;
      if (!r) continue;
      for (const a of r.actions || []) {
        const m = a.addChatItemAction?.item?.liveChatTextMessageRenderer;
        if (m) add(+r.videoOffsetTimeMsec / 1000, (m.message?.runs || []).map((x: any) => x.text || x.emoji?.shortcuts?.[0] || '').join(''));
      }
    } catch { /* linea suelta */ }
  }
  return data;
}

/** Puntuacion robusta de la actividad del chat por segundo (suavizada 5 s). */
export function chatZ(rate: number[], length: number): number[] {
  const r = Array.from({ length }, (_, i) => rate[i] ?? 0);
  const sm = r.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 2); j <= Math.min(r.length - 1, i + 2); j++) s += r[j], n++; return s / n; });
  const sorted = [...sm].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const mad = [...sm.map((v) => Math.abs(v - med))].sort((a, b) => a - b)[Math.floor(sm.length / 2)] || Math.max(0.5, med * 0.3);
  return sm.map((v) => (v - med) / (1.4826 * mad));
}

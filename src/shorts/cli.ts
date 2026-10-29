import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { ASSETS, STAGES, createRun, hash, listRuns, loadScript, loadState, markStage, requireStage, resolveId, runFile, totalCost, writeJson } from './runs';
import { generateScript, manualTemplate } from './stages/script';
import { cloneVoice, voiceStage } from './stages/voice';
import { buildStage } from './stages/build';
import { renderStage } from './stages/render';
import { qaStage } from './stages/qa';
import { publishStage, pullMetrics } from './stages/publish';
import { estimateSeconds } from '../shared/timing';
import type { Script, VoiceMode } from './types';

const program = new Command().name('shorts').description('Fabrica de videos cortos verticales');

function printScript(id: string) {
  const s = loadScript(id);
  const secs = s.beats.reduce((a, b) => a + estimateSeconds(b.narration), 0);
  console.log(`\n  ${s.title}\n  formato: ${s.format} · ~${secs.toFixed(0)} s estimados\n`);
  s.beats.forEach((b, i) => console.log(`  ${i + 1}. ${b.narration}\n     [${b.visual.kind}${b.visual.asset ? ' ' + b.visual.asset : ''}${b.visual.text ? ' "' + b.visual.text + '"' : ''}]`));
  if (s.claims.length) {
    console.log('\n  Afirmaciones:');
    s.claims.forEach((c) => console.log(`   - (${c.status}) ${c.text}\n       ${c.sources.join('\n       ') || 'sin fuente'}`));
  }
  console.log(`\n  Edita el guion en: ${runFile(id, 'script.json')}\n  Cuando este bien: npm run shorts -- approve ${id}\n`);
}

async function produce(id: string) {
  const b = buildStage(id);
  console.log(`  linea de tiempo: ${b.seconds.toFixed(1)} s, ${b.words} palabras`);
  const out = await renderStage(id);
  const qa = await qaStage(id);
  qa.checks.forEach((c) => console.log(`  ${c.ok ? 'OK   ' : c.level === 'aviso' ? 'AVISO' : 'FALLO'} ${c.msg}`));
  console.log(`\n  ${qa.passed ? 'Video listo' : 'El video NO paso el control'}: ${out}`);
  console.log(`  Costo anotado: US$${totalCost(loadState(id)).toFixed(3)}\n`);
  if (qa.passed) console.log(`  Miralo y, si te gusta: npm run shorts -- publish ${id} --at 2026-10-12T18:00:00-05:00\n`);
  return qa.passed;
}

program
  .command('new <tema>')
  .description('Crea un video y escribe el guion (con IA, o plantilla vacia con --manual)')
  .option('--manual', 'no usar IA: crea un guion de plantilla para rellenar a mano')
  .option('--notas <texto>', 'indicaciones para el guionista: angulo, datos, tono')
  .action(async (tema: string, o) => {
    const st = createRun(tema);
    if (o.manual) {
      const s = manualTemplate(tema);
      writeJson(runFile(st.id, 'script.json'), s);
      markStage(st.id, 'script', { hash: hash(s) });
    } else {
      console.log('  investigando y escribiendo el guion...');
      await generateScript(st.id, tema, o.notas);
    }
    console.log(`\n  Video creado: ${st.id}`);
    printScript(st.id);
  });

program.command('show <id>').description('Muestra el guion').action((id) => printScript(resolveId(id)));

program
  .command('approve <id>')
  .description('Apruebas el guion (puerta 1). Valida el archivo tras tus cambios')
  .action((p) => {
    const id = resolveId(p);
    const s = loadScript(id);
    markStage(id, 'approved', { hash: hash(s) });
    console.log(`  Guion aprobado. Siguiente: npm run shorts -- voice ${id} --mode recorded`);
  });

program
  .command('voice <id>')
  .description('Genera la voz: recorded (tu microfono), clone (tu voz clonada) o none (mudo, para pruebas)')
  .option('--mode <modo>', 'recorded | clone | none', 'recorded')
  .option('--redo <frases>', 'numeros de frase a repetir, separados por comas')
  .option('--no-render', 'no renderizar al terminar')
  .action(async (p, o) => {
    const id = resolveId(p);
    requireStage(id, 'approved', `Ejecuta primero: npm run shorts -- approve ${id}`);
    if (hash(loadScript(id)) !== loadState(id).stages.approved?.hash) throw new Error('El guion cambio despues de aprobarlo. Ejecuta "approve" otra vez.');
    if (!['recorded', 'clone', 'none'].includes(o.mode)) throw new Error('--mode debe ser recorded, clone o none');
    const redo = o.redo ? String(o.redo).split(',').map(Number) : undefined;
    const r = await voiceStage(id, o.mode as VoiceMode, { redo });
    console.log(`  voz lista: ${r.total.toFixed(1)} s (${r.regenerated} frases nuevas)`);
    if (o.render) await produce(id);
  });

program
  .command('render <id>')
  .description('Vuelve a montar y renderizar el video con la voz existente')
  .action(async (p) => {
    const id = resolveId(p);
    requireStage(id, 'voice', 'Ejecuta primero "voice".');
    await produce(id);
  });

program
  .command('publish <id>')
  .description('Apruebas el video (puerta 2) y se sube a YouTube, en privado o programado')
  .option('--at <fecha>', 'fecha de publicacion, ej. 2026-10-12T18:00:00-05:00')
  .option('--public', 'publicar ya (sin esto y sin --at queda en privado)')
  .action(async (p, o) => {
    const id = resolveId(p);
    requireStage(id, 'qa', 'El video debe pasar el control: ejecuta "render".');
    const videoId = await publishStage(id, { at: o.at, public: o.public });
    console.log(`\n  Subido: https://youtu.be/${videoId}${o.at ? ' (programado para ' + o.at + ')' : ''}`);
    console.log(`  Para TikTok, sube a mano este archivo: ${runFile(id, 'video.mp4')}\n`);
  });

program
  .command('list')
  .description('Lista los videos y su estado')
  .action(() => {
    for (const id of listRuns()) {
      const s = loadState(id);
      const last = [...STAGES].reverse().find((x) => s.stages[x]) || 'nuevo';
      console.log(`  ${id.padEnd(58)} ${last.padEnd(9)} US$${totalCost(s).toFixed(3)}${s.youtube ? '  https://youtu.be/' + s.youtube.videoId : ''}`);
    }
  });

program
  .command('metrics')
  .description('Descarga las estadisticas de los videos publicados')
  .action(async () => console.table(await pullMetrics()));

program
  .command('voice-clone <nombre> <archivos...>')
  .description('Crea tu voz clonada en ElevenLabs a partir de grabaciones tuyas (wav o mp3)')
  .action(async (nombre, archivos) => {
    const id = await cloneVoice(nombre, archivos);
    console.log(`\n  Voz creada. Anade esta linea a tu .env:\n  ELEVENLABS_VOICE_ID=${id}\n`);
  });

program
  .command('asset <archivo>')
  .description('Registra un archivo de public/assets con su origen')
  .requiredOption('--origen <tipo>', 'propio | permiso | oficial | licencia')
  .option('--autor <nombre>')
  .option('--url <url>')
  .option('--nota <texto>', 'que se ve en el archivo; el guionista lo usa para elegir')
  .action((archivo, o) => {
    const file = path.basename(archivo);
    if (!fs.existsSync(path.join(ASSETS, file))) throw new Error(`Copia antes el archivo a public/assets/${file}`);
    const f = path.join(ASSETS, 'assets.json');
    const all = (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []).filter((a: any) => a.file !== file);
    all.push({ file, origen: o.origen, autor: o.autor, url: o.url, nota: o.nota });
    writeJson(f, all);
    console.log(`  Registrado ${file} (${o.origen})`);
  });

program
  .command('demo')
  .description('Genera un video de prueba mudo, sin claves, para comprobar la instalacion')
  .action(async () => {
    const st = createRun('demo instalacion');
    const s: Script = {
      format: 'confirmado_vs_rumor',
      hook: 'GTA 6 ya tiene fecha, y esta vez parece la definitiva.',
      beats: [
        { narration: 'GTA 6 ya tiene fecha, y esta vez parece la definitiva.', visual: { kind: 'card', text: 'GTA 6 tiene fecha' }, claimIds: [] },
        { narration: 'Rockstar la fijó para el diecinueve de noviembre de dos mil veintiséis, en PS5 y Xbox Series.', visual: { kind: 'card', text: '19 nov 2026' }, claimIds: ['c1'] },
        { narration: 'De la versión de PC no hay nada anunciado, así que tocará esperar.', visual: { kind: 'card', text: '¿Y en PC?' }, claimIds: [] },
        { narration: 'Este video es una prueba de la instalación. Si lo ves con subtítulos, todo funciona.', visual: { kind: 'card', text: 'Prueba superada' }, claimIds: [] },
      ],
      claims: [{ id: 'c1', text: 'GTA 6 sale el 19 de noviembre de 2026 en PS5 y Xbox Series X|S', status: 'confirmado', sources: ['https://www.techradar.com/gaming/grand-theft-auto-6-delayed-again-but-itll-still-ship-in-2026'] }],
      title: 'Demo de instalacion',
      description: 'Video de prueba.',
      hashtags: ['#GTA6'],
    };
    writeJson(runFile(st.id, 'script.json'), s);
    markStage(st.id, 'script', { hash: hash(s) });
    markStage(st.id, 'approved', { hash: hash(loadScript(st.id)) });
    await voiceStage(st.id, 'none');
    await produce(st.id);
  });

program.parseAsync().catch((e) => {
  console.error(`\n  Error: ${e.message}\n`);
  process.exit(1);
});

#!/usr/bin/env node
/* Apply the pt-BR fitness glossary to the reviewed exercise translation source.
 *
 * Machine translation is useful for the first pass, but words such as row, fly, traps and
 * curl need domain-specific treatment. Keep these transformations deterministic and
 * idempotent so dataset updates can be normalized before human review.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFile = join(root, 'translations', 'exercises', 'pt-BR.json');
const { EXDB } = await import(pathToFileURL(join(root, 'frontend', 'src', 'lib', 'exercises-data.js')).href);
const source = JSON.parse(readFileSync(sourceFile, 'utf8'));

const replaceAll = (text, replacements) => replacements.reduce(
  (value, [pattern, replacement]) => value.replace(pattern, replacement),
  text
);

const common = [
  [/\barmadilhas\b/gi, 'trapézios'],
  [/\bbarra (?:da|de) armadilha\b/gi, 'trap bar'],
  [/\bagachamento maricas\b/gi, 'agachamento sissy'],
  [/\baderência\b/gi, 'pegada'],
  [/\bestocadas?\b/gi, match => match.toLowerCase().endsWith('s') ? 'avanços' : 'avanço'],
  [/\bponderad([oa]s?)\b/gi, 'com peso'],
  [/\bbezerros?\b/gi, match => match.toLowerCase().endsWith('s') ? 'panturrilhas' : 'panturrilha'],
  [/\bbanda\b/gi, 'faixa elástica'],
  [/\bnúcleo\b/gi, 'core'],
  [/\bferreiro\b/gi, 'Smith'],
  [/\bmacho\b/gi, 'masculino']
];

const nameOverrides = {
  'air bike': 'abdominal bicicleta',
  'archer pull up': 'barra fixa arqueiro',
  'butt-ups': 'elevação de quadril com pernas flexionadas',
  'clap push up': 'flexão de braços com palmas',
  'gironda sternum chin': 'barra fixa Gironda até o esterno',
  'hack calf raise': 'elevação de panturrilhas no hack',
  'hack one leg calf raise': 'elevação unilateral de panturrilha no hack',
  'lever donkey calf raise': 'elevação de panturrilhas donkey na máquina',
  'three bench dip': 'mergulho em três bancos',
  'weighted drop push up': 'flexão pliométrica com peso',
  'weighted three bench dips': 'mergulho em três bancos com peso',
  'wind sprints': 'tiros de corrida'
};

function normalizeName(english, translated) {
  if (nameOverrides[english]) return nameOverrides[english];
  let name = replaceAll(translated, common);

  if (/\brow\b/i.test(english)) name = name.replace(/\b(?:linha|fileira)\b/gi, 'remada');
  if (/\bfly\b/i.test(english)) name = name.replace(/\b(?:mosca|voar)\b/gi, 'crucifixo');
  if (/\bcrunch\b/i.test(english)) name = name.replace(/\bcrise\b/gi, 'abdominal');
  if (/\bpress(?:es)?\b/i.test(english)) name = name.replace(/\b(?:prensa|prensas|imprensa)\b/gi, 'press');
  if (/\bgrip\b/i.test(english)) name = name.replace(/\b(?:aperto|punho)\b/gi, 'pegada');

  if (/\bcurl(?:s)?\b/i.test(english)) {
    const term = /wrist curl/i.test(english)
      ? (/reverse wrist curl/i.test(english) ? 'extensão de punho' : 'flexão de punho')
      : /(?:leg|hamstring) curl/i.test(english) ? 'flexão de pernas'
        : /finger curls?/i.test(english) ? 'flexão dos dedos'
          : /lower back curl/i.test(english) ? 'flexão lombar'
            : 'rosca';
    name = name.replace(/\b(?:onda|enrolamento|curvatura|cachos?)\b/gi, term);
  }

  name = name
    .replace(/\bpull-up\b/gi, 'barra fixa')
    .replace(/\bpull up\b/gi, 'barra fixa')
    .replace(/\bpuxar para cima\b/gi, 'barra fixa')
    .replace(/\bqueixo para cima\b/gi, 'barra fixa supinada')
    .replace(/\bpush[- ]?up\b/gi, 'flexão de braços')
    .replace(/\bempurrar para cima\b/gi, 'flexão de braços')
    .replace(/\bcorridas de vento\b/gi, 'tiros de corrida')
    .replace(/\bcriação (?:com peso )?de panturrilha de burro\b/gi, match =>
      match.includes('com peso') ? 'elevação de panturrilhas donkey com peso' : 'elevação de panturrilhas donkey')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return name;
}

function normalizeStep(step) {
  return replaceAll(step, common)
    .replace(/\bcrise\b/gi, 'contração abdominal')
    .replace(/\bmúsculos centrais\b/gi, 'core')
    .replace(/\bEnvolva suas trapézios\b/g, 'Ative os trapézios')
    .replace(/\bEnvolva seu core\b/g, 'Ative o core')
    .replace(/\bEnvolva o core\b/g, 'Ative o core')
    .replace(/\bEnvolva (os|as)\b/g, 'Ative $1')
    .replace(/\benvolva seu core\b/g, 'ative o core')
    .replace(/\benvolva o core\b/g, 'ative o core')
    .replace(/\benvolva (os|as)\b/g, 'ative $1')
    .replace(/\bEnvolvendo\b/g, 'Ativando')
    .replace(/\benvolvendo\b/g, 'ativando')
    .replace(/\bpassar pelos calcanhares\b/gi, 'empurrar o chão com os calcanhares')
    .replace(/\bpasse pelos calcanhares\b/gi, 'empurre o chão com os calcanhares')
    .replace(/\bDeslize a bunda\b/g, 'Desloque o quadril')
    .replace(/\bdeslizando a bunda\b/g, 'deslocando o quadril')
    .replace(/\bempurrando a bunda\b/g, 'levando o quadril')
    .replace(/\bno início do movimento\b/gi, 'no topo do movimento')
    .replace(/\bno início da contração abdominal\b/gi, 'no topo da contração abdominal')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

for (const exercise of EXDB) {
  const translated = source.exercises[exercise.id];
  if (!translated) continue;
  translated.name = normalizeName(exercise.n, translated.name);
  translated.steps = translated.steps.map(normalizeStep);
}

writeFileSync(sourceFile, JSON.stringify(source, null, 2) + '\n');
console.log(`Normalized ${EXDB.length} pt-BR exercise translations.`);

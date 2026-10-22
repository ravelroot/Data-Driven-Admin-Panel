import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
const cores = { api: '\x1b[33m', web: '\x1b[36m' };
const reset = '\x1b[0m';
const processos = new Map();
let encerrando = false;

function prefixar(nome, fluxo, destino) {
  let resto = '';
  fluxo.setEncoding('utf8');
  fluxo.on('data', (pedaco) => {
    const linhas = (resto + pedaco).split(/\r?\n/);
    resto = linhas.pop() ?? '';
    for (const linha of linhas) destino.write(`${cores[nome]}[${nome}]${reset} ${linha}\n`);
  });
  fluxo.on('end', () => {
    if (resto) destino.write(`${cores[nome]}[${nome}]${reset} ${resto}\n`);
  });
}

function encerrarTodos(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  for (const filho of processos.values()) {
    if (filho.exitCode !== null) continue;
    if (windows) {
      spawnSync('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-filho.pid, 'SIGTERM');
      } catch {
        filho.kill('SIGTERM');
      }
    }
  }
  setTimeout(() => process.exit(codigo), 600).unref();
}

function iniciar(nome, espaco) {
  const filho = spawn('npm', ['run', 'dev', '-w', espaco], {
    cwd: raiz,
    shell: true,
    detached: !windows,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processos.set(nome, filho);
  prefixar(nome, filho.stdout, process.stdout);
  prefixar(nome, filho.stderr, process.stderr);
  filho.on('exit', (codigo) => {
    if (encerrando) return;
    process.stderr.write(`${cores[nome]}[${nome}]${reset} terminou com código ${codigo ?? 0}; encerrando o outro processo.\n`);
    encerrarTodos(codigo ?? 1);
  });
}

process.on('SIGINT', () => encerrarTodos(0));
process.on('SIGTERM', () => encerrarTodos(0));

iniciar('api', 'api');
iniciar('web', 'web');
process.stdout.write(`${cores.web}[web]${reset} painel em http://localhost:5173 · ${cores.api}[api]${reset} API em http://localhost:8080/api/v1\n`);

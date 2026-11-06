import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const SEMVER = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;
const PACOTES = ['package.json', 'web/package.json', 'api/package.json'];
const PYTHON = [
  ['analise/pyproject.toml', /^version = "([^"]+)"$/m, (versao) => `version = "${versao}"`],
  ['analise/bento_analise/app.py', /^VERSAO = "([^"]+)"$/m, (versao) => `VERSAO = "${versao}"`],
];

const lerJson = (arquivo) => JSON.parse(readFileSync(path.join(raiz, arquivo), 'utf8'));
const gravarJson = (arquivo, dados) => writeFileSync(path.join(raiz, arquivo), `${JSON.stringify(dados, null, 2)}\n`);

function versoesAtuais() {
  const versoes = { VERSION: readFileSync(path.join(raiz, 'VERSION'), 'utf8').trim() };
  for (const arquivo of PACOTES) versoes[arquivo] = lerJson(arquivo).version;
  const trava = lerJson('package-lock.json');
  versoes['package-lock.json'] = trava.version;
  for (const pacote of ['web', 'api']) versoes[`package-lock.json (${pacote})`] = trava.packages?.[pacote]?.version;
  for (const [arquivo, padrao] of PYTHON) versoes[arquivo] = readFileSync(path.join(raiz, arquivo), 'utf8').match(padrao)?.[1];
  return versoes;
}

function conferir() {
  const versoes = versoesAtuais();
  const unicas = new Set(Object.values(versoes));
  for (const [arquivo, versao] of Object.entries(versoes)) console.log(`${versao ?? '—'}\t${arquivo}`);
  if (unicas.size !== 1) {
    console.error('\nAs versões não batem. Rode "npm run versao -- <nova>" para alinhar todos os arquivos.');
    process.exit(1);
  }
  console.log(`\nTudo na versão ${[...unicas][0]}.`);
}

function definir(nova) {
  if (!SEMVER.test(nova)) {
    console.error(`"${nova}" não é uma versão no formato 1.2.3.`);
    process.exit(1);
  }
  writeFileSync(path.join(raiz, 'VERSION'), `${nova}\n`);
  for (const arquivo of PACOTES) {
    const dados = lerJson(arquivo);
    dados.version = nova;
    gravarJson(arquivo, dados);
  }
  const trava = lerJson('package-lock.json');
  trava.version = nova;
  if (trava.packages?.['']) trava.packages[''].version = nova;
  for (const pacote of ['web', 'api']) if (trava.packages?.[pacote]) trava.packages[pacote].version = nova;
  gravarJson('package-lock.json', trava);
  for (const [arquivo, padrao, linha] of PYTHON) {
    const caminho = path.join(raiz, arquivo);
    writeFileSync(caminho, readFileSync(caminho, 'utf8').replace(padrao, linha(nova)));
  }
  console.log(`Versão ${nova} gravada em VERSION, ${PACOTES.join(', ')}, package-lock.json e no motor analítico.`);
}

const argumento = process.argv[2];
if (!argumento || argumento === '--conferir') conferir();
else definir(argumento);

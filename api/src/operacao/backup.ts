import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { Banco } from '../banco/conexao.js';
import { aplicarMigracoes, listarMigracoes } from '../banco/migrar.js';
import { VERSAO } from '../config.js';

export const FORMATO_BACKUP = 'bento-backup';
export const VERSAO_FORMATO = 1;
const TAMANHO_LOTE = 500;
const PADRAO_ARQUIVO = /^bento-backup-\d{8}-\d{6}(-[a-z0-9]{1,12})?\.ndjson\.gz$/;

export interface CabecalhoBackup {
  formato: typeof FORMATO_BACKUP;
  versaoFormato: number;
  bento: string;
  banco: Banco['tipo'];
  criadoEm: string;
  migracoes: string[];
  tabelas: { nome: string; registros: number }[];
  sequencias: { nome: string; valor: number | null }[];
}

export interface ResumoBackup {
  tabelas: number;
  registros: number;
  bytes: number;
  arquivo?: string;
}

export interface ArquivoBackup {
  nome: string;
  bytes: number;
  criadoEm: string;
}

const identificador = (nome: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) throw new Error(`Nome inválido: ${nome}`);
  return `"${nome}"`;
};

export async function tabelasEmOrdem(banco: Banco): Promise<string[]> {
  const tabelas = await banco.consultar<{ nome: string }>(
    `select tablename as nome from pg_tables where schemaname = current_schema() order by tablename`,
  );
  const chaves = await banco.consultar<{ origem: string; destino: string }>(
    `select c.conrelid::regclass::text as origem, c.confrelid::regclass::text as destino
       from pg_constraint c
       join pg_namespace n on n.oid = c.connamespace
      where c.contype = 'f' and n.nspname = current_schema()`,
  );
  const nomes = tabelas.linhas.map((linha) => linha.nome).filter((nome) => nome !== 'migracoes');
  const dependencias = new Map(nomes.map((nome) => [nome, new Set<string>()]));
  for (const { origem, destino } of chaves.linhas) {
    const limpaOrigem = origem.replace(/"/g, '');
    const limpoDestino = destino.replace(/"/g, '');
    if (limpaOrigem !== limpoDestino) dependencias.get(limpaOrigem)?.add(limpoDestino);
  }
  const ordem: string[] = [];
  const visitados = new Set<string>();
  const visitando = new Set<string>();
  const visitar = (nome: string) => {
    if (visitados.has(nome)) return;
    if (visitando.has(nome)) throw new Error(`Dependência circular entre tabelas em ${nome}`);
    visitando.add(nome);
    for (const dependencia of dependencias.get(nome) ?? []) if (dependencias.has(dependencia)) visitar(dependencia);
    visitando.delete(nome);
    visitados.add(nome);
    ordem.push(nome);
  };
  for (const nome of nomes) visitar(nome);
  return ordem;
}

async function sequencias(banco: Banco): Promise<CabecalhoBackup['sequencias']> {
  const { linhas } = await banco.consultar<{ nome: string; valor: number | null }>(
    `select sequencename as nome, last_value::float8 as valor from pg_sequences where schemaname = current_schema() order by sequencename`,
  );
  return linhas.map((linha) => ({ nome: linha.nome, valor: linha.valor === null ? null : Number(linha.valor) }));
}

async function escreverLinha(destino: Writable, objeto: unknown): Promise<void> {
  if (!destino.write(`${JSON.stringify(objeto)}\n`)) await once(destino, 'drain');
}

export async function exportarBackup(banco: Banco, destino: Writable): Promise<ResumoBackup> {
  return banco.transacao(async (tx) => {
    await tx.executar('set transaction isolation level repeatable read, read only');
    const tabelas = await tabelasEmOrdem(tx);
    const contagens: CabecalhoBackup['tabelas'] = [];
    for (const nome of tabelas) {
      const { linhas } = await tx.consultar<{ total: number }>(`select count(*)::int as total from ${identificador(nome)}`);
      contagens.push({ nome, registros: linhas[0]?.total ?? 0 });
    }
    const migracoes = await tx.consultar<{ nome: string }>('select nome from migracoes order by nome');
    const cabecalho: CabecalhoBackup = {
      formato: FORMATO_BACKUP,
      versaoFormato: VERSAO_FORMATO,
      bento: VERSAO,
      banco: banco.tipo,
      criadoEm: new Date().toISOString(),
      migracoes: migracoes.linhas.map((linha) => linha.nome),
      tabelas: contagens,
      sequencias: await sequencias(tx),
    };
    await escreverLinha(destino, cabecalho);
    let registros = 0;
    for (const { nome, registros: total } of contagens) {
      for (let deslocamento = 0; deslocamento < total; deslocamento += TAMANHO_LOTE) {
        const { linhas } = await tx.consultar<{ r: unknown }>(
          `select to_jsonb(t) as r from ${identificador(nome)} t order by t.ctid limit $1 offset $2`,
          [TAMANHO_LOTE, deslocamento],
        );
        if (!linhas.length) break;
        registros += linhas.length;
        await escreverLinha(destino, { tabela: nome, linhas: linhas.map((linha) => linha.r) });
      }
    }
    await escreverLinha(destino, { fim: true, registros });
    return { tabelas: contagens.length, registros, bytes: 0 };
  });
}

export function nomeArquivoBackup(data = new Date(), sufixo?: string): string {
  const dois = (valor: number) => String(valor).padStart(2, '0');
  const carimbo = `${data.getFullYear()}${dois(data.getMonth() + 1)}${dois(data.getDate())}-${dois(data.getHours())}${dois(data.getMinutes())}${dois(data.getSeconds())}`;
  return `bento-backup-${carimbo}${sufixo ? `-${sufixo}` : ''}.ndjson.gz`;
}

export function arquivoBackupValido(nome: string): boolean {
  return PADRAO_ARQUIVO.test(nome);
}

export async function salvarBackup(banco: Banco, pasta: string, sufixo?: string): Promise<ResumoBackup & { arquivo: string }> {
  mkdirSync(pasta, { recursive: true });
  const nome = nomeArquivoBackup(new Date(), sufixo);
  const caminho = path.join(pasta, nome);
  const temporario = `${caminho}.parcial`;
  const gzip = createGzip({ level: 6 });
  const arquivo = createWriteStream(temporario, { mode: 0o600 });
  const gravacao = pipeline(gzip, arquivo);
  try {
    const resumo = await exportarBackup(banco, gzip);
    gzip.end();
    await gravacao;
    renameSync(temporario, caminho);
    return { ...resumo, bytes: statSync(caminho).size, arquivo: caminho };
  } catch (erro) {
    gzip.destroy();
    await gravacao.catch(() => undefined);
    rmSync(temporario, { force: true });
    throw erro;
  }
}

export function listarBackups(pasta: string): ArquivoBackup[] {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta)
    .filter(arquivoBackupValido)
    .map((nome) => {
      const info = statSync(path.join(pasta, nome));
      return { nome, bytes: info.size, criadoEm: info.mtime.toISOString() };
    })
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm) || b.nome.localeCompare(a.nome));
}

export function podarBackups(pasta: string, manter: number): string[] {
  const removidos: string[] = [];
  for (const arquivo of listarBackups(pasta).slice(Math.max(1, manter))) {
    rmSync(path.join(pasta, arquivo.nome), { force: true });
    removidos.push(arquivo.nome);
  }
  return removidos;
}

export async function* lerLinhasBackup(origem: Readable): AsyncGenerator<Record<string, unknown>> {
  const leitor = createInterface({ input: origem.pipe(createGunzip()), crlfDelay: Number.POSITIVE_INFINITY });
  for await (const linha of leitor) {
    if (!linha.trim()) continue;
    yield JSON.parse(linha) as Record<string, unknown>;
  }
}

export function abrirArquivoBackup(caminho: string): Readable {
  if (!existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);
  return createReadStream(caminho);
}

function validarCabecalho(bruto: Record<string, unknown> | undefined): CabecalhoBackup {
  if (!bruto || bruto.formato !== FORMATO_BACKUP) throw new Error('O arquivo não é um backup do Bento.');
  if (Number(bruto.versaoFormato) > VERSAO_FORMATO) throw new Error('O backup foi feito por uma versão mais nova do Bento. Atualize antes de restaurar.');
  const cabecalho = bruto as unknown as CabecalhoBackup;
  const conhecidas = listarMigracoes().map((migracao) => migracao.nome);
  cabecalho.migracoes.forEach((nome, indice) => {
    if (conhecidas[indice] !== nome) {
      throw new Error(`O backup usa a migração ${nome}, que esta versão do Bento não conhece. Restaure com a mesma versão ou uma mais nova.`);
    }
  });
  return cabecalho;
}

async function colunasGravaveis(banco: Banco, tabela: string): Promise<Set<string>> {
  const { linhas } = await banco.consultar<{ nome: string }>(
    `select column_name as nome from information_schema.columns
      where table_schema = current_schema() and table_name = $1 and is_generated = 'NEVER'`,
    [tabela],
  );
  return new Set(linhas.map((linha) => linha.nome));
}

async function apagarTudo(banco: Banco): Promise<void> {
  const tabelas = await banco.consultar<{ nome: string }>(`select tablename as nome from pg_tables where schemaname = current_schema()`);
  if (tabelas.linhas.length) {
    await banco.executar(`drop table if exists ${tabelas.linhas.map((linha) => identificador(linha.nome)).join(', ')} cascade`);
  }
  const restantes = await banco.consultar<{ nome: string }>(`select sequencename as nome from pg_sequences where schemaname = current_schema()`);
  if (restantes.linhas.length) {
    await banco.executar(`drop sequence if exists ${restantes.linhas.map((linha) => identificador(linha.nome)).join(', ')} cascade`);
  }
}

export interface ResumoRestauracao {
  bento: string;
  criadoEm: string;
  tabelas: number;
  registros: number;
  migracoesPosteriores: string[];
}

export async function restaurarBackup(banco: Banco, linhas: AsyncIterable<Record<string, unknown>>): Promise<ResumoRestauracao> {
  const iterador = linhas[Symbol.asyncIterator]();
  const primeira = await iterador.next();
  const cabecalho = validarCabecalho(primeira.done ? undefined : primeira.value);
  const migracoes = listarMigracoes().slice(0, cabecalho.migracoes.length);

  const resumo = await banco.transacao(async (tx) => {
    await apagarTudo(tx);
    await tx.executar('create table migracoes (nome text primary key, aplicada_em timestamptz not null default now())');
    for (const migracao of migracoes) {
      await tx.executar(migracao.sql);
      await tx.consultar('insert into migracoes (nome) values ($1)', [migracao.nome]);
    }
    const tabelas = await tabelasEmOrdem(tx);
    if (tabelas.length) await tx.executar(`truncate table ${tabelas.map(identificador).join(', ')} restart identity cascade`);
    const colunas = new Map<string, Set<string>>();
    let registros = 0;
    let terminou = false;
    for (;;) {
      const proxima = await iterador.next();
      if (proxima.done) break;
      const bloco = proxima.value;
      if (bloco.fim) {
        terminou = true;
        break;
      }
      const tabela = String(bloco.tabela ?? '');
      const itens = Array.isArray(bloco.linhas) ? (bloco.linhas as Record<string, unknown>[]) : [];
      if (!tabelas.includes(tabela)) throw new Error(`O backup tem a tabela ${tabela}, que não existe no esquema.`);
      if (!itens.length) continue;
      let gravaveis = colunas.get(tabela);
      if (!gravaveis) {
        gravaveis = await colunasGravaveis(tx, tabela);
        colunas.set(tabela, gravaveis);
      }
      const presentes = Object.keys(itens[0] ?? {}).filter((coluna) => gravaveis.has(coluna));
      const lista = presentes.map(identificador).join(', ');
      await tx.consultar(
        `insert into ${identificador(tabela)} (${lista}) overriding system value
         select ${lista} from jsonb_populate_recordset(null::${identificador(tabela)}, $1::jsonb)`,
        [JSON.stringify(itens)],
      );
      registros += itens.length;
    }
    if (!terminou) throw new Error('O arquivo de backup está incompleto (faltou o fim). Nada foi alterado.');
    const existentes = new Set((await tx.consultar<{ nome: string }>(`select sequencename as nome from pg_sequences where schemaname = current_schema()`)).linhas.map((linha) => linha.nome));
    for (const sequencia of cabecalho.sequencias) {
      if (sequencia.valor === null || !existentes.has(sequencia.nome)) continue;
      await tx.consultar('select setval($1::regclass, $2::bigint, true)', [identificador(sequencia.nome), Math.trunc(sequencia.valor)]);
    }
    return { bento: cabecalho.bento, criadoEm: cabecalho.criadoEm, tabelas: cabecalho.tabelas.length, registros };
  });

  const posteriores = await aplicarMigracoes(banco);
  return { ...resumo, migracoesPosteriores: posteriores };
}

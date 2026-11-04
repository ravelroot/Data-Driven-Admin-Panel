import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { createGzip, gunzipSync } from 'node:zlib';
import { criarBanco, type Banco } from '../src/banco/conexao.js';
import { aplicarMigracoes } from '../src/banco/migrar.js';
import { lerConfig } from '../src/config.js';
import { arquivoBackupValido, exportarBackup, lerLinhasBackup, podarBackups, restaurarBackup } from '../src/operacao/backup.js';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

async function gerarBackup(banco: Banco): Promise<Buffer> {
  const gzip = createGzip();
  const pedacos: Buffer[] = [];
  const coleta = new PassThrough();
  coleta.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
  gzip.pipe(coleta);
  await exportarBackup(banco, gzip);
  gzip.end();
  await new Promise((resolver) => coleta.on('end', resolver));
  return Buffer.concat(pedacos);
}

async function bancoVazio(): Promise<Banco> {
  const config = lerConfig({ dirDados: 'memoria', urlBanco: null, segredoJwt: 'segredo-de-teste-com-tamanho-suficiente-para-jwt', log: 'silent' });
  return criarBanco(config);
}

const contar = async (banco: Banco, tabela: string) =>
  (await banco.consultar<{ total: number }>(`select count(*)::int as total from ${tabela}`)).linhas[0]?.total ?? 0;

describe('backup e restauração', () => {
  let ambiente: Ambiente;
  let admin: string;
  let pasta: string;
  let arquivo: Buffer;

  before(async () => {
    pasta = mkdtempSync(path.join(tmpdir(), 'bento-backup-'));
    ambiente = await criarAmbiente({ backup: { automatico: 'diario', manter: 2, pasta } });
    admin = await entrar(ambiente.app);
    await ambiente.banco.consultar(
      `insert into relatorios (nome, tipo, formato, inicio, fim, status, linhas, tamanho_bytes, conteudo, tipo_mime)
       values ('Binário', 'receita', 'csv', current_date, current_date, 'pronto', 1, 4, '\\x00ff10ab'::bytea, 'text/csv')`,
    );
    arquivo = await gerarBackup(ambiente.banco);
  });

  after(async () => {
    await ambiente.fechar();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('o arquivo começa pelo cabeçalho e termina com o total de registros', () => {
    const linhas = gunzipSync(arquivo).toString('utf8').trim().split('\n');
    const cabecalho = JSON.parse(linhas[0] ?? '{}');
    assert.equal(cabecalho.formato, 'bento-backup');
    assert.ok(cabecalho.migracoes.includes('006_operacao_preferencias.sql'));
    assert.ok(cabecalho.tabelas.findIndex((tabela: { nome: string }) => tabela.nome === 'papeis') < cabecalho.tabelas.findIndex((tabela: { nome: string }) => tabela.nome === 'usuarios'));
    const fim = JSON.parse(linhas.at(-1) ?? '{}');
    assert.equal(fim.fim, true);
    assert.equal(fim.registros, cabecalho.tabelas.reduce((soma: number, tabela: { registros: number }) => soma + tabela.registros, 0));
  });

  it('restaura tudo em outro banco, com binários, identidades e sequências', async () => {
    const destino = await bancoVazio();
    try {
      await aplicarMigracoes(destino);
      await destino.consultar(`insert into usuarios (nome, email, papel) values ('Será apagada', 'apagar@exemplo.com', 'cliente')`);
      const resumo = await restaurarBackup(destino, lerLinhasBackup(Readable.from(arquivo)));
      assert.equal(resumo.migracoesPosteriores.length, 0);
      for (const tabela of ['usuarios', 'transacoes', 'auditoria', 'papel_permissoes', 'notificacao_estados', 'chaves_api', 'relatorios']) {
        assert.equal(await contar(destino, tabela), await contar(ambiente.banco, tabela), tabela);
      }
      assert.equal((await destino.consultar(`select 1 from usuarios where email = 'apagar@exemplo.com'`)).linhas.length, 0);
      const binario = await destino.consultar<{ hex: string }>(`select encode(conteudo, 'hex') as hex from relatorios where nome = 'Binário'`);
      assert.equal(binario.linhas[0]?.hex, '00ff10ab');
      const original = await ambiente.banco.consultar<{ email: string; senha_hash: string; criado_em: Date }>(
        `select email, senha_hash, criado_em from usuarios where email = 'admin@bento.local'`,
      );
      const restaurado = await destino.consultar<{ email: string; senha_hash: string; criado_em: Date }>(
        `select email, senha_hash, criado_em from usuarios where email = 'admin@bento.local'`,
      );
      assert.equal(restaurado.linhas[0]?.senha_hash, original.linhas[0]?.senha_hash);
      assert.equal(new Date(restaurado.linhas[0]?.criado_em ?? 0).getTime(), new Date(original.linhas[0]?.criado_em ?? 0).getTime());
      const novaAuditoria = await destino.consultar<{ id: number }>(
        `insert into auditoria (acao, descricao) values ('sistema.teste', 'depois da restauração') returning id`,
      );
      const maiorOriginal = await ambiente.banco.consultar<{ maximo: number }>('select max(id)::int as maximo from auditoria');
      assert.equal(Number(novaAuditoria.linhas[0]?.id) > Number(maiorOriginal.linhas[0]?.maximo), true);
      const novaTransacao = await destino.consultar<{ codigo: string }>(
        `insert into transacoes (cliente_nome, cliente_email, tipo, metodo, status, valor) values ('A', 'a@b.co', 'avulsa', 'pix', 'pendente', 100) returning codigo`,
      );
      const existe = await ambiente.banco.consultar('select 1 from transacoes where codigo = $1', [novaTransacao.linhas[0]?.codigo]);
      assert.equal(existe.linhas.length, 0);
    } finally {
      await destino.fechar();
    }
  });

  it('recusa arquivos que não são backups ou que estão incompletos, sem alterar nada', async () => {
    const destino = await bancoVazio();
    try {
      await aplicarMigracoes(destino);
      const qualquer = createGzip();
      const pedacos: Buffer[] = [];
      qualquer.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
      qualquer.end('{"ola":"mundo"}\n');
      await new Promise((resolver) => qualquer.on('end', resolver));
      await assert.rejects(() => restaurarBackup(destino, lerLinhasBackup(Readable.from(Buffer.concat(pedacos)))), /não é um backup/);
      const linhas = gunzipSync(arquivo).toString('utf8').trim().split('\n');
      const cortado = linhas.slice(0, -1).join('\n');
      const gzip = createGzip();
      const partes: Buffer[] = [];
      gzip.on('data', (pedaco: Buffer) => partes.push(pedaco));
      gzip.end(`${cortado}\n`);
      await new Promise((resolver) => gzip.on('end', resolver));
      const antes = await contar(destino, 'papeis');
      await assert.rejects(() => restaurarBackup(destino, lerLinhasBackup(Readable.from(Buffer.concat(partes)))), /incompleto/);
      assert.equal(await contar(destino, 'papeis'), antes);
      assert.equal(await contar(destino, 'usuarios'), 0);
    } finally {
      await destino.fechar();
    }
  });

  it('grava, lista e baixa backups pela API, e poda os antigos', async () => {
    const pedir = (method: 'GET' | 'POST', url: string) =>
      ambiente.app.inject({ method, url: `/api/v1${url}`, headers: method === 'GET' ? { cookie: admin } : cabecalhos(admin) });
    const analista = await entrar(ambiente.app, 'analista@bento.local');
    assert.equal((await ambiente.app.inject({ method: 'POST', url: '/api/v1/sistema/backups', headers: cabecalhos(analista) })).statusCode, 403);
    const criado = await pedir('POST', '/sistema/backups');
    assert.equal(criado.statusCode, 201, criado.body);
    assert.ok(arquivoBackupValido(criado.json().nome));
    const lista = await pedir('GET', '/sistema/backups');
    assert.equal(lista.json().itens[0].nome, criado.json().nome);
    const baixado = await pedir('GET', `/sistema/backups/${criado.json().nome}`);
    assert.equal(baixado.statusCode, 200);
    assert.equal(baixado.headers['content-type'], 'application/gzip');
    assert.equal(JSON.parse(gunzipSync(baixado.rawPayload).toString('utf8').split('\n')[0] ?? '{}').formato, 'bento-backup');
    assert.equal((await pedir('GET', '/sistema/backups/..%2F..%2Fetc%2Fpasswd')).statusCode, 422);
    assert.equal((await pedir('GET', '/sistema/backups/bento-backup-20000101-000000.ndjson.gz')).statusCode, 404);
    for (const nome of ['bento-backup-20200101-000000-auto.ndjson.gz', 'bento-backup-20200102-000000-auto.ndjson.gz', 'bento-backup-20200103-000000-auto.ndjson.gz']) {
      const { writeFileSync, utimesSync } = await import('node:fs');
      writeFileSync(path.join(pasta, nome), '');
      const data = new Date(`${nome.slice(13, 17)}-${nome.slice(17, 19)}-${nome.slice(19, 21)}T00:00:00Z`);
      utimesSync(path.join(pasta, nome), data, data);
    }
    const removidos = podarBackups(pasta, 2);
    assert.equal(removidos.length, 2);
    assert.equal(readdirSync(pasta).filter(arquivoBackupValido).length, 2);
  });
});

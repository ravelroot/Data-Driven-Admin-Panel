import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Banco } from './conexao.js';

const pastaMigracoes = fileURLToPath(new URL('../../migracoes/', import.meta.url));
const CHAVE_TRAVA = 4_242_017;

export function listarMigracoes(): { nome: string; sql: string }[] {
  return readdirSync(pastaMigracoes)
    .filter((arquivo) => arquivo.endsWith('.sql'))
    .sort()
    .map((arquivo) => ({ nome: arquivo, sql: readFileSync(path.join(pastaMigracoes, arquivo), 'utf8') }));
}

export async function aplicarMigracoes(banco: Banco): Promise<string[]> {
  await banco.executar(
    'create table if not exists migracoes (nome text primary key, aplicada_em timestamptz not null default now())',
  );
  return banco.transacao(async (tx) => {
    await tx.consultar('select pg_advisory_xact_lock($1)', [CHAVE_TRAVA]);
    const { linhas } = await tx.consultar<{ nome: string }>('select nome from migracoes');
    const aplicadas = new Set(linhas.map((linha) => linha.nome));
    const novas: string[] = [];
    for (const migracao of listarMigracoes()) {
      if (aplicadas.has(migracao.nome)) continue;
      await tx.executar(migracao.sql);
      await tx.consultar('insert into migracoes (nome) values ($1)', [migracao.nome]);
      novas.push(migracao.nome);
    }
    return novas;
  });
}

export async function bancoVazio(banco: Banco): Promise<boolean> {
  const { linhas } = await banco.consultar<{ total: number }>('select count(*)::int as total from usuarios');
  return (linhas[0]?.total ?? 0) === 0;
}

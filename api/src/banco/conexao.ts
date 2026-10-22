import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { DADOS_EM_MEMORIA, type Config } from '../config.js';

export type Linha = Record<string, unknown>;

export interface ResultadoConsulta<T> {
  linhas: T[];
  total: number;
}

export interface Banco {
  readonly tipo: 'postgresql' | 'pglite';
  consultar<T = Linha>(sql: string, parametros?: unknown[]): Promise<ResultadoConsulta<T>>;
  executar(sql: string): Promise<void>;
  transacao<T>(fn: (banco: Banco) => Promise<T>): Promise<T>;
  ouvir(
    canal: string,
    aoReceber: (carga: string) => void,
    aoFalhar?: (erro: Error) => void,
  ): Promise<() => Promise<void>>;
  notificar(canal: string, carga: string): Promise<void>;
  fechar(): Promise<void>;
}

const OID_INT8 = 20;
const OID_NUMERIC = 1700;
const OID_DATE = 1082;

function validarCanal(canal: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(canal)) throw new Error(`Canal inválido: ${canal}`);
  return canal;
}

function normalizarParametros(parametros: unknown[] = []): unknown[] {
  return parametros.map((valor) => (valor === undefined ? null : valor));
}

pg.types.setTypeParser(OID_INT8, (valor) => Number(valor));
pg.types.setTypeParser(OID_NUMERIC, (valor) => Number(valor));
pg.types.setTypeParser(OID_DATE, (valor) => valor);

function bancoPostgres(config: Config): Banco {
  const pool = new pg.Pool({
    connectionString: config.urlBanco ?? undefined,
    max: config.tamanhoPool,
    options: `-c timezone=${config.fuso}`,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', () => undefined);

  const sobreCliente = (cliente: pg.PoolClient): Banco => {
    const banco: Banco = {
      tipo: 'postgresql',
      async consultar<T>(sql: string, parametros?: unknown[]) {
        const resultado = await cliente.query(sql, normalizarParametros(parametros));
        return { linhas: resultado.rows as T[], total: resultado.rowCount ?? resultado.rows.length };
      },
      async executar(sql: string) {
        await cliente.query(sql);
      },
      transacao: (fn) => fn(banco),
      ouvir: () => Promise.reject(new Error('Use ouvir fora de uma transação')),
      async notificar(canal, carga) {
        await cliente.query('select pg_notify($1, $2)', [validarCanal(canal), carga]);
      },
      fechar: async () => undefined,
    };
    return banco;
  };

  return {
    tipo: 'postgresql',
    async consultar<T>(sql: string, parametros?: unknown[]) {
      const resultado = await pool.query(sql, normalizarParametros(parametros));
      return { linhas: resultado.rows as T[], total: resultado.rowCount ?? resultado.rows.length };
    },
    async executar(sql: string) {
      await pool.query(sql);
    },
    async transacao<T>(fn: (banco: Banco) => Promise<T>) {
      const cliente = await pool.connect();
      try {
        await cliente.query('begin');
        const resultado = await fn(sobreCliente(cliente));
        await cliente.query('commit');
        return resultado;
      } catch (erro) {
        await cliente.query('rollback').catch(() => undefined);
        throw erro;
      } finally {
        cliente.release();
      }
    },
    async ouvir(canal, aoReceber, aoFalhar) {
      const nome = validarCanal(canal);
      const cliente = await pool.connect();
      let liberado = false;
      const liberar = (erro?: Error) => {
        if (liberado) return;
        liberado = true;
        cliente.release(erro);
      };
      const tratar = (mensagem: pg.Notification) => {
        if (mensagem.channel === nome) aoReceber(mensagem.payload ?? '');
      };
      cliente.on('notification', tratar);
      cliente.on('error', (erro) => {
        liberar(erro);
        aoFalhar?.(erro);
      });
      await cliente.query(`listen ${nome}`);
      return async () => {
        cliente.off('notification', tratar);
        if (!liberado) await cliente.query(`unlisten ${nome}`).catch(() => undefined);
        liberar();
      };
    },
    async notificar(canal, carga) {
      await pool.query('select pg_notify($1, $2)', [validarCanal(canal), carga]);
    },
    async fechar() {
      await pool.end();
    },
  };
}

async function bancoPglite(config: Config): Promise<Banco> {
  const emMemoria = config.dirDados === DADOS_EM_MEMORIA;
  if (!emMemoria) mkdirSync(config.dirDados, { recursive: true });
  const parsers = {
    [OID_INT8]: (valor: string) => Number(valor),
    [OID_NUMERIC]: (valor: string) => Number(valor),
    [OID_DATE]: (valor: string) => valor,
  };
  const db = emMemoria ? new PGlite({ parsers }) : new PGlite({ dataDir: config.dirDados, parsers });
  await db.waitReady;
  await db.exec(`set time zone '${config.fuso}'`);
  const emissor = new EventEmitter();
  emissor.setMaxListeners(0);

  const sobreTransacao = (tx: Transaction): Banco => {
    const banco: Banco = {
      tipo: 'pglite',
      async consultar<T>(sql: string, parametros?: unknown[]) {
        const resultado = await tx.query<T>(sql, normalizarParametros(parametros));
        return { linhas: resultado.rows, total: resultado.rows.length || resultado.affectedRows || 0 };
      },
      async executar(sql: string) {
        await tx.exec(sql);
      },
      transacao: (fn) => fn(banco),
      ouvir: () => Promise.reject(new Error('Use ouvir fora de uma transação')),
      async notificar(canal, carga) {
        emissor.emit(validarCanal(canal), carga);
      },
      fechar: async () => undefined,
    };
    return banco;
  };

  return {
    tipo: 'pglite',
    async consultar<T>(sql: string, parametros?: unknown[]) {
      const resultado = await db.query<T>(sql, normalizarParametros(parametros));
      return { linhas: resultado.rows, total: resultado.rows.length || resultado.affectedRows || 0 };
    },
    async executar(sql: string) {
      await db.exec(sql);
    },
    transacao: (fn) => db.transaction((tx) => fn(sobreTransacao(tx))),
    async ouvir(canal, aoReceber) {
      const nome = validarCanal(canal);
      emissor.on(nome, aoReceber);
      return async () => {
        emissor.off(nome, aoReceber);
      };
    },
    async notificar(canal, carga) {
      emissor.emit(validarCanal(canal), carga);
    },
    async fechar() {
      emissor.removeAllListeners();
      await db.close();
    },
  };
}

export async function criarBanco(config: Config): Promise<Banco> {
  return config.urlBanco ? bancoPostgres(config) : bancoPglite(config);
}

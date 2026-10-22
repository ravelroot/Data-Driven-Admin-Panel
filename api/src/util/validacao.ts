import { z } from 'zod';
import { diaValido } from './datas.js';

export const esquemaDia = z.string().refine(diaValido, 'Use o formato AAAA-MM-DD.');

export const esquemaUuid = z.uuid('Identificador inválido.');

export const paramId = z.object({ id: esquemaUuid });

export function esquemaPaginacao<T extends readonly [string, ...string[]]>(camposOrdenacao: T, padrao: T[number]) {
  return z.object({
    pagina: z.coerce.number().int().min(1).default(1),
    porPagina: z.coerce.number().int().min(1).max(100).default(10),
    ordenar: z.enum(camposOrdenacao).default(padrao),
    direcao: z.enum(['asc', 'desc']).default('desc'),
    q: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((valor) => (valor ? valor : undefined)),
  });
}

export const paginacaoSimples = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(10),
});

export function opcional<T extends z.ZodType>(esquema: T) {
  return z.preprocess((valor) => (valor === '' || valor === null ? undefined : valor), esquema.optional());
}

export function textoOpcional(maximo: number) {
  return z.preprocess(
    (valor) => (typeof valor === 'string' ? (valor.trim() === '' ? null : valor.trim()) : valor),
    z.string().max(maximo).nullable().optional(),
  );
}

export interface Pagina<T> {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

export function montarPagina<T>(itens: T[], total: number, pagina: number, porPagina: number): Pagina<T> {
  return { itens, total, pagina, porPagina, paginas: Math.max(1, Math.ceil(total / porPagina)) };
}

export function filtroBusca(q: string): string {
  return `%${q.replace(/[\\%_]/g, (caractere) => `\\${caractere}`)}%`;
}

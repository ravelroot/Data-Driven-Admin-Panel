import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

z.config(z.locales.ptBR());

function ehZod(valor: unknown): valor is z.ZodType {
  return Boolean(valor) && typeof (valor as { safeParse?: unknown }).safeParse === 'function';
}

export function registrarValidacaoZod(app: FastifyInstance): void {
  app.setValidatorCompiler(({ schema }) => (dados: unknown) => {
    if (!ehZod(schema)) return { value: dados };
    const resultado = schema.safeParse(dados);
    if (resultado.success) return { value: resultado.data };
    return { error: resultado.error };
  });
  app.setSerializerCompiler(() => (dados: unknown) => JSON.stringify(dados));
}

function paraJsonSchema(valor: unknown): unknown {
  if (!ehZod(valor)) return valor;
  try {
    const { $schema: _ignorado, ...resto } = z.toJSONSchema(valor, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    return resto;
  } catch {
    return { type: 'object' };
  }
}

export function transformarParaSwagger({ schema, url }: { schema: Record<string, unknown>; url: string }) {
  if (!schema) return { schema, url };
  const convertido: Record<string, unknown> = { ...schema };
  for (const parte of ['body', 'querystring', 'params', 'headers']) {
    if (parte in convertido) convertido[parte] = paraJsonSchema(convertido[parte]);
  }
  return { schema: convertido, url };
}

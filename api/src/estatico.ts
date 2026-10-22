import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

export const PAGINAS: Record<string, string> = {
  '/': 'index.html',
  '/analytics': 'analytics.html',
  '/usuarios': 'usuarios.html',
  '/notificacoes': 'notificacoes.html',
  '/relatorios': 'relatorios.html',
  '/configuracoes': 'configuracoes.html',
  '/componentes': 'componentes.html',
  '/entrar': 'entrar.html',
};

export async function registrarEstatico(app: FastifyInstance): Promise<boolean> {
  const raiz = app.config.dirWeb;
  if (!existsSync(path.join(raiz, 'index.html'))) {
    app.log.info({ raiz }, 'Interface web não encontrada; servindo só a API. Rode "npm run build" para gerar web/dist.');
    return false;
  }
  await app.register(fastifyStatic, {
    root: raiz,
    prefix: '/',
    index: false,
    wildcard: true,
    maxAge: '1h',
    setHeaders: (resposta, caminho) => {
      if (caminho.includes(`${path.sep}assets${path.sep}`)) {
        resposta.header('cache-control', 'public, max-age=31536000, immutable');
      } else if (caminho.endsWith('.html')) {
        resposta.header('cache-control', 'no-cache');
      }
    },
  });
  for (const [rota, arquivo] of Object.entries(PAGINAS)) {
    if (!existsSync(path.join(raiz, arquivo))) continue;
    app.get(rota, { schema: { hide: true } }, (_requisicao, resposta) =>
      resposta.header('cache-control', 'no-cache').sendFile(arquivo),
    );
  }
  return true;
}

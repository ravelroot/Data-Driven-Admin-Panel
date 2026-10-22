import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import './tipos.js';
import { iniciarAgendador } from './agendador.js';
import { criarBanco, type Banco } from './banco/conexao.js';
import { VERSAO, type Config } from './config.js';
import { registrarEstatico } from './estatico.js';
import { rotasAnalytics } from './modulos/analytics/rotas.js';
import { rotasAtividades } from './modulos/atividades/rotas.js';
import { rotasAuth } from './modulos/auth/rotas.js';
import { rotasBusca } from './modulos/busca/rotas.js';
import { rotasConfiguracoes } from './modulos/configuracoes/rotas.js';
import { rotasIntegracoes } from './modulos/integracoes/rotas.js';
import { rotasNotificacoes } from './modulos/notificacoes/rotas.js';
import { rotasRelatorios } from './modulos/relatorios/rotas.js';
import { rotasTransacoes } from './modulos/transacoes/rotas.js';
import { rotasUsuarios } from './modulos/usuarios/rotas.js';
import { rotasVisaoGeral } from './modulos/visao-geral/rotas.js';
import { registrarAutenticacao } from './plugins/autenticacao.js';
import { registrarErros } from './plugins/erros.js';
import { registrarValidacaoZod, transformarParaSwagger } from './plugins/esquemas.js';
import { iniciarSimulador } from './simulador.js';
import { criarBarramento } from './tempo-real/barramento.js';
import { ErroApi } from './util/erros.js';

export interface OpcoesApp {
  config: Config;
  banco?: Banco;
  registrarLogs?: boolean;
  iniciarTarefas?: boolean;
}

export async function construirApp(opcoes: OpcoesApp): Promise<FastifyInstance> {
  const { config } = opcoes;
  const app = Fastify({
    logger: opcoes.registrarLogs === false ? false : { level: config.log },
    trustProxy: config.proxyConfiavel,
    bodyLimit: 1_048_576,
  });

  registrarValidacaoZod(app);
  const analisarJson = app.getDefaultJsonParser('error', 'remove');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (requisicao, corpo, pronto) => {
    const texto = typeof corpo === 'string' ? corpo : corpo.toString('utf8');
    if (texto.trim() === '') {
      pronto(null, undefined);
      return;
    }
    analisarJson(requisicao, texto, pronto);
  });
  const banco = opcoes.banco ?? (await criarBanco(config));
  const barramento = criarBarramento(banco, app.log);
  app.decorate('config', config);
  app.decorate('banco', banco);
  app.decorate('barramento', barramento);

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.https ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.https,
  });
  if (config.origens.length > 0) {
    await app.register(fastifyCors, { origin: config.origens, credentials: true, allowedHeaders: ['content-type', 'x-bento', 'authorization'] });
  }
  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_requisicao, contexto) => ({
      statusCode: 429,
      message: `Limite de ${contexto.max} requisições atingido. Tente de novo em ${contexto.after}.`,
    }),
  });
  await app.register(fastifyJwt, { secret: config.segredoJwt });
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Bento API',
        description: 'API do painel administrativo Bento: métricas, analytics, usuários, notificações, relatórios e configurações.',
        version: VERSAO,
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          cookieSessao: { type: 'apiKey', in: 'cookie', name: 'bento_sessao' },
          chaveApi: { type: 'http', scheme: 'bearer', description: 'Chave de API bnt_... criada em Configurações › Segurança' },
        },
      },
      security: [{ cookieSessao: [] }, { chaveApi: [] }],
    },
    transform: transformarParaSwagger as never,
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/api/v1/docs', uiConfig: { docExpansion: 'list', deepLinking: true } });

  registrarErros(app);
  registrarAutenticacao(app);

  await app.register(
    async (api) => {
      api.get('/saude', { schema: { tags: ['Sistema'], summary: 'Saúde da API e do banco' } }, async () => {
        await banco.consultar('select 1');
        return { status: 'ok', banco: banco.tipo, versao: VERSAO, uptime: Math.round(process.uptime()) };
      });
      await api.register(rotasAuth);
      await api.register(rotasVisaoGeral);
      await api.register(rotasAnalytics);
      await api.register(rotasTransacoes);
      await api.register(rotasUsuarios);
      await api.register(rotasNotificacoes);
      await api.register(rotasRelatorios);
      await api.register(rotasConfiguracoes);
      await api.register(rotasIntegracoes);
      await api.register(rotasAtividades);
      await api.register(rotasBusca);
    },
    { prefix: '/api/v1', logLevel: config.log === 'debug' || config.log === 'trace' ? config.log : 'warn' },
  );

  const temWeb = await registrarEstatico(app);

  app.setNotFoundHandler((requisicao, resposta) => {
    if (requisicao.url.startsWith('/api/') || !temWeb || requisicao.method !== 'GET') {
      return resposta.status(404).send(new ErroApi('NAO_ENCONTRADO', 'Rota não encontrada.').paraJson());
    }
    return resposta.redirect('/');
  });

  const paradas: (() => void)[] = [];
  app.addHook('onReady', async () => {
    await barramento.iniciar();
    if (opcoes.iniciarTarefas) {
      paradas.push(iniciarAgendador(app));
      if (config.simulador) paradas.push(iniciarSimulador(app));
    }
  });
  app.addHook('onClose', async () => {
    for (const parar of paradas) parar();
    await barramento.parar();
    if (!opcoes.banco) await banco.fechar();
  });

  return app;
}

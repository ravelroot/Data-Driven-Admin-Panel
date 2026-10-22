import { construirApp } from './app.js';
import { garantirAdministrador } from './banco/administrador.js';
import { aplicarMigracoes, bancoVazio } from './banco/migrar.js';
import { semear } from './banco/semente.js';
import { DADOS_EM_MEMORIA, lerConfig } from './config.js';

const config = lerConfig();
const app = await construirApp({ config, iniciarTarefas: true });

try {
  const aplicadas = await aplicarMigracoes(app.banco);
  if (aplicadas.length > 0) app.log.info({ migracoes: aplicadas }, 'Migrações aplicadas');
  if (config.semear && (await bancoVazio(app.banco))) {
    app.log.info('Banco vazio: criando os dados de demonstração (leva alguns segundos)');
    const resumo = await semear(app.banco, config.fuso);
    app.log.info(resumo, 'Dados de demonstração criados');
  }
  if (config.admin && (await garantirAdministrador(app.banco, config.admin)) === 'criado') {
    app.log.info({ email: config.admin.email.toLowerCase() }, 'Conta de administrador criada');
  }
  if (config.segredoGerado) {
    app.log.warn('BENTO_SEGREDO_JWT não definido: usando um segredo gerado em dados/segredo. Defina o seu em produção.');
  }
  await app.listen({ port: config.porta, host: config.host });
  const local = config.host === '0.0.0.0' ? 'localhost' : config.host;
  const origemBanco = app.banco.tipo === 'postgresql' ? 'PostgreSQL' : config.dirDados === DADOS_EM_MEMORIA ? 'PGlite em memória' : `PGlite em ${config.dirDados}`;
  app.log.info(`Bento pronto em http://${local}:${config.porta} · API em /api/v1 · documentação em /api/v1/docs · banco: ${origemBanco}`);
} catch (erro) {
  app.log.error(erro);
  await app.close().catch(() => undefined);
  process.exit(1);
}

let encerrando = false;
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    if (encerrando) return;
    encerrando = true;
    app.log.info(`Recebido ${sinal}; encerrando`);
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

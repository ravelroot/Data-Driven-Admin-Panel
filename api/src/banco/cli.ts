import { lerConfig } from '../config.js';
import { garantirAdministrador } from './administrador.js';
import { criarBanco } from './conexao.js';
import { aplicarMigracoes, bancoVazio } from './migrar.js';
import { semear } from './semente.js';

const comando = process.argv[2];
const config = lerConfig();
const banco = await criarBanco(config);

try {
  if (comando === 'migrar') {
    const aplicadas = await aplicarMigracoes(banco);
    console.log(aplicadas.length ? `Migrações aplicadas: ${aplicadas.join(', ')}` : 'O banco já está atualizado.');
  } else if (comando === 'semear') {
    await aplicarMigracoes(banco);
    if (!(await bancoVazio(banco))) {
      console.log('O banco já tem usuários; a semente só roda em banco vazio. Apague a pasta de dados do PGlite ou use um banco novo.');
    } else {
      const resumo = await semear(banco, config.fuso);
      console.log(
        `Dados de demonstração criados: ${resumo.usuarios} usuários, ${resumo.assinaturas} assinaturas e ${resumo.transacoes} transações em ${(resumo.milissegundos / 1000).toFixed(1)} s.`,
      );
    }
  } else if (comando === 'admin') {
    if (!config.admin) {
      console.log('Defina BENTO_ADMIN_EMAIL e BENTO_ADMIN_SENHA (e, se quiser, BENTO_ADMIN_NOME) no .env ou no ambiente e rode de novo.');
      process.exitCode = 1;
    } else {
      await aplicarMigracoes(banco);
      const resultado = await garantirAdministrador(banco, config.admin);
      console.log(
        resultado === 'criado'
          ? `Administrador ${config.admin.email.toLowerCase()} criado. Entre com a senha definida em BENTO_ADMIN_SENHA.`
          : `Já existe uma conta com o e-mail ${config.admin.email.toLowerCase()}; nada foi alterado.`,
      );
    }
  } else {
    console.log('Uso: npm run migrar | npm run semear | npm run admin');
    process.exitCode = 1;
  }
} finally {
  await banco.fechar();
}

import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DADOS_EM_MEMORIA, lerConfig, raizProjeto, type Config } from './config.js';
import { garantirAdministrador } from './banco/administrador.js';
import { criarBanco, type Banco } from './banco/conexao.js';
import { aplicarMigracoes, bancoVazio } from './banco/migrar.js';
import { semear } from './banco/semente.js';
import { abrirArquivoBackup, lerLinhasBackup, podarBackups, restaurarBackup, salvarBackup } from './operacao/backup.js';
import { executarDiagnostico, formatarDiagnostico } from './operacao/diagnostico.js';
import { executarLimpeza, previaLimpeza, totalRemovido } from './operacao/retencao.js';

const AJUDA = `Uso: npm run <comando> [-- opções]

  migrar                     aplica as migrações pendentes
  semear                     cria os dados de demonstração em um banco vazio
  admin                      cria o administrador de BENTO_ADMIN_EMAIL e BENTO_ADMIN_SENHA
  diagnostico [--json]       confere ambiente, configuração, banco e segurança
  backup [--pasta <pasta>]   grava um backup completo em .ndjson.gz
  restaurar <arquivo> [--sim]
                             substitui TODOS os dados pelos do backup
  limpar [--simular]         aplica a política de retenção (BENTO_RETENCAO_*)`;

const argumentos = process.argv.slice(2);
const comando = argumentos[0];
const opcao = (nome: string): boolean => argumentos.includes(`--${nome}`);
const valorOpcao = (nome: string): string | undefined => {
  const indice = argumentos.indexOf(`--${nome}`);
  return indice >= 0 ? argumentos[indice + 1] : undefined;
};
const posicional = (): string | undefined => argumentos.slice(1).find((argumento, indice, lista) => !argumento.startsWith('--') && !lista[indice - 1]?.startsWith('--pasta'));

const formatarBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

async function servidorNoAr(config: Config): Promise<boolean> {
  try {
    const resposta = await fetch(`http://127.0.0.1:${config.porta}/api/v1/saude/vivo`, { signal: AbortSignal.timeout(800) });
    return resposta.ok;
  } catch {
    return false;
  }
}

async function confirmar(pergunta: string): Promise<boolean> {
  if (opcao('sim')) return true;
  if (!process.stdin.isTTY) return false;
  const leitor = createInterface({ input: process.stdin, output: process.stdout });
  const resposta = await leitor.question(`${pergunta} Digite "restaurar" para continuar: `);
  leitor.close();
  return resposta.trim().toLowerCase() === 'restaurar';
}

async function executar(config: Config, banco: Banco): Promise<number> {
  if (comando === 'migrar') {
    const aplicadas = await aplicarMigracoes(banco);
    console.log(aplicadas.length ? `Migrações aplicadas: ${aplicadas.join(', ')}` : 'O banco já está atualizado.');
    return 0;
  }

  if (comando === 'semear') {
    await aplicarMigracoes(banco);
    if (!(await bancoVazio(banco))) {
      console.log('O banco já tem usuários; a semente só roda em banco vazio. Apague a pasta de dados do PGlite ou use um banco novo.');
      return 0;
    }
    const resumo = await semear(banco, config.fuso);
    console.log(
      `Dados de demonstração criados: ${resumo.usuarios} usuários, ${resumo.assinaturas} assinaturas e ${resumo.transacoes} transações em ${(resumo.milissegundos / 1000).toFixed(1)} s.`,
    );
    return 0;
  }

  if (comando === 'admin') {
    if (!config.admin) {
      console.log('Defina BENTO_ADMIN_EMAIL e BENTO_ADMIN_SENHA (e, se quiser, BENTO_ADMIN_NOME) no .env ou no ambiente e rode de novo.');
      return 1;
    }
    await aplicarMigracoes(banco);
    const resultado = await garantirAdministrador(banco, config.admin);
    console.log(
      resultado === 'criado'
        ? `Administrador ${config.admin.email.toLowerCase()} criado. Entre com a senha definida em BENTO_ADMIN_SENHA.`
        : `Já existe uma conta com o e-mail ${config.admin.email.toLowerCase()}; nada foi alterado.`,
    );
    return 0;
  }

  if (comando === 'diagnostico') {
    const resultado = await executarDiagnostico(config, banco);
    console.log(opcao('json') ? JSON.stringify(resultado, null, 2) : formatarDiagnostico(resultado, Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));
    return resultado.resumo.erro > 0 ? 1 : 0;
  }

  if (comando === 'backup') {
    const pasta = valorOpcao('pasta') ? path.resolve(valorOpcao('pasta') as string) : config.backup.pasta;
    const resumo = await salvarBackup(banco, pasta, 'manual');
    console.log(`Backup gravado em ${resumo.arquivo} (${resumo.registros} registros de ${resumo.tabelas} tabelas, ${formatarBytes(resumo.bytes)}).`);
    if (config.backup.automatico !== 'desligado') podarBackups(pasta, Math.max(config.backup.manter, 1) + 50);
    return 0;
  }

  if (comando === 'restaurar') {
    const arquivo = posicional();
    if (!arquivo) {
      console.log('Informe o arquivo: npm run restaurar -- dados/backups/bento-backup-AAAAMMDD-HHMMSS.ndjson.gz');
      return 1;
    }
    const caminho = path.isAbsolute(arquivo) ? arquivo : path.resolve(process.env.INIT_CWD ?? raizProjeto, arquivo);
    if (!(await confirmar(`Isto apaga todos os dados atuais de ${banco.tipo === 'postgresql' ? 'PostgreSQL' : 'PGlite'} e restaura ${path.basename(caminho)}.`))) {
      console.log('Restauração cancelada. Para confirmar sem perguntar, use --sim.');
      return 1;
    }
    const resumo = await restaurarBackup(banco, lerLinhasBackup(abrirArquivoBackup(caminho)));
    console.log(
      `Backup restaurado: ${resumo.registros} registros de ${resumo.tabelas} tabelas, feito pelo Bento ${resumo.bento} em ${new Date(resumo.criadoEm).toLocaleString('pt-BR')}.`,
    );
    if (resumo.migracoesPosteriores.length) console.log(`Migrações aplicadas depois: ${resumo.migracoesPosteriores.join(', ')}.`);
    return 0;
  }

  if (comando === 'limpar') {
    await aplicarMigracoes(banco);
    const itens = opcao('simular') ? await previaLimpeza(banco, config.retencao) : await executarLimpeza(banco, config.retencao);
    for (const item of itens) {
      const regra = item.dias > 0 ? `mais de ${item.dias} dias` : 'sem limite';
      console.log(`  ${item.nome} (${regra}): ${item.registros}${item.bytes ? `, ${formatarBytes(item.bytes)}` : ''}`);
    }
    console.log(opcao('simular') ? `Seriam removidos ${totalRemovido(itens)} registros.` : `Removidos ${totalRemovido(itens)} registros.`);
    return 0;
  }

  console.log(AJUDA);
  return comando ? 1 : 0;
}

const config = lerConfig();
if (comando && config.urlBanco === null && config.dirDados !== DADOS_EM_MEMORIA && (await servidorNoAr(config))) {
  console.log(
    'O Bento está rodando com o banco embutido (PGlite), que não aceita dois processos ao mesmo tempo. Pare o servidor antes de usar este comando ou, para backups, use Configurações › Status do sistema.',
  );
  process.exit(1);
}

let banco: Banco | null = null;
try {
  banco = comando ? await criarBanco(config) : null;
  process.exitCode = banco ? await executar(config, banco) : await executar(config, null as unknown as Banco);
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
} finally {
  await banco?.fechar();
}

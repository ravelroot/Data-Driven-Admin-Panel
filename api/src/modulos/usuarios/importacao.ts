import type { FastifyInstance } from 'fastify';
import { lerCsv, normalizarCabecalho } from '../../util/csv-leitura.js';
import { semPermissao, validacao } from '../../util/erros.js';
import { registrarAtividade } from '../comum/auditoria.js';
import { criarNotificacao } from '../notificacoes/servico.js';
import type { Ator } from './servico.js';

export const LIMITE_LINHAS_IMPORTACAO = 2_000;
const LIMITE_LINHAS_RESPOSTA = 500;
const CANAIS = ['Orgânico', 'Direto', 'Pago', 'Social', 'Indicação', 'E-mail'];
const STATUS_IMPORTAVEIS = ['ativo', 'pendente', 'inativo'] as const;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Campo = 'nome' | 'email' | 'papel' | 'status' | 'cargo' | 'empresa' | 'telefone' | 'pais' | 'cidade' | 'canal';

const SINONIMOS: Record<Campo, string[]> = {
  nome: ['nome', 'nomecompleto', 'name', 'fullname'],
  email: ['email', 'mail', 'emailaddress', 'correioeletronico'],
  papel: ['papel', 'funcao', 'perfil', 'role'],
  status: ['status', 'situacao', 'estado'],
  cargo: ['cargo', 'titulo', 'jobtitle', 'title'],
  empresa: ['empresa', 'organizacao', 'company', 'organization'],
  telefone: ['telefone', 'fone', 'celular', 'phone', 'whatsapp'],
  pais: ['pais', 'country'],
  cidade: ['cidade', 'city', 'municipio'],
  canal: ['canal', 'origem', 'channel', 'source'],
};

const LIMITES: Partial<Record<Campo, number>> = { cargo: 80, empresa: 120, telefone: 30, pais: 60, cidade: 80 };

export interface OpcoesImportacao {
  csv: string;
  simular: boolean;
  papelPadrao: string;
  statusPadrao: (typeof STATUS_IMPORTAVEIS)[number];
}

export interface LinhaImportacao {
  linha: number;
  nome: string;
  email: string;
  papel: string;
  situacao: 'criar' | 'ignorar' | 'erro';
  mensagem: string;
}

export interface ResultadoImportacao {
  simulacao: boolean;
  total: number;
  criar: number;
  ignorar: number;
  erros: number;
  criados: number;
  colunas: { reconhecidas: string[]; ignoradas: string[] };
  linhas: LinhaImportacao[];
  linhasOmitidas: number;
}

interface Registro {
  nome: string;
  email: string;
  papel: string;
  status: string;
  cargo: string | null;
  empresa: string | null;
  telefone: string | null;
  pais: string | null;
  cidade: string | null;
  canal: string | null;
}

const semAcento = (texto: string): string => normalizarCabecalho(texto);

export const MODELO_IMPORTACAO = [
  'nome;email;papel;status;cargo;empresa;telefone;cidade;pais;canal',
  'Marina Lopes;marina@suaempresa.com;analista;ativo;Analista de dados;Sua Empresa;+55 11 90000-0000;São Paulo;Brasil;Direto',
  'Caio Prado;caio@cliente.com;cliente;ativo;;Cliente Ltda;;Recife;Brasil;Orgânico',
].join('\r\n');

function mapearColunas(cabecalho: string[]): { indices: Partial<Record<Campo, number>>; reconhecidas: string[]; ignoradas: string[] } {
  const indices: Partial<Record<Campo, number>> = {};
  const reconhecidas: string[] = [];
  const ignoradas: string[] = [];
  cabecalho.forEach((titulo, indice) => {
    const chave = semAcento(titulo);
    const campo = (Object.keys(SINONIMOS) as Campo[]).find((candidato) => SINONIMOS[candidato].includes(chave));
    if (campo && indices[campo] === undefined) {
      indices[campo] = indice;
      reconhecidas.push(campo);
    } else if (titulo.trim()) {
      ignoradas.push(titulo.trim());
    }
  });
  return { indices, reconhecidas, ignoradas };
}

export async function importarUsuarios(app: FastifyInstance, ator: Ator, opcoes: OpcoesImportacao): Promise<ResultadoImportacao> {
  const { banco } = app;
  const tabela = lerCsv(opcoes.csv);
  if (tabela.length < 2) throw validacao('A planilha precisa da linha de cabeçalho e de pelo menos uma conta.');
  const [cabecalho, ...dados] = tabela;
  if (dados.length > LIMITE_LINHAS_IMPORTACAO) {
    throw validacao(`Importe no máximo ${LIMITE_LINHAS_IMPORTACAO} contas por vez (a planilha tem ${dados.length}).`);
  }
  const { indices, reconhecidas, ignoradas } = mapearColunas(cabecalho ?? []);
  if (indices.nome === undefined || indices.email === undefined) {
    throw validacao('A planilha precisa das colunas "nome" e "email" no cabeçalho.');
  }

  const { linhas: papeis } = await banco.consultar<{ codigo: string; nome: string }>('select codigo, nome from papeis');
  const papelPorChave = new Map<string, string>();
  for (const papel of papeis) {
    papelPorChave.set(semAcento(papel.codigo), papel.codigo);
    papelPorChave.set(semAcento(papel.nome), papel.codigo);
  }
  const papelPadrao = papelPorChave.get(semAcento(opcoes.papelPadrao));
  if (!papelPadrao) throw validacao('Papel padrão inexistente.', [{ campo: 'papelPadrao', mensagem: 'Escolha um papel válido.' }]);
  const podePermissoes = ator.usuario.permissoes.has('usuarios.permissoes');
  if (!podePermissoes && ['admin', 'gerente'].includes(papelPadrao)) {
    throw semPermissao('Só quem controla permissões pode importar administradores e gerentes.');
  }

  const valor = (celulas: string[], campo: Campo): string => {
    const indice = indices[campo];
    return indice === undefined ? '' : (celulas[indice] ?? '').trim();
  };

  const emails = dados.map((celulas) => valor(celulas, 'email').toLowerCase()).filter(Boolean);
  const { linhas: existentes } = await banco.consultar<{ email: string }>('select lower(email) as email from usuarios where lower(email) = any($1::text[])', [
    emails,
  ]);
  const jaCadastrados = new Set(existentes.map((linha) => linha.email));
  const vistos = new Set<string>();

  const resultado: LinhaImportacao[] = [];
  const validos: Registro[] = [];
  dados.forEach((celulas, posicao) => {
    const numero = posicao + 2;
    const nome = valor(celulas, 'nome').replace(/\s+/g, ' ');
    const email = valor(celulas, 'email').toLowerCase();
    const papelBruto = valor(celulas, 'papel');
    const papel = papelBruto ? papelPorChave.get(semAcento(papelBruto)) : papelPadrao;
    const statusBruto = semAcento(valor(celulas, 'status'));
    const status = statusBruto ? STATUS_IMPORTAVEIS.find((opcao) => opcao === statusBruto) : opcoes.statusPadrao;
    const canalBruto = valor(celulas, 'canal');
    const canal = canalBruto ? CANAIS.find((opcao) => semAcento(opcao) === semAcento(canalBruto)) : null;
    const base = { linha: numero, nome, email, papel: papel ?? papelBruto };
    const erro = (mensagem: string) => resultado.push({ ...base, situacao: 'erro', mensagem });

    if (nome.length < 2 || nome.length > 120) return erro('O nome precisa ter de 2 a 120 caracteres.');
    if (!EMAIL.test(email) || email.length > 254) return erro('E-mail inválido.');
    if (!papel) return erro(`Papel "${papelBruto}" não existe.`);
    if (!podePermissoes && ['admin', 'gerente'].includes(papel)) return erro('Só quem controla permissões cadastra administradores e gerentes.');
    if (!status) return erro('Status deve ser ativo, pendente ou inativo.');
    if (canalBruto && !canal) return erro(`Canal "${canalBruto}" não existe. Use ${CANAIS.join(', ')}.`);
    for (const [campo, limite] of Object.entries(LIMITES) as [Campo, number][]) {
      if (valor(celulas, campo).length > limite) return erro(`O campo ${campo} passa de ${limite} caracteres.`);
    }
    if (jaCadastrados.has(email)) return resultado.push({ ...base, situacao: 'ignorar', mensagem: 'Já existe uma conta com este e-mail.' });
    if (vistos.has(email)) return resultado.push({ ...base, situacao: 'ignorar', mensagem: 'E-mail repetido na planilha.' });
    vistos.add(email);
    const opcional = (campo: Campo) => valor(celulas, campo) || null;
    validos.push({
      nome,
      email,
      papel,
      status,
      cargo: opcional('cargo'),
      empresa: opcional('empresa'),
      telefone: opcional('telefone'),
      pais: opcional('pais'),
      cidade: opcional('cidade'),
      canal: canal ?? null,
    });
    resultado.push({ ...base, situacao: 'criar', mensagem: status === 'ativo' ? 'Pronta para criar.' : `Pronta para criar como ${status}.` });
  });

  let criados = 0;
  if (!opcoes.simular && validos.length > 0) {
    criados = await banco.transacao(async (tx) => {
      const { linhas } = await tx.consultar<{ id: string }>(
        `insert into usuarios (nome, email, papel, status, cargo, empresa, telefone, pais, cidade, canal)
         select x.nome, lower(x.email), x.papel, x.status, x.cargo, x.empresa, x.telefone, x.pais, x.cidade, x.canal
           from jsonb_to_recordset($1::jsonb) as x(nome text, email text, papel text, status text, cargo text, empresa text,
                                                   telefone text, pais text, cidade text, canal text)
         on conflict ((lower(email))) do nothing
         returning id`,
        [JSON.stringify(validos)],
      );
      await registrarAtividade(tx, {
        usuarioId: ator.usuario.id,
        acao: 'usuario.importados',
        entidade: 'usuario',
        descricao: `importou ${linhas.length} ${linhas.length === 1 ? 'conta' : 'contas'} de uma planilha CSV`,
        detalhes: {
          criados: linhas.length,
          ignorados: resultado.filter((linha) => linha.situacao === 'ignorar').length,
          erros: resultado.filter((linha) => linha.situacao === 'erro').length,
        },
        ip: ator.ip,
      });
      return linhas.length;
    });
    if (criados > 0) {
      await criarNotificacao(banco, app.barramento, {
        destinatarioId: null,
        tipo: 'info',
        categoria: 'usuario',
        titulo: 'Usuários importados',
        mensagem: `${ator.usuario.nome} importou ${criados} ${criados === 1 ? 'conta' : 'contas'} de uma planilha.`,
        link: '/usuarios',
        criadoPor: ator.usuario.id,
      });
    }
  }

  const contar = (situacao: LinhaImportacao['situacao']) => resultado.filter((linha) => linha.situacao === situacao).length;
  const ordenadas = [...resultado].sort((a, b) => {
    const peso = { erro: 0, ignorar: 1, criar: 2 } as const;
    return peso[a.situacao] - peso[b.situacao] || a.linha - b.linha;
  });
  return {
    simulacao: opcoes.simular,
    total: dados.length,
    criar: contar('criar'),
    ignorar: contar('ignorar'),
    erros: contar('erro'),
    criados,
    colunas: { reconhecidas, ignoradas },
    linhas: ordenadas.slice(0, LIMITE_LINHAS_RESPOSTA),
    linhasOmitidas: Math.max(0, ordenadas.length - LIMITE_LINHAS_RESPOSTA),
  };
}

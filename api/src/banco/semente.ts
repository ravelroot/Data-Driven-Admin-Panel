import { randomUUID } from 'node:crypto';
import type { Banco } from './conexao.js';
import { gerarHashSenha } from '../modulos/auth/servico.js';
import { gerarArquivo, nomePadrao, proximaExecucao } from '../modulos/relatorios/servico.js';
import {
  diaLocal,
  diferencaDias,
  horaLocal,
  inicioDoDia,
  primeiroDiaDoMes,
  rotuloMes,
  somarDias,
  somarMeses,
} from '../util/datas.js';
import { formatarMoeda, slug } from '../util/formato.js';
import {
  CANAIS,
  CARGOS,
  CIDADES,
  criarSorteio,
  DISPOSITIVOS,
  escolher,
  escolherPonderado,
  gerarEmpresa,
  PAISES,
  PAISES_TRAFEGO,
  PRIMEIROS_NOMES,
  SOBRENOMES,
  type Sorteio,
} from './ficticios.js';

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
const SEMENTE = 20_261_022;
const DIAS_HISTORICO = 730;

const PLANOS = [
  { codigo: 'essencial', nome: 'Essencial', mensal: 4_900, anual: 49_000, peso: 40 },
  { codigo: 'profissional', nome: 'Profissional', mensal: 12_900, anual: 129_000, peso: 35 },
  { codigo: 'equipe', nome: 'Equipe', mensal: 29_900, anual: 299_000, peso: 18 },
  { codigo: 'empresa', nome: 'Empresa', mensal: 79_900, anual: 799_000, peso: 7 },
] as const;

const METODOS = [
  { nome: 'cartao' as const, peso: 62 },
  { nome: 'pix' as const, peso: 28 },
  { nome: 'boleto' as const, peso: 10 },
];

const PESOS_HORA = [1, 0.5, 0.3, 0.2, 0.2, 0.4, 1, 2, 3.5, 4.5, 5, 5, 4.6, 4.8, 5, 5, 4.8, 4.5, 4, 4.2, 4.4, 3.8, 2.8, 1.8];
const PESOS_SEMANA = [0.62, 1.05, 1.1, 1.08, 1.04, 0.96, 0.72];

const MOTIVOS_BLOQUEIO = [
  'Suspeita de fraude no pagamento',
  'Violação dos termos de uso',
  'Contestação de cobrança em aberto',
  'Pedido do titular da conta',
  'Compartilhamento indevido de acesso',
];

const MOTIVOS_CANCELAMENTO = [
  'Preço acima do orçamento',
  'Migrou para outra ferramenta',
  'Projeto encerrado',
  'Pouco uso no período',
  'Faltou um recurso necessário',
];

export const CONTAS_EQUIPE = [
  { nome: 'Ana Martins', email: 'admin@bento.local', papel: 'admin', cargo: 'Head de Operações', cidade: 'São Paulo' },
  { nome: 'Bruno Costa', email: 'gerente@bento.local', papel: 'gerente', cargo: 'Gerente de Produto', cidade: 'Curitiba' },
  { nome: 'Carla Dias', email: 'analista@bento.local', papel: 'analista', cargo: 'Analista de Dados', cidade: 'Belo Horizonte' },
  { nome: 'Diego Rocha', email: 'suporte@bento.local', papel: 'suporte', cargo: 'Analista de Suporte', cidade: 'Recife' },
] as const;

export const SENHA_DEMONSTRACAO = 'bento123';

interface Cliente {
  id: string;
  nome: string;
  email: string;
  criadoEm: number;
  dia: string;
  pais: string;
  cidade: string;
  canal: string;
  dispositivo: string;
  empresa: string | null;
  cargo: string | null;
  status: 'ativo' | 'bloqueado' | 'pendente' | 'inativo';
  bloqueadoEm: number | null;
  motivoBloqueio: string | null;
  ultimoAcesso: number | null;
}

interface Assinatura {
  id: string;
  usuarioId: string;
  plano: string;
  status: 'ativa' | 'teste' | 'cancelada' | 'inadimplente';
  ciclo: 'mensal' | 'anual';
  metodo: 'cartao' | 'pix' | 'boleto';
  valor: number;
  iniciadaEm: number;
  testeAte: number | null;
  convertidaEm: number | null;
  renovacaoEm: number | null;
  canceladaEm: number | null;
  motivo: string | null;
}

interface Transacao {
  usuarioId: string;
  assinaturaId: string | null;
  plano: string | null;
  nome: string;
  email: string;
  tipo: 'assinatura' | 'upgrade' | 'avulsa';
  metodo: 'cartao' | 'pix' | 'boleto';
  status: 'paga' | 'pendente' | 'falhou' | 'reembolsada';
  valor: number;
  criadoEm: number;
}

interface Evento {
  quando: number;
  usuarioId: string | null;
  acao: string;
  descricao: string;
  entidade: string | null;
  entidadeId: string | null;
}

interface NovaNotificacao {
  quando: number;
  destinatarioId: string | null;
  tipo: 'info' | 'sucesso' | 'alerta' | 'erro';
  categoria: 'transacao' | 'usuario' | 'sistema' | 'seguranca' | 'relatorio';
  titulo: string;
  mensagem: string;
  link: string | null;
}

export interface ResumoSemente {
  usuarios: number;
  assinaturas: number;
  transacoes: number;
  milissegundos: number;
}

async function inserirEmLote(
  banco: Banco,
  tabela: string,
  colunas: string[],
  linhas: unknown[][],
  conversoes: Record<string, string> = {},
): Promise<void> {
  if (linhas.length === 0) return;
  const porLote = Math.max(1, Math.floor(16_000 / colunas.length));
  const sufixos = colunas.map((coluna) => conversoes[coluna] ?? '');
  for (let inicio = 0; inicio < linhas.length; inicio += porLote) {
    const lote = linhas.slice(inicio, inicio + porLote);
    const parametros: unknown[] = [];
    const valores = lote.map(
      (linha) =>
        `(${linha
          .map((valor, indice) => {
            parametros.push(valor);
            return `$${parametros.length}${sufixos[indice]}`;
          })
          .join(',')})`,
    );
    await banco.consultar(`insert into ${tabela} (${colunas.join(', ')}) values ${valores.join(', ')}`, parametros);
  }
}

function horaAleatoria(sorteio: Sorteio): number {
  return escolherPonderado(
    sorteio,
    PESOS_HORA.map((peso, hora) => ({ hora, peso })),
  ).hora;
}

function somarMesesInstante(instante: number, meses: number): number {
  const data = new Date(instante);
  const dia = data.getUTCDate();
  data.setUTCDate(1);
  data.setUTCMonth(data.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 0)).getUTCDate();
  data.setUTCDate(Math.min(dia, ultimo));
  return data.getTime();
}

function data(instante: number | null): Date | null {
  return instante === null ? null : new Date(instante);
}

export async function semear(banco: Banco, fuso: string, opcoes: { escala?: number } = {}): Promise<ResumoSemente> {
  const comeco = Date.now();
  const escala = opcoes.escala ?? 1;
  const sorteio = criarSorteio(SEMENTE);
  const agora = Date.now();
  const hoje = diaLocal(new Date(agora), fuso);
  const inicioHistorico = somarDias(hoje, -DIAS_HISTORICO);
  const fracaoHoje = Math.max(0.05, horaLocal(new Date(agora), fuso) / 24);
  const hashSenha = await gerarHashSenha(SENHA_DEMONSTRACAO);

  const equipe = CONTAS_EQUIPE.map((conta, indice) => ({
    ...conta,
    id: randomUUID(),
    criadoEm: inicioDoDia(somarDias(inicioHistorico, -30 + indice * 3), fuso).getTime() + 10 * HORA_MS,
    ultimoAcesso: agora - Math.round((indice + 1) * 37 * 60_000 * (1 + sorteio())),
  }));
  const [admin, gerente, analista, suporte] = equipe;

  const pesosDia: number[] = [];
  for (let d = 0; d <= DIAS_HISTORICO; d += 1) {
    const dia = somarDias(inicioHistorico, d);
    const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
    const fator = d === DIAS_HISTORICO ? fracaoHoje : 1;
    pesosDia.push(Math.exp((Math.log(3) * d) / DIAS_HISTORICO) * PESOS_SEMANA[semana] * (0.8 + sorteio() * 0.4) * fator);
  }
  const alvoClientes = Math.round(2_400 * escala);
  const fatorDia = alvoClientes / pesosDia.reduce((soma, peso) => soma + peso, 0);

  const clientes: Cliente[] = [];
  const emailsUsados = new Map<string, number>();
  for (let d = 0; d <= DIAS_HISTORICO; d += 1) {
    const dia = somarDias(inicioHistorico, d);
    const esperado = pesosDia[d] * fatorDia;
    const quantidade = Math.floor(esperado) + (sorteio() < esperado - Math.floor(esperado) ? 1 : 0);
    const inicioDia = inicioDoDia(dia, fuso).getTime();
    for (let i = 0; i < quantidade; i += 1) {
      const criadoEm = inicioDia + horaAleatoria(sorteio) * HORA_MS + Math.floor(sorteio() * HORA_MS);
      if (criadoEm >= agora) continue;
      const primeiro = escolher(sorteio, PRIMEIROS_NOMES);
      const sobrenome = escolher(sorteio, SOBRENOMES);
      const base = `${slug(primeiro)}.${slug(sobrenome)}`;
      const repeticao = (emailsUsados.get(base) ?? 0) + 1;
      emailsUsados.set(base, repeticao);
      const pais = escolherPonderado(sorteio, PAISES);
      clientes.push({
        id: randomUUID(),
        nome: `${primeiro} ${sobrenome}`,
        email: `${base}${repeticao}@exemplo.com`,
        criadoEm,
        dia,
        pais: pais.nome,
        cidade: escolher(sorteio, CIDADES[pais.codigo]),
        canal: escolherPonderado(sorteio, CANAIS).nome,
        dispositivo: escolherPonderado(sorteio, DISPOSITIVOS).nome,
        empresa: sorteio() < 0.72 ? gerarEmpresa(sorteio) : null,
        cargo: sorteio() < 0.6 ? escolher(sorteio, CARGOS) : null,
        status: 'ativo',
        bloqueadoEm: null,
        motivoBloqueio: null,
        ultimoAcesso: null,
      });
    }
  }

  const assinaturas: Assinatura[] = [];
  const transacoes: Transacao[] = [];
  const eventos: Evento[] = [];
  const conversoesPorChave = new Map<string, number>();
  const assinaturaPorCliente = new Map<string, Assinatura>();
  const limiteEventos = agora - 30 * DIA_MS;

  const novaTransacao = (cliente: Cliente, assinatura: Assinatura | null, dados: Omit<Transacao, 'usuarioId' | 'assinaturaId' | 'nome' | 'email'>) => {
    transacoes.push({
      ...dados,
      usuarioId: cliente.id,
      assinaturaId: assinatura?.id ?? null,
      nome: cliente.nome,
      email: cliente.email,
    });
  };

  for (const cliente of clientes) {
    const escolha = sorteio();
    let iniciadaEm: number;
    let testeAte: number | null = null;
    let convertidaEm: number | null = null;
    if (escolha < 0.7) {
      iniciadaEm = cliente.criadoEm + Math.floor(sorteio() * 48 * HORA_MS);
      if (iniciadaEm >= agora) iniciadaEm = cliente.criadoEm;
      testeAte = iniciadaEm + 14 * DIA_MS;
      const converte = sorteio() < 0.7;
      if (testeAte > agora) {
        const plano = PLANOS[1];
        const assinatura: Assinatura = {
          id: randomUUID(),
          usuarioId: cliente.id,
          plano: plano.codigo,
          status: 'teste',
          ciclo: 'mensal',
          metodo: 'cartao',
          valor: plano.mensal,
          iniciadaEm,
          testeAte,
          convertidaEm: null,
          renovacaoEm: testeAte,
          canceladaEm: null,
          motivo: null,
        };
        assinaturas.push(assinatura);
        assinaturaPorCliente.set(cliente.id, assinatura);
        continue;
      }
      if (!converte) {
        const plano = PLANOS[1];
        const assinatura: Assinatura = {
          id: randomUUID(),
          usuarioId: cliente.id,
          plano: plano.codigo,
          status: 'cancelada',
          ciclo: 'mensal',
          metodo: 'cartao',
          valor: plano.mensal,
          iniciadaEm,
          testeAte,
          convertidaEm: null,
          renovacaoEm: null,
          canceladaEm: testeAte,
          motivo: 'Período de teste encerrado',
        };
        assinaturas.push(assinatura);
        assinaturaPorCliente.set(cliente.id, assinatura);
        continue;
      }
      convertidaEm = testeAte + Math.floor(sorteio() * 3 * HORA_MS);
      if (convertidaEm >= agora) convertidaEm = testeAte;
    } else if (escolha < 0.745) {
      iniciadaEm = cliente.criadoEm + Math.floor(sorteio() * 6 * HORA_MS);
      if (iniciadaEm >= agora) iniciadaEm = cliente.criadoEm;
      convertidaEm = iniciadaEm;
    } else {
      continue;
    }

    let indicePlano = PLANOS.indexOf(escolherPonderado(sorteio, PLANOS));
    const ciclo = sorteio() < 0.2 ? 'anual' : 'mensal';
    const metodo = escolherPonderado(sorteio, METODOS).nome;
    const mesesPorCiclo = ciclo === 'anual' ? 12 : 1;
    const preco = () => (ciclo === 'anual' ? PLANOS[indicePlano].anual : PLANOS[indicePlano].mensal);
    const assinatura: Assinatura = {
      id: randomUUID(),
      usuarioId: cliente.id,
      plano: PLANOS[indicePlano].codigo,
      status: 'ativa',
      ciclo,
      metodo,
      valor: preco(),
      iniciadaEm,
      testeAte,
      convertidaEm,
      renovacaoEm: null,
      canceladaEm: null,
      motivo: null,
    };
    assinaturas.push(assinatura);
    assinaturaPorCliente.set(cliente.id, assinatura);
    const chaveConversao = `${diaLocal(new Date(convertidaEm), fuso)}|${cliente.canal}|${cliente.dispositivo}`;
    conversoesPorChave.set(chaveConversao, (conversoesPorChave.get(chaveConversao) ?? 0) + 1);
    if (convertidaEm >= limiteEventos) {
      eventos.push({
        quando: convertidaEm,
        usuarioId: null,
        acao: 'assinatura.criada',
        descricao: `Nova assinatura do plano ${PLANOS[indicePlano].nome} por ${cliente.nome}`,
        entidade: 'usuario',
        entidadeId: cliente.id,
      });
    }

    const momentoUpgrade =
      ciclo === 'mensal' && indicePlano < PLANOS.length - 1 && sorteio() < 0.08 ? 2 + Math.floor(sorteio() * 8) : -1;
    let ultimaFalhou = false;
    let ciclos = 0;
    for (let quando = convertidaEm; quando <= agora; quando = somarMesesInstante(convertidaEm, (ciclos += 1) * mesesPorCiclo)) {
      if (ciclos >= 1) {
        const chance = ciclo === 'anual' ? 0.18 : 0.025;
        if (sorteio() < chance) {
          const canceladaEm = Math.max(convertidaEm + HORA_MS, quando - Math.floor(sorteio() * 5 * DIA_MS));
          assinatura.status = 'cancelada';
          assinatura.canceladaEm = canceladaEm;
          assinatura.motivo = escolher(sorteio, MOTIVOS_CANCELAMENTO);
          if (canceladaEm >= limiteEventos) {
            eventos.push({
              quando: canceladaEm,
              usuarioId: null,
              acao: 'assinatura.cancelada',
              descricao: `${cliente.nome} cancelou o plano ${PLANOS[indicePlano].nome}`,
              entidade: 'usuario',
              entidadeId: cliente.id,
            });
          }
          break;
        }
      }
      if (ciclos === momentoUpgrade) {
        const anterior = preco();
        indicePlano += 1;
        const momento = quando - Math.floor(sorteio() * 10 * DIA_MS);
        if (momento > convertidaEm) {
          novaTransacao(cliente, assinatura, {
            plano: PLANOS[indicePlano].codigo,
            tipo: 'upgrade',
            metodo,
            status: 'paga',
            valor: preco() - anterior,
            criadoEm: momento,
          });
        }
        assinatura.plano = PLANOS[indicePlano].codigo;
        assinatura.valor = preco();
      }
      const momento = quando + Math.floor(sorteio() * 40 * 60_000);
      if (momento > agora) break;
      const sorte = sorteio();
      ultimaFalhou = false;
      if (metodo === 'boleto' && momento > agora - 3 * DIA_MS && sorte < 0.55) {
        novaTransacao(cliente, assinatura, { plano: assinatura.plano, tipo: 'assinatura', metodo, status: 'pendente', valor: preco(), criadoEm: momento });
      } else if (sorte < 0.035) {
        novaTransacao(cliente, assinatura, { plano: assinatura.plano, tipo: 'assinatura', metodo, status: 'falhou', valor: preco(), criadoEm: momento });
        if (momento >= limiteEventos) {
          eventos.push({
            quando: momento,
            usuarioId: null,
            acao: 'transacao.falhou',
            descricao: `Pagamento recusado de ${cliente.nome} (${formatarMoeda(preco())})`,
            entidade: 'usuario',
            entidadeId: cliente.id,
          });
        }
        const nova = momento + DIA_MS * (1 + Math.floor(sorteio() * 2)) + Math.floor(sorteio() * 6 * HORA_MS);
        if (nova <= agora && sorteio() < 0.85) {
          novaTransacao(cliente, assinatura, { plano: assinatura.plano, tipo: 'assinatura', metodo, status: 'paga', valor: preco(), criadoEm: nova });
        } else {
          ultimaFalhou = true;
        }
      } else if (sorte < 0.047) {
        novaTransacao(cliente, assinatura, { plano: assinatura.plano, tipo: 'assinatura', metodo, status: 'reembolsada', valor: preco(), criadoEm: momento });
      } else {
        novaTransacao(cliente, assinatura, { plano: assinatura.plano, tipo: 'assinatura', metodo, status: 'paga', valor: preco(), criadoEm: momento });
      }
      if (ciclo === 'mensal' && sorteio() < 0.015) {
        const extra = momento + Math.floor(sorteio() * 20 * DIA_MS);
        if (extra <= agora) {
          novaTransacao(cliente, assinatura, {
            plano: assinatura.plano,
            tipo: 'avulsa',
            metodo,
            status: 'paga',
            valor: escolher(sorteio, [1_990, 4_990, 9_900, 14_900]),
            criadoEm: extra,
          });
        }
      }
    }
    if (assinatura.status !== 'cancelada') {
      assinatura.renovacaoEm = somarMesesInstante(convertidaEm, ciclos * mesesPorCiclo);
      if (assinatura.renovacaoEm <= agora) assinatura.renovacaoEm = somarMesesInstante(convertidaEm, (ciclos + 1) * mesesPorCiclo);
      if (ultimaFalhou) assinatura.status = 'inadimplente';
    }
  }

  for (const cliente of clientes) {
    const assinatura = assinaturaPorCliente.get(cliente.id);
    const vigente = assinatura && assinatura.status !== 'cancelada';
    if (assinatura?.status === 'cancelada') {
      if (sorteio() < (assinatura.convertidaEm ? 0.45 : 0.3)) cliente.status = 'inativo';
      const fim = assinatura.canceladaEm ?? cliente.criadoEm;
      cliente.ultimoAcesso = Math.max(cliente.criadoEm, fim - Math.floor(sorteio() * 6 * DIA_MS));
    } else if (vigente) {
      const recencia = sorteio() ** 2 * 12 * DIA_MS;
      cliente.ultimoAcesso = Math.max(cliente.criadoEm, agora - Math.floor(recencia));
    } else {
      const limite = Math.min(cliente.criadoEm + 30 * DIA_MS, agora);
      cliente.ultimoAcesso = cliente.criadoEm + Math.floor(sorteio() * (limite - cliente.criadoEm));
      if (agora - cliente.criadoEm < 3 * DIA_MS && sorteio() < 0.35) {
        cliente.status = 'pendente';
        cliente.ultimoAcesso = null;
      }
    }
    if (cliente.status !== 'pendente' && sorteio() < 0.012) {
      cliente.status = 'bloqueado';
      const janela = Math.min(60 * DIA_MS, agora - cliente.criadoEm);
      cliente.bloqueadoEm = agora - Math.floor(sorteio() * janela);
      cliente.motivoBloqueio = escolher(sorteio, MOTIVOS_BLOQUEIO);
      if (cliente.ultimoAcesso !== null && cliente.ultimoAcesso > cliente.bloqueadoEm) {
        cliente.ultimoAcesso = Math.max(cliente.criadoEm, cliente.bloqueadoEm - Math.floor(sorteio() * 2 * DIA_MS));
      }
      const autor = sorteio() < 0.6 ? suporte : admin;
      if (cliente.bloqueadoEm >= limiteEventos) {
        eventos.push({
          quando: cliente.bloqueadoEm,
          usuarioId: autor.id,
          acao: 'usuario.bloqueado',
          descricao: `bloqueou a conta de ${cliente.nome}`,
          entidade: 'usuario',
          entidadeId: cliente.id,
        });
      }
    }
    if (cliente.criadoEm >= limiteEventos && sorteio() < 0.5) {
      eventos.push({
        quando: cliente.criadoEm,
        usuarioId: null,
        acao: 'usuario.cadastrado',
        descricao: `Novo cadastro de ${cliente.nome} pelo canal ${cliente.canal}`,
        entidade: 'usuario',
        entidadeId: cliente.id,
      });
    }
  }

  transacoes.sort((a, b) => a.criadoEm - b.criadoEm);

  for (let d = 0; d < 30; d += 1) {
    const dia = somarDias(hoje, -d);
    const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
    for (const pessoa of equipe) {
      if ((semana === 0 || semana === 6) && sorteio() < 0.75) continue;
      const quando = inicioDoDia(dia, fuso).getTime() + (8 + Math.floor(sorteio() * 3)) * HORA_MS + Math.floor(sorteio() * HORA_MS);
      if (quando >= agora) continue;
      eventos.push({ quando, usuarioId: pessoa.id, acao: 'auth.entrou', descricao: 'entrou no painel', entidade: 'sessao', entidadeId: null });
    }
  }
  const recentes = clientes.filter((cliente) => cliente.criadoEm < agora - DIA_MS);
  for (let i = 0; i < Math.round(24 * Math.max(escala, 0.25)); i += 1) {
    const alvo = escolher(sorteio, recentes);
    const autor = escolher(sorteio, [suporte, suporte, gerente, admin]);
    eventos.push({
      quando: agora - Math.floor(sorteio() * 29 * DIA_MS) - HORA_MS,
      usuarioId: autor.id,
      acao: 'usuario.editado',
      descricao: `editou o cadastro de ${alvo.nome}`,
      entidade: 'usuario',
      entidadeId: alvo.id,
    });
  }
  for (let i = 0; i < 4; i += 1) {
    eventos.push({
      quando: agora - Math.floor(sorteio() * 28 * DIA_MS) - 2 * HORA_MS,
      usuarioId: escolher(sorteio, [gerente, analista]).id,
      acao: 'usuarios.exportados',
      descricao: 'exportou a lista de usuários (CSV)',
      entidade: null,
      entidadeId: null,
    });
  }

  const receitaPorMes = new Map<string, number>();
  for (const transacao of transacoes) {
    if (transacao.status !== 'paga') continue;
    const mes = diaLocal(new Date(transacao.criadoEm), fuso).slice(0, 7);
    receitaPorMes.set(mes, (receitaPorMes.get(mes) ?? 0) + transacao.valor);
  }
  const mesAtual = primeiroDiaDoMes(hoje);
  const diasNoMes = diferencaDias(mesAtual, somarMeses(mesAtual, 1));
  const progressoMes = (diferencaDias(mesAtual, hoje) + fracaoHoje) / diasNoMes;
  const metas: unknown[][] = [];
  let metaAtual = 0;
  for (let mes = primeiroDiaDoMes(inicioHistorico); mes <= mesAtual; mes = somarMeses(mes, 1)) {
    const receita = receitaPorMes.get(mes.slice(0, 7)) ?? 0;
    const base = mes === mesAtual ? (receita / Math.max(progressoMes, 0.05)) * 1.04 : receita * (1.03 + sorteio() * 0.09);
    const meta = Math.max(100_000, Math.round(base / 100_000) * 100_000);
    if (mes === mesAtual) metaAtual = meta;
    metas.push([mes, meta]);
  }

  const notificacoes: NovaNotificacao[] = [];
  const limiteNotificacoes = agora - 14 * DIA_MS;
  for (const transacao of transacoes) {
    if (transacao.criadoEm < limiteNotificacoes) continue;
    if (transacao.status === 'paga' && transacao.valor >= 29_900 && sorteio() < 0.5) {
      const plano = PLANOS.find((item) => item.codigo === transacao.plano)?.nome ?? 'avulso';
      notificacoes.push({
        quando: transacao.criadoEm,
        destinatarioId: null,
        tipo: 'sucesso',
        categoria: 'transacao',
        titulo: `Nova transação de ${formatarMoeda(transacao.valor)}`,
        mensagem: `${transacao.nome} pagou ${formatarMoeda(transacao.valor)} no plano ${plano}.`,
        link: '/',
      });
    } else if (transacao.status === 'falhou') {
      notificacoes.push({
        quando: transacao.criadoEm,
        destinatarioId: null,
        tipo: 'erro',
        categoria: 'transacao',
        titulo: 'Pagamento recusado',
        mensagem: `A cobrança de ${formatarMoeda(transacao.valor)} de ${transacao.nome} foi recusada.`,
        link: '/',
      });
    }
  }
  for (const cliente of clientes) {
    if (cliente.criadoEm >= limiteNotificacoes && sorteio() < 0.25) {
      notificacoes.push({
        quando: cliente.criadoEm,
        destinatarioId: null,
        tipo: 'info',
        categoria: 'usuario',
        titulo: 'Novo cadastro',
        mensagem: `${cliente.nome} criou uma conta pelo canal ${cliente.canal}.`,
        link: '/usuarios',
      });
    }
    if (cliente.bloqueadoEm && cliente.bloqueadoEm >= limiteNotificacoes) {
      notificacoes.push({
        quando: cliente.bloqueadoEm,
        destinatarioId: null,
        tipo: 'alerta',
        categoria: 'seguranca',
        titulo: 'Conta bloqueada',
        mensagem: `A conta de ${cliente.nome} foi bloqueada. Motivo: ${cliente.motivoBloqueio}.`,
        link: '/usuarios',
      });
    }
  }
  const receitaMesAtual = receitaPorMes.get(mesAtual.slice(0, 7)) ?? 0;
  notificacoes.push(
    {
      quando: agora - 26 * HORA_MS,
      destinatarioId: null,
      tipo: 'info',
      categoria: 'sistema',
      titulo: 'Acompanhamento da meta',
      mensagem: `A receita de ${rotuloMes(mesAtual)} chegou a ${Math.round((receitaMesAtual / Math.max(metaAtual, 1)) * 100)}% da meta mensal.`,
      link: '/analytics',
    },
    {
      quando: agora - 9 * DIA_MS,
      destinatarioId: null,
      tipo: 'info',
      categoria: 'sistema',
      titulo: 'Conecte suas ferramentas',
      mensagem: 'Envie transações e alertas para Slack, Discord ou um webhook em Configurações › Integrações.',
      link: '/configuracoes',
    },
    {
      quando: agora - 3 * HORA_MS,
      destinatarioId: admin.id,
      tipo: 'sucesso',
      categoria: 'relatorio',
      titulo: 'Relatório pronto',
      mensagem: '"Transações · últimos 30 dias" (CSV) está pronto para baixar.',
      link: '/relatorios',
    },
    {
      quando: agora - 40 * HORA_MS,
      destinatarioId: null,
      tipo: 'alerta',
      categoria: 'seguranca',
      titulo: 'Tentativas de acesso bloqueadas',
      mensagem: '5 tentativas de login sem sucesso para suporte@bento.local. O acesso ficou suspenso por 15 minutos.',
      link: '/configuracoes',
    },
  );
  notificacoes.sort((a, b) => b.quando - a.quando);
  const notificacoesFinais = notificacoes.slice(0, Math.max(20, Math.round(60 * Math.min(escala * 2, 1))));

  const trafego: unknown[][] = [];
  const trafegoPaises: unknown[][] = [];
  const cadastrosPorChave = new Map<string, number>();
  for (const cliente of clientes) {
    const chave = `${cliente.dia}|${cliente.canal}|${cliente.dispositivo}`;
    cadastrosPorChave.set(chave, (cadastrosPorChave.get(chave) ?? 0) + 1);
  }
  for (let d = 0; d <= DIAS_HISTORICO; d += 1) {
    const dia = somarDias(inicioHistorico, d);
    const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
    const fator = d === DIAS_HISTORICO ? fracaoHoje : 1;
    const visitantesDia = 150 * escala * Math.exp((Math.log(2.6) * d) / DIAS_HISTORICO) * PESOS_SEMANA[semana] * (0.85 + sorteio() * 0.3) * fator;
    for (const canal of CANAIS) {
      const visitantesCanal = visitantesDia * (canal.peso / 100) * (0.8 + sorteio() * 0.4);
      for (const dispositivo of DISPOSITIVOS) {
        const chave = `${dia}|${canal.nome}|${dispositivo.nome}`;
        const cadastros = cadastrosPorChave.get(chave) ?? 0;
        const conversoes = conversoesPorChave.get(chave) ?? 0;
        const visitantes = Math.max(Math.round(visitantesCanal * (dispositivo.peso / 100)), cadastros * 3, conversoes * 4);
        if (visitantes === 0 && cadastros === 0 && conversoes === 0) continue;
        trafego.push([dia, canal.nome, dispositivo.nome, visitantes, Math.round(visitantes * (1.25 + sorteio() * 0.35)), cadastros, conversoes]);
      }
    }
    for (const pais of PAISES_TRAFEGO) {
      const visitantes = Math.round(visitantesDia * (pais.peso / 100) * (0.8 + sorteio() * 0.4));
      if (visitantes > 0) trafegoPaises.push([dia, pais.codigo, visitantes]);
    }
  }

  await banco.transacao(async (tx) => {
    await inserirEmLote(
      tx,
      'usuarios',
      ['id', 'nome', 'email', 'senha_hash', 'papel', 'status', 'cargo', 'empresa', 'pais', 'cidade', 'ultimo_acesso', 'criado_em', 'atualizado_em'],
      equipe.map((pessoa) => [
        pessoa.id,
        pessoa.nome,
        pessoa.email,
        hashSenha,
        pessoa.papel,
        'ativo',
        pessoa.cargo,
        'Bento',
        'Brasil',
        pessoa.cidade,
        new Date(pessoa.ultimoAcesso),
        new Date(pessoa.criadoEm),
        new Date(pessoa.criadoEm),
      ]),
    );
    await inserirEmLote(
      tx,
      'usuarios',
      [
        'id', 'nome', 'email', 'papel', 'status', 'cargo', 'empresa', 'pais', 'cidade', 'canal', 'bloqueado_em', 'motivo_bloqueio',
        'ultimo_acesso', 'criado_em', 'atualizado_em',
      ],
      clientes.map((cliente) => [
        cliente.id,
        cliente.nome,
        cliente.email,
        'cliente',
        cliente.status,
        cliente.cargo,
        cliente.empresa,
        cliente.pais,
        cliente.cidade,
        cliente.canal,
        data(cliente.bloqueadoEm),
        cliente.motivoBloqueio,
        data(cliente.ultimoAcesso),
        new Date(cliente.criadoEm),
        new Date(Math.max(cliente.criadoEm, cliente.bloqueadoEm ?? 0)),
      ]),
    );
    await inserirEmLote(
      tx,
      'preferencias_usuario',
      ['usuario_id', 'tema', 'paleta', 'densidade', 'sidebar_recolhida'],
      equipe.map((pessoa) => [pessoa.id, 'sistema', 'bento', 'confortavel', false]),
    );
    await inserirEmLote(
      tx,
      'assinaturas',
      [
        'id', 'usuario_id', 'plano', 'status', 'ciclo', 'metodo', 'valor', 'iniciada_em', 'teste_ate', 'convertida_em', 'renovacao_em',
        'cancelada_em', 'motivo_cancelamento', 'criado_em', 'atualizado_em',
      ],
      assinaturas.map((assinatura) => [
        assinatura.id,
        assinatura.usuarioId,
        assinatura.plano,
        assinatura.status,
        assinatura.ciclo,
        assinatura.metodo,
        assinatura.valor,
        new Date(assinatura.iniciadaEm),
        data(assinatura.testeAte),
        data(assinatura.convertidaEm),
        data(assinatura.renovacaoEm),
        data(assinatura.canceladaEm),
        assinatura.motivo,
        new Date(assinatura.iniciadaEm),
        new Date(assinatura.canceladaEm ?? assinatura.convertidaEm ?? assinatura.iniciadaEm),
      ]),
    );
    await inserirEmLote(
      tx,
      'transacoes',
      ['codigo', 'usuario_id', 'assinatura_id', 'plano', 'cliente_nome', 'cliente_email', 'tipo', 'metodo', 'status', 'valor', 'criado_em', 'pago_em'],
      transacoes.map((transacao, indice) => [
        `TX-${String(indice + 1).padStart(6, '0')}`,
        transacao.usuarioId,
        transacao.assinaturaId,
        transacao.plano,
        transacao.nome,
        transacao.email,
        transacao.tipo,
        transacao.metodo,
        transacao.status,
        transacao.valor,
        new Date(transacao.criadoEm),
        transacao.status === 'paga' || transacao.status === 'reembolsada' ? new Date(transacao.criadoEm) : null,
      ]),
    );
    await tx.consultar(`select setval('transacoes_codigo_seq', $1::bigint, true)`, [Math.max(transacoes.length, 1)]);
    await inserirEmLote(tx, 'trafego_diario', ['dia', 'canal', 'dispositivo', 'visitantes', 'sessoes', 'cadastros', 'conversoes'], trafego, {
      dia: '::date',
    });
    await inserirEmLote(tx, 'trafego_paises', ['dia', 'pais_codigo', 'visitantes'], trafegoPaises, { dia: '::date' });
    await inserirEmLote(tx, 'metas_mensais', ['mes', 'valor'], metas, { mes: '::date' });
    await tx.consultar(`update configuracoes_sistema set valor = $1::jsonb, atualizado_em = now() where chave = 'metaMensal'`, [
      JSON.stringify(metaAtual),
    ]);
    eventos.sort((a, b) => a.quando - b.quando);
    await inserirEmLote(
      tx,
      'auditoria',
      ['usuario_id', 'acao', 'entidade', 'entidade_id', 'descricao', 'ip', 'criado_em'],
      eventos.map((evento) => [
        evento.usuarioId,
        evento.acao,
        evento.entidade,
        evento.entidadeId,
        evento.descricao,
        evento.usuarioId ? '127.0.0.1' : null,
        new Date(evento.quando),
      ]),
    );
    const idsNotificacoes = notificacoesFinais.map(() => randomUUID());
    await inserirEmLote(
      tx,
      'notificacoes',
      ['id', 'destinatario_id', 'tipo', 'categoria', 'titulo', 'mensagem', 'link', 'criado_em'],
      notificacoesFinais.map((notificacao, indice) => [
        idsNotificacoes[indice],
        notificacao.destinatarioId,
        notificacao.tipo,
        notificacao.categoria,
        notificacao.titulo,
        notificacao.mensagem,
        notificacao.link,
        new Date(notificacao.quando),
      ]),
    );
    const estados: unknown[][] = [];
    notificacoesFinais.forEach((notificacao, indice) => {
      if (notificacao.quando > agora - 36 * HORA_MS) return;
      for (const pessoa of equipe) {
        if (notificacao.destinatarioId && notificacao.destinatarioId !== pessoa.id) continue;
        estados.push([idsNotificacoes[indice], pessoa.id, new Date(notificacao.quando + HORA_MS * (1 + Math.floor(sorteio() * 8)))]);
      }
    });
    await inserirEmLote(tx, 'notificacao_estados', ['notificacao_id', 'usuario_id', 'lida_em'], estados);
    await inserirEmLote(
      tx,
      'relatorios_agendados',
      ['nome', 'tipo', 'formato', 'frequencia', 'periodo', 'proxima_execucao', 'ultima_execucao', 'criado_por', 'criado_em'],
      [
        [
          'Receita semanal',
          'receita',
          'pdf',
          'semanal',
          '7d',
          proximaExecucao('semanal', fuso),
          new Date(proximaExecucao('semanal', fuso).getTime() - 7 * DIA_MS),
          admin.id,
          new Date(agora - 60 * DIA_MS),
        ],
        [
          'Novos usuários do mês',
          'usuarios',
          'csv',
          'mensal',
          'mes-anterior',
          proximaExecucao('mensal', fuso),
          null,
          analista.id,
          new Date(agora - 20 * DIA_MS),
        ],
      ],
    );
  });

  const mesAnterior = somarMeses(mesAtual, -1);
  const prontos = [
    {
      tipo: 'receita' as const,
      formato: 'pdf' as const,
      inicio: mesAnterior,
      fim: somarDias(mesAtual, -1),
      nome: `Receita de ${rotuloMes(mesAnterior)}`,
      autor: admin.id,
      quando: agora - 6 * DIA_MS,
    },
    {
      tipo: 'crescimento' as const,
      formato: 'pdf' as const,
      inicio: somarMeses(mesAtual, -11),
      fim: hoje,
      nome: nomePadrao('crescimento', somarMeses(mesAtual, -11), hoje),
      autor: gerente.id,
      quando: agora - 2 * DIA_MS,
    },
    {
      tipo: 'transacoes' as const,
      formato: 'csv' as const,
      inicio: somarDias(hoje, -29),
      fim: hoje,
      nome: 'Transações · últimos 30 dias',
      autor: analista.id,
      quando: agora - 3 * HORA_MS,
    },
  ];
  for (const relatorio of prontos) {
    const { conteudo, linhas } = await gerarArquivo(banco, fuso, relatorio);
    await banco.consultar(
      `insert into relatorios (nome, tipo, formato, inicio, fim, status, linhas, tamanho_bytes, conteudo, tipo_mime, criado_por, criado_em)
       values ($1, $2, $3, $4::date, $5::date, 'pronto', $6, $7, $8, $9, $10, $11)`,
      [
        relatorio.nome,
        relatorio.tipo,
        relatorio.formato,
        relatorio.inicio,
        relatorio.fim,
        linhas,
        conteudo.length,
        conteudo,
        relatorio.formato === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
        relatorio.autor,
        new Date(relatorio.quando),
      ],
    );
    await banco.consultar(
      `insert into auditoria (usuario_id, acao, entidade, descricao, ip, criado_em) values ($1, 'relatorio.gerado', 'relatorio', $2, '127.0.0.1', $3)`,
      [relatorio.autor, `gerou o relatório "${relatorio.nome}" (${relatorio.formato.toUpperCase()})`, new Date(relatorio.quando)],
    );
  }

  return {
    usuarios: clientes.length + equipe.length,
    assinaturas: assinaturas.length,
    transacoes: transacoes.length,
    milissegundos: Date.now() - comeco,
  };
}

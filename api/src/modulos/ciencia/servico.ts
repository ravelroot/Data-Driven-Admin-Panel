import type { FastifyInstance } from 'fastify';
import { validacao } from '../../util/erros.js';
import { obterConfigSistema } from '../comum/consultas.js';
import { montarConjunto } from './conjunto.js';
import { baixarDoMotor, enviarAoMotor, motorConfigurado, saudeDoMotor } from './motor.js';

export interface ClienteResumo {
  usuarioId: string;
  nome: string;
}

export interface ResultadoMotor {
  previsoes: unknown;
  risco: { clientes: { id: string }[] } | null;
  segmentos: { segmentos: { exemplos: string[] }[] } | null;
  coortes: unknown;
  ltv: unknown;
  simulador: { ativos: number; arpu: number; churn: number; novos: number; mrr: number } | null;
  qualidade: { verificacoes: { codigo: string; exemplos: string[] }[] } | null;
  avisos: string[];
  tempos: Record<string, number>;
  referencia: string;
  gerado_em: string;
  duracao_ms: number;
  versao: string;
}

export interface Analise extends ResultadoMotor {
  clientes: Record<string, ClienteResumo>;
  volumes: { assinaturas: number; eventos: number; dias: number; truncado: boolean };
  emCache: boolean;
}

export interface Cenario {
  preco: number;
  churnPp: number;
  aquisicao: number;
  elasticidade: number;
  meses: number;
}

interface EstadoCache {
  atual?: { analise: Analise; expira: number; calculadaEm: number };
  falha?: { erro: unknown; ate: number };
  emAndamento?: Promise<Analise>;
}

const INTERVALO_MINIMO_MS = 60_000;
const ESPERA_APOS_FALHA_MS = 60_000;

const CODIGOS_COM_CLIENTES = new Set(['sem_canal', 'datas_invertidas', 'testes_vencidos', 'valor_divergente', 'sem_cobranca', 'pago_apos_cancelar', 'cobranca_duplicada']);
const caches = new WeakMap<FastifyInstance, EstadoCache>();

function estadoDe(app: FastifyInstance): EstadoCache {
  let estado = caches.get(app);
  if (!estado) {
    estado = {};
    caches.set(app, estado);
  }
  return estado;
}

async function resumirClientes(app: FastifyInstance, ids: Set<string>, usuarios: Map<string, string>): Promise<Record<string, ClienteResumo>> {
  const alvo = [...ids].filter((id) => usuarios.has(id)).slice(0, 2_000);
  if (!alvo.length) return {};
  const { linhas } = await app.banco.consultar<{ id: string; nome: string }>(
    `select u.id::text as id, u.nome from usuarios u where u.id in (select jsonb_array_elements_text($1::jsonb)::uuid)`,
    [JSON.stringify([...new Set(alvo.map((id) => usuarios.get(id)!))])],
  );
  const porUsuario = new Map(linhas.map((linha) => [linha.id, linha]));
  const resultado: Record<string, ClienteResumo> = {};
  for (const id of alvo) {
    const usuario = porUsuario.get(usuarios.get(id)!);
    if (usuario) resultado[id] = { usuarioId: usuario.id, nome: usuario.nome };
  }
  return resultado;
}

async function calcular(app: FastifyInstance): Promise<Analise> {
  const conjunto = await montarConjunto(app.banco, app.config.fuso);
  const resultado = await enviarAoMotor<ResultadoMotor>(app.config.analise, '/v1/analise', conjunto.corpo);
  const ids = new Set<string>();
  for (const cliente of resultado.risco?.clientes ?? []) ids.add(cliente.id);
  for (const segmento of resultado.segmentos?.segmentos ?? []) for (const id of segmento.exemplos) ids.add(id);
  for (const verificacao of resultado.qualidade?.verificacoes ?? []) {
    if (CODIGOS_COM_CLIENTES.has(verificacao.codigo)) for (const id of verificacao.exemplos) ids.add(id);
  }
  return {
    ...resultado,
    clientes: await resumirClientes(app, ids, conjunto.usuarios),
    volumes: {
      assinaturas: conjunto.corpo.assinaturas.length,
      eventos: conjunto.corpo.eventos.length,
      dias: conjunto.corpo.diario.length,
      truncado: conjunto.truncado,
    },
    emCache: false,
  };
}

export async function obterAnalise(app: FastifyInstance, atualizar = false): Promise<Analise> {
  const estado = estadoDe(app);
  const agora = Date.now();
  const recente = estado.atual && agora - estado.atual.calculadaEm < INTERVALO_MINIMO_MS;
  if (estado.atual && (recente || (!atualizar && estado.atual.expira > agora))) return { ...estado.atual.analise, emCache: true };
  if (estado.emAndamento) return estado.emAndamento;
  if (!atualizar && estado.falha && estado.falha.ate > agora) throw estado.falha.erro;
  const promessa = calcular(app)
    .then((analise) => {
      const calculadaEm = Date.now();
      estado.atual = { analise, calculadaEm, expira: calculadaEm + app.config.analise.cacheMinutos * 60_000 };
      estado.falha = undefined;
      return analise;
    })
    .catch((erro: unknown) => {
      estado.falha = { erro, ate: Date.now() + ESPERA_APOS_FALHA_MS };
      throw erro;
    })
    .finally(() => {
      estado.emAndamento = undefined;
    });
  estado.emAndamento = promessa;
  return promessa;
}

export function limparCacheAnalise(app: FastifyInstance): void {
  caches.delete(app);
}

export async function estadoMotor(app: FastifyInstance) {
  const configurado = motorConfigurado(app.config.analise);
  const saude = configurado ? await saudeDoMotor(app.config.analise) : null;
  const atual = caches.get(app)?.atual;
  return {
    configurado,
    disponivel: saude?.status === 'ok',
    versao: saude?.versao ?? null,
    bibliotecas: saude?.bibliotecas ?? {},
    ultimaAnalise: atual?.analise.gerado_em ?? null,
    cacheMinutos: app.config.analise.cacheMinutos,
  };
}

export async function simularCenario(app: FastifyInstance, cenario: Cenario) {
  const analise = caches.get(app)?.atual?.analise ?? (await obterAnalise(app));
  const base = analise.simulador;
  if (!base || base.ativos === 0) throw validacao('Ainda não há clientes pagantes suficientes para simular.');
  return enviarAoMotor<unknown>(app.config.analise, '/v1/simulador', {
    ativos: base.ativos,
    arpu: base.arpu,
    churn: base.churn,
    novos: base.novos,
    preco: cenario.preco,
    churn_pp: cenario.churnPp,
    aquisicao: cenario.aquisicao,
    elasticidade: cenario.elasticidade,
    meses: cenario.meses,
    referencia: analise.referencia,
  });
}

export function semClientes(analise: Analise): Analise {
  return { ...analise, clientes: {} };
}

export async function gerarPlanilhaAnalise(app: FastifyInstance, comNomes: boolean): Promise<Buffer> {
  const analise = await obterAnalise(app);
  const { clientes, volumes: _volumes, emCache: _emCache, ...resto } = analise;
  const nomes = comNomes ? Object.fromEntries(Object.entries(clientes).map(([id, cliente]) => [id, cliente.nome])) : {};
  const empresa = (await obterConfigSistema(app.banco)).nomeEmpresa || 'Bento';
  return baixarDoMotor(app.config.analise, '/v1/relatorio', { analise: resto, nomes, empresa: empresa.slice(0, 120) });
}

export async function analisarPlanilha(app: FastifyInstance, nome: string, conteudo: string) {
  return enviarAoMotor<unknown>(app.config.analise, '/v1/planilha', { nome, conteudo });
}

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { condicaoAtendida, descreverRegra, type Regra } from '../src/modulos/alertas/servico.js';
import { detectarAnomalias, distribuicaoNormal, mediana, preverMes, regressaoLinear, type DefinicaoSerie } from '../src/modulos/insights/calculos.js';
import { somarDias } from '../src/util/datas.js';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

const definicao: DefinicaoSerie = {
  codigo: 'receita',
  nome: 'Receita paga',
  unidade: 'moeda',
  sazonal: false,
  bomQuandoSobe: true,
  minimoEsperado: 10,
  link: (dia) => `/transacoes?inicio=${dia}`,
};

describe('cálculos de insights e regras', () => {
  it('avalia regras por valor e por variação', () => {
    const base: Regra = { metrica: 'taxa_falha', janela: '24h', modo: 'valor', operador: 'maior', limite: 5 };
    assert.equal(condicaoAtendida(base, 5.1), true);
    assert.equal(condicaoAtendida(base, 5), false);
    assert.equal(condicaoAtendida({ ...base, operador: 'menor' }, 4.9), true);
    assert.equal(condicaoAtendida({ ...base, modo: 'variacao', operador: 'menor', limite: 10 }, -12), true);
    assert.equal(condicaoAtendida({ ...base, modo: 'variacao', operador: 'menor', limite: -10 }, -9), false);
    assert.equal(condicaoAtendida({ ...base, modo: 'variacao', operador: 'maior', limite: 10 }, null), false);
    assert.equal(descreverRegra({ metrica: 'receita', janela: '7d', modo: 'variacao', operador: 'menor', limite: 15 }, 'BRL'), 'Receita paga nos últimos 7 dias cai mais de 15% em relação ao período anterior');
    assert.match(descreverRegra({ metrica: 'receita', janela: '24h', modo: 'valor', operador: 'menor', limite: 150_000 }, 'BRL'), /abaixo de R\$\s1\.500$/);
  });

  it('calcula mediana, distribuição normal e regressão linear', () => {
    assert.equal(mediana([5, 1, 3]), 3);
    assert.equal(mediana([4, 1, 3, 2]), 2.5);
    assert.ok(Math.abs(distribuicaoNormal(0) - 0.5) < 1e-6);
    assert.ok(Math.abs(distribuicaoNormal(1.2816) - 0.9) < 1e-3);
    const { inclinacao, intercepto } = regressaoLinear([10, 12, 14, 16]);
    assert.equal(inclinacao, 2);
    assert.equal(intercepto, 10);
  });

  it('projeta o mês somando o ritmo diário aos dias que faltam', () => {
    const serie = new Map<string, number>();
    for (let indice = 0; indice < 140; indice += 1) serie.set(somarDias('2026-11-10', -indice), 1_000);
    const previsao = preverMes(serie, '2026-11-10', 0.5, 40_000);
    assert.equal(previsao.diasNoMes, 30);
    assert.equal(previsao.diasRestantes, 20);
    assert.equal(previsao.realizado, 10_000);
    assert.equal(previsao.projetado, 30_500);
    assert.equal(previsao.minimo, previsao.projetado);
    assert.equal(previsao.probabilidadeMeta, 0);
    assert.equal(previsao.ritmoAtual, 1_000);
    assert.equal(previsao.ritmoNecessario, Math.round(30_000 / 20.5));
    assert.equal(previsao.serie.rotulos.length, 30);
    assert.equal(previsao.serie.realizado.filter((valor) => valor !== null).length, 10);
    assert.equal(previsao.serie.projetado[9], 10_500);
    assert.equal(previsao.serie.projetado[29], 30_500);
    assert.equal(previsao.serie.meta[29], 40_000);
    assert.equal(previsao.confiavel, true);
  });

  it('acha o pico fora do padrão e ignora o ruído normal', () => {
    const serie = new Map<string, number>();
    for (let indice = 0; indice < 120; indice += 1) serie.set(somarDias('2026-11-01', -indice), 100 + ((indice * 7) % 11) - 5);
    assert.deepEqual(detectarAnomalias(definicao, serie, '2026-11-01'), []);
    serie.set('2026-10-30', 260);
    serie.set('2026-10-28', 20);
    const encontradas = detectarAnomalias(definicao, serie, '2026-11-01');
    assert.equal(encontradas.length, 2);
    const pico = encontradas.find((item) => item.dia === '2026-10-30');
    assert.equal(pico?.sentido, 'alta');
    assert.equal(pico?.positiva, true);
    assert.equal(pico?.gravidade, 'alta');
    assert.equal(pico?.link, '/transacoes?inicio=2026-10-30');
    const queda = encontradas.find((item) => item.dia === '2026-10-28');
    assert.equal(queda?.sentido, 'queda');
    assert.equal(queda?.positiva, false);
  });
});

describe('alertas de métricas, insights e layout da visão geral', () => {
  let ambiente: Ambiente;
  let admin: string;
  let analista: string;
  let suporte: string;
  let alertaId = '';

  before(async () => {
    ambiente = await criarAmbiente();
    admin = await entrar(ambiente.app);
    analista = await entrar(ambiente.app, 'analista@bento.local');
    suporte = await entrar(ambiente.app, 'suporte@bento.local');
  });

  after(async () => {
    await ambiente.fechar();
  });

  const pedir = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
    ambiente.app.inject({ method, url: `/api/v1${url}`, headers: method === 'GET' ? { cookie } : cabecalhos(cookie), ...(payload === undefined ? {} : { payload }) });

  const regraReceita = { nome: 'Receita do mês', metrica: 'receita', janela: '30d', modo: 'valor', operador: 'maior', limite: 1 };

  it('respeita as permissões e valida a regra', async () => {
    assert.equal((await pedir('GET', '/alertas', suporte)).statusCode, 403);
    const catalogo = await pedir('GET', '/alertas/catalogo', analista);
    assert.equal(catalogo.statusCode, 200);
    assert.equal(catalogo.json().metricas.length, 9);
    assert.equal(catalogo.json().janelas.length, 4);
    assert.equal((await pedir('POST', '/alertas', suporte, regraReceita)).statusCode, 403);
    assert.equal((await pedir('POST', '/alertas', analista, { ...regraReceita, metrica: 'lucro' })).statusCode, 422);
    assert.equal((await pedir('POST', '/alertas', analista, { ...regraReceita, nome: 'x' })).statusCode, 422);
    assert.equal((await pedir('POST', '/alertas', analista, { ...regraReceita, silencioMinutos: 1 })).statusCode, 422);
    assert.equal((await pedir('POST', '/alertas', analista, { ...regraReceita, extra: true })).statusCode, 422);
  });

  it('simula, cria, avalia e dispara uma notificação na categoria de métricas', async () => {
    const simulacao = await pedir('POST', '/alertas/simular', analista, { metrica: 'receita', janela: '30d', modo: 'valor', operador: 'maior', limite: 1 });
    assert.equal(simulacao.statusCode, 200);
    assert.equal(simulacao.json().dispararia, true);
    assert.ok(simulacao.json().atual > 0);
    assert.match(simulacao.json().valorFormatado, /^R\$/);

    const criado = await pedir('POST', '/alertas', analista, regraReceita);
    assert.equal(criado.statusCode, 201, criado.body);
    alertaId = criado.json().id;
    assert.equal(criado.json().estado, 'normal');
    assert.equal(criado.json().silencioMinutos, 60);
    assert.match(criado.json().descricao, /^Receita paga nos últimos 30 dias acima de/);

    const avaliado = await pedir('POST', `/alertas/${alertaId}/avaliar`, analista);
    assert.equal(avaliado.statusCode, 200, avaliado.body);
    assert.equal(avaliado.json().disparados, 1);
    assert.equal(avaliado.json().alerta.estado, 'disparado');
    assert.ok(avaliado.json().alerta.ultimoValor > 0);

    const notificacoes = await pedir('GET', '/notificacoes?categoria=metrica', admin);
    assert.equal(notificacoes.statusCode, 200);
    assert.equal(notificacoes.json().itens[0].titulo, 'Alerta: Receita do mês');
    assert.equal(notificacoes.json().itens[0].link, `/alertas?alerta=${alertaId}`);

    const disparos = await pedir('GET', `/alertas/disparos?alerta=${alertaId}`, analista);
    assert.equal(disparos.json().total, 1);
    assert.equal(disparos.json().itens[0].resolvidoEm, null);

    const lista = await pedir('GET', '/alertas', analista);
    assert.deepEqual(lista.json().resumo, { total: 1, ativos: 1, disparados: 1, disparos7d: 1 });

    const denovo = await pedir('POST', `/alertas/${alertaId}/avaliar`, analista);
    assert.equal(denovo.json().disparados, 0);
  });

  it('volta ao normal, respeita o silêncio e reinicia ao mudar a regra', async () => {
    await ambiente.banco.consultar('update alertas_metricas set limite = 1e11 where id = $1', [alertaId]);
    const normalizado = await pedir('POST', `/alertas/${alertaId}/avaliar`, analista);
    assert.equal(normalizado.json().resolvidos, 1);
    assert.equal(normalizado.json().alerta.estado, 'normal');
    const disparos = await pedir('GET', `/alertas/disparos?alerta=${alertaId}`, analista);
    assert.ok(disparos.json().itens[0].resolvidoEm);

    await ambiente.banco.consultar('update alertas_metricas set limite = 1 where id = $1', [alertaId]);
    const silenciado = await pedir('POST', `/alertas/${alertaId}/avaliar`, analista);
    assert.equal(silenciado.json().disparados, 0);
    assert.equal(silenciado.json().alerta.estado, 'normal');

    const editado = await pedir('PATCH', `/alertas/${alertaId}`, analista, { modo: 'variacao', operador: 'menor', limite: 99, silencioMinutos: 5 });
    assert.equal(editado.statusCode, 200);
    assert.equal(editado.json().ultimaAvaliacao, null);
    assert.match(editado.json().descricao, /cai mais de 99%/);

    const pausado = await pedir('PATCH', `/alertas/${alertaId}`, analista, { ativo: false });
    assert.equal(pausado.json().ativo, false);
    assert.equal((await pedir('POST', `/alertas/${alertaId}/avaliar`, analista)).statusCode, 409);
    const auditoria = await ambiente.banco.consultar<{ acao: string }>(`select acao from auditoria where entidade = 'alerta' order by id`);
    assert.deepEqual(auditoria.linhas.map((linha) => linha.acao), ['alerta.criado', 'alerta.atualizado', 'alerta.pausado']);
  });

  it('o agendador só avalia regras ativas e vencidas', async () => {
    const { avaliarAlertas } = await import('../src/modulos/alertas/servico.js');
    const outro = await pedir('POST', '/alertas', admin, { ...regraReceita, nome: 'Taxa de falha', metrica: 'taxa_falha', janela: '7d', limite: 1000 });
    const primeira = await avaliarAlertas(ambiente.app);
    assert.equal(primeira.avaliados, 1);
    const segunda = await avaliarAlertas(ambiente.app);
    assert.equal(segunda.avaliados, 0);
    await pedir('DELETE', `/alertas/${outro.json().id}`, admin);
  });

  it('exclui o alerta com o histórico e limita a quantidade', async () => {
    assert.equal((await pedir('DELETE', `/alertas/${alertaId}`, analista)).statusCode, 204);
    assert.equal((await pedir('GET', `/alertas/${alertaId}`, analista)).statusCode, 404);
    const { linhas } = await ambiente.banco.consultar<{ total: number }>('select count(*)::int as total from disparos_alerta where alerta_id = $1', [alertaId]);
    assert.equal(linhas[0].total, 0);
    await ambiente.banco.consultar(
      `insert into alertas_metricas (nome, metrica, janela, modo, operador, limite)
       select 'Lote ' || n, 'receita', '24h', 'valor', 'maior', 1 from generate_series(1, 50) as n`,
    );
    assert.equal((await pedir('POST', '/alertas', admin, regraReceita)).statusCode, 409);
    await ambiente.banco.consultar(`delete from alertas_metricas where nome like 'Lote %'`);
  });

  it('entrega previsão, tendência do MRR, anomalias e destaques', async () => {
    assert.equal((await ambiente.app.inject({ method: 'GET', url: '/api/v1/insights' })).statusCode, 401);
    const resposta = await pedir('GET', '/insights', analista);
    assert.equal(resposta.statusCode, 200, resposta.body);
    const { previsao, mrr, anomalias, destaques } = resposta.json();
    assert.equal(previsao.serie.rotulos.length, previsao.diasNoMes);
    assert.ok(previsao.realizado <= previsao.projetado);
    assert.ok(previsao.minimo <= previsao.projetado && previsao.projetado <= previsao.maximo);
    assert.ok(previsao.probabilidadeMeta >= 0 && previsao.probabilidadeMeta <= 100);
    assert.ok(previsao.meta > 0);
    assert.equal(mrr.serie.length, 12);
    assert.ok(Array.isArray(anomalias) && anomalias.length <= 8);
    assert.ok(destaques.length >= 1);
    for (const destaque of destaques) assert.ok(['positivo', 'negativo', 'neutro'].includes(destaque.tom));
  });

  it('guarda o layout da visão geral por pessoa e recusa layouts inválidos', async () => {
    const layout = [
      { id: 'receita', largura: 'inteiro', altura: 'alto', oculto: false },
      { id: 'canais', largura: 'metade', altura: 'normal', oculto: true },
    ];
    const salvo = await pedir('PUT', '/configuracoes/preferencias', analista, { layoutVisaoGeral: layout });
    assert.equal(salvo.statusCode, 200);
    assert.deepEqual(salvo.json().layoutVisaoGeral, layout);
    const lido = await pedir('GET', '/auth/eu', analista);
    assert.deepEqual(lido.json().preferencias.layoutVisaoGeral, layout);
    const outro = await pedir('GET', '/auth/eu', admin);
    assert.equal(outro.json().preferencias.layoutVisaoGeral, null);

    assert.equal((await pedir('PUT', '/configuracoes/preferencias', analista, { layoutVisaoGeral: [layout[0], layout[0]] })).statusCode, 422);
    assert.equal((await pedir('PUT', '/configuracoes/preferencias', analista, { layoutVisaoGeral: [{ ...layout[0], largura: 'gigante' }] })).statusCode, 422);
    assert.equal((await pedir('PUT', '/configuracoes/preferencias', analista, { layoutVisaoGeral: [{ ...layout[0], id: '<script>' }] })).statusCode, 422);
    const restaurado = await pedir('PUT', '/configuracoes/preferencias', analista, { layoutVisaoGeral: null });
    assert.equal(restaurado.json().layoutVisaoGeral, null);
  });
});

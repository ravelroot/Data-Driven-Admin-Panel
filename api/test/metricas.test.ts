import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

const CHAVES_KPI = ['anterior', 'rotulos', 'serie', 'valor', 'variacao'];

describe('visão geral e analytics', () => {
  let ambiente: Ambiente;
  let cookie: string;

  before(async () => {
    ambiente = await criarAmbiente();
    cookie = await entrar(ambiente.app);
  });

  after(async () => {
    await ambiente.fechar();
  });

  const obter = async (url: string) => {
    const resposta = await ambiente.app.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(resposta.statusCode, 200, resposta.body);
    return resposta.json();
  };

  for (const [periodo, pontos] of [
    ['7d', 7],
    ['30d', 30],
    ['90d', 13],
    ['12m', 12],
  ] as const) {
    it(`monta a visão geral de ${periodo} no formato do contrato`, async () => {
      const dados = await obter(`/api/v1/visao-geral?periodo=${periodo}`);
      assert.deepEqual(Object.keys(dados).sort(), [
        'atividades',
        'canais',
        'kpis',
        'metaMensal',
        'periodo',
        'planos',
        'receitaMensal',
        'transacoesRecentes',
      ]);
      for (const nome of ['receita', 'usuarios', 'assinaturas', 'crescimento', 'mrr', 'churn', 'ticketMedio', 'conversao']) {
        const kpi = dados.kpis[nome];
        for (const chave of CHAVES_KPI) assert.ok(chave in kpi, `${nome} sem ${chave}`);
        assert.equal(kpi.serie.length, pontos, `${nome} com ${kpi.serie.length} pontos`);
        assert.equal(kpi.rotulos.length, pontos);
      }
      assert.equal(typeof dados.kpis.usuarios.novos, 'number');
      assert.equal(dados.receitaMensal.rotulos.length, 12);
      assert.equal(dados.receitaMensal.meta.length, 12);
      assert.equal(dados.planos.length, 4);
      assert.ok(dados.transacoesRecentes.length <= 6);
      assert.ok(dados.atividades.length <= 8);
      assert.ok(dados.kpis.receita.valor > 0);
      assert.ok(dados.metaMensal.valor > 0);
    });
  }

  it('recusa período desconhecido', async () => {
    const resposta = await ambiente.app.inject({ method: 'GET', url: '/api/v1/visao-geral?periodo=5a', headers: { cookie } });
    assert.equal(resposta.statusCode, 422);
  });

  it('monta o analytics com séries alinhadas, funil, coortes e mapa de calor', async () => {
    const dados = await obter('/api/v1/analytics?agrupar=dia');
    const tamanho = dados.serie.rotulos.length;
    assert.equal(tamanho, 30);
    for (const serie of Object.values(dados.serie) as unknown[][]) assert.equal(serie.length, tamanho);
    for (const nome of ['receita', 'transacoes', 'novosUsuarios', 'visitantes', 'conversao', 'ticketMedio', 'churn', 'mrr']) {
      assert.deepEqual(Object.keys(dados.resumo[nome]).sort(), ['anterior', 'valor', 'variacao']);
    }
    assert.deepEqual(
      dados.funil.map((etapa: { etapa: string }) => etapa.etapa),
      ['Visitantes', 'Cadastros', 'Em teste', 'Assinantes'],
    );
    assert.equal(dados.coortes.length, 6);
    assert.equal(dados.coortes[0].retencao[0], 100);
    assert.equal(dados.mapaCalor.valores.length, 7);
    assert.ok(dados.mapaCalor.valores.every((linha: number[]) => linha.length === 24));
    assert.ok(dados.dispositivos.length >= 1);
    assert.ok(dados.paises.length <= 8);
  });

  it('agrupa o analytics por mês em um intervalo longo', async () => {
    const dados = await obter('/api/v1/analytics?inicio=2025-01-01&fim=2025-06-30&agrupar=mes');
    assert.equal(dados.serie.rotulos.length, 6);
    assert.equal(dados.serie.rotulos[0], 'jan/25');
  });

  it('recusa intervalo invertido', async () => {
    const resposta = await ambiente.app.inject({
      method: 'GET',
      url: '/api/v1/analytics?inicio=2026-02-10&fim=2026-02-01',
      headers: { cookie },
    });
    assert.equal(resposta.statusCode, 422);
  });
});

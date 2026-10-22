import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { executarVencidos } from '../src/agendador.js';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

describe('relatórios e notificações', () => {
  let ambiente: Ambiente;
  let cookie: string;

  before(async () => {
    ambiente = await criarAmbiente();
    cookie = await entrar(ambiente.app);
  });

  after(async () => {
    await ambiente.fechar();
  });

  const hoje = () => new Date().toISOString().slice(0, 10);
  const haDias = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);

  it('mostra a prévia de um relatório', async () => {
    const resposta = await ambiente.app.inject({
      method: 'GET',
      url: `/api/v1/relatorios/previa?tipo=receita&inicio=${haDias(9)}&fim=${haDias(0)}`,
      headers: { cookie },
    });
    assert.equal(resposta.statusCode, 200);
    const corpo = resposta.json();
    assert.equal(corpo.colunas[0].campo, 'data');
    assert.ok(corpo.linhas.length >= 9);
    assert.ok(corpo.resumo.some((item: { rotulo: string }) => item.rotulo === 'Receita líquida'));
  });

  it('gera e baixa um relatório em CSV', async () => {
    const gerado = await ambiente.app.inject({
      method: 'POST',
      url: '/api/v1/relatorios',
      headers: cabecalhos(cookie),
      payload: { tipo: 'transacoes', formato: 'csv', inicio: haDias(30), fim: hoje() },
    });
    assert.equal(gerado.statusCode, 201, gerado.body);
    const relatorio = gerado.json();
    assert.equal(relatorio.status, 'pronto');
    assert.ok(relatorio.linhas > 0);
    const arquivo = await ambiente.app.inject({ method: 'GET', url: `/api/v1/relatorios/${relatorio.id}/baixar`, headers: { cookie } });
    assert.equal(arquivo.statusCode, 200);
    assert.match(String(arquivo.headers['content-disposition']), /attachment; filename="bento-transacoes-.+\.csv"/);
    assert.equal(arquivo.rawPayload.subarray(0, 3).toString('hex'), 'efbbbf');
    assert.ok(arquivo.body.includes('Código;Data;Cliente'));
  });

  it('gera e baixa um relatório em PDF', async () => {
    const gerado = await ambiente.app.inject({
      method: 'POST',
      url: '/api/v1/relatorios',
      headers: cabecalhos(cookie),
      payload: { tipo: 'crescimento', formato: 'pdf', inicio: haDias(180), fim: hoje(), nome: 'Crescimento semestral' },
    });
    assert.equal(gerado.statusCode, 201, gerado.body);
    const relatorio = gerado.json();
    assert.equal(relatorio.nome, 'Crescimento semestral');
    const arquivo = await ambiente.app.inject({ method: 'GET', url: `/api/v1/relatorios/${relatorio.id}/baixar`, headers: { cookie } });
    assert.equal(arquivo.headers['content-type'], 'application/pdf');
    assert.equal(arquivo.rawPayload.subarray(0, 5).toString(), '%PDF-');
    const historico = await ambiente.app.inject({ method: 'GET', url: '/api/v1/relatorios?porPagina=50', headers: { cookie } });
    assert.ok(historico.json().itens.some((item: { id: string }) => item.id === relatorio.id));
  });

  it('executa relatórios agendados vencidos e reagenda o próximo', async () => {
    const { linhas } = await ambiente.banco.consultar<{ id: string }>(
      `update relatorios_agendados set proxima_execucao = now() - interval '1 minute' where frequencia = 'semanal' returning id`,
    );
    assert.equal(linhas.length, 1);
    const executados = await executarVencidos(ambiente.app);
    assert.equal(executados, 1);
    const { linhas: gerados } = await ambiente.banco.consultar<{ total: number }>(
      'select count(*)::int as total from relatorios where agendamento_id = $1',
      [linhas[0].id],
    );
    assert.equal(gerados[0].total, 1);
    const agendados = await ambiente.app.inject({ method: 'GET', url: '/api/v1/relatorios/agendados', headers: { cookie } });
    const semanal = agendados.json().find((item: { id: string }) => item.id === linhas[0].id);
    assert.ok(Date.parse(semanal.proximaExecucao) > Date.now());
    assert.ok(semanal.ultimaExecucao);
    assert.equal(await executarVencidos(ambiente.app), 0);
  });

  it('marca notificações como lidas, uma e todas', async () => {
    const contar = async () =>
      (await ambiente.app.inject({ method: 'GET', url: '/api/v1/notificacoes/contagem', headers: { cookie } })).json().naoLidas as number;
    const antes = await contar();
    assert.ok(antes > 0);
    const lista = await ambiente.app.inject({
      method: 'GET',
      url: '/api/v1/notificacoes?filtro=nao-lidas&porPagina=5',
      headers: { cookie },
    });
    const corpo = lista.json();
    assert.equal(corpo.naoLidas, antes);
    assert.ok(corpo.itens.every((item: { lida: boolean }) => !item.lida));
    const lida = await ambiente.app.inject({
      method: 'POST',
      url: `/api/v1/notificacoes/${corpo.itens[0].id}/ler`,
      headers: cabecalhos(cookie),
    });
    assert.equal(lida.statusCode, 200);
    assert.equal(await contar(), antes - 1);
    const todas = await ambiente.app.inject({ method: 'POST', url: '/api/v1/notificacoes/ler-todas', headers: cabecalhos(cookie) });
    assert.equal(todas.json().afetadas, antes - 1);
    assert.equal(await contar(), 0);
  });

  it('dispensa notificações e respeita as preferências por categoria', async () => {
    const enviada = await ambiente.app.inject({
      method: 'POST',
      url: '/api/v1/notificacoes',
      headers: cabecalhos(cookie),
      payload: { titulo: 'Manutenção programada', mensagem: 'O painel ficará fora do ar por 10 minutos.', tipo: 'alerta' },
    });
    assert.equal(enviada.statusCode, 201);
    const id = enviada.json().id;
    const dispensa = await ambiente.app.inject({ method: 'DELETE', url: `/api/v1/notificacoes/${id}`, headers: cabecalhos(cookie) });
    assert.equal(dispensa.statusCode, 204);
    const depois = await ambiente.app.inject({ method: 'GET', url: '/api/v1/notificacoes?porPagina=100', headers: { cookie } });
    assert.ok(!depois.json().itens.some((item: { id: string }) => item.id === id));

    const preferencias = await ambiente.app.inject({
      method: 'PUT',
      url: '/api/v1/notificacoes/preferencias',
      headers: cabecalhos(cookie),
      payload: [{ categoria: 'transacao', app: false, email: false }],
    });
    assert.equal(preferencias.statusCode, 200);
    const filtrada = await ambiente.app.inject({
      method: 'GET',
      url: '/api/v1/notificacoes?categoria=transacao',
      headers: { cookie },
    });
    assert.equal(filtrada.json().total, 0);
  });
});

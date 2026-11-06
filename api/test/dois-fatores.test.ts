import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { codigoTotp, conferirTotp, deBase32, gerarSegredoTotp, normalizarCodigoRecuperacao, paraBase32, passoDe } from '../src/util/totp.js';
import { cabecalhos, cookiesDe, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

const SEGREDO_RFC = paraBase32(Buffer.from('12345678901234567890'));

const segredoDa = (uri: string): string => new URL(uri.replace('otpauth://', 'http://')).searchParams.get('secret') ?? '';

describe('código TOTP', () => {
  it('segue os vetores de teste da RFC 6238 com 6 dígitos', () => {
    assert.equal(SEGREDO_RFC, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    const esperados: [number, string][] = [
      [59, '287082'],
      [1_111_111_109, '081804'],
      [1_111_111_111, '050471'],
      [1_234_567_890, '005924'],
      [2_000_000_000, '279037'],
    ];
    for (const [segundos, codigo] of esperados) assert.equal(codigoTotp(SEGREDO_RFC, passoDe(segundos * 1000)), codigo);
  });

  it('converte base32 nos dois sentidos e aceita só um passo de tolerância', () => {
    const segredo = gerarSegredoTotp();
    assert.equal(segredo.length, 32);
    assert.equal(paraBase32(deBase32(segredo)), segredo);
    const agora = 1_700_000_000_000;
    const passo = passoDe(agora);
    assert.equal(conferirTotp(segredo, codigoTotp(segredo, passo - 1), null, agora), passo - 1);
    assert.equal(conferirTotp(segredo, codigoTotp(segredo, passo + 1), null, agora), passo + 1);
    assert.equal(conferirTotp(segredo, codigoTotp(segredo, passo + 3), null, agora), null);
    assert.equal(conferirTotp(segredo, codigoTotp(segredo, passo), passo, agora), null);
    assert.equal(conferirTotp(segredo, '12345', null, agora), null);
    assert.equal(normalizarCodigoRecuperacao(' abcd-efgh '), 'ABCDEFGH');
    assert.equal(normalizarCodigoRecuperacao('curto'), null);
  });
});

describe('verificação em duas etapas', () => {
  let ambiente: Ambiente;
  let cookieGerente: string;
  let cookieAdmin: string;
  let segredo = '';
  let codigos: string[] = [];
  let idGerente = '';
  let idSuporte = '';

  before(async () => {
    ambiente = await criarAmbiente();
    cookieGerente = await entrar(ambiente.app, 'gerente@bento.local');
    cookieAdmin = await entrar(ambiente.app);
    const { linhas } = await ambiente.banco.consultar<{ id: string; email: string }>(
      `select id, email from usuarios where email in ('gerente@bento.local', 'suporte@bento.local')`,
    );
    idGerente = linhas.find((linha) => linha.email === 'gerente@bento.local')?.id ?? '';
    idSuporte = linhas.find((linha) => linha.email === 'suporte@bento.local')?.id ?? '';
  });

  after(async () => {
    await ambiente.fechar();
  });

  const pedir = (method: 'GET' | 'POST' | 'PUT', url: string, cookie: string, payload?: unknown) =>
    ambiente.app.inject({ method, url: `/api/v1${url}`, headers: method === 'GET' ? { cookie } : cabecalhos(cookie), ...(payload === undefined ? {} : { payload }) });

  let origem = 0;
  const outroIp = () => `198.51.100.${(origem += 1)}`;

  const entrarComSenha = (email: string) =>
    ambiente.app.inject({ method: 'POST', url: '/api/v1/auth/entrar', payload: { email, senha: 'bento123' }, remoteAddress: outroIp() });

  const concluir = (cookieDesafio: string, codigo: string) =>
    ambiente.app.inject({ method: 'POST', url: '/api/v1/auth/dois-fatores', headers: cabecalhos(cookieDesafio), payload: { codigo }, remoteAddress: outroIp() });

  const proximoCodigo = async (email: string): Promise<string> => {
    await ambiente.banco.consultar('update usuarios set totp_ultimo_passo = null where email = $1', [email]);
    return codigoTotp(segredo, passoDe());
  };

  it('ativa com a senha e o primeiro código e devolve dez códigos de recuperação', async () => {
    const senhaErrada = await pedir('POST', '/configuracoes/seguranca/dois-fatores/iniciar', cookieGerente, { senhaAtual: 'errada' });
    assert.equal(senhaErrada.statusCode, 401);

    const iniciada = await pedir('POST', '/configuracoes/seguranca/dois-fatores/iniciar', cookieGerente, { senhaAtual: 'bento123' });
    assert.equal(iniciada.statusCode, 200, iniciada.body);
    assert.match(iniciada.json().uri, /^otpauth:\/\/totp\/Bento%3Agerente%40bento\.local\?secret=[A-Z2-7]{32}&issuer=Bento/);
    segredo = segredoDa(iniciada.json().uri);
    assert.equal(iniciada.json().segredo.replace(/\s/g, ''), segredo);

    const errado = await pedir('POST', '/configuracoes/seguranca/dois-fatores/ativar', cookieGerente, { codigo: '000000' === codigoTotp(segredo, passoDe()) ? '111111' : '000000' });
    assert.equal(errado.statusCode, 422);

    const ativada = await pedir('POST', '/configuracoes/seguranca/dois-fatores/ativar', cookieGerente, { codigo: codigoTotp(segredo, passoDe()) });
    assert.equal(ativada.statusCode, 200, ativada.body);
    codigos = ativada.json().codigos;
    assert.equal(codigos.length, 10);
    assert.equal(new Set(codigos).size, 10);
    assert.ok(codigos.every((codigo) => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(codigo)));
    assert.equal(ativada.json().estado.ativo, true);
    assert.equal(ativada.json().estado.codigosRestantes, 10);

    const estado = await pedir('GET', '/configuracoes/seguranca/dois-fatores', cookieGerente);
    assert.equal(estado.json().ativo, true);
    const { linhas } = await ambiente.banco.consultar<{ totp_segredo: string }>('select totp_segredo from usuarios where id = $1', [idGerente]);
    assert.ok(linhas[0].totp_segredo.startsWith('enc:v1:'));
    assert.ok(!linhas[0].totp_segredo.includes(segredo));
    const usuario = await pedir('GET', `/usuarios/${idGerente}`, cookieAdmin);
    assert.equal(usuario.json().doisFatores ?? usuario.json().usuario?.doisFatores, true);
  });

  it('pede o código depois da senha e só abre a sessão com um código válido e inédito', async () => {
    const primeira = await entrarComSenha('gerente@bento.local');
    assert.equal(primeira.statusCode, 200);
    assert.deepEqual(Object.keys(primeira.json()).sort(), ['doisFatores', 'expiraEm']);
    const nomes = primeira.cookies.map((cookie) => cookie.name);
    assert.deepEqual(nomes, ['bento_desafio']);
    assert.ok(primeira.cookies[0].httpOnly);
    const desafio = cookiesDe(primeira);

    const comoSessao = await ambiente.app.inject({ method: 'GET', url: '/api/v1/auth/eu', headers: { cookie: `bento_sessao=${primeira.cookies[0].value}` } });
    assert.equal(comoSessao.statusCode, 401);

    const semCabecalho = await ambiente.app.inject({ method: 'POST', url: '/api/v1/auth/dois-fatores', headers: { cookie: desafio }, payload: { codigo: '123456' }, remoteAddress: outroIp() });
    assert.equal(semCabecalho.statusCode, 403);
    assert.equal(semCabecalho.json().erro.codigo, 'CSRF');

    const semDesafio = await ambiente.app.inject({ method: 'POST', url: '/api/v1/auth/dois-fatores', headers: { 'x-bento': '1' }, payload: { codigo: '123456' }, remoteAddress: outroIp() });
    assert.equal(semDesafio.statusCode, 401);

    const { linhas } = await ambiente.banco.consultar<{ passo: string }>('select totp_ultimo_passo as passo from usuarios where id = $1', [idGerente]);
    const repetido = await concluir(desafio, codigoTotp(segredo, Number(linhas[0].passo)));
    assert.equal(repetido.statusCode, 401);

    const certo = await concluir(desafio, await proximoCodigo('gerente@bento.local'));
    assert.equal(certo.statusCode, 200, certo.body);
    assert.equal(certo.json().usuario.email, 'gerente@bento.local');
    const sessao = cookiesDe(certo);
    assert.match(sessao, /bento_sessao=/);
    const eu = await ambiente.app.inject({ method: 'GET', url: '/api/v1/auth/eu', headers: { cookie: sessao } });
    assert.equal(eu.statusCode, 200);
    assert.equal(eu.json().doisFatores.ativo, true);
  });

  it('aceita cada código de recuperação uma vez só e avisa quantos restam', async () => {
    const desafio = cookiesDe(await entrarComSenha('gerente@bento.local'));
    const usado = await concluir(desafio, codigos[0].toLowerCase());
    assert.equal(usado.statusCode, 200, usado.body);
    assert.equal(usado.json().codigosRestantes, 9);
    const outraVez = await concluir(cookiesDe(await entrarComSenha('gerente@bento.local')), codigos[0]);
    assert.equal(outraVez.statusCode, 401);
    const { linhas } = await ambiente.banco.consultar<{ total: number }>(
      `select count(*)::int as total from notificacoes where destinatario_id = $1 and titulo = 'Código de recuperação usado'`,
      [idGerente],
    );
    assert.equal(linhas[0].total, 1);
    await ambiente.banco.consultar('update usuarios set tentativas_falhas = 0 where id = $1', [idGerente]);
  });

  it('suspende o acesso depois de cinco códigos errados', async () => {
    const desafio = cookiesDe(await entrarComSenha('gerente@bento.local'));
    const respostas: number[] = [];
    for (let i = 0; i < 6; i += 1) respostas.push((await concluir(desafio, 'ZZZZ-ZZZZ')).statusCode);
    assert.deepEqual(respostas, [401, 401, 401, 401, 401, 429]);
    await ambiente.banco.consultar('update usuarios set tentativas_falhas = 0, bloqueio_temporario_ate = null where id = $1', [idGerente]);
  });

  it('regenera os códigos e desativa com senha e código', async () => {
    const sessao = cookiesDe(await concluir(cookiesDe(await entrarComSenha('gerente@bento.local')), await proximoCodigo('gerente@bento.local')));
    const semCodigoNovo = await pedir('POST', '/configuracoes/seguranca/dois-fatores/codigos', sessao, { senhaAtual: 'bento123', codigo: '000000' });
    assert.equal(semCodigoNovo.statusCode, 422);
    const novos = await pedir('POST', '/configuracoes/seguranca/dois-fatores/codigos', sessao, { senhaAtual: 'bento123', codigo: codigos[1] });
    assert.equal(novos.statusCode, 200, novos.body);
    assert.equal(novos.json().codigos.length, 10);
    assert.equal(novos.json().codigos.includes(codigos[1]), false);
    codigos = novos.json().codigos;

    const semCodigo = await pedir('POST', '/configuracoes/seguranca/dois-fatores/desativar', sessao, { senhaAtual: 'bento123', codigo: '999999' });
    assert.equal(semCodigo.statusCode, 422);
    const desligada = await pedir('POST', '/configuracoes/seguranca/dois-fatores/desativar', sessao, { senhaAtual: 'bento123', codigo: codigos[0] });
    assert.equal(desligada.statusCode, 200, desligada.body);
    assert.equal(desligada.json().ativo, false);
    const { linhas } = await ambiente.banco.consultar<{ total: number }>('select count(*)::int as total from codigos_recuperacao where usuario_id = $1', [idGerente]);
    assert.equal(linhas[0].total, 0);
    const direto = await entrarComSenha('gerente@bento.local');
    assert.ok(direto.cookies.some((cookie) => cookie.name === 'bento_sessao'));
  });

  it('exige a configuração dos papéis marcados e libera só as rotas da própria conta', async () => {
    const proprio = await pedir('PUT', '/configuracoes/sistema', cookieAdmin, { doisFatoresPapeis: ['admin'] });
    assert.equal(proprio.statusCode, 422);
    const cliente = await pedir('PUT', '/configuracoes/sistema', cookieAdmin, { doisFatoresPapeis: ['cliente'] });
    assert.equal(cliente.statusCode, 422);
    const regra = await pedir('PUT', '/configuracoes/sistema', cookieAdmin, { doisFatoresPapeis: ['suporte', 'suporte'] });
    assert.equal(regra.statusCode, 200, regra.body);
    assert.deepEqual(regra.json().doisFatoresPapeis, ['suporte']);

    const suporte = cookiesDe(await entrarComSenha('suporte@bento.local'));
    const eu = await pedir('GET', '/auth/eu', suporte);
    assert.equal(eu.statusCode, 200);
    assert.equal(eu.json().doisFatores.pendente, true);
    const bloqueada = await pedir('GET', '/visao-geral', suporte);
    assert.equal(bloqueada.statusCode, 403);
    assert.equal(bloqueada.json().erro.codigo, 'DOIS_FATORES');
    const tokenSessao = suporte.split('; ').find((parte) => parte.startsWith('bento_sessao='))?.slice('bento_sessao='.length) ?? '';
    const comoBearer = await ambiente.app.inject({ method: 'GET', url: '/api/v1/visao-geral', headers: { authorization: `Bearer ${tokenSessao}` } });
    assert.equal(comoBearer.statusCode, 403);
    assert.equal(comoBearer.json().erro.codigo, 'DOIS_FATORES');
    assert.equal((await pedir('GET', '/configuracoes/seguranca/dois-fatores', suporte)).statusCode, 200);
    assert.equal((await pedir('GET', '/notificacoes/contagem', suporte)).statusCode, 200);

    const iniciada = await pedir('POST', '/configuracoes/seguranca/dois-fatores/iniciar', suporte, { senhaAtual: 'bento123' });
    segredo = segredoDa(iniciada.json().uri);
    const ativada = await pedir('POST', '/configuracoes/seguranca/dois-fatores/ativar', suporte, { codigo: codigoTotp(segredo, passoDe()) });
    assert.equal(ativada.statusCode, 200);
    assert.equal((await pedir('GET', '/visao-geral', suporte)).statusCode, 200);

    const desligar = await pedir('POST', '/configuracoes/seguranca/dois-fatores/desativar', suporte, { senhaAtual: 'bento123', codigo: ativada.json().codigos[0] });
    assert.equal(desligar.statusCode, 409);
  });

  it('administrador redefine a verificação de quem perdeu o celular, respeitando a hierarquia', async () => {
    const suporte = cookiesDe(await concluir(cookiesDe(await entrarComSenha('suporte@bento.local')), await proximoCodigo('suporte@bento.local')));
    const { linhas } = await ambiente.banco.consultar<{ id: string }>(`select id from usuarios where email = 'admin@bento.local'`);
    const contraAdmin = await pedir('POST', `/usuarios/${linhas[0].id}/redefinir-dois-fatores`, suporte);
    assert.equal(contraAdmin.statusCode, 403);
    const propria = await pedir('POST', `/usuarios/${linhas[0].id}/redefinir-dois-fatores`, cookieAdmin);
    assert.equal(propria.statusCode, 422);

    await pedir('PUT', '/configuracoes/sistema', cookieAdmin, { doisFatoresPapeis: [] });
    const redefinida = await pedir('POST', `/usuarios/${idSuporte}/redefinir-dois-fatores`, cookieAdmin);
    assert.equal(redefinida.statusCode, 200, redefinida.body);
    assert.equal((await pedir('POST', `/usuarios/${idSuporte}/redefinir-dois-fatores`, cookieAdmin)).statusCode, 409);
    assert.equal((await pedir('GET', '/auth/eu', suporte)).statusCode, 401);
    const auditoria = await ambiente.banco.consultar<{ acao: string }>(
      `select acao from auditoria where acao in ('seguranca.dois_fatores_ativado', 'seguranca.dois_fatores_desativado', 'usuario.dois_fatores_redefinido', 'seguranca.codigos_gerados')`,
    );
    const acoes = new Set(auditoria.linhas.map((linha) => linha.acao));
    assert.equal(acoes.size, 4);
  });
});

import type { FastifyInstance } from 'fastify';
import { dispararEmSegundoPlano } from './integracoes.js';
import { registrarAtividade } from './modulos/comum/auditoria.js';
import { buscarTransacao, buscarUsuario } from './modulos/comum/consultas.js';
import { hojeLocal } from './modulos/metricas/base.js';
import { criarNotificacao } from './modulos/notificacoes/servico.js';
import { CANAIS, CIDADES, criarSorteio, escolherPonderado, gerarNomeFicticio, PAISES } from './banco/ficticios.js';
import { formatarMoeda } from './util/formato.js';

interface Assinante {
  assinatura_id: string;
  usuario_id: string;
  nome: string;
  email: string;
  plano: string;
  plano_nome: string;
  valor: number;
  metodo: 'cartao' | 'pix' | 'boleto';
}

export function iniciarSimulador(app: FastifyInstance): () => void {
  const sorteio = criarSorteio(Date.now() % 2_147_483_647);
  const mediaMs = app.config.intervaloSimulador * 1_000;
  let temporizador: NodeJS.Timeout | null = null;
  let parado = false;
  let ciclos = 0;

  const novaTransacao = async () => {
    const { banco, barramento } = app;
    const { linhas } = await banco.consultar<Assinante>(
      `select a.id as assinatura_id, u.id as usuario_id, u.nome, u.email, a.plano, p.nome as plano_nome, a.valor, a.metodo
         from assinaturas a
         join usuarios u on u.id = a.usuario_id
         join planos p on p.codigo = a.plano
        where a.status = 'ativa' and a.ciclo = 'mensal' and u.status = 'ativo'
        order by random()
        limit 1`,
    );
    const assinante = linhas[0];
    if (!assinante) return;
    const sorte = sorteio();
    const status = sorte < 0.88 ? 'paga' : sorte < 0.95 ? 'falhou' : 'pendente';
    const metodo = status === 'pendente' && assinante.metodo === 'cartao' ? 'boleto' : assinante.metodo;
    const { linhas: criadas } = await banco.consultar<{ id: string }>(
      `insert into transacoes (usuario_id, assinatura_id, plano, cliente_nome, cliente_email, tipo, metodo, status, valor, pago_em)
       values ($1, $2, $3, $4, $5, 'assinatura', $6, $7, $8, case when $7 = 'paga' then now() else null end)
       returning id`,
      [assinante.usuario_id, assinante.assinatura_id, assinante.plano, assinante.nome, assinante.email, metodo, status, assinante.valor],
    );
    const transacao = await buscarTransacao(banco, criadas[0].id);
    const valor = formatarMoeda(assinante.valor);
    if (status === 'paga') {
      await barramento.publicar({ tipo: 'transacao', destinatarioId: null, dados: transacao });
      await criarNotificacao(banco, barramento, {
        destinatarioId: null,
        tipo: 'sucesso',
        categoria: 'transacao',
        titulo: `Nova transação de ${valor}`,
        mensagem: `${assinante.nome} pagou ${valor} no plano ${assinante.plano_nome}.`,
        link: '/',
        dados: { transacaoId: transacao.id },
      });
      dispararEmSegundoPlano(banco, app.config.segredoJwt, app.log, 'transacao.paga', `${assinante.nome} pagou ${valor} (${assinante.plano_nome})`, transacao);
    } else if (status === 'falhou') {
      await criarNotificacao(banco, barramento, {
        destinatarioId: null,
        tipo: 'erro',
        categoria: 'transacao',
        titulo: 'Pagamento recusado',
        mensagem: `A cobrança de ${valor} de ${assinante.nome} (${assinante.plano_nome}) foi recusada.`,
        link: '/',
        dados: { transacaoId: transacao.id },
      });
      await registrarAtividade(banco, {
        usuarioId: null,
        acao: 'transacao.falhou',
        entidade: 'transacao',
        entidadeId: transacao.id,
        descricao: `Pagamento recusado de ${assinante.nome} (${valor})`,
      });
    }
  };

  const novoCadastro = async () => {
    const { banco, barramento } = app;
    const pais = escolherPonderado(sorteio, PAISES);
    const canal = escolherPonderado(sorteio, CANAIS);
    const { nome, email } = gerarNomeFicticio(sorteio, `${Date.now().toString(36)}`);
    const cidades = CIDADES[pais.codigo] ?? ['São Paulo'];
    const cidade = cidades[Math.floor(sorteio() * cidades.length)];
    const { linhas } = await banco.consultar<{ id: string }>(
      `insert into usuarios (nome, email, papel, status, pais, cidade, canal, ultimo_acesso)
       values ($1, $2, 'cliente', 'ativo', $3, $4, $5, now()) returning id`,
      [nome, email, pais.nome, cidade, canal.nome],
    );
    const id = linhas[0].id;
    if (sorteio() < 0.7) {
      await banco.consultar(
        `insert into assinaturas (usuario_id, plano, status, ciclo, metodo, valor, iniciada_em, teste_ate)
         values ($1, 'profissional', 'teste', 'mensal', 'cartao', 12900, now(), now() + interval '14 days')`,
        [id],
      );
    }
    await banco.consultar(
      `insert into trafego_diario (dia, canal, dispositivo, visitantes, sessoes, cadastros)
       values ($1::date, $2, 'Desktop', 1, 1, 1)
       on conflict (dia, canal, dispositivo) do update set cadastros = trafego_diario.cadastros + 1,
         visitantes = greatest(trafego_diario.visitantes, trafego_diario.cadastros + 1)`,
      [hojeLocal(app.config.fuso), canal.nome],
    );
    const usuario = await buscarUsuario(banco, id);
    await registrarAtividade(banco, {
      usuarioId: null,
      acao: 'usuario.cadastrado',
      entidade: 'usuario',
      entidadeId: id,
      descricao: `Novo cadastro de ${nome} pelo canal ${canal.nome}`,
    });
    await barramento.publicar({ tipo: 'usuario', destinatarioId: null, dados: usuario });
    await criarNotificacao(banco, barramento, {
      destinatarioId: null,
      tipo: 'info',
      categoria: 'usuario',
      titulo: 'Novo cadastro',
      mensagem: `${nome} criou uma conta pelo canal ${canal.nome}.`,
      link: '/usuarios',
      dados: { usuarioId: id },
    });
    dispararEmSegundoPlano(banco, app.config.segredoJwt, app.log, 'usuario.criado', `Novo cadastro: ${nome}`, usuario);
  };

  const agendar = () => {
    if (parado) return;
    const espera = Math.round(mediaMs * (0.6 + sorteio() * 0.8));
    temporizador = setTimeout(async () => {
      try {
        ciclos += 1;
        await novaTransacao();
        if (ciclos % 5 === 0) await novoCadastro();
      } catch (erro) {
        app.log.warn({ erro }, 'Falha no simulador de atividade');
      } finally {
        agendar();
      }
    }, espera);
    temporizador.unref();
  };

  agendar();
  return () => {
    parado = true;
    if (temporizador) clearTimeout(temporizador);
  };
}

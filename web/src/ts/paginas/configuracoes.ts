import { iniciarPagina } from "../layout/inicio.ts";
import { html, $, $$, exigir, renderizar, parametrosUrl, atualizarUrl, carregando } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { api, mensagemDeErro, ErroApi } from "../nucleo/api.ts";
import { pode, atualizarUsuarioAtual, atualizarPreferencias, atualizarSistema, usuarioAtual, sessao } from "../nucleo/sessao.ts";
import { aplicarTema, aplicarPaleta, aplicarDensidade, aplicarMovimento, definirBarraRecolhida, preferenciasLocais } from "../nucleo/tema.ts";
import { relativo, corAvatar, moeda, dataHora, numero } from "../nucleo/formato.ts";
import { limparRecentes } from "../nucleo/recentes.ts";
import { PAGINAS_INICIAIS, paginaPorId } from "../layout/navegacao.ts";
import { abrirNovidades } from "../layout/novidades.ts";
import { definirManutencao } from "../layout/manutencao.ts";
import { Gaveta } from "../componentes/gaveta.ts";
import { iniciarAbas } from "../componentes/abas.ts";
import { confirmar, mostrarSegredo } from "../componentes/modal.ts";
import { avisar, avisoSucesso } from "../componentes/aviso.ts";
import { lerFormulario, mostrarErros, limparErros, ligarForcaSenha, ligarMostrarSenha } from "../componentes/formulario.ts";
import { iniciarDoisFatores } from "../componentes/dois-fatores.ts";
import type {
  EntregaIntegracao,
  EstadoAjustes,
  EstadoDoisFatores,
  EstadoManutencao,
  Integracao,
  ModoSimulador,
  Pagina,
  Preferencias,
  ResumoDemonstracao,
  RetencaoDias,
  Sistema,
  StatusEntrega,
  Usuario,
} from "../nucleo/tipos.ts";
import { ouvir } from "../nucleo/eventos.ts";

interface SessaoAtiva {
  id: string;
  navegador: string | null;
  sistema: string | null;
  ip: string | null;
  criadoEm: string;
  ultimoUso: string | null;
  atual: boolean;
}

interface ChaveApi {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  ultimoUso: string | null;
  criadoEm: string;
}

type DadosAparencia = {
  tema: string;
  paleta: string;
  densidade: string;
  sidebarRecolhida: boolean;
};

type DadosChave = {
  nome: string;
  acesso: string;
};

type CampoFormulario = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const campo = <T extends Element = HTMLInputElement>(formulario: HTMLFormElement, nome: string): T => formulario.elements.namedItem(nome) as T;

const alvoDoEvento = (evento: Event): Element => evento.target as Element;

const ICONES_PROVEDOR: Record<string, string> = {
  webhook: "webhook",
  slack: "hash",
  discord: "mensagens",
  teams: "usuarios",
  "google-chat": "globo",
  telegram: "enviar",
  "google-analytics": "grafico-combinado",
  stripe: "cartao",
};

const carregados = new Set<string>();

const preencherFormulario = (formulario: HTMLFormElement, dados: object): void => {
  const valores = dados as Record<string, unknown>;
  for (const item of formulario.elements) {
    const elemento = item as CampoFormulario;
    if (!elemento.name || !(elemento.name in valores)) continue;
    const valor = valores[elemento.name];
    if (elemento instanceof HTMLInputElement && elemento.type === "radio") elemento.checked = elemento.value === String(valor);
    else if (elemento instanceof HTMLInputElement && elemento.type === "checkbox" && Array.isArray(valor)) elemento.checked = valor.includes(elemento.value);
    else if (elemento instanceof HTMLInputElement && elemento.type === "checkbox") elemento.checked = Boolean(valor);
    else if (elemento.dataset.moeda !== undefined) elemento.value = valor === null || valor === undefined ? "" : (Number(valor) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    else elemento.value = String(valor ?? "");
  }
};

const tratarErroFormulario = (formulario: HTMLFormElement, erro: unknown, titulo: string): void => {
  if (erro instanceof ErroApi && erro.codigo === "VALIDACAO" && mostrarErros(formulario, erro.detalhes)) return;
  if (erro instanceof ErroApi && erro.codigo === "CREDENCIAIS") {
    mostrarErros(formulario, { senhaAtual: erro.message });
    return;
  }
  if (erro instanceof ErroApi && erro.codigo === "CONFLITO") {
    mostrarErros(formulario, { email: erro.message });
    return;
  }
  avisar({ tipo: "erro", titulo, texto: mensagemDeErro(erro) });
};

const secaoPerfil = async (): Promise<void> => {
  const formulario = exigir<HTMLFormElement>("[data-form-perfil]");
  const perfil = await api.obter<Usuario>("/configuracoes/perfil");
  preencherFormulario(formulario, perfil);
  renderizar(
    $("[data-perfil-foto]"),
    html`<span class="avatar avatar-gigante" data-cor="${corAvatar(perfil.email)}" aria-hidden="true">${perfil.iniciais}</span>
      <div class="pilha-pequena"><p class="font-semibold">${perfil.papel?.nome}</p><p class="text-xs texto-suave">Conta criada ${relativo(perfil.criadoEm)}. O avatar usa suas iniciais.</p></div>`,
  );
  const emailOriginal = perfil.email;
  const campoSenha = exigir("[data-campo-senha-atual]");
  campo(formulario, "email").addEventListener("input", () => {
    const mudou = campo(formulario, "email").value.trim().toLowerCase() !== emailOriginal.toLowerCase();
    campoSenha.hidden = !mudou;
    campo(formulario, "senhaAtual").required = mudou;
  });
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = formulario.querySelector<HTMLButtonElement>("[data-salvar]");
    carregando(botao, true);
    try {
      const dados = lerFormulario(formulario) as Record<string, string>;
      if (dados.email.toLowerCase() === emailOriginal.toLowerCase()) {
        delete dados.email;
        delete dados.senhaAtual;
      }
      const atualizado = await api.atualizar<Usuario>("/configuracoes/perfil", dados);
      atualizarUsuarioAtual(atualizado);
      campo(formulario, "senhaAtual").value = "";
      campoSenha.hidden = true;
      avisoSucesso("Perfil salvo");
    } catch (erro) {
      tratarErroFormulario(formulario, erro, "Não foi possível salvar o perfil");
    } finally {
      carregando(botao, false);
    }
  });
};

const secaoAparencia = async (): Promise<void> => {
  const formulario = exigir<HTMLFormElement>("[data-form-aparencia]");
  const locais = preferenciasLocais();
  preencherFormulario(formulario, locais);
  const salvarNoServidor = (() => {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    return (preferencias: DadosAparencia): void => {
      clearTimeout(temporizador);
      temporizador = setTimeout(async () => {
        try {
          const salvas = await api.substituir<Preferencias>("/configuracoes/aparencia", preferencias);
          atualizarPreferencias(salvas);
        } catch (erro) {
          avisar({ tipo: "erro", titulo: "Aparência salva só neste navegador", texto: mensagemDeErro(erro) });
        }
      }, 400);
    };
  })();
  formulario.addEventListener("change", (evento) => {
    const { name } = evento.target as HTMLInputElement;
    const dados = lerFormulario(formulario) as DadosAparencia;
    if (name === "tema") aplicarTema(dados.tema);
    if (name === "paleta") aplicarPaleta(dados.paleta);
    if (name === "densidade") aplicarDensidade(dados.densidade);
    if (name === "sidebarRecolhida") {
      definirBarraRecolhida(dados.sidebarRecolhida);
      const casca = $("#casca");
      if (casca) casca.dataset.barra = dados.sidebarRecolhida ? "recolhida" : "expandida";
    }
    salvarNoServidor(dados);
  });
};

const secaoPreferencias = async (): Promise<void> => {
  const formulario = exigir<HTMLFormElement>("[data-form-preferencias]");
  const seletor = exigir<HTMLSelectElement>("[data-paginas-iniciais]", formulario);
  const opcoes = PAGINAS_INICIAIS.map((id) => paginaPorId(id)).filter((item) => item && pode(item.permissao));
  renderizar(seletor, html`${opcoes.map((item) => html`<option value="${item?.id ?? ""}">${item?.rotulo ?? ""}</option>`)}`);
  const atuais = await api.obter<Preferencias>("/configuracoes/preferencias");
  atualizarPreferencias(atuais);
  const preencher = (preferencias: Preferencias): void =>
    preencherFormulario(formulario, {
      paginaInicial: opcoes.some((item) => item?.id === preferencias.paginaInicial) ? preferencias.paginaInicial : (opcoes[0]?.id ?? "visao-geral"),
      itensPorPagina: preferencias.itensPorPagina ?? 25,
      movimento: preferencias.movimento ?? "sistema",
      atalhosTeclado: preferencias.atalhosTeclado ?? true,
      mostrarPrimeirosPassos: !preferencias.primeirosPassosOcultos,
    });
  preencher(atuais);
  formulario.addEventListener("change", async (evento) => {
    const alvo = evento.target as HTMLInputElement;
    const dados = lerFormulario(formulario) as Record<string, unknown>;
    const corpo: Partial<Preferencias> = {
      paginaInicial: dados.paginaInicial as Preferencias["paginaInicial"],
      itensPorPagina: Number(dados.itensPorPagina),
      movimento: dados.movimento as Preferencias["movimento"],
      atalhosTeclado: Boolean(dados.atalhosTeclado),
    };
    if ("mostrarPrimeirosPassos" in dados) corpo.primeirosPassosOcultos = !dados.mostrarPrimeirosPassos;
    if (alvo.name === "movimento") aplicarMovimento(String(dados.movimento));
    try {
      const salvas = await api.substituir<Preferencias>("/configuracoes/preferencias", corpo);
      atualizarPreferencias(salvas);
      avisoSucesso("Preferência salva", alvo.name === "itensPorPagina" ? "Vale para as próximas tabelas que você abrir." : undefined);
    } catch (erro) {
      preencher(atuais);
      avisar({ tipo: "erro", titulo: "Não foi possível salvar a preferência", texto: mensagemDeErro(erro) });
    }
  });
  exigir("[data-ver-novidades]", formulario).addEventListener("click", () => abrirNovidades());
  exigir("[data-limpar-recentes]", formulario).addEventListener("click", () => {
    limparRecentes(usuarioAtual()?.id);
    avisoSucesso("Lista de recentes limpa");
  });
};

const navegadorDe = (sessao: SessaoAtiva): string => [sessao.navegador, sessao.sistema].filter(Boolean).join(" no ") || "Navegador desconhecido";

const carregarSessoes = async (): Promise<void> => {
  const alvo = exigir("[data-sessoes]");
  try {
    const sessoes = await api.obter<SessaoAtiva[]>("/configuracoes/seguranca/sessoes");
    renderizar(
      alvo,
      html`${sessoes.map(
        (sessao) => html`<div class="sessao-item">
          <span class="sessao-icone">${html([icone(/android|iphone|ios|celular/i.test(`${sessao.sistema} ${sessao.navegador}`) ? "celular" : "notebook")])}</span>
          <div class="sessao-textos">
            <p class="sessao-titulo">${navegadorDe(sessao)}${sessao.atual ? html`<span class="emblema emblema-oliva emblema-pequeno">Esta sessão</span>` : ""}</p>
            <p class="sessao-detalhe">${sessao.ip ?? "IP oculto"}, entrou ${relativo(sessao.criadoEm)}${sessao.ultimoUso ? `, usada ${relativo(sessao.ultimoUso)}` : ""}</p>
          </div>
          ${sessao.atual ? "" : html`<button type="button" class="botao botao-fantasma botao-pequeno" data-revogar="${sessao.id}">Encerrar</button>`}
        </div>`,
      )}`,
    );
    exigir('[data-acao="encerrar-outras"]').hidden = sessoes.filter((sessao) => !sessao.atual).length === 0;
  } catch (erro) {
    renderizar(alvo, html`<p class="text-sm texto-suave">${mensagemDeErro(erro)}</p>`);
  }
};

const secaoSeguranca = async (): Promise<void> => {
  exigir("[data-aviso-dois-fatores]").hidden = !sessao().doisFatores?.pendente;
  ouvir<EstadoDoisFatores>("sessao:dois-fatores", (estado) => {
    exigir("[data-aviso-dois-fatores]").hidden = !estado?.pendente;
    if (estado && !estado.pendente && parametrosUrl().obrigatorio) atualizarUrl({ obrigatorio: null });
  });
  const formulario = exigir<HTMLFormElement>("[data-form-senha]");
  ligarForcaSenha($<HTMLInputElement>("[data-nova-senha]"), $<HTMLElement>("[data-forca]"));
  ligarMostrarSenha(formulario);
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = formulario.querySelector<HTMLButtonElement>("[data-salvar]");
    carregando(botao, true);
    try {
      await api.criar("/configuracoes/seguranca/senha", lerFormulario(formulario));
      formulario.reset();
      exigir("[data-forca]").dataset.nivel = "0";
      avisoSucesso("Senha trocada", "As outras sessões foram encerradas.");
      carregarSessoes();
    } catch (erro) {
      tratarErroFormulario(formulario, erro, "Não foi possível trocar a senha");
    } finally {
      carregando(botao, false);
    }
  });
  exigir("[data-sessoes]").addEventListener("click", async (evento) => {
    const botao = alvoDoEvento(evento).closest<HTMLButtonElement>("[data-revogar]");
    if (!botao) return;
    carregando(botao, true);
    try {
      await api.excluir(`/configuracoes/seguranca/sessoes/${botao.dataset.revogar}`);
      carregarSessoes();
    } catch (erro) {
      carregando(botao, false);
      avisar({ tipo: "erro", titulo: "Não foi possível encerrar", texto: mensagemDeErro(erro) });
    }
  });
  exigir('[data-acao="encerrar-outras"]').addEventListener("click", async (evento) => {
    const ok = await confirmar({ titulo: "Encerrar as outras sessões?", texto: "Você continua conectado aqui. Nos outros dispositivos será preciso entrar de novo.", tipo: "alerta", confirmar: "Encerrar sessões" });
    if (!ok) return;
    carregando(evento.currentTarget as HTMLButtonElement, true);
    try {
      const { revogadas } = await api.excluir<{ revogadas: number }>("/configuracoes/seguranca/sessoes");
      avisoSucesso("Sessões encerradas", `${revogadas} ${revogadas === 1 ? "sessão encerrada" : "sessões encerradas"}.`);
      carregarSessoes();
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível encerrar", texto: mensagemDeErro(erro) });
    } finally {
      carregando($<HTMLButtonElement>('[data-acao="encerrar-outras"]'), false);
    }
  });
  await Promise.all([carregarSessoes(), iniciarDoisFatores(exigir("[data-dois-fatores]"))]);
};

const carregarChaves = async (): Promise<void> => {
  const alvo = exigir("[data-chaves]");
  try {
    const chaves = await api.obter<ChaveApi[]>("/configuracoes/chaves-api");
    if (!chaves.length) {
      renderizar(alvo, html`<div class="vazio vazio-compacto"><span class="vazio-icone">${html([icone("chave")])}</span><p class="vazio-titulo">Nenhuma chave criada</p><p class="vazio-texto">Crie uma chave para automatizar tarefas com a API.</p></div>`);
      return;
    }
    renderizar(
      alvo,
      html`${chaves.map(
        (chave) => html`<div class="chave-item">
          <span class="sessao-icone">${html([icone("chave")])}</span>
          <div class="sessao-textos">
            <p class="sessao-titulo">${chave.nome}${chave.escopos.map((escopo) => html`<span class="emblema emblema-pequeno ${escopo === "escrita" ? "emblema-ouro" : "emblema-neutro"}">${escopo === "escrita" ? "Leitura e escrita" : "Só leitura"}</span>`)}</p>
            <p class="sessao-detalhe">Criada ${relativo(chave.criadoEm)}, ${chave.ultimoUso ? `usada ${relativo(chave.ultimoUso)}` : "nunca usada"}</p>
          </div>
          <code class="chave-prefixo">${chave.prefixo}…</code>
          <button type="button" class="botao botao-fantasma botao-pequeno" data-revogar-chave="${chave.id}" data-nome="${chave.nome}">${html([icone("lixeira")])}Revogar</button>
        </div>`,
      )}`,
    );
  } catch (erro) {
    renderizar(alvo, html`<p class="text-sm texto-suave">${mensagemDeErro(erro)}</p>`);
  }
};

const secaoChaves = async (): Promise<void> => {
  exigir('[data-acao="nova-chave"]').addEventListener("click", () => {
    const gaveta = new Gaveta({ titulo: "Nova chave de API", subtitulo: "O segredo aparece uma única vez, logo depois de criar." }).abrir();
    gaveta.definirCorpo(html`
      <form class="formulario" id="form-chave" novalidate>
        <label class="campo">
          <span class="campo-rotulo campo-obrigatorio">Nome</span>
          <input class="entrada" name="nome" required maxlength="80" placeholder="Ex.: Integração com o ERP">
          <span class="campo-ajuda">Ajuda a lembrar onde a chave está em uso.</span>
        </label>
        <fieldset class="campo">
          <legend class="campo-rotulo mb-2">Acesso</legend>
          <label class="opcao"><input type="radio" class="radio" name="acesso" value="leitura" checked><span class="opcao-texto"><span class="opcao-titulo">Só leitura</span><span class="opcao-descricao">Consulta dados com GET. Não altera nada.</span></span></label>
          <label class="opcao mt-3"><input type="radio" class="radio" name="acesso" value="escrita"><span class="opcao-texto"><span class="opcao-titulo">Leitura e escrita</span><span class="opcao-descricao">Pode criar e alterar tudo o que sua conta pode.</span></span></label>
        </fieldset>
      </form>
    `);
    gaveta.definirRodape(html`<button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button><button type="submit" form="form-chave" class="botao botao-primario" data-criar><i data-icone="chave"></i>Criar chave</button>`);
    exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
    const formulario = exigir<HTMLFormElement>("#form-chave");
    formulario.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      if (!formulario.reportValidity()) return;
      const botao = gaveta.rodape.querySelector<HTMLButtonElement>("[data-criar]");
      carregando(botao, true);
      try {
        const { nome, acesso } = lerFormulario(formulario) as DadosChave;
        const { segredo } = await api.criar<{ chave: ChaveApi; segredo: string }>("/configuracoes/chaves-api", { nome, escopos: acesso === "escrita" ? ["leitura", "escrita"] : ["leitura"] });
        gaveta.fechar();
        carregarChaves();
        await mostrarSegredo({ titulo: "Chave criada", texto: "Copie e guarde em um lugar seguro. Depois de fechar esta janela não é possível ver o segredo de novo.", segredo });
      } catch (erro) {
        tratarErroFormulario(formulario, erro, "Não foi possível criar a chave");
      } finally {
        carregando(botao, false);
      }
    });
  });
  exigir("[data-chaves]").addEventListener("click", async (evento) => {
    const botao = alvoDoEvento(evento).closest<HTMLElement>("[data-revogar-chave]");
    if (!botao) return;
    const ok = await confirmar({ titulo: `Revogar “${botao.dataset.nome}”?`, texto: "Sistemas que usam esta chave deixam de acessar a API na hora.", tipo: "perigo", confirmar: "Revogar chave" });
    if (!ok) return;
    try {
      await api.excluir(`/configuracoes/chaves-api/${botao.dataset.revogarChave}`);
      carregarChaves();
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível revogar", texto: mensagemDeErro(erro) });
    }
  });
  await carregarChaves();
};

const cartaoIntegracao = (integracao: Integracao) => html`
  <article class="integracao" data-ativo="${integracao.ativo}">
    <div class="integracao-topo">
      <span class="integracao-logo" data-provedor="${integracao.provedor}">${html([icone(ICONES_PROVEDOR[integracao.provedor] ?? "integracao")])}</span>
      <span class="emblema emblema-pequeno" data-status="${integracao.status}">${integracao.status === "conectada" ? "Conectada" : integracao.status === "erro" ? "Com erro" : "Desligada"}</span>
    </div>
    <div class="integracao-textos">
      <h3 class="integracao-nome">${integracao.nome}</h3>
      <p class="integracao-categoria">${integracao.categoria}</p>
    </div>
    <p class="integracao-descricao">${integracao.descricao}</p>
    <div class="integracao-rodape">
      <span class="integracao-evento">${integracao.ultimoEvento ? `Último evento ${relativo(integracao.ultimoEvento)}` : integracao.configurada ? "Configurada" : "Não configurada"}</span>
      <div class="integracao-botoes">
        ${integracao.enviaEventos ? html`<button type="button" class="botao botao-fantasma botao-icone botao-pequeno" data-entregas="${integracao.id}" aria-label="Histórico de entregas de ${integracao.nome}" data-dica-flutuante="Entregas">${html([icone("historico")])}</button>` : ""}
        <button type="button" class="botao botao-secundario botao-pequeno" data-configurar="${integracao.id}">${html([icone("ajustes")])}Configurar</button>
      </div>
    </div>
    ${integracao.status === "erro" && integracao.ultimoErro ? html`<p class="integracao-erro">${integracao.ultimoErro}</p>` : ""}
  </article>
`;

const ROTULOS_ENTREGA: Record<StatusEntrega, string> = { pendente: "Nova tentativa", entregue: "Entregue", falhou: "Falhou" };
const STATUS_EMBLEMA_ENTREGA: Record<StatusEntrega, string> = { pendente: "pendente", entregue: "sucesso", falhou: "erro" };
const ROTULOS_EVENTO: Record<string, string> = {
  "transacao.paga": "Transação paga",
  "usuario.criado": "Usuário criado",
  "usuario.bloqueado": "Usuário bloqueado",
  "relatorio.gerado": "Relatório gerado",
  "alerta.disparado": "Alerta de métrica disparado",
  "integracao.teste": "Teste",
};

const EVENTOS_INTEGRACAO = ["transacao.paga", "usuario.criado", "usuario.bloqueado", "relatorio.gerado", "alerta.disparado"] as const;

const exemploVerificacao = (): string =>
  [
    'import { createHmac, timingSafeEqual } from "node:crypto";',
    "",
    "export function assinaturaValida(corpoBruto, cabecalho, segredo) {",
    '  const esperado = "sha256=" + createHmac("sha256", segredo).update(corpoBruto).digest("hex");',
    "  return cabecalho?.length === esperado.length && timingSafeEqual(Buffer.from(cabecalho), Buffer.from(esperado));",
    "}",
  ].join("\n");

const blocoCopiavel = (rotulo: string, conteudo: string) => html`
  <div class="integracao-codigo">
    <div class="integracao-codigo-topo">
      <span>${rotulo}</span>
      <button type="button" class="botao botao-fantasma botao-pequeno" data-copiar-codigo>${html([icone("copiar")])}Copiar</button>
    </div>
    <pre><code>${conteudo}</code></pre>
  </div>
`;

const guiaIntegracao = (integracao: Integracao) => html`
  <details class="integracao-guia" ${integracao.configurada ? "" : "open"}>
    <summary>${html([icone("bussola")])}Como conectar ${integracao.nome}</summary>
    <ol class="integracao-passos">${integracao.guia.passos.map((passo) => html`<li>${passo}</li>`)}</ol>
    <a class="link-externo" href="${integracao.guia.documentacao}" target="_blank" rel="noopener noreferrer">${html([icone("externo")])}Documentação oficial</a>
  </details>
`;

const eventosIntegracao = (integracao: Integracao) => html`
  <fieldset class="campo integracao-eventos" data-eventos>
    <legend class="campo-rotulo campo-obrigatorio">Eventos enviados</legend>
    <div class="opcoes-papeis">
      ${EVENTOS_INTEGRACAO.map(
        (evento) => html`<label class="opcao"><input type="checkbox" class="caixa-marcacao" name="eventos" value="${evento}" ${integracao.eventos.includes(evento) ? "checked" : ""}><span class="opcao-texto"><span class="opcao-titulo">${ROTULOS_EVENTO[evento]}</span></span></label>`,
      )}
    </div>
    <span class="campo-ajuda">Escolha o que esta integração recebe. Os alertas só chegam quando a regra estiver marcada para avisar as integrações.</span>
  </fieldset>
`;

const exemploWebhook = (integracao: Integracao) =>
  integracao.exemplo
    ? html`<details class="integracao-guia">
        <summary>${html([icone("arquivo")])}O que chega no seu sistema</summary>
        <p class="campo-ajuda">Um POST em JSON com os cabeçalhos <code>X-Bento-Evento</code>, <code>X-Bento-Entrega</code>, <code>X-Bento-Tentativa</code> e <code>X-Bento-Assinatura</code>.</p>
        ${blocoCopiavel("Corpo", JSON.stringify(integracao.exemplo, null, 2))}
        ${blocoCopiavel("Conferir a assinatura (Node.js)", exemploVerificacao())}
      </details>`
    : "";

type RespostaEntregas = Pagina<EntregaIntegracao> & { resumo: Record<StatusEntrega, number> };

const itemEntrega = (entrega: EntregaIntegracao) => html`
  <li class="entrega" data-status="${entrega.status}">
    <div class="entrega-topo">
      <span class="emblema emblema-pequeno" data-status="${STATUS_EMBLEMA_ENTREGA[entrega.status]}">${ROTULOS_ENTREGA[entrega.status]}</span>
      <span class="entrega-evento">${ROTULOS_EVENTO[entrega.evento] ?? entrega.evento}</span>
      <time class="entrega-data" datetime="${entrega.criadoEm}" title="${dataHora(entrega.criadoEm)}">${relativo(entrega.criadoEm)}</time>
    </div>
    <p class="entrega-resumo">${entrega.resumo}</p>
    <p class="entrega-meta">
      ${entrega.codigoHttp ? html`<span>HTTP ${entrega.codigoHttp}</span>` : ""}
      ${entrega.duracaoMs !== null ? html`<span>${numero(entrega.duracaoMs)} ms</span>` : ""}
      <span>${entrega.tentativas} ${entrega.tentativas === 1 ? "tentativa" : "tentativas"}</span>
      ${entrega.status === "pendente" && entrega.proximaTentativa ? html`<span>próxima ${relativo(entrega.proximaTentativa)}</span>` : ""}
    </p>
    ${entrega.erro && entrega.status !== "entregue" ? html`<p class="entrega-erro">${entrega.erro}</p>` : ""}
    ${entrega.teste ? "" : html`<button type="button" class="botao botao-fantasma botao-pequeno entrega-reenviar" data-reenviar="${entrega.id}">${html([icone("repetir")])}Reenviar</button>`}
  </li>
`;

const abrirEntregas = (integracao: Integracao, recarregarCartoes: () => Promise<void>): void => {
  const gaveta = new Gaveta({ titulo: `Entregas · ${integracao.nome}`, subtitulo: "Eventos enviados, com código HTTP, tempo de resposta e tentativas.", largura: "larga" }).abrir();
  let filtro: StatusEntrega | "" = "";
  let pagina = 1;
  const carregar = async (): Promise<void> => {
    try {
      const resposta = await api.obter<RespostaEntregas>(`/integracoes/${integracao.id}/entregas`, { status: filtro, pagina, porPagina: 20 });
      const { resumo } = resposta;
      gaveta.definirCorpo(html`
        <div class="entregas-filtros" role="group" aria-label="Filtrar entregas">
          ${(
            [
              ["", "Todas", resumo.entregue + resumo.pendente + resumo.falhou],
              ["entregue", "Entregues", resumo.entregue],
              ["pendente", "Aguardando", resumo.pendente],
              ["falhou", "Falharam", resumo.falhou],
            ] as const
          ).map(([valor, rotulo, total]) => html`<button type="button" class="botao botao-fantasma botao-pequeno" data-filtro-entrega="${valor}" aria-pressed="${filtro === valor}">${rotulo}<span class="contador">${numero(total)}</span></button>`)}
        </div>
        ${resposta.itens.length
          ? html`<ul class="entregas-lista" role="list">${resposta.itens.map(itemEntrega)}</ul>`
          : html`<div class="vazio vazio-compacto"><span class="vazio-icone">${html([icone("webhook")])}</span><p class="vazio-titulo">Nenhuma entrega${filtro ? " com esse status" : ""}</p><p class="vazio-texto">Os eventos aparecem aqui assim que a integração estiver ligada.</p></div>`}
        ${resposta.paginas > 1
          ? html`<div class="entregas-paginacao">
              <button type="button" class="botao botao-secundario botao-pequeno" data-pagina-entregas="${pagina - 1}" ${pagina <= 1 ? "disabled" : ""}>${html([icone("chevron-esquerda")])}Anteriores</button>
              <span class="texto-suave text-sm">${pagina} de ${resposta.paginas}</span>
              <button type="button" class="botao botao-secundario botao-pequeno" data-pagina-entregas="${pagina + 1}" ${pagina >= resposta.paginas ? "disabled" : ""}>Próximas${html([icone("chevron-direita")])}</button>
            </div>`
          : ""}
        <div class="alerta alerta-info alerta-compacto mt-4">${html([icone("info")])}<span>Falhas são reenviadas sozinhas depois de 1, 5 e 30 minutos. Cada envio leva os cabeçalhos <code>X-Bento-Entrega</code> e <code>X-Bento-Tentativa</code> para o destino ignorar repetições.</span></div>
      `);
    } catch (erro) {
      gaveta.definirCorpo(html`<div class="vazio vazio-erro"><span class="vazio-icone">${html([icone("alerta")])}</span><p class="vazio-titulo">Não foi possível carregar</p><p class="vazio-texto">${mensagemDeErro(erro)}</p></div>`);
    }
  };
  gaveta.corpo.addEventListener("click", async (evento) => {
    const alvo = alvoDoEvento(evento);
    const botaoFiltro = alvo.closest<HTMLElement>("[data-filtro-entrega]");
    if (botaoFiltro) {
      filtro = (botaoFiltro.dataset.filtroEntrega ?? "") as StatusEntrega | "";
      pagina = 1;
      await carregar();
      return;
    }
    const botaoPagina = alvo.closest<HTMLButtonElement>("[data-pagina-entregas]");
    if (botaoPagina && !botaoPagina.disabled) {
      pagina = Math.max(1, Number(botaoPagina.dataset.paginaEntregas));
      await carregar();
      return;
    }
    const botaoReenviar = alvo.closest<HTMLButtonElement>("[data-reenviar]");
    if (botaoReenviar) {
      carregando(botaoReenviar, true);
      try {
        const entrega = await api.criar<EntregaIntegracao>(`/integracoes/${integracao.id}/entregas/${botaoReenviar.dataset.reenviar}/reenviar`);
        avisar({ tipo: entrega.status === "entregue" ? "sucesso" : "erro", titulo: entrega.status === "entregue" ? "Evento reenviado" : "O reenvio falhou", texto: entrega.erro ?? undefined });
        await carregar();
        void recarregarCartoes();
      } catch (erro) {
        carregando(botaoReenviar, false);
        avisar({ tipo: "erro", titulo: "Não foi possível reenviar", texto: mensagemDeErro(erro) });
      }
    }
  });
  gaveta.definirRodape(html`
    <button type="button" class="botao botao-fantasma" data-atualizar-entregas>${html([icone("atualizar")])}Atualizar</button>
    <button type="button" class="botao botao-secundario" data-fechar-entregas>Fechar</button>
  `);
  exigir("[data-atualizar-entregas]", gaveta.rodape).addEventListener("click", () => void carregar());
  exigir("[data-fechar-entregas]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
  void carregar();
};

const abrirIntegracao = (integracao: Integracao, recarregar: () => Promise<void>): void => {
  const gaveta = new Gaveta({ titulo: integracao.nome, subtitulo: integracao.descricao, largura: "larga" }).abrir();
  gaveta.definirCorpo(html`
    <form class="formulario" id="form-integracao" novalidate>
      ${guiaIntegracao(integracao)}
      <div class="linha-interruptor">
        <div class="opcao-texto"><span class="opcao-titulo">Integração ligada</span><span class="opcao-descricao">Desligada, nenhum evento é enviado.</span></div>
        <label class="interruptor"><input type="checkbox" name="ativo" ${integracao.ativo ? "checked" : ""}><span class="interruptor-trilho"></span></label>
      </div>
      ${integracao.campos.map(
        (item) => html`<label class="campo">
          <span class="campo-rotulo ${item.obrigatorio ? "campo-obrigatorio" : ""}">${item.rotulo}</span>
          <input class="entrada ${item.tipo === "segredo" ? "entrada-mono" : ""}" name="${item.nome}" type="${item.tipo === "url" ? "url" : item.tipo === "segredo" ? "password" : "text"}" value="${item.tipo === "segredo" ? "" : item.valor ?? ""}" placeholder="${item.tipo === "segredo" && item.valor ? `${item.valor} (deixe em branco para manter)` : ""}" autocomplete="off" spellcheck="false" data-campo-config>
          ${item.dica ? html`<span class="campo-ajuda">${item.dica}</span>` : ""}
        </label>`,
      )}
      ${integracao.enviaEventos ? eventosIntegracao(integracao) : ""}
      ${exemploWebhook(integracao)}
    </form>
  `);
  gaveta.definirRodape(html`
    <div class="gaveta-rodape-esquerda">${integracao.enviaEventos ? html`<button type="button" class="botao botao-fantasma" data-testar>${html([icone("enviar")])}Salvar e testar</button>` : html`<button type="button" class="botao botao-fantasma" data-testar>${html([icone("verificado")])}Conferir campos</button>`}</div>
    <button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button>
    <button type="submit" form="form-integracao" class="botao botao-primario" data-salvar><i data-icone="salvar"></i>Salvar</button>
  `);
  const formulario = exigir<HTMLFormElement>("#form-integracao");
  exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
  formulario.addEventListener("click", async (evento) => {
    const botao = alvoDoEvento(evento).closest<HTMLButtonElement>("[data-copiar-codigo]");
    if (!botao) return;
    const codigo = botao.closest(".integracao-codigo")?.querySelector("code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(codigo);
      avisoSucesso("Copiado");
    } catch {
      avisar({ tipo: "erro", titulo: "Não foi possível copiar", texto: "Selecione o texto e copie com Ctrl + C." });
    }
  });
  const salvar = async (): Promise<Integracao> => {
    const config: Record<string, string> = {};
    for (const entrada of formulario.querySelectorAll<HTMLInputElement>("[data-campo-config]")) config[entrada.name] = entrada.value.trim();
    const corpo: Record<string, unknown> = { ativo: campo(formulario, "ativo").checked, config };
    if (integracao.enviaEventos) {
      corpo.eventos = [...formulario.querySelectorAll<HTMLInputElement>('input[name="eventos"]:checked')].map((entrada) => entrada.value);
    }
    return api.atualizar<Integracao>(`/integracoes/${integracao.id}`, corpo);
  };
  exigir("[data-testar]", gaveta.rodape).addEventListener("click", async (evento) => {
    const botao = evento.currentTarget as HTMLButtonElement;
    carregando(botao, true);
    limparErros(formulario);
    try {
      await salvar();
      const resultado = await api.criar<{ ok: boolean; mensagem: string }>(`/integracoes/${integracao.id}/testar`);
      avisar({ tipo: resultado.ok ? "sucesso" : "erro", titulo: resultado.ok ? "Tudo certo" : "O teste falhou", texto: resultado.mensagem });
      void recarregar();
    } catch (erro) {
      tratarErroFormulario(formulario, erro, "Não foi possível testar");
    } finally {
      carregando(botao, false);
    }
  });
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const botao = gaveta.rodape.querySelector<HTMLButtonElement>("[data-salvar]");
    carregando(botao, true);
    limparErros(formulario);
    try {
      await salvar();
      gaveta.fechar();
      avisoSucesso("Integração salva", integracao.nome);
      void recarregar();
    } catch (erro) {
      tratarErroFormulario(formulario, erro, "Não foi possível salvar a integração");
    } finally {
      carregando(botao, false);
    }
  });
};

const secaoIntegracoes = async (): Promise<void> => {
  const alvo = exigir("[data-integracoes]");
  let lista: Integracao[] = [];
  const recarregar = async (): Promise<void> => {
    lista = await api.obter<Integracao[]>("/integracoes");
    renderizar(alvo, html`${lista.map(cartaoIntegracao)}`);
  };
  alvo.addEventListener("click", (evento) => {
    const entregas = alvoDoEvento(evento).closest<HTMLElement>("[data-entregas]");
    if (entregas) {
      const integracao = lista.find((item) => item.id === entregas.dataset.entregas);
      if (integracao) abrirEntregas(integracao, recarregar);
      return;
    }
    const botao = alvoDoEvento(evento).closest<HTMLElement>("[data-configurar]");
    if (!botao) return;
    const integracao = lista.find((item) => item.id === botao.dataset.configurar);
    if (integracao) abrirIntegracao(integracao, recarregar);
  });
  await recarregar();
};

const abrirDadosReais = (sistema: Sistema, resumo: ResumoDemonstracao): void => {
  const gaveta = new Gaveta({ titulo: "Começar com os meus dados", subtitulo: "Um passo só: backup, limpeza dos exemplos e a sua conta no lugar da conta de demonstração.", largura: "larga" }).abrir();
  gaveta.definirCorpo(html`
    <form class="formulario" id="form-dados-reais" novalidate>
      <div class="alerta alerta-info alerta-compacto">${html([icone("backup")])}<span>Antes de apagar, o Bento grava um backup completo em <code>dados/backups</code>. Dá para voltar com <code>npm run restaurar</code>.</span></div>
      <dl class="comecar-resumo">
        <div><dt>Contas da equipe</dt><dd>${numero(resumo.equipe)}</dd></div>
        <div><dt>Clientes</dt><dd>${numero(resumo.clientes)}</dd></div>
        <div><dt>Transações</dt><dd>${numero(resumo.transacoes)}</dd></div>
        <div><dt>Relatórios</dt><dd>${numero(resumo.relatorios)}</dd></div>
      </dl>
      <p class="campo-ajuda">Saem também assinaturas, tráfego, notificações, alertas, notas e a auditoria de exemplo. Ficam as integrações, a moeda, o fuso, a meta, as chaves de API e as suas preferências.</p>
      <div class="grade-campos">
        <label class="campo">
          <span class="campo-rotulo campo-obrigatorio">Seu nome</span>
          <input class="entrada" name="nome" required minlength="2" maxlength="120" autocomplete="name">
        </label>
        <label class="campo">
          <span class="campo-rotulo campo-obrigatorio">Seu e-mail</span>
          <input class="entrada" name="email" type="email" required maxlength="254" autocomplete="email">
        </label>
        <label class="campo">
          <span class="campo-rotulo campo-obrigatorio">Senha nova</span>
          <span class="entrada-caixa"><input class="entrada" type="password" name="senha" required minlength="8" maxlength="128" autocomplete="new-password" data-senha-real><button type="button" class="entrada-caixa-acao" data-mostrar-senha aria-label="Mostrar senha">${html([icone("olho")])}</button></span>
          <span class="forca-senha" data-forca-real aria-hidden="true"><span></span><span></span><span></span><span></span></span>
        </label>
        <label class="campo">
          <span class="campo-rotulo">Nome da empresa</span>
          <input class="entrada" name="nomeEmpresa" maxlength="120" value="${sistema.nomeEmpresa.trim().toLowerCase() === "bento" ? "" : sistema.nomeEmpresa}">
        </label>
        <label class="campo campo-inteiro">
          <span class="campo-rotulo campo-obrigatorio">Senha atual, para confirmar</span>
          <span class="entrada-caixa"><input class="entrada" type="password" name="senhaAtual" required autocomplete="current-password" placeholder="bento123 na demonstração"><button type="button" class="entrada-caixa-acao" data-mostrar-senha aria-label="Mostrar senha">${html([icone("olho")])}</button></span>
        </label>
        <label class="opcao campo-inteiro"><input type="checkbox" class="caixa-marcacao" name="entendi" required><span class="opcao-texto"><span class="opcao-titulo">Entendi que os dados de exemplo serão apagados</span><span class="opcao-descricao">As outras contas de demonstração deixam de existir e todas as sessões são encerradas.</span></span></label>
      </div>
    </form>
  `);
  gaveta.definirRodape(html`
    <button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button>
    <button type="submit" form="form-dados-reais" class="botao botao-primario" data-salvar>${html([icone("foguete")])}Apagar exemplos e começar</button>
  `);
  const formulario = exigir<HTMLFormElement>("#form-dados-reais");
  ligarMostrarSenha(formulario);
  ligarForcaSenha(formulario.querySelector("[data-senha-real]"), formulario.querySelector<HTMLElement>("[data-forca-real]"));
  exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = gaveta.rodape.querySelector<HTMLButtonElement>("[data-salvar]");
    carregando(botao, true);
    const dados = lerFormulario(formulario) as Record<string, unknown>;
    delete dados.entendi;
    try {
      const resultado = await api.criar<{ backup: string; email: string }>("/sistema/demonstracao/encerrar", dados);
      location.assign(`/entrar?email=${encodeURIComponent(resultado.email)}&pronto=${encodeURIComponent(resultado.backup)}`);
    } catch (erro) {
      carregando(botao, false);
      tratarErroFormulario(formulario, erro, "Não foi possível concluir");
    }
  });
};

const cartaoDemonstracao = async (sistema: Sistema): Promise<void> => {
  const alvo = $("[data-demonstracao]");
  if (!alvo) return;
  const resumo = await api.obter<ResumoDemonstracao>("/sistema/demonstracao").catch(() => null);
  if (!resumo?.ativa) {
    alvo.hidden = true;
    return;
  }
  renderizar(
    alvo,
    html`<span class="comecar-icone">${html([icone("foguete")])}</span>
      <div class="comecar-texto">
        <h3 class="comecar-titulo">O painel ainda mostra a demonstração</h3>
        <p class="comecar-descricao">${numero(resumo.clientes)} clientes, ${numero(resumo.transacoes)} transações e ${numero(resumo.equipe)} contas da equipe são de exemplo. Quando quiser usar de verdade, o Bento faz um backup, apaga tudo isso e coloca a sua conta no lugar.</p>
      </div>
      <button type="button" class="botao botao-primario" data-comecar>${html([icone("foguete")])}Começar com os meus dados</button>`,
  );
  alvo.hidden = false;
  exigir("[data-comecar]", alvo).addEventListener("click", () => abrirDadosReais(sistema, resumo));
  if (parametrosUrl().comecar !== undefined) {
    atualizarUrl({ comecar: null });
    abrirDadosReais(sistema, resumo);
  }
};

const secaoSistema = async (): Promise<void> => {
  const formulario = exigir<HTMLFormElement>("[data-form-sistema]");
  const sistema = await api.obter<Sistema>("/configuracoes/sistema");
  preencherFormulario(formulario, sistema);
  const campoMoeda = campo<HTMLSelectElement | HTMLInputElement>(formulario, "moeda");
  const atualizarSimbolo = (): void => {
    const simbolo = moeda(0, { moeda: campoMoeda.value }).replace(/[\d\s,.]/g, "");
    exigir("[data-simbolo-moeda]").textContent = simbolo || campoMoeda.value;
  };
  atualizarSimbolo();
  campoMoeda.addEventListener("change", atualizarSimbolo);
  if (!pode("configuracoes.sistema")) {
    for (const elemento of formulario.elements) (elemento as HTMLInputElement).disabled = true;
    exigir("[data-aviso-sistema]").hidden = false;
    return;
  }
  void cartaoDemonstracao(sistema);
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = formulario.querySelector<HTMLButtonElement>("[data-salvar]");
    carregando(botao, true);
    try {
      const salvo = await api.substituir<Sistema>("/configuracoes/sistema", lerFormulario(formulario));
      atualizarSistema(salvo);
      avisoSucesso("Dados da empresa salvos");
    } catch (erro) {
      tratarErroFormulario(formulario, erro, "Não foi possível salvar");
    } finally {
      carregando(botao, false);
    }
  });
};

interface StatusSistema {
  versao: string;
  agora: string;
  fuso: string;
  simulador: boolean;
  node: string;
  plataforma: string;
  processo: { pid: number; tempoNoArSegundos: number; memoriaBytes: number; heapUsadoBytes: number; requisicoes?: number };
  banco: { tipo: "postgresql" | "pglite"; versao: string; latenciaMs: number; tamanhoBytes: number };
  tempoReal: { conexoes: number; canalAtivo: boolean };
  tabelas: Array<{ nome: string; registros: number }>;
  migracoes: Array<{ nome: string; aplicadaEm: string }>;
  manutencao?: EstadoManutencao;
  producao?: boolean;
}

const bytes = (valor: number): string => {
  if (!valor) return "—";
  const unidades = ["B", "KB", "MB", "GB"];
  let indice = 0;
  let atual = valor;
  while (atual >= 1024 && indice < unidades.length - 1) {
    atual /= 1024;
    indice += 1;
  }
  return `${atual.toLocaleString("pt-BR", { maximumFractionDigits: indice ? 1 : 0 })} ${unidades[indice]}`;
};

const duracao = (segundos: number): string => {
  const dias = Math.floor(segundos / 86_400);
  const horas = Math.floor((segundos % 86_400) / 3_600);
  const minutos = Math.floor((segundos % 3_600) / 60);
  if (dias) return `${dias}d ${horas}h`;
  if (horas) return `${horas}h ${minutos}min`;
  return `${minutos}min ${segundos % 60}s`;
};

const NOMES_TABELAS: Record<string, string> = {
  usuarios: "Usuários",
  assinaturas: "Assinaturas",
  transacoes: "Transações",
  notificacoes: "Notificações",
  relatorios: "Relatórios gerados",
  relatorios_agendados: "Relatórios agendados",
  sessoes: "Sessões",
  chaves_api: "Chaves de API",
  notas_usuario: "Notas internas",
  entregas_integracao: "Entregas das integrações",
  auditoria: "Registros de auditoria",
};

let temporizadorStatus: number | undefined;

const secaoStatus = async (): Promise<void> => {
  const alvo = exigir("[data-status-sistema]");
  const desenhar = (status: StatusSistema): void => {
    const celulas: Array<[string, string]> = [
      ["Versão", status.versao],
      ["Banco", status.banco.tipo === "pglite" ? "PGlite" : "PostgreSQL"],
      ["Latência do banco", `${status.banco.latenciaMs.toLocaleString("pt-BR")} ms`],
      ["Tamanho do banco", bytes(status.banco.tamanhoBytes)],
      ["Tempo no ar", duracao(status.processo.tempoNoArSegundos)],
      ["Memória (RSS)", bytes(status.processo.memoriaBytes)],
      ["Tempo real", `${status.tempoReal.conexoes} ${status.tempoReal.conexoes === 1 ? "conexão" : "conexões"}`],
      ["Requisições atendidas", numero(status.processo.requisicoes ?? 0)],
      ["Node.js", status.node],
      ["Modo", status.manutencao?.ativo ? "Manutenção" : status.producao ? "Produção" : "Desenvolvimento"],
      ["Heap usado", bytes(status.processo.heapUsadoBytes)],
    ];
    renderizar(
      alvo,
      html`
        <div class="sistema-grade">
          ${celulas.map(([rotulo, valor]) => html`<div class="sistema-celula"><span class="sistema-rotulo">${rotulo}</span><span class="sistema-valor" title="${valor}">${valor}</span></div>`)}
        </div>
        <div class="grade-campos mt-2 items-start">
          <table class="sistema-tabela">
            <thead><tr><th>Tabela</th><th>Registros</th></tr></thead>
            <tbody>${status.tabelas.map((tabela) => html`<tr><td>${NOMES_TABELAS[tabela.nome] ?? tabela.nome}</td><td>${tabela.registros.toLocaleString("pt-BR")}</td></tr>`)}</tbody>
          </table>
          <table class="sistema-tabela">
            <thead><tr><th>Migração</th><th>Aplicada em</th></tr></thead>
            <tbody>${status.migracoes.map((migracao) => html`<tr><td>${migracao.nome}</td><td>${new Date(migracao.aplicadaEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td></tr>`)}</tbody>
          </table>
        </div>
        <p class="mt-4 font-mono text-[0.625rem] uppercase tracking-[0.08em] text-neutra-500">
          ${status.banco.versao} · ${status.plataforma} · pid ${status.processo.pid} · fuso ${status.fuso} · simulador ${status.simulador ? "ligado" : "desligado"} · canal ${status.tempoReal.canalAtivo ? "ativo" : "local"} · lido às ${new Date(status.agora).toLocaleTimeString("pt-BR")}
        </p>
      `,
    );
  };
  const carregar = async (): Promise<void> => {
    try {
      desenhar(await api.obter<StatusSistema>("/sistema/status"));
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível ler o status", texto: mensagemDeErro(erro) });
    }
  };
  $("[data-atualizar-status]")?.addEventListener("click", () => void carregar());
  await carregar();
  window.clearInterval(temporizadorStatus);
  temporizadorStatus = window.setInterval(() => {
    if (!exigir("#secao-status").hidden && document.visibilityState === "visible") void carregar();
  }, 15_000);
};

type StatusVerificacao = "ok" | "info" | "aviso" | "erro";

interface Verificacao {
  id: string;
  grupo: string;
  titulo: string;
  status: StatusVerificacao;
  detalhe: string;
  dica?: string;
}

interface Diagnostico {
  versao: string;
  geradoEm: string;
  resumo: Record<StatusVerificacao, number>;
  verificacoes: Verificacao[];
}

interface ArquivoBackup {
  nome: string;
  bytes: number;
  criadoEm: string;
}

interface ItemLimpeza {
  categoria: string;
  nome: string;
  dias: number;
  registros: number;
  bytes: number;
}

const CHAVES_RETENCAO: Record<string, keyof RetencaoDias> = {
  notificacoes: "notificacoesDias",
  relatorios: "relatoriosDias",
  auditoria: "auditoriaDias",
  sessoes: "sessoesDias",
  entregas: "entregasDias",
  alertas: "alertasDias",
};

const ROTULOS_VERIFICACAO: Record<StatusVerificacao, string> = { ok: "Tudo certo", info: "Informação", aviso: "Atenção", erro: "Precisa de ajuste" };
const STATUS_EMBLEMA_VERIFICACAO: Record<StatusVerificacao, string> = { ok: "sucesso", info: "info", aviso: "alerta", erro: "erro" };
const ORDEM_VERIFICACAO: Record<StatusVerificacao, number> = { erro: 0, aviso: 1, info: 2, ok: 3 };

const descreverManutencao = (estado: EstadoManutencao): string =>
  estado.ativo ? `Ligada ${estado.desde ? relativo(estado.desde) : ""}${estado.porNome ? ` por ${estado.porNome}` : ""}.` : "Desligada: todos alteram o que o papel permite.";

const secaoManutencao = async (): Promise<void> => {
  const alvoDiagnostico = exigir("[data-diagnostico]");
  const carregarDiagnostico = async (): Promise<void> => {
    try {
      const resultado = await api.obter<Diagnostico>("/sistema/diagnostico");
      const ordenadas = [...resultado.verificacoes].sort((a, b) => ORDEM_VERIFICACAO[a.status] - ORDEM_VERIFICACAO[b.status]);
      const atencao = ordenadas.filter((item) => item.status === "erro" || item.status === "aviso");
      const demais = ordenadas.filter((item) => item.status === "ok" || item.status === "info");
      const lista = (itens: Verificacao[]) => html`<ul class="verificacoes" role="list">
        ${itens.map(
          (item) => html`<li class="verificacao" data-status="${item.status}">
            <span class="verificacao-ponto" aria-hidden="true"></span>
            <div class="verificacao-texto">
              <p class="verificacao-titulo">${item.titulo}<span class="sr-only">: ${ROTULOS_VERIFICACAO[item.status]}</span><span class="verificacao-grupo">${item.grupo}</span></p>
              <p class="verificacao-detalhe">${item.detalhe}</p>
              ${item.dica ? html`<p class="verificacao-dica">${html([icone("chevron-direita")])}${item.dica}</p>` : ""}
            </div>
          </li>`,
        )}
      </ul>`;
      renderizar(
        alvoDiagnostico,
        html`
          <p class="verificacoes-resumo">
            ${(["erro", "aviso", "ok", "info"] as const).map((status) => html`<span class="emblema emblema-pequeno" data-status="${STATUS_EMBLEMA_VERIFICACAO[status]}">${numero(resultado.resumo[status])} ${status === "ok" ? "ok" : status === "info" ? "informativas" : status === "aviso" ? (resultado.resumo.aviso === 1 ? "aviso" : "avisos") : resultado.resumo.erro === 1 ? "erro" : "erros"}</span>`)}
            <span class="texto-suave text-xs">conferido ${relativo(resultado.geradoEm)}</span>
          </p>
          ${atencao.length ? lista(atencao) : html`<div class="alerta alerta-sucesso alerta-compacto">${html([icone("sucesso")])}<span>Nenhum erro ou aviso. O Bento está configurado como esperado.</span></div>`}
          <details class="verificacoes-demais">
            <summary>${atencao.length ? `Ver as outras ${demais.length} verificações` : `Ver as ${demais.length} verificações`}</summary>
            ${lista(demais)}
          </details>
        `,
      );
    } catch (erro) {
      renderizar(alvoDiagnostico, html`<div class="alerta alerta-erro alerta-compacto">${html([icone("alerta")])}<span>${mensagemDeErro(erro)}</span></div>`);
    }
  };

  const formulario = exigir<HTMLFormElement>("[data-form-manutencao]");
  const estadoTexto = exigir("[data-manutencao-estado]", formulario);
  const preencherManutencao = (estado: EstadoManutencao): void => {
    campo(formulario, "ativo").checked = estado.ativo;
    campo(formulario, "mensagem").value = estado.mensagem ?? "";
    estadoTexto.textContent = descreverManutencao(estado);
  };
  preencherManutencao(await api.obter<EstadoManutencao>("/sistema/manutencao"));
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const ativo = campo(formulario, "ativo").checked;
    const mensagem = campo(formulario, "mensagem").value.trim();
    if (ativo) {
      const ok = await confirmar({
        titulo: "Ligar o modo de manutenção?",
        texto: "Quem não configura o sistema passa a só consultar dados até você encerrar. O simulador e os relatórios agendados ficam pausados.",
        tipo: "alerta",
        confirmar: "Ligar manutenção",
      });
      if (!ok) return;
    }
    const botao = formulario.querySelector<HTMLButtonElement>("[data-salvar]");
    carregando(botao, true);
    try {
      const estado = await api.substituir<EstadoManutencao>("/sistema/manutencao", { ativo, mensagem });
      preencherManutencao(estado);
      definirManutencao(estado);
      avisoSucesso(estado.ativo ? "Modo de manutenção ligado" : "Modo de manutenção desligado");
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível aplicar", texto: mensagemDeErro(erro) });
    } finally {
      carregando(botao, false);
    }
  });

  const alvoBackups = exigir("[data-backups]");
  const politica = exigir("[data-backup-politica]");
  const carregarBackups = async (): Promise<void> => {
    try {
      const resposta = await api.obter<{ automatico: string; manter: number; itens: ArquivoBackup[] }>("/sistema/backups");
      politica.innerHTML = String(
        html`${resposta.automatico === "desligado" ? "Backup automático desligado." : `Backup automático ${resposta.automatico === "diario" ? "diário" : "semanal"}, guardando os ${resposta.manter} mais recentes.`} Restaure com <code>npm run restaurar</code>.`,
      );
      renderizar(
        alvoBackups,
        resposta.itens.length
          ? html`<ul class="arquivos-backup" role="list">
              ${resposta.itens.slice(0, 12).map(
                (arquivo) => html`<li class="arquivo-backup">
                  <span class="arquivo-backup-icone">${html([icone("banco-dados")])}</span>
                  <div class="arquivo-backup-texto">
                    <p class="arquivo-backup-nome">${arquivo.nome}</p>
                    <p class="arquivo-backup-meta">${bytes(arquivo.bytes)} · <time datetime="${arquivo.criadoEm}" title="${dataHora(arquivo.criadoEm)}">${relativo(arquivo.criadoEm)}</time>${arquivo.nome.includes("-auto.") ? " · automático" : ""}</p>
                  </div>
                  <button type="button" class="botao botao-fantasma botao-icone botao-pequeno" data-baixar-backup="${arquivo.nome}" aria-label="Baixar ${arquivo.nome}" data-dica-flutuante="Baixar">${html([icone("baixar")])}</button>
                </li>`,
              )}
            </ul>`
          : html`<div class="vazio vazio-compacto"><span class="vazio-icone">${html([icone("backup")])}</span><p class="vazio-titulo">Nenhum backup ainda</p><p class="vazio-texto">Faça o primeiro agora ou ligue o backup automático.</p></div>`,
      );
    } catch (erro) {
      renderizar(alvoBackups, html`<div class="alerta alerta-erro alerta-compacto">${html([icone("alerta")])}<span>${mensagemDeErro(erro)}</span></div>`);
    }
  };
  exigir("[data-fazer-backup]").addEventListener("click", async (evento) => {
    const botao = evento.currentTarget as HTMLButtonElement;
    carregando(botao, true);
    try {
      const resumo = await api.criar<{ nome: string; registros: number; bytes: number }>("/sistema/backups");
      avisoSucesso("Backup gravado", `${resumo.nome} · ${numero(resumo.registros)} registros · ${bytes(resumo.bytes)}`);
      await carregarBackups();
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível fazer o backup", texto: mensagemDeErro(erro) });
    } finally {
      carregando(botao, false);
    }
  });
  alvoBackups.addEventListener("click", async (evento) => {
    const botao = alvoDoEvento(evento).closest<HTMLButtonElement>("[data-baixar-backup]");
    if (!botao) return;
    carregando(botao, true);
    try {
      await api.baixar(`/sistema/backups/${encodeURIComponent(botao.dataset.baixarBackup ?? "")}`, null, botao.dataset.baixarBackup);
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível baixar", texto: mensagemDeErro(erro) });
    } finally {
      carregando(botao, false);
    }
  });

  const alvoRetencao = exigir<HTMLFormElement>("[data-retencao]");
  let estadoAjustes = await api.obter<EstadoAjustes>("/sistema/operacao");
  const alterado = (chave: string): boolean => estadoAjustes.alterados.includes(chave);
  const origem = (chaves: string[], padrao: string) =>
    chaves.some(alterado) ? html`Ajustado no painel · no <code>.env</code>: ${padrao}` : html`Valor do <code>.env</code>`;
  const desenharRetencao = (itens: ItemLimpeza[], removidos = false): void => {
    const minimos: Record<string, number> = { notificacoes: 0, relatorios: 0, auditoria: 0, sessoes: 1, entregas: 1, alertas: 1 };
    renderizar(
      alvoRetencao,
      html`<table class="sistema-tabela retencao-tabela">
        <thead><tr><th>Dado</th><th>Guardar por (dias)</th><th>${removidos ? "Removidos" : "A remover"}</th></tr></thead>
        <tbody>
          ${itens.map(
            (item) => html`<tr>
              <td>${item.nome}${alterado(`retencao.${CHAVES_RETENCAO[item.categoria]}`) ? html` <span class="emblema emblema-pequeno" data-status="info">painel</span>` : ""}</td>
              <td><input class="entrada entrada-pequena retencao-dias" type="number" inputmode="numeric" step="1" min="${minimos[item.categoria] ?? 0}" max="3650" name="${CHAVES_RETENCAO[item.categoria] ?? item.categoria}" value="${item.dias}" aria-label="Dias para ${item.nome}" required>${item.dias === 0 ? html`<span class="texto-suave text-xs"> sem limite</span>` : ""}</td>
              <td>${numero(item.registros)}${item.bytes ? html` <span class="texto-suave">(${bytes(item.bytes)})</span>` : ""}</td>
            </tr>`,
          )}
        </tbody>
      </table>
      <div class="formulario-acoes justify-start">
        <button type="submit" class="botao botao-secundario botao-pequeno" data-salvar>${html([icone("salvar")])}Salvar prazos</button>
        ${estadoAjustes.alterados.length ? html`<button type="button" class="botao botao-fantasma botao-pequeno" data-restaurar-padroes>${html([icone("desfazer")])}Voltar aos valores do .env</button>` : ""}
      </div>`,
    );
  };
  const carregarRetencao = async (): Promise<void> => {
    try {
      desenharRetencao((await api.obter<{ itens: ItemLimpeza[] }>("/sistema/limpeza")).itens);
    } catch (erro) {
      renderizar(alvoRetencao, html`<div class="alerta alerta-erro alerta-compacto">${html([icone("alerta")])}<span>${mensagemDeErro(erro)}</span></div>`);
    }
  };

  const formularioBackup = exigir<HTMLFormElement>("[data-form-backup]");
  const formularioSimulador = exigir<HTMLFormElement>("[data-form-simulador]");
  const DESCRICOES_SIMULADOR: Record<ModoSimulador, string> = {
    auto: "Roda só enquanto o painel usa os dados de demonstração.",
    ligado: "Roda sempre, mesmo com dados reais. Use só para testes.",
    desligado: "Nunca cria dados de exemplo.",
  };
  const preencherAjustes = (): void => {
    const { ajustes, padroes, simulador } = estadoAjustes;
    campo<HTMLSelectElement>(formularioBackup, "backupAutomatico").value = ajustes.backupAutomatico;
    campo(formularioBackup, "backupManter").value = String(ajustes.backupManter);
    const nomesFrequencia: Record<string, string> = { diario: "todo dia", semanal: "toda semana", desligado: "desligado" };
    exigir("[data-origem-backup]", formularioBackup).innerHTML = String(
      origem(["backupAutomatico", "backupManter"], `${nomesFrequencia[padroes.backupAutomatico]}, ${padroes.backupManter} cópias`),
    );
    renderizar(
      formularioSimulador,
      html`<div class="opcoes-simulador" role="radiogroup" aria-label="Modo do simulador">
          ${(["auto", "ligado", "desligado"] as const).map(
            (modo) => html`<label class="opcao"><input type="radio" class="radio" name="simulador" value="${modo}" ${simulador.modo === modo ? "checked" : ""} ${simulador.permitido ? "" : "disabled"}><span class="opcao-texto"><span class="opcao-titulo">${modo === "auto" ? "Automático" : modo === "ligado" ? "Ligado" : "Desligado"}</span><span class="opcao-descricao">${DESCRICOES_SIMULADOR[modo]}</span></span></label>`,
          )}
        </div>
        <p class="campo-ajuda simulador-estado">${simulador.permitido ? html`<span class="emblema emblema-pequeno" data-status="${simulador.ativo ? "sucesso" : "inativo"}">${simulador.ativo ? `Rodando a cada ~${simulador.intervaloSegundos} s` : "Parado"}</span><span>${estadoAjustes.demonstracao ? "O painel usa os dados de demonstração." : "O painel usa dados reais."}</span>` : html`<span>Desligado pelo <code>.env</code> (<code>BENTO_SIMULADOR=false</code>).</span>`}</p>`,
    );
  };
  preencherAjustes();
  const salvarAjustes = async (corpo: Record<string, unknown>, botao: HTMLButtonElement | null, titulo: string): Promise<boolean> => {
    carregando(botao, true);
    try {
      estadoAjustes = await api.substituir<EstadoAjustes>("/sistema/operacao", corpo);
      preencherAjustes();
      avisoSucesso(titulo, "Vale na hora para todas as instâncias.");
      return true;
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível salvar", texto: mensagemDeErro(erro) });
      return false;
    } finally {
      carregando(botao, false);
    }
  };
  formularioSimulador.addEventListener("change", async (evento) => {
    const entrada = evento.target as HTMLInputElement;
    if (entrada.name !== "simulador") return;
    await salvarAjustes({ simulador: entrada.value }, null, "Simulador ajustado");
  });
  formularioBackup.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (!formularioBackup.reportValidity()) return;
    const ok = await salvarAjustes(
      { backupAutomatico: campo<HTMLSelectElement>(formularioBackup, "backupAutomatico").value, backupManter: Number(campo(formularioBackup, "backupManter").value) },
      formularioBackup.querySelector<HTMLButtonElement>("[data-salvar]"),
      "Backups ajustados",
    );
    if (ok) await carregarBackups();
  });
  alvoRetencao.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (!alvoRetencao.reportValidity()) return;
    const retencao: Partial<RetencaoDias> = {};
    for (const entrada of alvoRetencao.querySelectorAll<HTMLInputElement>(".retencao-dias")) retencao[entrada.name as keyof RetencaoDias] = Number(entrada.value);
    if (await salvarAjustes({ retencao }, alvoRetencao.querySelector<HTMLButtonElement>("[data-salvar]"), "Prazos de retenção salvos")) await carregarRetencao();
  });
  alvoRetencao.addEventListener("click", async (evento) => {
    const botao = alvoDoEvento(evento).closest<HTMLButtonElement>("[data-restaurar-padroes]");
    if (!botao) return;
    const ok = await confirmar({ titulo: "Voltar aos valores do .env?", texto: "Simulador, backups e prazos de retenção voltam para o que está no .env.", confirmar: "Voltar" });
    if (!ok) return;
    carregando(botao, true);
    try {
      estadoAjustes = await api.excluir<EstadoAjustes>("/sistema/operacao");
      preencherAjustes();
      avisoSucesso("Valores do .env restaurados");
      await Promise.all([carregarRetencao(), carregarBackups()]);
    } catch (erro) {
      carregando(botao, false);
      avisar({ tipo: "erro", titulo: "Não foi possível restaurar", texto: mensagemDeErro(erro) });
    }
  });
  exigir("[data-limpar]").addEventListener("click", async (evento) => {
    const botao = evento.currentTarget as HTMLButtonElement;
    const ok = await confirmar({
      titulo: "Aplicar a retenção agora?",
      texto: "Os registros mais antigos que os prazos da tabela são apagados de vez. Faça um backup antes se quiser guardá-los.",
      tipo: "perigo",
      confirmar: "Limpar agora",
    });
    if (!ok) return;
    carregando(botao, true);
    try {
      const resultado = await api.criar<{ itens: ItemLimpeza[]; total: number }>("/sistema/limpeza");
      desenharRetencao(resultado.itens, true);
      avisoSucesso(resultado.total ? `${numero(resultado.total)} registros removidos` : "Nada a remover");
      window.setTimeout(() => void carregarRetencao(), 6000);
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível limpar", texto: mensagemDeErro(erro) });
    } finally {
      carregando(botao, false);
    }
  });

  exigir("[data-conferir]").addEventListener("click", async (evento) => {
    const botao = evento.currentTarget as HTMLButtonElement;
    carregando(botao, true);
    await carregarDiagnostico();
    carregando(botao, false);
  });

  const status = await api.obter<StatusSistema & { metricas?: boolean }>("/sistema/status").catch(() => null);
  if (status) {
    exigir("[data-metricas-estado]").textContent = status.metricas
      ? "Métricas no formato do Prometheus, ativas. Envie o token em Authorization: Bearer."
      : "Métricas no formato do Prometheus, desligadas. Defina BENTO_METRICAS_TOKEN para ativar.";
  }
  await Promise.all([carregarDiagnostico(), carregarBackups(), carregarRetencao()]);
};

const SECOES: Record<string, () => Promise<void>> = {
  perfil: secaoPerfil,
  aparencia: secaoAparencia,
  preferencias: secaoPreferencias,
  seguranca: secaoSeguranca,
  chaves: secaoChaves,
  integracoes: secaoIntegracoes,
  sistema: secaoSistema,
  status: secaoStatus,
  manutencao: secaoManutencao,
};

const abrirSecao = async (nome: string): Promise<void> => {
  atualizarUrl({ secao: nome === "perfil" ? null : nome });
  if (carregados.has(nome)) return;
  carregados.add(nome);
  try {
    await SECOES[nome]?.();
    hidratarIcones(exigir(`#secao-${nome}`));
  } catch (erro) {
    carregados.delete(nome);
    avisar({ tipo: "erro", titulo: "Não foi possível carregar a seção", texto: mensagemDeErro(erro) });
  }
};

iniciarPagina({
  pagina: "configuracoes",
  aoIniciar: async () => {
    $$("[data-permissao]").forEach((elemento) => {
      if (!pode(elemento.dataset.permissao)) elemento.remove();
    });
    const inicial = sessao().doisFatores?.pendente ? "seguranca" : parametrosUrl().secao;
    iniciarAbas($("[data-secoes]"), { inicial: inicial && SECOES[inicial] ? inicial : "perfil", aoTrocar: abrirSecao });
  },
});

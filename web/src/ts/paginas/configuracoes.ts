import { iniciarPagina } from "../layout/inicio.ts";
import { html, $, $$, exigir, renderizar, parametrosUrl, atualizarUrl, carregando } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { api, mensagemDeErro, ErroApi } from "../nucleo/api.ts";
import { pode, atualizarUsuarioAtual, atualizarPreferencias, atualizarSistema } from "../nucleo/sessao.ts";
import { aplicarTema, aplicarPaleta, aplicarDensidade, definirBarraRecolhida, preferenciasLocais } from "../nucleo/tema.ts";
import { relativo, corAvatar, moeda } from "../nucleo/formato.ts";
import { Gaveta } from "../componentes/gaveta.ts";
import { iniciarAbas } from "../componentes/abas.ts";
import { confirmar, mostrarSegredo } from "../componentes/modal.ts";
import { avisar, avisoSucesso } from "../componentes/aviso.ts";
import { lerFormulario, mostrarErros, limparErros, ligarForcaSenha, ligarMostrarSenha } from "../componentes/formulario.ts";
import type { Integracao, Preferencias, Sistema, Usuario } from "../nucleo/tipos.ts";

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

const ICONES_PROVEDOR: Record<string, string> = { webhook: "webhook", slack: "hash", discord: "mensagens", "google-analytics": "grafico-combinado", stripe: "cartao" };

const carregados = new Set<string>();

const preencherFormulario = (formulario: HTMLFormElement, dados: object): void => {
  const valores = dados as Record<string, unknown>;
  for (const item of formulario.elements) {
    const elemento = item as CampoFormulario;
    if (!elemento.name || !(elemento.name in valores)) continue;
    const valor = valores[elemento.name];
    if (elemento instanceof HTMLInputElement && elemento.type === "radio") elemento.checked = elemento.value === String(valor);
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
  await carregarSessoes();
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
      <button type="button" class="botao botao-secundario botao-pequeno" data-configurar="${integracao.id}">${html([icone("ajustes")])}Configurar</button>
    </div>
  </article>
`;

const abrirIntegracao = (integracao: Integracao, recarregar: () => Promise<void>): void => {
  const gaveta = new Gaveta({ titulo: integracao.nome, subtitulo: integracao.descricao }).abrir();
  gaveta.definirCorpo(html`
    <form class="formulario" id="form-integracao" novalidate>
      <div class="linha-interruptor">
        <div class="opcao-texto"><span class="opcao-titulo">Integração ligada</span><span class="opcao-descricao">Desligada, nenhum evento é enviado.</span></div>
        <label class="interruptor"><input type="checkbox" name="ativo" ${integracao.ativo ? "checked" : ""}><span class="interruptor-trilho"></span></label>
      </div>
      ${integracao.campos.map(
        (item) => html`<label class="campo">
          <span class="campo-rotulo">${item.rotulo}</span>
          <input class="entrada ${item.tipo === "segredo" ? "entrada-mono" : ""}" name="${item.nome}" type="${item.tipo === "url" ? "url" : item.tipo === "segredo" ? "password" : "text"}" value="${item.tipo === "segredo" ? "" : item.valor ?? ""}" placeholder="${item.tipo === "segredo" && item.valor ? `${item.valor} (deixe em branco para manter)` : ""}" autocomplete="off" data-campo-config>
        </label>`,
      )}
      <div class="alerta alerta-info alerta-compacto">${html([icone("info")])}<span>Eventos enviados: transação paga, usuário criado, usuário bloqueado e relatório gerado.</span></div>
    </form>
  `);
  gaveta.definirRodape(html`
    <div class="gaveta-rodape-esquerda"><button type="button" class="botao botao-fantasma" data-testar>${html([icone("enviar")])}Testar</button></div>
    <button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button>
    <button type="submit" form="form-integracao" class="botao botao-primario" data-salvar><i data-icone="salvar"></i>Salvar</button>
  `);
  const formulario = exigir<HTMLFormElement>("#form-integracao");
  exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
  const salvar = async (): Promise<Integracao> => {
    const config: Record<string, string> = {};
    for (const entrada of formulario.querySelectorAll<HTMLInputElement>("[data-campo-config]")) config[entrada.name] = entrada.value.trim();
    return api.atualizar<Integracao>(`/integracoes/${integracao.id}`, { ativo: campo(formulario, "ativo").checked, config });
  };
  exigir("[data-testar]", gaveta.rodape).addEventListener("click", async (evento) => {
    const botao = evento.currentTarget as HTMLButtonElement;
    carregando(botao, true);
    try {
      await salvar();
      const resultado = await api.criar<{ ok: boolean; mensagem: string }>(`/integracoes/${integracao.id}/testar`);
      avisar({ tipo: resultado.ok ? "sucesso" : "erro", titulo: resultado.ok ? "Teste enviado" : "O teste falhou", texto: resultado.mensagem });
      recarregar();
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível testar", texto: mensagemDeErro(erro) });
    } finally {
      carregando(botao, false);
    }
  });
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const botao = gaveta.rodape.querySelector<HTMLButtonElement>("[data-salvar]");
    carregando(botao, true);
    try {
      await salvar();
      gaveta.fechar();
      avisoSucesso("Integração salva", integracao.nome);
      recarregar();
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
    const botao = alvoDoEvento(evento).closest<HTMLElement>("[data-configurar]");
    if (!botao) return;
    const integracao = lista.find((item) => item.id === botao.dataset.configurar);
    if (integracao) abrirIntegracao(integracao, recarregar);
  });
  await recarregar();
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
  processo: { pid: number; tempoNoArSegundos: number; memoriaBytes: number; heapUsadoBytes: number };
  banco: { tipo: "postgresql" | "pglite"; versao: string; latenciaMs: number; tamanhoBytes: number };
  tempoReal: { conexoes: number; canalAtivo: boolean };
  tabelas: Array<{ nome: string; registros: number }>;
  migracoes: Array<{ nome: string; aplicadaEm: string }>;
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
      ["Node.js", status.node],
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

const SECOES: Record<string, () => Promise<void>> = { perfil: secaoPerfil, aparencia: secaoAparencia, seguranca: secaoSeguranca, chaves: secaoChaves, integracoes: secaoIntegracoes, sistema: secaoSistema, status: secaoStatus };

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
    const inicial = parametrosUrl().secao;
    iniciarAbas($("[data-secoes]"), { inicial: inicial && SECOES[inicial] ? inicial : "perfil", aoTrocar: abrirSecao });
  },
});

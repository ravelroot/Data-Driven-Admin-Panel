import { iniciarPagina } from "../layout/inicio.js";
import { html, $, $$, renderizar, parametrosUrl, atualizarUrl, carregando } from "../nucleo/dom.js";
import { icone, hidratarIcones } from "../nucleo/icones.js";
import { api, mensagemDeErro, ErroApi } from "../nucleo/api.js";
import { pode, atualizarUsuarioAtual, atualizarPreferencias, atualizarSistema } from "../nucleo/sessao.js";
import { aplicarTema, aplicarPaleta, aplicarDensidade, definirBarraRecolhida, preferenciasLocais } from "../nucleo/tema.js";
import { relativo, corAvatar, moeda } from "../nucleo/formato.js";
import { Gaveta } from "../componentes/gaveta.js";
import { iniciarAbas } from "../componentes/abas.js";
import { confirmar, mostrarSegredo } from "../componentes/modal.js";
import { avisar, avisoSucesso } from "../componentes/aviso.js";
import { lerFormulario, mostrarErros, limparErros, ligarForcaSenha, ligarMostrarSenha } from "../componentes/formulario.js";

const ICONES_PROVEDOR = { webhook: "webhook", slack: "hash", discord: "mensagens", "google-analytics": "grafico-combinado", stripe: "cartao" };

const carregados = new Set();

const preencherFormulario = (formulario, dados) => {
  for (const elemento of formulario.elements) {
    if (!elemento.name || !(elemento.name in dados)) continue;
    const valor = dados[elemento.name];
    if (elemento.type === "radio") elemento.checked = elemento.value === String(valor);
    else if (elemento.type === "checkbox") elemento.checked = Boolean(valor);
    else if (elemento.dataset.moeda !== undefined) elemento.value = valor === null || valor === undefined ? "" : (valor / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    else elemento.value = valor ?? "";
  }
};

const tratarErroFormulario = (formulario, erro, titulo) => {
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

const secaoPerfil = async () => {
  const formulario = $("[data-form-perfil]");
  const perfil = await api.obter("/configuracoes/perfil");
  preencherFormulario(formulario, perfil);
  renderizar(
    $("[data-perfil-foto]"),
    html`<span class="avatar avatar-gigante" data-cor="${corAvatar(perfil.email)}" aria-hidden="true">${perfil.iniciais}</span>
      <div class="pilha-pequena"><p class="font-semibold">${perfil.papel?.nome}</p><p class="text-xs texto-suave">Conta criada ${relativo(perfil.criadoEm)}. O avatar usa suas iniciais.</p></div>`,
  );
  const emailOriginal = perfil.email;
  const campoSenha = $("[data-campo-senha-atual]");
  formulario.elements.email.addEventListener("input", () => {
    const mudou = formulario.elements.email.value.trim().toLowerCase() !== emailOriginal.toLowerCase();
    campoSenha.hidden = !mudou;
    formulario.elements.senhaAtual.required = mudou;
  });
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = formulario.querySelector("[data-salvar]");
    carregando(botao, true);
    try {
      const dados = lerFormulario(formulario);
      if (dados.email.toLowerCase() === emailOriginal.toLowerCase()) {
        delete dados.email;
        delete dados.senhaAtual;
      }
      const atualizado = await api.atualizar("/configuracoes/perfil", dados);
      atualizarUsuarioAtual(atualizado);
      formulario.elements.senhaAtual.value = "";
      campoSenha.hidden = true;
      avisoSucesso("Perfil salvo");
    } catch (erro) {
      tratarErroFormulario(formulario, erro, "Não foi possível salvar o perfil");
    } finally {
      carregando(botao, false);
    }
  });
};

const secaoAparencia = async () => {
  const formulario = $("[data-form-aparencia]");
  const locais = preferenciasLocais();
  preencherFormulario(formulario, locais);
  const salvarNoServidor = (() => {
    let temporizador;
    return (preferencias) => {
      clearTimeout(temporizador);
      temporizador = setTimeout(async () => {
        try {
          const salvas = await api.substituir("/configuracoes/aparencia", preferencias);
          atualizarPreferencias(salvas);
        } catch (erro) {
          avisar({ tipo: "erro", titulo: "Aparência salva só neste navegador", texto: mensagemDeErro(erro) });
        }
      }, 400);
    };
  })();
  formulario.addEventListener("change", (evento) => {
    const { name } = evento.target;
    const dados = lerFormulario(formulario);
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

const navegadorDe = (sessao) => [sessao.navegador, sessao.sistema].filter(Boolean).join(" no ") || "Navegador desconhecido";

const carregarSessoes = async () => {
  const alvo = $("[data-sessoes]");
  try {
    const sessoes = await api.obter("/configuracoes/seguranca/sessoes");
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
    $('[data-acao="encerrar-outras"]').hidden = sessoes.filter((sessao) => !sessao.atual).length === 0;
  } catch (erro) {
    renderizar(alvo, html`<p class="text-sm texto-suave">${mensagemDeErro(erro)}</p>`);
  }
};

const secaoSeguranca = async () => {
  const formulario = $("[data-form-senha]");
  ligarForcaSenha($("[data-nova-senha]"), $("[data-forca]"));
  ligarMostrarSenha(formulario);
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = formulario.querySelector("[data-salvar]");
    carregando(botao, true);
    try {
      await api.criar("/configuracoes/seguranca/senha", lerFormulario(formulario));
      formulario.reset();
      $("[data-forca]").dataset.nivel = "0";
      avisoSucesso("Senha trocada", "As outras sessões foram encerradas.");
      carregarSessoes();
    } catch (erro) {
      tratarErroFormulario(formulario, erro, "Não foi possível trocar a senha");
    } finally {
      carregando(botao, false);
    }
  });
  $("[data-sessoes]").addEventListener("click", async (evento) => {
    const botao = evento.target.closest("[data-revogar]");
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
  $('[data-acao="encerrar-outras"]').addEventListener("click", async (evento) => {
    const ok = await confirmar({ titulo: "Encerrar as outras sessões?", texto: "Você continua conectado aqui. Nos outros dispositivos será preciso entrar de novo.", tipo: "alerta", confirmar: "Encerrar sessões" });
    if (!ok) return;
    carregando(evento.currentTarget, true);
    try {
      const { revogadas } = await api.excluir("/configuracoes/seguranca/sessoes");
      avisoSucesso("Sessões encerradas", `${revogadas} ${revogadas === 1 ? "sessão encerrada" : "sessões encerradas"}.`);
      carregarSessoes();
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível encerrar", texto: mensagemDeErro(erro) });
    } finally {
      carregando($('[data-acao="encerrar-outras"]'), false);
    }
  });
  await carregarSessoes();
};

const carregarChaves = async () => {
  const alvo = $("[data-chaves]");
  try {
    const chaves = await api.obter("/configuracoes/chaves-api");
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

const secaoChaves = async () => {
  $('[data-acao="nova-chave"]').addEventListener("click", () => {
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
    gaveta.rodape.querySelector("[data-cancelar]").addEventListener("click", () => gaveta.fechar());
    const formulario = $("#form-chave");
    formulario.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      if (!formulario.reportValidity()) return;
      const botao = gaveta.rodape.querySelector("[data-criar]");
      carregando(botao, true);
      try {
        const { nome, acesso } = lerFormulario(formulario);
        const { segredo } = await api.criar("/configuracoes/chaves-api", { nome, escopos: acesso === "escrita" ? ["leitura", "escrita"] : ["leitura"] });
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
  $("[data-chaves]").addEventListener("click", async (evento) => {
    const botao = evento.target.closest("[data-revogar-chave]");
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

const cartaoIntegracao = (integracao) => html`
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

const abrirIntegracao = (integracao, recarregar) => {
  const gaveta = new Gaveta({ titulo: integracao.nome, subtitulo: integracao.descricao }).abrir();
  gaveta.definirCorpo(html`
    <form class="formulario" id="form-integracao" novalidate>
      <div class="linha-interruptor">
        <div class="opcao-texto"><span class="opcao-titulo">Integração ligada</span><span class="opcao-descricao">Desligada, nenhum evento é enviado.</span></div>
        <label class="interruptor"><input type="checkbox" name="ativo" ${integracao.ativo ? "checked" : ""}><span class="interruptor-trilho"></span></label>
      </div>
      ${integracao.campos.map(
        (campo) => html`<label class="campo">
          <span class="campo-rotulo">${campo.rotulo}</span>
          <input class="entrada ${campo.tipo === "segredo" ? "entrada-mono" : ""}" name="${campo.nome}" type="${campo.tipo === "url" ? "url" : campo.tipo === "segredo" ? "password" : "text"}" value="${campo.tipo === "segredo" ? "" : campo.valor ?? ""}" placeholder="${campo.tipo === "segredo" && campo.valor ? `${campo.valor} (deixe em branco para manter)` : ""}" autocomplete="off" data-campo-config>
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
  const formulario = $("#form-integracao");
  gaveta.rodape.querySelector("[data-cancelar]").addEventListener("click", () => gaveta.fechar());
  const salvar = async () => {
    const config = {};
    for (const entrada of formulario.querySelectorAll("[data-campo-config]")) config[entrada.name] = entrada.value.trim();
    return api.atualizar(`/integracoes/${integracao.id}`, { ativo: formulario.elements.ativo.checked, config });
  };
  gaveta.rodape.querySelector("[data-testar]").addEventListener("click", async (evento) => {
    const botao = evento.currentTarget;
    carregando(botao, true);
    try {
      await salvar();
      const resultado = await api.criar(`/integracoes/${integracao.id}/testar`);
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
    const botao = gaveta.rodape.querySelector("[data-salvar]");
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

const secaoIntegracoes = async () => {
  const alvo = $("[data-integracoes]");
  let lista = [];
  const recarregar = async () => {
    lista = await api.obter("/integracoes");
    renderizar(alvo, html`${lista.map(cartaoIntegracao)}`);
  };
  alvo.addEventListener("click", (evento) => {
    const botao = evento.target.closest("[data-configurar]");
    if (!botao) return;
    const integracao = lista.find((item) => item.id === botao.dataset.configurar);
    if (integracao) abrirIntegracao(integracao, recarregar);
  });
  await recarregar();
};

const secaoSistema = async () => {
  const formulario = $("[data-form-sistema]");
  const sistema = await api.obter("/configuracoes/sistema");
  preencherFormulario(formulario, sistema);
  const atualizarSimbolo = () => {
    const simbolo = moeda(0, { moeda: formulario.elements.moeda.value }).replace(/[\d\s,.]/g, "");
    $("[data-simbolo-moeda]").textContent = simbolo || formulario.elements.moeda.value;
  };
  atualizarSimbolo();
  formulario.elements.moeda.addEventListener("change", atualizarSimbolo);
  if (!pode("configuracoes.sistema")) {
    for (const elemento of formulario.elements) elemento.disabled = true;
    $("[data-aviso-sistema]").hidden = false;
    return;
  }
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = formulario.querySelector("[data-salvar]");
    carregando(botao, true);
    try {
      const salvo = await api.substituir("/configuracoes/sistema", lerFormulario(formulario));
      atualizarSistema(salvo);
      avisoSucesso("Dados da empresa salvos");
    } catch (erro) {
      tratarErroFormulario(formulario, erro, "Não foi possível salvar");
    } finally {
      carregando(botao, false);
    }
  });
};

const SECOES = { perfil: secaoPerfil, aparencia: secaoAparencia, seguranca: secaoSeguranca, chaves: secaoChaves, integracoes: secaoIntegracoes, sistema: secaoSistema };

const abrirSecao = async (nome) => {
  atualizarUrl({ secao: nome === "perfil" ? null : nome });
  if (carregados.has(nome)) return;
  carregados.add(nome);
  try {
    await SECOES[nome]?.();
    hidratarIcones($(`#secao-${nome}`));
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
    iniciarAbas($("[data-secoes]"), { inicial: SECOES[inicial] ? inicial : "perfil", aoTrocar: abrirSecao });
  },
});

import { iniciarPagina } from "../layout/inicio.js";
import { html, $, $$, renderizar, parametrosUrl, atualizarUrl, carregando } from "../nucleo/dom.js";
import { icone, hidratarIcones } from "../nucleo/icones.js";
import { api, mensagemDeErro, ErroApi } from "../nucleo/api.js";
import { pode, usuarioAtual } from "../nucleo/sessao.js";
import { ouvir } from "../nucleo/eventos.js";
import { moeda, numero, relativo, dataCurta, dataHora, rotulos, corAvatar, plural } from "../nucleo/formato.js";
import { TabelaDados, botaoAcoesLinha } from "../componentes/tabela.js";
import { Gaveta } from "../componentes/gaveta.js";
import { iniciarAbas } from "../componentes/abas.js";
import { confirmar, mostrarSegredo } from "../componentes/modal.js";
import { avisar, avisoSucesso } from "../componentes/aviso.js";
import { lerFormulario, mostrarErros, limparErros, semVazios } from "../componentes/formulario.js";
import { emblemaStatusTransacao } from "../componentes/transacao.js";

const PAISES = ["Brasil", "Portugal", "Argentina", "Chile", "Colômbia", "México", "Uruguai", "Estados Unidos", "Espanha", "Angola", "Moçambique", "Outro"];

const estado = {
  tabela: null,
  papeis: [],
  permissoes: [],
  filtroStatus: "",
};

const avatarUsuario = (usuario, classe = "avatar-pequeno") =>
  html`<span class="avatar ${classe}" data-cor="${corAvatar(usuario.email ?? usuario.nome)}" aria-hidden="true">${usuario.iniciais}<span class="avatar-status" data-status="${usuario.status}"></span></span>`;

const emblemaStatus = (status) => html`<span class="emblema" data-status="${status}">${rotulos.status[status] ?? status}</span>`;

const emblemaPapel = (papel) => html`<span class="emblema" data-papel="${papel?.codigo}">${papel?.nome ?? "—"}</span>`;

const COLUNAS = [
  {
    campo: "nome",
    titulo: "Usuário",
    ordenavel: true,
    render: (usuario) => html`<div class="celula-usuario">${avatarUsuario(usuario)}<div class="celula-usuario-texto"><span class="celula-usuario-nome">${usuario.nome}</span><span class="celula-usuario-email">${usuario.email}</span></div></div>`,
  },
  { campo: "papel", titulo: "Papel", ordenavel: true, render: (usuario) => emblemaPapel(usuario.papel) },
  { campo: "plano", titulo: "Plano", render: (usuario) => (usuario.plano ? usuario.plano.nome : html`<span class="texto-fraco">Sem plano</span>`) },
  { campo: "status", titulo: "Status", ordenavel: true, render: (usuario) => emblemaStatus(usuario.status) },
  {
    campo: "ultimoAcesso",
    titulo: "Último acesso",
    ordenavel: true,
    direcaoInicial: "desc",
    classe: "celula-data",
    render: (usuario) => html`<time datetime="${usuario.ultimoAcesso ?? ""}" title="${usuario.ultimoAcesso ? dataHora(usuario.ultimoAcesso) : "Nunca acessou"}">${usuario.ultimoAcesso ? relativo(usuario.ultimoAcesso) : "Nunca"}</time>`,
  },
  { campo: "criadoEm", titulo: "Criado em", ordenavel: true, direcaoInicial: "desc", classe: "celula-data", render: (usuario) => dataCurta(usuario.criadoEm) },
  { campo: "acoes", titulo: "Ações", oculto: true, classe: "celula-acoes", render: (usuario) => botaoAcoesLinha(usuario.id, `Ações para ${usuario.nome}`) },
];

const ehEuMesmo = (usuario) => usuario.id === usuarioAtual()?.id;

const acoesDoUsuario = (usuario) => [
  { rotulo: "Ver detalhes", icone: "olho", executar: () => abrirDetalhes(usuario.id) },
  pode("usuarios.editar") && { rotulo: "Editar", icone: "editar", executar: () => abrirDetalhes(usuario.id, "editar") },
  pode("usuarios.ver") && { rotulo: "Permissões", icone: "escudo", executar: () => abrirDetalhes(usuario.id, "permissoes") },
  pode("usuarios.editar") && { rotulo: "Redefinir senha", icone: "chave", executar: () => redefinirSenha(usuario) },
  pode("usuarios.bloquear") && "separador",
  pode("usuarios.bloquear") &&
    (usuario.status === "bloqueado"
      ? { rotulo: "Desbloquear conta", icone: "cadeado-aberto", executar: () => desbloquear(usuario) }
      : { rotulo: "Bloquear conta", icone: "cadeado", perigo: true, desativado: ehEuMesmo(usuario), executar: () => bloquear(usuario) }),
  pode("usuarios.excluir") && { rotulo: "Excluir", icone: "lixeira", perigo: true, desativado: ehEuMesmo(usuario), executar: () => excluir(usuario) },
];

const atualizarContagens = (contagens = {}) => {
  for (const [chave, valor] of Object.entries(contagens)) {
    const alvo = $(`[data-contagem="${chave}"]`);
    if (alvo) alvo.textContent = numero(valor, { compacto: valor >= 10000 });
  }
};

const recarregar = () => estado.tabela.recarregar({ silencioso: true });

const bloquear = async (usuario) => {
  const motivo = await confirmar({
    titulo: `Bloquear ${usuario.nome}?`,
    texto: "A pessoa sai de todas as sessões e não consegue entrar até alguém desbloquear a conta.",
    tipo: "perigo",
    confirmar: "Bloquear conta",
    campo: { rotulo: "Motivo do bloqueio", obrigatorio: true, placeholder: "Ex.: pagamento contestado, acesso suspeito" },
  });
  if (!motivo) return false;
  try {
    await api.criar(`/usuarios/${usuario.id}/bloquear`, { motivo: String(motivo) });
    avisoSucesso("Conta bloqueada", `${usuario.nome} não consegue mais entrar.`);
    recarregar();
    return true;
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível bloquear", texto: mensagemDeErro(erro) });
    return false;
  }
};

const desbloquear = async (usuario) => {
  try {
    await api.criar(`/usuarios/${usuario.id}/desbloquear`);
    avisoSucesso("Conta desbloqueada", `${usuario.nome} já pode entrar de novo.`);
    recarregar();
    return true;
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível desbloquear", texto: mensagemDeErro(erro) });
    return false;
  }
};

const excluir = async (usuario) => {
  const ok = await confirmar({
    titulo: `Excluir ${usuario.nome}?`,
    texto: "A conta, as sessões e as permissões individuais são apagadas. As transações continuam no histórico, sem o vínculo com a pessoa. Não dá para desfazer.",
    tipo: "perigo",
    confirmar: "Excluir usuário",
  });
  if (!ok) return false;
  try {
    await api.excluir(`/usuarios/${usuario.id}`);
    avisoSucesso("Usuário excluído", usuario.email);
    recarregar();
    return true;
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível excluir", texto: mensagemDeErro(erro) });
    return false;
  }
};

const redefinirSenha = async (usuario) => {
  const ok = await confirmar({
    titulo: `Gerar senha temporária para ${usuario.nome}?`,
    texto: "A senha atual deixa de funcionar e as sessões abertas são encerradas. Envie a nova senha para a pessoa por um canal seguro.",
    tipo: "alerta",
    confirmar: "Gerar senha",
  });
  if (!ok) return;
  try {
    const { senhaTemporaria } = await api.criar(`/usuarios/${usuario.id}/redefinir-senha`);
    await mostrarSegredo({ titulo: "Senha temporária gerada", texto: "Ela aparece só desta vez. Copie e envie para a pessoa.", segredo: senhaTemporaria });
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível gerar a senha", texto: mensagemDeErro(erro) });
  }
};

const opcoesPapel = (selecionado) => html`${estado.papeis.map((papel) => html`<option value="${papel.codigo}" ${papel.codigo === selecionado ? "selected" : ""}>${papel.nome}</option>`)}`;

const opcoesPais = (selecionado) => html`<option value="">Selecione</option>${PAISES.map((pais) => html`<option ${pais === selecionado ? "selected" : ""}>${pais}</option>`)}`;

const camposUsuario = (usuario = {}, { novo = false } = {}) => html`
  <div class="grade-campos">
    <label class="campo campo-inteiro">
      <span class="campo-rotulo campo-obrigatorio">Nome completo</span>
      <input class="entrada" name="nome" required minlength="2" maxlength="120" value="${usuario.nome ?? ""}" autocomplete="off">
    </label>
    <label class="campo campo-inteiro">
      <span class="campo-rotulo campo-obrigatorio">E-mail</span>
      <input class="entrada" type="email" name="email" required maxlength="160" value="${usuario.email ?? ""}" autocomplete="off">
    </label>
    <label class="campo">
      <span class="campo-rotulo ${novo ? "campo-obrigatorio" : ""}">Papel</span>
      <select class="selecao" name="papel" ${!novo && !pode("usuarios.permissoes") ? "disabled" : ""}>${opcoesPapel(usuario.papel?.codigo ?? "cliente")}</select>
      ${!novo && !pode("usuarios.permissoes") ? html`<span class="campo-ajuda">Só quem gerencia permissões troca o papel.</span>` : ""}
    </label>
    <label class="campo">
      <span class="campo-rotulo">Status</span>
      <select class="selecao" name="status" ${usuario.status === "bloqueado" ? "disabled" : ""}>
        <option value="ativo" ${usuario.status === "ativo" || !usuario.status ? "selected" : ""}>Ativo</option>
        <option value="pendente" ${usuario.status === "pendente" ? "selected" : ""}>Pendente</option>
        ${novo ? "" : html`<option value="inativo" ${usuario.status === "inativo" ? "selected" : ""}>Inativo</option>`}
        ${usuario.status === "bloqueado" ? html`<option value="bloqueado" selected>Bloqueado</option>` : ""}
      </select>
      ${usuario.status === "bloqueado" ? html`<span class="campo-ajuda">Desbloqueie a conta para mudar o status.</span>` : ""}
    </label>
    <label class="campo">
      <span class="campo-rotulo">Cargo</span>
      <input class="entrada" name="cargo" maxlength="80" value="${usuario.cargo ?? ""}">
    </label>
    <label class="campo">
      <span class="campo-rotulo">Empresa</span>
      <input class="entrada" name="empresa" maxlength="120" value="${usuario.empresa ?? ""}">
    </label>
    <label class="campo">
      <span class="campo-rotulo">Telefone</span>
      <input class="entrada" type="tel" name="telefone" maxlength="30" value="${usuario.telefone ?? ""}" placeholder="(00) 00000-0000">
    </label>
    <label class="campo">
      <span class="campo-rotulo">País</span>
      <select class="selecao" name="pais">${opcoesPais(usuario.pais)}</select>
    </label>
    <label class="campo campo-inteiro">
      <span class="campo-rotulo">Cidade</span>
      <input class="entrada" name="cidade" maxlength="80" value="${usuario.cidade ?? ""}">
    </label>
    ${novo
      ? html`<label class="campo campo-inteiro">
          <span class="campo-rotulo">Senha inicial <span class="campo-rotulo-extra">opcional</span></span>
          <span class="entrada-caixa">
            <input class="entrada" type="password" name="senha" minlength="8" maxlength="128" autocomplete="new-password">
            <button type="button" class="entrada-caixa-acao" data-mostrar-senha aria-label="Mostrar senha">${html([icone("olho")])}</button>
          </span>
          <span class="campo-ajuda">Deixe em branco para gerar uma senha temporária de 12 caracteres.</span>
        </label>`
      : ""}
  </div>
`;

const abrirNovo = () => {
  const gaveta = new Gaveta({ titulo: "Novo usuário", subtitulo: "A conta fica disponível assim que você salvar." }).abrir();
  gaveta.definirCorpo(html`<form class="formulario" id="form-novo-usuario" novalidate>${camposUsuario({}, { novo: true })}</form>`);
  gaveta.definirRodape(html`
    <button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button>
    <button type="submit" form="form-novo-usuario" class="botao botao-primario" data-salvar><i data-icone="usuario-novo"></i>Cadastrar usuário</button>
  `);
  const formulario = $("#form-novo-usuario");
  ligarMostrarSenha(formulario);
  gaveta.rodape.querySelector("[data-cancelar]").addEventListener("click", () => gaveta.fechar());
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = gaveta.rodape.querySelector("[data-salvar]");
    carregando(botao, true);
    try {
      const dados = semVazios(lerFormulario(formulario));
      const resposta = await api.criar("/usuarios", dados);
      gaveta.fechar();
      avisoSucesso("Usuário cadastrado", `${resposta.usuario.nome} já aparece na lista.`);
      estado.tabela.recarregar();
      if (resposta.senhaTemporaria) {
        await mostrarSegredo({ titulo: "Senha temporária", texto: `Envie esta senha para ${resposta.usuario.nome}. Ela aparece só desta vez.`, segredo: resposta.senhaTemporaria });
      }
    } catch (erro) {
      if (erro instanceof ErroApi && erro.codigo === "VALIDACAO" && mostrarErros(formulario, erro.detalhes)) return;
      if (erro instanceof ErroApi && erro.codigo === "CONFLITO") {
        mostrarErros(formulario, { email: erro.message });
        return;
      }
      avisar({ tipo: "erro", titulo: "Não foi possível cadastrar", texto: mensagemDeErro(erro) });
    } finally {
      carregando(botao, false);
    }
  });
  formulario.elements.nome.focus();
};

const ligarMostrarSenha = (raiz) => {
  for (const botao of raiz.querySelectorAll("[data-mostrar-senha]")) {
    botao.addEventListener("click", () => {
      const entrada = botao.parentElement.querySelector("input");
      const visivel = entrada.type === "text";
      entrada.type = visivel ? "password" : "text";
      botao.innerHTML = icone(visivel ? "olho" : "olho-fechado");
      botao.setAttribute("aria-label", visivel ? "Mostrar senha" : "Ocultar senha");
    });
  }
};

const painelResumo = (detalhe) => {
  const { usuario, assinatura, transacoes, atividades, sessoesAtivas } = detalhe;
  return html`
    <div class="perfil-cabecalho">
      ${avatarUsuario(usuario, "avatar-gigante")}
      <div class="perfil-textos">
        <p class="perfil-nome">${usuario.nome}</p>
        <p class="perfil-email">${usuario.email}</p>
        <div class="perfil-emblemas">${emblemaPapel(usuario.papel)}${emblemaStatus(usuario.status)}</div>
      </div>
    </div>
    ${usuario.status === "bloqueado"
      ? html`<div class="alerta alerta-erro mt-5">${html([icone("cadeado")])}<div class="alerta-textos"><p class="alerta-titulo">Conta bloqueada ${usuario.bloqueadoEm ? relativo(usuario.bloqueadoEm) : ""}</p><p class="alerta-texto">${usuario.motivoBloqueio || "Sem motivo informado."}</p></div></div>`
      : ""}
    <dl class="perfil-resumo">
      <div><dt>Criado em</dt><dd>${dataCurta(usuario.criadoEm)}</dd></div>
      <div><dt>Último acesso</dt><dd>${usuario.ultimoAcesso ? relativo(usuario.ultimoAcesso) : "Nunca"}</dd></div>
      <div><dt>Sessões ativas</dt><dd>${numero(sessoesAtivas ?? 0)}</dd></div>
    </dl>
    <section class="gaveta-secao mt-5">
      <h3 class="gaveta-secao-titulo">Dados</h3>
      <dl class="lista-definicao">
        <dt>Cargo</dt><dd>${usuario.cargo || "—"}</dd>
        <dt>Empresa</dt><dd>${usuario.empresa || "—"}</dd>
        <dt>Telefone</dt><dd>${usuario.telefone || "—"}</dd>
        <dt>Local</dt><dd>${[usuario.cidade, usuario.pais].filter(Boolean).join(", ") || "—"}</dd>
        <dt>Atualizado</dt><dd>${dataHora(usuario.atualizadoEm)}</dd>
      </dl>
    </section>
    <section class="gaveta-secao">
      <h3 class="gaveta-secao-titulo">Assinatura</h3>
      ${assinatura
        ? html`<div class="assinatura-resumo">
            <span class="assinatura-resumo-icone">${html([icone("repetir")])}</span>
            <div class="assinatura-resumo-textos">
              <span class="assinatura-resumo-plano">${assinatura.plano?.nome ?? "Plano"}</span>
              <span class="assinatura-resumo-detalhe">${rotulos.ciclo[assinatura.ciclo] ?? assinatura.ciclo}, desde ${dataCurta(assinatura.iniciadaEm)}${assinatura.renovacaoEm ? `, renova em ${dataCurta(assinatura.renovacaoEm)}` : ""}</span>
              <span class="mt-1"><span class="emblema emblema-pequeno" data-status="${assinatura.status}">${rotulos.assinatura[assinatura.status] ?? assinatura.status}</span></span>
            </div>
            <span class="assinatura-resumo-valor">${moeda(assinatura.valor)}<small>${assinatura.ciclo === "anual" ? "por ano" : "por mês"}</small></span>
          </div>`
        : html`<p class="text-sm texto-suave">Esta conta não tem assinatura.</p>`}
    </section>
    <section class="gaveta-secao">
      <h3 class="gaveta-secao-titulo">Últimas transações</h3>
      ${transacoes?.length
        ? html`<table class="tabela-simples"><thead><tr><th>Código</th><th>Data</th><th>Status</th><th class="celula-numero">Valor</th></tr></thead><tbody>
            ${transacoes.map((transacao) => html`<tr><td class="celula-codigo">${transacao.codigo}</td><td class="celula-data">${dataCurta(transacao.criadoEm)}</td><td>${emblemaStatusTransacao(transacao.status)}</td><td class="celula-numero font-semibold">${moeda(transacao.valor)}</td></tr>`)}
          </tbody></table>`
        : html`<p class="text-sm texto-suave">Nenhuma transação ainda.</p>`}
    </section>
    <section class="gaveta-secao">
      <h3 class="gaveta-secao-titulo">Atividade</h3>
      ${atividades?.length
        ? html`<ol class="linha-tempo linha-tempo-compacta">${atividades.map(
            (atividade) => html`<li class="linha-tempo-item"><span class="linha-tempo-marcador">${html([icone("atividade")])}</span><div class="linha-tempo-conteudo"><p class="linha-tempo-texto"><strong>${atividade.usuario?.nome ?? "Sistema"}</strong> ${atividade.descricao}</p><time class="linha-tempo-tempo" datetime="${atividade.criadoEm}">${relativo(atividade.criadoEm)}</time></div></li>`,
          )}</ol>`
        : html`<p class="text-sm texto-suave">Nada registrado.</p>`}
    </section>
  `;
};

const agruparPermissoes = () => {
  const grupos = new Map();
  for (const permissao of estado.permissoes) {
    if (!grupos.has(permissao.modulo)) grupos.set(permissao.modulo, []);
    grupos.get(permissao.modulo).push(permissao);
  }
  return [...grupos.entries()];
};

const painelPermissoes = (dados, editavel) => {
  const concedidas = new Set(dados.concedidas);
  const negadas = new Set(dados.negadas);
  const doPapel = new Set(dados.permissoesPapel);
  const efetivas = new Set(dados.efetivas);
  return html`
    <form id="form-permissoes" class="pilha">
      <fieldset class="pilha-pequena">
        <legend class="gaveta-secao-titulo">Papel</legend>
        <div class="papeis-grade">
          ${estado.papeis.map(
            (papel) => html`<label class="papel-opcao">
              <input type="radio" name="papel" value="${papel.codigo}" ${papel.codigo === dados.papel.codigo ? "checked" : ""} ${editavel ? "" : "disabled"}>
              <span class="papel-opcao-nome">${papel.nome}</span>
              <span class="papel-opcao-descricao">${papel.descricao} (${plural(papel.permissoes.length, "permissão", "permissões")})</span>
            </label>`,
          )}
        </div>
      </fieldset>
      <div class="permissao-legenda">
        <span>${html([icone("camadas", "size-3.5")])}Papel: segue o papel escolhido</span>
        <span>${html([icone("confirmar", "size-3.5")])}Conceder: libera mesmo fora do papel</span>
        <span>${html([icone("fechar", "size-3.5")])}Negar: bloqueia mesmo se o papel liberar</span>
      </div>
      <div class="matriz-permissoes">
        ${agruparPermissoes().map(
          ([modulo, itens]) => html`<div class="permissao-modulo">
            <p class="permissao-modulo-titulo">${modulo}<span>${plural(itens.length, "permissão", "permissões")}</span></p>
            ${itens.map((permissao) => {
              const valor = concedidas.has(permissao.codigo) ? "concedida" : negadas.has(permissao.codigo) ? "negada" : "papel";
              return html`<div class="permissao-item" data-permissao-item="${permissao.codigo}" data-papel-tem="${doPapel.has(permissao.codigo)}">
                <span class="permissao-efetiva" data-ativa="${efetivas.has(permissao.codigo)}" title="${efetivas.has(permissao.codigo) ? "Liberada" : "Bloqueada"}">${html([icone(efetivas.has(permissao.codigo) ? "confirmar" : "menos")])}</span>
                <div class="permissao-textos">
                  <span class="permissao-nome">${permissao.nome}</span>
                  <span class="permissao-codigo">${permissao.codigo}</span>
                </div>
                <div class="permissao-estado" role="radiogroup" aria-label="${permissao.nome}">
                  <button type="button" data-valor="papel" aria-pressed="${valor === "papel"}" aria-label="Seguir o papel" ${editavel ? "" : "disabled"}>${html([icone("camadas")])}</button>
                  <button type="button" data-valor="concedida" aria-pressed="${valor === "concedida"}" aria-label="Conceder" ${editavel ? "" : "disabled"}>${html([icone("confirmar")])}</button>
                  <button type="button" data-valor="negada" aria-pressed="${valor === "negada"}" aria-label="Negar" ${editavel ? "" : "disabled"}>${html([icone("fechar")])}</button>
                </div>
              </div>`;
            })}
          </div>`,
        )}
      </div>
    </form>
  `;
};

const recalcularEfetivas = (formulario) => {
  const papel = estado.papeis.find((item) => item.codigo === formulario.elements.papel.value);
  const doPapel = new Set(papel?.permissoes ?? []);
  for (const item of formulario.querySelectorAll("[data-permissao-item]")) {
    const codigo = item.dataset.permissaoItem;
    const valor = item.querySelector('[aria-pressed="true"]')?.dataset.valor ?? "papel";
    const ativa = valor === "concedida" || (valor === "papel" && doPapel.has(codigo));
    const marcador = item.querySelector(".permissao-efetiva");
    marcador.dataset.ativa = String(ativa);
    marcador.innerHTML = icone(ativa ? "confirmar" : "menos");
  }
};

const lerPermissoes = (formulario) => {
  const concedidas = [];
  const negadas = [];
  for (const item of formulario.querySelectorAll("[data-permissao-item]")) {
    const valor = item.querySelector('[aria-pressed="true"]')?.dataset.valor;
    if (valor === "concedida") concedidas.push(item.dataset.permissaoItem);
    if (valor === "negada") negadas.push(item.dataset.permissaoItem);
  }
  return { papel: formulario.elements.papel.value, concedidas, negadas };
};

const abrirDetalhes = async (id, abaInicial = "resumo") => {
  const gaveta = new Gaveta({ titulo: "Usuário", subtitulo: "Carregando…", largura: "larga", aoFechar: () => atualizarUrl({ usuario: null }) }).abrir();
  atualizarUrl({ usuario: id });
  let detalhe;
  try {
    detalhe = await api.obter(`/usuarios/${id}`);
  } catch (erro) {
    gaveta.definirTitulo("Usuário", "");
    gaveta.definirCorpo(html`<div class="vazio vazio-erro"><span class="vazio-icone">${html([icone("alerta")])}</span><p class="vazio-titulo">Não foi possível abrir</p><p class="vazio-texto">${mensagemDeErro(erro)}</p></div>`);
    return;
  }
  const { usuario } = detalhe;
  gaveta.definirTitulo(usuario.nome, `Conta criada ${relativo(usuario.criadoEm)}`);
  gaveta.definirAbas(html`
    <div class="abas" role="tablist" aria-label="Seções do usuário">
      <button type="button" class="aba" role="tab" id="aba-resumo" data-aba="resumo" aria-controls="painel-resumo">${html([icone("usuario")])}Resumo</button>
      ${pode("usuarios.editar") ? html`<button type="button" class="aba" role="tab" id="aba-editar" data-aba="editar" aria-controls="painel-editar">${html([icone("editar")])}Editar</button>` : ""}
      <button type="button" class="aba" role="tab" id="aba-permissoes" data-aba="permissoes" aria-controls="painel-permissoes">${html([icone("escudo")])}Permissões</button>
    </div>
  `);
  gaveta.definirCorpo(html`
    <div class="painel-aba" id="painel-resumo" role="tabpanel" aria-labelledby="aba-resumo">${painelResumo(detalhe)}</div>
    ${pode("usuarios.editar") ? html`<div class="painel-aba" id="painel-editar" role="tabpanel" aria-labelledby="aba-editar" hidden><form class="formulario" id="form-editar-usuario" novalidate>${camposUsuario(usuario)}</form></div>` : ""}
    <div class="painel-aba" id="painel-permissoes" role="tabpanel" aria-labelledby="aba-permissoes" hidden><div class="gaveta-carregando"><span class="giro"></span></div></div>
  `);

  let permissoesCarregadas = false;
  const editavelPermissoes = pode("usuarios.permissoes") && !ehEuMesmo(usuario);

  const rodapes = {
    resumo: () =>
      html`<div class="gaveta-rodape-esquerda">
          ${pode("usuarios.bloquear") && !ehEuMesmo(usuario)
            ? usuario.status === "bloqueado"
              ? html`<button type="button" class="botao botao-secundario" data-rodape="desbloquear"><i data-icone="cadeado-aberto"></i>Desbloquear</button>`
              : html`<button type="button" class="botao botao-perigo-suave" data-rodape="bloquear"><i data-icone="cadeado"></i>Bloquear</button>`
            : ""}
        </div>
        ${pode("usuarios.editar") ? html`<button type="button" class="botao botao-secundario" data-rodape="senha"><i data-icone="chave"></i>Redefinir senha</button>` : ""}
        ${pode("usuarios.editar") ? html`<button type="button" class="botao botao-primario" data-rodape="ir-editar"><i data-icone="editar"></i>Editar</button>` : ""}`,
    editar: () => html`<button type="button" class="botao botao-secundario" data-rodape="cancelar">Cancelar</button><button type="submit" form="form-editar-usuario" class="botao botao-primario" data-salvar><i data-icone="salvar"></i>Salvar alterações</button>`,
    permissoes: () =>
      editavelPermissoes
        ? html`<p class="gaveta-rodape-esquerda text-xs texto-suave">As mudanças valem no próximo acesso.</p><button type="submit" form="form-permissoes" class="botao botao-primario" data-salvar-permissoes><i data-icone="escudo-ok"></i>Salvar permissões</button>`
        : html`<p class="gaveta-rodape-esquerda text-xs texto-suave">${ehEuMesmo(usuario) ? "Você não pode alterar as próprias permissões." : "Só quem tem a permissão de gerenciar permissões pode alterar."}</p>`,
  };

  const carregarPermissoes = async () => {
    if (permissoesCarregadas) return;
    permissoesCarregadas = true;
    const painel = $("#painel-permissoes");
    try {
      const dados = await api.obter(`/usuarios/${id}/permissoes`);
      renderizar(painel, painelPermissoes(dados, editavelPermissoes));
      hidratarIcones(painel);
      const formulario = $("#form-permissoes");
      formulario.addEventListener("click", (evento) => {
        const botao = evento.target.closest(".permissao-estado button");
        if (!botao || botao.disabled) return;
        for (const irmao of botao.parentElement.querySelectorAll("button")) irmao.setAttribute("aria-pressed", String(irmao === botao));
        recalcularEfetivas(formulario);
      });
      formulario.addEventListener("change", () => recalcularEfetivas(formulario));
      formulario.addEventListener("submit", async (evento) => {
        evento.preventDefault();
        const botao = gaveta.rodape.querySelector("[data-salvar-permissoes]");
        carregando(botao, true);
        try {
          await api.substituir(`/usuarios/${id}/permissoes`, lerPermissoes(formulario));
          avisoSucesso("Permissões salvas", `${usuario.nome} recebe as mudanças no próximo acesso.`);
          recarregar();
        } catch (erro) {
          avisar({ tipo: "erro", titulo: "Não foi possível salvar as permissões", texto: mensagemDeErro(erro) });
        } finally {
          carregando(botao, false);
        }
      });
    } catch (erro) {
      renderizar(painel, html`<div class="vazio vazio-erro"><p class="vazio-texto">${mensagemDeErro(erro)}</p></div>`);
    }
  };

  const abas = iniciarAbas(gaveta.abas.querySelector('[role="tablist"]'), {
    inicial: abaInicial,
    aoTrocar: (nome) => {
      gaveta.definirRodape(rodapes[nome]?.() ?? "");
      if (nome === "permissoes") carregarPermissoes();
    },
  });

  gaveta.rodape.addEventListener("click", async (evento) => {
    const botao = evento.target.closest("[data-rodape]");
    if (!botao) return;
    const acao = botao.dataset.rodape;
    if (acao === "ir-editar") abas.selecionar("editar");
    else if (acao === "cancelar") abas.selecionar("resumo");
    else if (acao === "senha") redefinirSenha(usuario);
    else if (acao === "bloquear" && (await bloquear(usuario))) {
      gaveta.fechar();
    } else if (acao === "desbloquear" && (await desbloquear(usuario))) {
      gaveta.fechar();
    }
  });

  const formularioEdicao = $("#form-editar-usuario");
  formularioEdicao?.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formularioEdicao);
    if (!formularioEdicao.reportValidity()) return;
    const botao = gaveta.rodape.querySelector("[data-salvar]");
    carregando(botao, true);
    try {
      const dados = lerFormulario(formularioEdicao);
      if (dados.status === "bloqueado") delete dados.status;
      const { usuario: atualizado } = await api.atualizar(`/usuarios/${id}`, dados);
      avisoSucesso("Alterações salvas", atualizado.nome);
      recarregar();
      gaveta.fechar();
    } catch (erro) {
      if (erro instanceof ErroApi && erro.codigo === "VALIDACAO" && mostrarErros(formularioEdicao, erro.detalhes)) return;
      if (erro instanceof ErroApi && erro.codigo === "CONFLITO") {
        mostrarErros(formularioEdicao, { email: erro.message });
        return;
      }
      avisar({ tipo: "erro", titulo: "Não foi possível salvar", texto: mensagemDeErro(erro) });
    } finally {
      carregando(botao, false);
    }
  });
};

const acaoEmMassa = async (acao) => {
  const ids = [...estado.tabela.selecionados];
  if (!ids.length) return;
  const textos = {
    bloquear: { titulo: `Bloquear ${plural(ids.length, "conta")}?`, texto: "As pessoas saem de todas as sessões.", tipo: "perigo", confirmar: "Bloquear" },
    desbloquear: { titulo: `Desbloquear ${plural(ids.length, "conta")}?`, texto: "As pessoas voltam a conseguir entrar.", tipo: "info", confirmar: "Desbloquear" },
    ativar: { titulo: `Ativar ${plural(ids.length, "conta")}?`, texto: "Contas pendentes ou inativas passam a ficar ativas.", tipo: "info", confirmar: "Ativar" },
    excluir: { titulo: `Excluir ${plural(ids.length, "conta")}?`, texto: "Não dá para desfazer. Sua própria conta é ignorada.", tipo: "perigo", confirmar: "Excluir" },
  };
  const resposta = await confirmar({ ...textos[acao], campo: acao === "bloquear" ? { rotulo: "Motivo", obrigatorio: true } : null });
  if (!resposta) return;
  try {
    const { afetados } = await api.criar("/usuarios/acoes-em-massa", { ids, acao, motivo: typeof resposta === "string" ? resposta : undefined });
    avisoSucesso("Pronto", `${plural(afetados, "conta atualizada", "contas atualizadas")}.`);
    estado.tabela.limparSelecao();
    recarregar();
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível concluir", texto: mensagemDeErro(erro) });
  }
};

const exportar = async (botao) => {
  carregando(botao, true);
  try {
    const { pagina, porPagina, ...filtros } = estado.tabela.parametros();
    await api.baixar("/usuarios/exportar", { formato: "csv", ...filtros }, "bento-usuarios.csv");
    avisoSucesso("Exportação pronta", "O arquivo CSV foi baixado.");
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível exportar", texto: mensagemDeErro(erro) });
  } finally {
    carregando(botao, false);
  }
};

iniciarPagina({
  pagina: "usuarios",
  permissao: "usuarios.ver",
  aoIniciar: async () => {
    $$("[data-permissao]").forEach((elemento) => {
      if (!pode(elemento.dataset.permissao)) elemento.remove();
    });

    const [papeis, permissoes] = await Promise.all([api.obter("/papeis"), api.obter("/permissoes")]);
    estado.papeis = papeis;
    estado.permissoes = permissoes;
    $('[data-filtro="papel"]').insertAdjacentHTML("beforeend", String(html`${papeis.map((papel) => html`<option value="${papel.codigo}">${papel.nome} (${numero(papel.usuarios)})</option>`)}`));

    const podeEmMassa = pode("usuarios.bloquear") || pode("usuarios.excluir");
    estado.tabela = new TabelaDados($("[data-tabela]"), {
      colunas: COLUNAS,
      legenda: "Lista de usuários",
      selecionavel: podeEmMassa,
      ordenacao: { campo: "criadoEm", direcao: "desc" },
      buscar: (parametros, sinal) => api.obter("/usuarios", parametros, { sinal }),
      aoClicarLinha: (usuario) => abrirDetalhes(usuario.id),
      acoesLinha: acoesDoUsuario,
      vazio: { icone: "usuarios", titulo: "Nenhum usuário encontrado", texto: "Ajuste a busca ou os filtros para ver mais contas." },
      aoCarregar: (resposta) => {
        atualizarContagens(resposta.contagens);
        $("[data-resumo-tabela]").textContent = `${plural(resposta.total, "conta encontrada", "contas encontradas")}`;
      },
    });

    if (podeEmMassa) {
      const acoes = estado.tabela.definirAcoesSelecao(html`
        ${pode("usuarios.editar") ? html`<button type="button" class="botao botao-secundario botao-pequeno" data-massa="ativar">${html([icone("usuario-ok")])}Ativar</button>` : ""}
        ${pode("usuarios.bloquear") ? html`<button type="button" class="botao botao-secundario botao-pequeno" data-massa="desbloquear">${html([icone("cadeado-aberto")])}Desbloquear</button><button type="button" class="botao botao-secundario botao-pequeno" data-massa="bloquear">${html([icone("cadeado")])}Bloquear</button>` : ""}
        ${pode("usuarios.excluir") ? html`<button type="button" class="botao botao-perigo-suave botao-pequeno" data-massa="excluir">${html([icone("lixeira")])}Excluir</button>` : ""}
      `);
      acoes.addEventListener("click", (evento) => {
        const botao = evento.target.closest("[data-massa]");
        if (botao) acaoEmMassa(botao.dataset.massa);
      });
    }

    $("[data-busca]").addEventListener("input", (evento) => estado.tabela.buscar(evento.target.value));
    $("[data-status-filtro]").addEventListener("click", (evento) => {
      const botao = evento.target.closest("[data-status]");
      if (!botao) return;
      estado.filtroStatus = botao.dataset.status;
      $$("[data-status-filtro] [data-status]").forEach((outro) => outro.setAttribute("aria-pressed", String(outro === botao)));
      estado.tabela.definirFiltro("status", estado.filtroStatus);
    });
    $$("[data-filtro]").forEach((selecao) => selecao.addEventListener("change", () => estado.tabela.definirFiltro(selecao.dataset.filtro, selecao.value)));
    document.addEventListener("click", (evento) => {
      const botao = evento.target.closest('[data-acao="novo"], [data-acao="exportar"]');
      if (!botao) return;
      if (botao.dataset.acao === "novo") abrirNovo();
      else exportar(botao);
    });

    ouvir("tempo-real:usuario", (usuario) => {
      const { q, status, papel, plano } = estado.tabela.parametros();
      if (!usuario || q || status || papel || plano || estado.tabela.estado.ordenar !== "criadoEm" || estado.tabela.estado.direcao !== "desc") return;
      estado.tabela.inserirNoTopo(usuario);
    });

    await estado.tabela.recarregar();

    const parametros = parametrosUrl();
    if (parametros.novo && pode("usuarios.criar")) {
      atualizarUrl({ novo: null });
      abrirNovo();
    } else if (parametros.usuario) abrirDetalhes(parametros.usuario);
  },
});

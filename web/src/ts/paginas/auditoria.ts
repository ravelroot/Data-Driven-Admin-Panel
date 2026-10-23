import { iniciarPagina } from "../layout/inicio.ts";
import { html, $$, exigir, parametrosUrl, atualizarUrl, carregando } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";
import { api, mensagemDeErro } from "../nucleo/api.ts";
import { data, dataHora, relativo, corAvatar, plural } from "../nucleo/formato.ts";
import { TabelaDados } from "../componentes/tabela.ts";
import type { ColunaTabela, ParametrosTabela, ValorFiltro } from "../componentes/tabela.ts";
import { Gaveta } from "../componentes/gaveta.ts";
import { avisar, avisoSucesso } from "../componentes/aviso.ts";
import type { Seguro } from "../nucleo/dom.ts";
import type { Atividade, Pagina, Referencia } from "../nucleo/tipos.ts";

interface AtividadeCompleta extends Atividade {
  ip: string | null;
  detalhes: Record<string, unknown>;
}

interface PessoaEquipe {
  id: string;
  nome: string;
  papel: Referencia;
}

interface GrupoAcao {
  valor: string;
  rotulo: string;
  tom: string;
}

const GRUPOS_ACAO: GrupoAcao[] = [
  { valor: "auth", rotulo: "Acessos", tom: "neutro" },
  { valor: "usuario,usuarios", rotulo: "Usuários", tom: "anil" },
  { valor: "assinatura", rotulo: "Assinaturas", tom: "salvia" },
  { valor: "transacao", rotulo: "Transações", tom: "anil" },
  { valor: "relatorio", rotulo: "Relatórios", tom: "ouro" },
  { valor: "notificacao", rotulo: "Notificações", tom: "casca" },
  { valor: "integracao", rotulo: "Integrações", tom: "anil" },
  { valor: "perfil,seguranca", rotulo: "Perfil e segurança", tom: "brasa" },
  { valor: "sistema", rotulo: "Sistema", tom: "neutro" },
];

const ROTULOS_ACAO: Record<string, string> = {
  "assinatura.cancelada": "Assinatura cancelada",
  "assinatura.criada": "Assinatura criada",
  "auth.bloqueio_temporario": "Bloqueio temporário",
  "auth.entrou": "Entrou no painel",
  "integracao.ativada": "Integração ativada",
  "integracao.configurada": "Integração configurada",
  "integracao.desativada": "Integração desativada",
  "integracao.teste": "Teste de integração",
  "notificacao.enviada": "Aviso enviado",
  "perfil.atualizado": "Perfil atualizado",
  "relatorio.agendado": "Relatório agendado",
  "relatorio.excluido": "Relatório excluído",
  "relatorio.gerado": "Relatório gerado",
  "seguranca.chave_criada": "Chave de API criada",
  "seguranca.chave_revogada": "Chave de API revogada",
  "seguranca.senha_alterada": "Senha alterada",
  "sistema.configurado": "Sistema configurado",
  "transacao.falhou": "Pagamento recusado",
  "transacao.paga": "Pagamento confirmado",
  "transacao.reembolsar": "Reembolso",
  "usuario.bloqueado": "Conta bloqueada",
  "usuario.cadastrado": "Novo cadastro",
  "usuario.criado": "Usuário criado",
  "usuario.desbloqueado": "Conta desbloqueada",
  "usuario.editado": "Usuário editado",
  "usuario.excluido": "Usuário excluído",
  "usuario.papel_alterado": "Papel alterado",
  "usuario.permissoes_alteradas": "Permissões alteradas",
  "usuario.senha_redefinida": "Senha redefinida",
  "usuarios.exportados": "Usuários exportados",
};

const FILTROS = ["acao", "usuario", "inicio", "fim"] as const;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POR_PAGINA = new Set([10, 25, 50, 100]);
const LINKS_ENTIDADE: Record<string, (id: string) => string> = {
  usuario: (id) => `/usuarios?usuario=${encodeURIComponent(id)}`,
  transacao: (id) => `/transacoes?transacao=${encodeURIComponent(id)}`,
};

let tabelaAtual: TabelaDados<AtividadeCompleta> | null = null;

const tabela = (): TabelaDados<AtividadeCompleta> => {
  if (!tabelaAtual) throw new Error("Tabela da auditoria ainda não montada");
  return tabelaAtual;
};

const grupoDe = (acao: string): GrupoAcao | undefined => {
  const prefixo = acao.split(".")[0] ?? "";
  return GRUPOS_ACAO.find((grupo) => grupo.valor.split(",").includes(prefixo));
};

const dataHoraMono = (iso: string): string =>
  data(iso, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

const etiquetaAcao = (acao: string): Seguro =>
  html`<span class="emblema emblema-${grupoDe(acao)?.tom ?? "neutro"}" title="${acao}">${ROTULOS_ACAO[acao] ?? acao}</span>`;

const pessoaCelula = (atividade: AtividadeCompleta): Seguro =>
  atividade.usuario
    ? html`<div class="celula-usuario"><span class="avatar avatar-pequeno" data-cor="${corAvatar(atividade.usuario.nome)}" aria-hidden="true">${atividade.usuario.iniciais ?? "?"}</span><div class="celula-usuario-texto"><span class="celula-usuario-nome">${atividade.usuario.nome}</span></div></div>`
    : html`<span class="celula-icone-texto texto-suave">${html([icone("configuracoes")])}Sistema</span>`;

const COLUNAS: ColunaTabela<AtividadeCompleta>[] = [
  {
    campo: "criadoEm",
    titulo: "Data e hora",
    classe: "celula-data",
    render: (atividade) => html`<time class="auditoria-data" datetime="${atividade.criadoEm}" title="${relativo(atividade.criadoEm)}">${dataHoraMono(atividade.criadoEm)}</time>`,
  },
  { campo: "usuario", titulo: "Pessoa", render: pessoaCelula },
  { campo: "acao", titulo: "Ação", render: (atividade) => etiquetaAcao(atividade.acao) },
  { campo: "descricao", titulo: "Descrição", render: (atividade) => html`<span class="auditoria-descricao" title="${atividade.descricao}">${atividade.descricao}</span>` },
  { campo: "ip", titulo: "IP", render: (atividade) => (atividade.ip ? html`<span class="auditoria-ip">${atividade.ip}</span>` : html`<span class="texto-fraco">—</span>`) },
];

const filtrosAtuais = (): Record<string, string> => {
  const { q, ...resto } = tabela().parametros();
  const filtros: Record<string, string> = {};
  if (q) filtros.q = String(q);
  for (const nome of FILTROS) {
    const valor = resto[nome];
    if (valor !== undefined && valor !== null && valor !== "") filtros[nome] = String(valor);
  }
  return filtros;
};

const sincronizarUrl = (): void => {
  const { pagina, porPagina } = tabela().estado;
  const filtros = filtrosAtuais();
  atualizarUrl({
    q: filtros.q ?? null,
    ...Object.fromEntries(FILTROS.map((nome) => [nome, filtros[nome] ?? null])),
    pagina: pagina > 1 ? pagina : null,
    porPagina: porPagina !== 25 ? porPagina : null,
  });
  exigir<HTMLButtonElement>('[data-acao="limpar"]').hidden = Object.keys(filtros).length === 0;
};

const abrirDetalhe = (atividade: AtividadeCompleta): void => {
  const gaveta = new Gaveta({
    titulo: ROTULOS_ACAO[atividade.acao] ?? atividade.acao,
    subtitulo: dataHora(atividade.criadoEm),
    aoFechar: () => atualizarUrl({ atividade: null }),
  }).abrir();
  atualizarUrl({ atividade: atividade.id });
  const link = atividade.entidade && atividade.entidadeId ? LINKS_ENTIDADE[atividade.entidade]?.(atividade.entidadeId) : undefined;
  const temDetalhes = Object.keys(atividade.detalhes ?? {}).length > 0;
  gaveta.definirCorpo(html`
    <section class="gaveta-secao">
      <div class="linha-entre">${pessoaCelula(atividade)}${etiquetaAcao(atividade.acao)}</div>
      <p class="mt-3 text-sm">${atividade.usuario ? html`<strong>${atividade.usuario.nome}</strong> ` : ""}${atividade.descricao}</p>
    </section>
    <section class="gaveta-secao">
      <h3 class="gaveta-secao-titulo">Registro</h3>
      <dl class="lista-definicao">
        <dt>Ação</dt><dd><code>${atividade.acao}</code></dd>
        <dt>Quando</dt><dd><span class="auditoria-data">${dataHoraMono(atividade.criadoEm)}</span> · ${relativo(atividade.criadoEm)}</dd>
        <dt>Entidade</dt><dd>${atividade.entidade ?? "—"}</dd>
        <dt>ID da entidade</dt><dd>${atividade.entidadeId ? html`<code>${atividade.entidadeId}</code>` : "—"}</dd>
        <dt>IP</dt><dd>${atividade.ip ? html`<code>${atividade.ip}</code>` : "—"}</dd>
        <dt>Nº do registro</dt><dd><code>${atividade.id}</code></dd>
      </dl>
      ${link ? html`<a class="botao botao-secundario botao-pequeno mt-4" href="${link}">${html([icone("externo")])}Abrir ${atividade.entidade === "usuario" ? "cadastro" : "transação"}</a>` : ""}
    </section>
    <section class="gaveta-secao">
      <h3 class="gaveta-secao-titulo">Detalhes</h3>
      ${temDetalhes ? html`<pre class="auditoria-json"><code>${JSON.stringify(atividade.detalhes, null, 2)}</code></pre>` : html`<p class="text-sm texto-suave">Sem detalhes adicionais.</p>`}
    </section>
  `);
};

const exportar = async (botao: HTMLButtonElement): Promise<void> => {
  carregando(botao, true);
  try {
    await api.baixar("/atividades/exportar", { formato: "csv", ...filtrosAtuais() }, "bento-auditoria.csv");
    avisoSucesso("Exportação pronta", "O CSV traz até 10 mil registros com os filtros atuais.");
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível exportar", texto: mensagemDeErro(erro) });
  } finally {
    carregando(botao, false);
  }
};

const ajustarLimitesDatas = (): void => {
  const inicio = exigir<HTMLInputElement>('[data-filtro-data="inicio"]');
  const fim = exigir<HTMLInputElement>('[data-filtro-data="fim"]');
  fim.min = inicio.value;
  inicio.max = fim.value;
};

iniciarPagina({
  pagina: "auditoria",
  permissao: "auditoria.ver",
  aoIniciar: async () => {
    const url = parametrosUrl();
    const pessoas = await api.obter<PessoaEquipe[]>("/atividades/pessoas").catch(() => [] as PessoaEquipe[]);

    exigir('[data-filtro="acao"]').insertAdjacentHTML("beforeend", String(html`${GRUPOS_ACAO.map((grupo) => html`<option value="${grupo.valor}">${grupo.rotulo}</option>`)}`));
    exigir('[data-filtro="usuario"]').insertAdjacentHTML("beforeend", String(html`${pessoas.map((pessoa) => html`<option value="${pessoa.id}">${pessoa.nome} (${pessoa.papel.nome})</option>`)}`));

    const filtros: Record<string, ValorFiltro> = {};
    if (url.acao && GRUPOS_ACAO.some((grupo) => grupo.valor === url.acao)) filtros.acao = url.acao;
    if (url.usuario && UUID.test(url.usuario)) filtros.usuario = url.usuario;
    for (const nome of ["inicio", "fim"] as const) if (url[nome] && DIA.test(url[nome])) filtros[nome] = url[nome];

    tabelaAtual = new TabelaDados<AtividadeCompleta>(exigir<HTMLElement>("[data-tabela]"), {
      colunas: COLUNAS,
      legenda: "Registro de atividades em ordem cronológica, do mais recente ao mais antigo",
      filtros,
      porPagina: POR_PAGINA.has(Number(url.porPagina)) ? Number(url.porPagina) : 25,
      buscar: (parametros: ParametrosTabela, sinal: AbortSignal) => {
        const { ordenar: _ordenar, direcao: _direcao, ...consulta } = parametros;
        return api.obter<Pagina<AtividadeCompleta>>("/atividades", consulta, { sinal });
      },
      aoClicarLinha: abrirDetalhe,
      vazio: { icone: "historico", titulo: "Nada registrado com esses filtros", texto: "Amplie o período, troque a pessoa ou limpe a busca." },
      aoCarregar: (resposta) => {
        exigir("[data-resumo-tabela]").textContent = plural(resposta.total, "registro encontrado", "registros encontrados");
        sincronizarUrl();
      },
    });

    const busca = exigir<HTMLInputElement>("[data-busca]");
    if (url.q) {
      busca.value = url.q.slice(0, 120);
      tabela().estado.q = busca.value.trim();
    }
    const pagina = Number(url.pagina);
    if (Number.isInteger(pagina) && pagina > 1) tabela().estado.pagina = pagina;

    $$<HTMLSelectElement>("[data-filtro]").forEach((selecao) => {
      selecao.value = String(filtros[selecao.dataset.filtro ?? ""] ?? "");
      selecao.addEventListener("change", () => tabela().definirFiltro(selecao.dataset.filtro ?? "", selecao.value));
    });
    $$<HTMLInputElement>("[data-filtro-data]").forEach((entrada) => {
      entrada.value = String(filtros[entrada.dataset.filtroData ?? ""] ?? "");
      entrada.addEventListener("change", () => {
        if (entrada.value && !DIA.test(entrada.value)) return;
        ajustarLimitesDatas();
        tabela().definirFiltro(entrada.dataset.filtroData ?? "", entrada.value);
      });
    });
    ajustarLimitesDatas();

    busca.addEventListener("input", () => tabela().buscar(busca.value));
    exigir('[data-acao="limpar"]').addEventListener("click", () => {
      busca.value = "";
      tabela().estado.q = "";
      for (const nome of FILTROS) delete tabela().estado.filtros[nome];
      $$<HTMLSelectElement>("[data-filtro]").forEach((selecao) => (selecao.value = ""));
      $$<HTMLInputElement>("[data-filtro-data]").forEach((entrada) => (entrada.value = ""));
      ajustarLimitesDatas();
      void tabela().recarregar({ voltarInicio: true });
    });
    exigir<HTMLButtonElement>('[data-acao="exportar"]').addEventListener("click", (evento) => exportar(evento.currentTarget as HTMLButtonElement));

    await tabela().recarregar();
    if (url.atividade) {
      const alvo = tabela().itens.find((item) => String(item.id) === url.atividade);
      if (alvo) abrirDetalhe(alvo);
      else atualizarUrl({ atividade: null });
    }
  },
});

import { iniciarPagina } from "../layout/inicio.ts";
import { html, $, $$, exigir, parametrosUrl, atualizarUrl, carregando, atrasar } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";
import { api, mensagemDeErro, ErroApi } from "../nucleo/api.ts";
import { pode } from "../nucleo/sessao.ts";
import { ouvir } from "../nucleo/eventos.ts";
import { moeda, numero, percentual, dataCurta, dataHora, relativo, rotulos, plural } from "../nucleo/formato.ts";
import { TabelaDados, botaoAcoesLinha } from "../componentes/tabela.ts";
import type { ColunaTabela, Direcao, ParametrosTabela, ValorFiltro } from "../componentes/tabela.ts";
import { Gaveta } from "../componentes/gaveta.ts";
import { confirmar } from "../componentes/modal.ts";
import { avisar, avisoSucesso } from "../componentes/aviso.ts";
import { emblemaStatusTransacao, metodo as celulaMetodo, clienteCelula } from "../componentes/transacao.ts";
import type { Seguro } from "../nucleo/dom.ts";
import type { Pagina, Referencia, Transacao } from "../nucleo/tipos.ts";

interface ResumoTransacoes {
  quantidade: number;
  valorPago: number;
  valorReembolsado: number;
  taxaFalha: number;
}

interface RespostaTransacoes extends Pagina<Transacao> {
  resumo: ResumoTransacoes;
  contagens: Record<string, number>;
}

interface DetalheTransacao extends Transacao {
  pagoEm: string | null;
  reembolsadoEm: string | null;
  reembolsoMotivo: string | null;
  reembolsadoPor: { id: string; nome: string } | null;
  assinatura: { id: string; plano: Referencia | null; status: string; ciclo: string } | null;
}

interface AcaoLinha {
  rotulo: string;
  icone: string;
  perigo?: boolean;
  executar: () => unknown;
}

const FILTROS = ["status", "metodo", "tipo", "inicio", "fim"] as const;
const STATUS = new Set(["paga", "pendente", "falhou", "reembolsada"]);
const ORDENAVEIS = new Set(["criadoEm", "valor", "codigo", "status", "usuario", "metodo"]);
const VALIDOS: Record<string, Set<string>> = {
  status: STATUS,
  metodo: new Set(["cartao", "pix", "boleto"]),
  tipo: new Set(["assinatura", "upgrade", "avulsa", "reembolso"]),
};
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POR_PAGINA = new Set([10, 25, 50, 100]);

let tabelaAtual: TabelaDados<Transacao, RespostaTransacoes> | null = null;

const tabela = (): TabelaDados<Transacao, RespostaTransacoes> => {
  if (!tabelaAtual) throw new Error("Tabela de transações ainda não montada");
  return tabelaAtual;
};

const traduzir = (grupo: Record<string, string>, chave: string): string => grupo[chave] ?? chave;

const negativo = (transacao: Pick<Transacao, "tipo" | "status">): boolean => transacao.tipo === "reembolso" || transacao.status === "reembolsada";

const COLUNAS: ColunaTabela<Transacao>[] = [
  { campo: "codigo", titulo: "Código", ordenavel: true, classe: "celula-codigo", render: (transacao) => transacao.codigo },
  {
    campo: "criadoEm",
    titulo: "Data",
    ordenavel: true,
    direcaoInicial: "desc",
    classe: "celula-data",
    render: (transacao) => html`<time datetime="${transacao.criadoEm}" title="${dataHora(transacao.criadoEm)}">${dataCurta(transacao.criadoEm)}</time>`,
  },
  { campo: "usuario", titulo: "Cliente", ordenavel: true, render: (transacao) => clienteCelula(transacao.usuario) },
  { campo: "plano", titulo: "Plano", render: (transacao) => transacao.plano?.nome ?? html`<span class="texto-fraco">—</span>` },
  { campo: "tipo", titulo: "Tipo", render: (transacao) => traduzir(rotulos.tipoTransacao, transacao.tipo) },
  { campo: "metodo", titulo: "Método", ordenavel: true, render: (transacao) => celulaMetodo(transacao.metodo) },
  { campo: "status", titulo: "Status", ordenavel: true, render: (transacao) => emblemaStatusTransacao(transacao.status) },
  {
    campo: "valor",
    titulo: "Valor",
    ordenavel: true,
    direcaoInicial: "desc",
    classe: "celula-moeda",
    render: (transacao) => html`<span ${negativo(transacao) ? html`data-negativo="true"` : ""}>${moeda(transacao.valor)}</span>`,
  },
  { campo: "acoes", titulo: "Ações", oculto: true, classe: "celula-acoes", render: (transacao) => botaoAcoesLinha(transacao.id, `Ações para ${transacao.codigo}`) },
];

const podeReembolsar = (transacao: Pick<Transacao, "status">): boolean => pode("transacoes.reembolsar") && transacao.status === "paga";

const acoesDaTransacao = (transacao: Transacao): Array<AcaoLinha | "separador" | false> => [
  { rotulo: "Ver detalhes", icone: "olho", executar: () => abrirDetalhe(transacao.id) },
  Boolean(transacao.usuario?.id) && { rotulo: "Abrir cadastro do cliente", icone: "usuario", executar: () => location.assign(`/usuarios?usuario=${encodeURIComponent(transacao.usuario.id)}`) },
  podeReembolsar(transacao) && "separador",
  podeReembolsar(transacao) && { rotulo: "Reembolsar", icone: "desfazer", perigo: true, executar: () => reembolsar(transacao) },
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
  const { pagina, porPagina, ordenar, direcao } = tabela().estado;
  const filtros = filtrosAtuais();
  atualizarUrl({
    q: filtros.q ?? null,
    ...Object.fromEntries(FILTROS.map((nome) => [nome, filtros[nome] ?? null])),
    ordenar: ordenar && ordenar !== "criadoEm" ? ordenar : null,
    direcao: direcao !== "desc" ? direcao : null,
    pagina: pagina > 1 ? pagina : null,
    porPagina: porPagina !== 10 ? porPagina : null,
  });
  const temFiltro = Object.keys(filtros).length > 0;
  exigir<HTMLButtonElement>('[data-acao="limpar"]').hidden = !temFiltro;
};

const atualizarResumo = (resposta: RespostaTransacoes): void => {
  const { resumo, contagens } = resposta;
  const valores: Record<keyof ResumoTransacoes, string> = {
    quantidade: numero(resumo.quantidade, { compacto: resumo.quantidade >= 100000 }),
    valorPago: moeda(resumo.valorPago, { compacto: resumo.valorPago >= 100_000_00 }),
    valorReembolsado: moeda(resumo.valorReembolsado, { compacto: resumo.valorReembolsado >= 100_000_00 }),
    taxaFalha: percentual(resumo.taxaFalha),
  };
  for (const [chave, texto] of Object.entries(valores)) {
    const alvo = $(`[data-resumo-valor="${chave}"]`);
    if (alvo) alvo.textContent = texto;
  }
  exigir("[data-resumo]").setAttribute("aria-busy", "false");
  for (const [chave, valor] of Object.entries(contagens ?? {})) {
    const alvo = $(`[data-contagem="${chave}"]`);
    if (alvo) alvo.textContent = numero(valor, { compacto: valor >= 10000 });
  }
  exigir("[data-resumo-tabela]").textContent = plural(resposta.total, "transação encontrada", "transações encontradas");
};

const recarregar = (): Promise<unknown> => tabela().recarregar({ silencioso: true });

const pedirMotivo = async (transacao: Transacao): Promise<string | null> => {
  for (;;) {
    const resposta = await confirmar({
      titulo: `Reembolsar ${moeda(transacao.valor)} de ${transacao.usuario?.nome ?? "cliente removido"}?`,
      texto: `A transação ${transacao.codigo} passa a constar como reembolsada e o motivo fica registrado na auditoria. Não dá para desfazer pelo painel.`,
      tipo: "perigo",
      confirmar: "Reembolsar",
      campo: { rotulo: "Motivo do reembolso", obrigatorio: true, placeholder: "Ex.: cobrança em duplicidade, cancelamento dentro do prazo" },
    });
    if (!resposta) return null;
    const motivo = String(resposta).trim();
    if (motivo.length >= 3) return motivo;
    avisar({ tipo: "alerta", titulo: "Motivo muito curto", texto: "Explique o motivo com pelo menos 3 caracteres." });
  }
};

const reembolsar = async (transacao: Transacao): Promise<DetalheTransacao | null> => {
  const motivo = await pedirMotivo(transacao);
  if (!motivo) return null;
  try {
    const { transacao: atualizada } = await api.criar<{ transacao: DetalheTransacao }>(`/transacoes/${transacao.id}/reembolsar`, { motivo });
    avisoSucesso("Reembolso registrado", `${atualizada.codigo}: ${moeda(atualizada.valor)} devolvidos para ${atualizada.usuario?.nome ?? "o cliente"}.`);
    recarregar();
    return atualizada;
  } catch (erro) {
    const titulo = erro instanceof ErroApi && erro.codigo === "CONFLITO" ? "Esta transação não pode ser reembolsada" : "Não foi possível reembolsar";
    avisar({ tipo: "erro", titulo, texto: mensagemDeErro(erro) });
    if (erro instanceof ErroApi && erro.codigo === "CONFLITO") recarregar();
    return null;
  }
};

const itemLinhaTempo = (opcoes: { icone: string; tom?: string; titulo: Seguro | string; quando: string | null; extra?: Seguro | string }): Seguro => html`
  <li class="linha-tempo-item">
    <span class="linha-tempo-marcador" ${opcoes.tom ? html`data-tom="${opcoes.tom}"` : ""}>${html([icone(opcoes.icone)])}</span>
    <div class="linha-tempo-conteudo">
      <p class="linha-tempo-texto">${opcoes.titulo}</p>
      ${opcoes.extra ?? ""}
      ${opcoes.quando ? html`<time class="linha-tempo-tempo" datetime="${opcoes.quando}" title="${dataHora(opcoes.quando)}">${dataHora(opcoes.quando)} · ${relativo(opcoes.quando)}</time>` : ""}
    </div>
  </li>
`;

const linhaDoTempo = (transacao: DetalheTransacao): Seguro => {
  const itens: Seguro[] = [itemLinhaTempo({ icone: "recibo", titulo: html`<strong>Criada</strong> via ${traduzir(rotulos.metodo, transacao.metodo).toLowerCase()}`, quando: transacao.criadoEm })];
  if (transacao.pagoEm) itens.push(itemLinhaTempo({ icone: "confirmar", tom: "oliva", titulo: html`<strong>Paga</strong>`, quando: transacao.pagoEm }));
  else if (transacao.status === "falhou") itens.push(itemLinhaTempo({ icone: "erro", tom: "brasa", titulo: html`<strong>Pagamento recusado</strong>`, quando: null }));
  else if (transacao.status === "pendente") itens.push(itemLinhaTempo({ icone: "relogio", tom: "ouro", titulo: html`<strong>Aguardando pagamento</strong>`, quando: null }));
  if (transacao.status === "reembolsada") {
    itens.push(
      itemLinhaTempo({
        icone: "desfazer",
        tom: "anil",
        titulo: transacao.reembolsadoPor ? html`<strong>Reembolsada</strong> por ${transacao.reembolsadoPor.nome}` : html`<strong>Reembolsada</strong>`,
        quando: transacao.reembolsadoEm,
        extra: transacao.reembolsoMotivo
          ? html`<p class="transacoes-reembolso-motivo">Motivo: ${transacao.reembolsoMotivo}</p>`
          : html`<p class="transacoes-reembolso-motivo texto-suave">Reembolso anterior ao registro de motivos.</p>`,
      }),
    );
  }
  return html`<ol class="linha-tempo linha-tempo-compacta">${itens}</ol>`;
};

const corpoDetalhe = (transacao: DetalheTransacao): Seguro => html`
  <section class="gaveta-secao">
    <div class="linha-entre">
      <p class="cartao-numero">${moeda(transacao.valor)}</p>
      ${emblemaStatusTransacao(transacao.status)}
    </div>
    <p class="mt-1 text-sm texto-suave">${traduzir(rotulos.tipoTransacao, transacao.tipo)} · ${traduzir(rotulos.metodo, transacao.metodo)}${transacao.plano ? ` · ${transacao.plano.nome}` : ""}</p>
  </section>
  ${transacao.status === "reembolsada" && transacao.reembolsoMotivo
    ? html`<section class="gaveta-secao"><div class="transacoes-reembolso"><strong>Reembolsada${transacao.reembolsadoPor ? ` por ${transacao.reembolsadoPor.nome}` : ""}</strong><p class="transacoes-reembolso-motivo">${transacao.reembolsoMotivo}</p></div></section>`
    : ""}
  <section class="gaveta-secao">
    <h3 class="gaveta-secao-titulo">Cliente</h3>
    <div class="linha-entre">
      ${clienteCelula(transacao.usuario)}
      ${transacao.usuario?.id ? html`<a class="botao botao-secundario botao-pequeno" href="/usuarios?usuario=${encodeURIComponent(transacao.usuario.id)}">${html([icone("usuario")])}Abrir cadastro</a>` : ""}
    </div>
  </section>
  <section class="gaveta-secao">
    <h3 class="gaveta-secao-titulo">Linha do tempo</h3>
    ${linhaDoTempo(transacao)}
  </section>
  <section class="gaveta-secao">
    <h3 class="gaveta-secao-titulo">Detalhes</h3>
    <dl class="lista-definicao">
      <dt>Código</dt><dd><code>${transacao.codigo}</code></dd>
      <dt>Plano</dt><dd>${transacao.plano?.nome ?? "—"}</dd>
      <dt>Tipo</dt><dd>${traduzir(rotulos.tipoTransacao, transacao.tipo)}</dd>
      <dt>Método</dt><dd>${celulaMetodo(transacao.metodo)}</dd>
      <dt>Moeda</dt><dd>${transacao.moeda}</dd>
      <dt>Assinatura</dt><dd>${transacao.assinatura ? `${transacao.assinatura.plano?.nome ?? "Plano"}, ${traduzir(rotulos.ciclo, transacao.assinatura.ciclo).toLowerCase()} (${traduzir(rotulos.assinatura, transacao.assinatura.status).toLowerCase()})` : "—"}</dd>
    </dl>
  </section>
`;

const abrirDetalhe = async (id: string): Promise<void> => {
  const gaveta = new Gaveta({ titulo: "Transação", subtitulo: "Carregando detalhes…", aoFechar: () => atualizarUrl({ transacao: null }) }).abrir();
  atualizarUrl({ transacao: id });

  const preencher = (transacao: DetalheTransacao): void => {
    gaveta.definirTitulo(transacao.codigo, dataHora(transacao.criadoEm));
    gaveta.definirCorpo(corpoDetalhe(transacao));
    gaveta.definirRodape(
      podeReembolsar(transacao)
        ? html`<p class="gaveta-rodape-esquerda text-xs texto-suave">O motivo fica registrado na auditoria.</p><button type="button" class="botao botao-perigo-suave" data-reembolsar><i data-icone="desfazer"></i>Reembolsar</button>`
        : "",
    );
    gaveta.rodape.querySelector<HTMLButtonElement>("[data-reembolsar]")?.addEventListener("click", async (evento) => {
      const botao = evento.currentTarget as HTMLButtonElement;
      carregando(botao, true);
      const atualizada = await reembolsar(transacao);
      carregando(botao, false);
      if (atualizada) preencher(atualizada);
    });
  };

  try {
    preencher(await api.obter<DetalheTransacao>(`/transacoes/${id}`));
  } catch (erro) {
    gaveta.definirTitulo("Transação", "");
    gaveta.definirCorpo(html`<div class="vazio vazio-erro"><span class="vazio-icone">${html([icone("alerta")])}</span><p class="vazio-titulo">Não foi possível abrir a transação</p><p class="vazio-texto">${mensagemDeErro(erro)}</p></div>`);
  }
};

const exportar = async (botao: HTMLButtonElement): Promise<void> => {
  carregando(botao, true);
  try {
    await api.baixar("/transacoes/exportar", { formato: "csv", ...filtrosAtuais() }, "bento-transacoes.csv");
    avisoSucesso("Exportação pronta", "O arquivo CSV foi baixado com os filtros atuais.");
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível exportar", texto: mensagemDeErro(erro) });
  } finally {
    carregando(botao, false);
  }
};

const lerFiltrosDaUrl = (url: Record<string, string>): Record<string, ValorFiltro> => {
  const filtros: Record<string, ValorFiltro> = {};
  for (const nome of ["status", "metodo", "tipo"] as const) {
    if (url[nome] && VALIDOS[nome].has(url[nome])) filtros[nome] = url[nome];
  }
  for (const nome of ["inicio", "fim"] as const) {
    if (url[nome] && DIA.test(url[nome])) filtros[nome] = url[nome];
  }
  return filtros;
};

const marcarStatus = (status: string): void => {
  $$("[data-status-filtro] [data-status]").forEach((botao) => botao.setAttribute("aria-pressed", String((botao.dataset.status ?? "") === status)));
};

const ajustarLimitesDatas = (): void => {
  const inicio = exigir<HTMLInputElement>('[data-filtro-data="inicio"]');
  const fim = exigir<HTMLInputElement>('[data-filtro-data="fim"]');
  fim.min = inicio.value;
  inicio.max = fim.value;
};

iniciarPagina({
  pagina: "transacoes",
  permissao: "transacoes.ver",
  aoIniciar: async () => {
    const url = parametrosUrl();
    const filtros = lerFiltrosDaUrl(url);
    const ordenar = url.ordenar && ORDENAVEIS.has(url.ordenar) ? url.ordenar : "criadoEm";
    const direcao: Direcao = url.direcao === "asc" ? "asc" : "desc";

    tabelaAtual = new TabelaDados<Transacao, RespostaTransacoes>(exigir<HTMLElement>("[data-tabela]"), {
      colunas: COLUNAS,
      legenda: "Lista de transações",
      ordenacao: { campo: ordenar, direcao },
      filtros,
      porPagina: POR_PAGINA.has(Number(url.porPagina)) ? Number(url.porPagina) : 10,
      buscar: (parametros: ParametrosTabela, sinal: AbortSignal) => api.obter<RespostaTransacoes>("/transacoes", parametros, { sinal }),
      aoClicarLinha: (transacao: Transacao) => abrirDetalhe(transacao.id),
      acoesLinha: acoesDaTransacao,
      vazio: { icone: "recibo", titulo: "Nenhuma transação encontrada", texto: "Ajuste a busca, o período ou os filtros para ver mais resultados." },
      aoCarregar: (resposta: RespostaTransacoes) => {
        atualizarResumo(resposta);
        sincronizarUrl();
      },
    });

    const busca = exigir<HTMLInputElement>("[data-busca]");
    if (url.q) {
      const texto = url.q.slice(0, 120);
      busca.value = texto;
      tabela().estado.q = texto.trim();
    }
    const pagina = Number(url.pagina);
    if (Number.isInteger(pagina) && pagina > 1) tabela().estado.pagina = pagina;

    marcarStatus(String(filtros.status ?? ""));
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
    exigir("[data-status-filtro]").addEventListener("click", (evento) => {
      const botao = (evento.target as Element | null)?.closest<HTMLElement>("[data-status]");
      if (!botao) return;
      const status = botao.dataset.status ?? "";
      marcarStatus(status);
      tabela().definirFiltro("status", status);
    });

    exigir('[data-acao="limpar"]').addEventListener("click", () => {
      busca.value = "";
      tabela().estado.q = "";
      for (const nome of FILTROS) delete tabela().estado.filtros[nome];
      marcarStatus("");
      $$<HTMLSelectElement>("[data-filtro]").forEach((selecao) => (selecao.value = ""));
      $$<HTMLInputElement>("[data-filtro-data]").forEach((entrada) => (entrada.value = ""));
      ajustarLimitesDatas();
      void tabela().recarregar({ voltarInicio: true });
    });
    exigir<HTMLButtonElement>('[data-acao="exportar"]').addEventListener("click", (evento) => exportar(evento.currentTarget as HTMLButtonElement));

    const atualizarAoVivo = atrasar(() => void recarregar(), 800);
    ouvir<Transacao | null>("tempo-real:transacao", (transacao) => {
      if (!transacao) return;
      const lista = tabela();
      const naTela = lista.itens.some((item) => item.id === transacao.id);
      const visaoPadrao = !Object.keys(filtrosAtuais()).length && lista.estado.ordenar === "criadoEm" && lista.estado.direcao === "desc" && lista.estado.pagina === 1;
      if (naTela || visaoPadrao) atualizarAoVivo();
    });

    await tabela().recarregar();
    if (url.transacao && UUID.test(url.transacao)) abrirDetalhe(url.transacao);
    else if (url.transacao) atualizarUrl({ transacao: null });
  },
});

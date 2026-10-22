import { iniciarPagina } from "../layout/inicio.ts";
import { html, $, $$, exigir, renderizar, parametrosUrl, carregando } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { api, mensagemDeErro, ErroApi } from "../nucleo/api.ts";
import { pode } from "../nucleo/sessao.ts";
import { moeda, numero, percentual, dataCurta, dataHora, relativo, bytes, dataIso, somarDias, rotulos } from "../nucleo/formato.ts";
import { TabelaDados, botaoAcoesLinha } from "../componentes/tabela.ts";
import { Gaveta } from "../componentes/gaveta.ts";
import { confirmar } from "../componentes/modal.ts";
import { avisar, avisoSucesso } from "../componentes/aviso.ts";
import { lerFormulario, mostrarErros } from "../componentes/formulario.ts";
import type { Agendamento, FormatoValor, Pagina, Relatorio, TipoRelatorio } from "../nucleo/tipos.ts";

interface ColunaRelatorio {
  campo: string;
  titulo: string;
  formato: FormatoValor;
}

interface TipoInfo {
  tipo: TipoRelatorio;
  nome: string;
  descricao: string;
  colunas: ColunaRelatorio[];
}

type ValorCelula = string | number | null | undefined;

interface ItemResumo {
  rotulo: string;
  valor: ValorCelula;
  formato: FormatoValor;
}

interface Previa {
  colunas: ColunaRelatorio[];
  linhas: Record<string, ValorCelula>[];
  total: number;
  resumo: ItemResumo[];
}

interface Recarregavel {
  recarregar: (opcoes?: { voltarInicio?: boolean; silencioso?: boolean }) => unknown;
}

interface EstadoPagina {
  tipos: TipoInfo[];
  historico: Recarregavel | null;
  controladorPrevia: AbortController | null;
}

const ICONES_TIPO: Record<string, string> = { receita: "carteira", transacoes: "recibo", usuarios: "usuarios", assinaturas: "repetir", crescimento: "tendencia-alta" };

const estado: EstadoPagina = { tipos: [], historico: null, controladorPrevia: null };

const construtor = (): HTMLFormElement => exigir<HTMLFormElement>("[data-construtor]");

const campoData = (formulario: HTMLFormElement, nome: "inicio" | "fim"): HTMLInputElement => formulario.elements.namedItem(nome) as HTMLInputElement;

const alvoDoEvento = (evento: Event): Element => evento.target as Element;

const formatarCelula = (valor: ValorCelula, formato: FormatoValor): string => {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (formato === "moeda") return moeda(valor);
  if (formato === "numero") return numero(valor);
  if (formato === "percentual") return percentual(valor);
  if (formato === "data") return dataCurta(valor);
  return String(valor);
};

const tipoAtual = (): string | undefined => (construtor().elements.namedItem("tipo") as RadioNodeList | HTMLInputElement | null)?.value ?? estado.tipos[0]?.tipo;

const renderizarTipos = (selecionado: string | undefined): void => {
  renderizar(
    $("[data-tipos]"),
    html`${estado.tipos.map(
      (tipo) => html`<label class="tipo-relatorio">
        <input type="radio" name="tipo" value="${tipo.tipo}" ${tipo.tipo === selecionado ? "checked" : ""}>
        <span class="tipo-relatorio-icone">${html([icone(ICONES_TIPO[tipo.tipo] ?? "arquivo")])}</span>
        <span class="tipo-relatorio-textos"><span class="tipo-relatorio-nome">${tipo.nome}</span><span class="tipo-relatorio-descricao">${tipo.descricao}</span></span>
      </label>`,
    )}`,
  );
};

const carregarPrevia = async (): Promise<void> => {
  const formulario = construtor();
  const inicio = campoData(formulario, "inicio");
  const fim = campoData(formulario, "fim");
  if (!inicio.value || !fim.value || inicio.value > fim.value) return;
  estado.controladorPrevia?.abort();
  const controlador = new AbortController();
  estado.controladorPrevia = controlador;
  const alvo = exigir("[data-previa]");
  alvo.dataset.carregando = "true";
  try {
    const previa = await api.obter<Previa>("/relatorios/previa", { tipo: tipoAtual(), inicio: inicio.value, fim: fim.value }, { sinal: controlador.signal });
    const tipo = estado.tipos.find((item) => item.tipo === tipoAtual());
    exigir("[data-previa-subtitulo]").textContent = `${tipo?.nome ?? "Relatório"}: ${numero(previa.total)} ${previa.total === 1 ? "linha" : "linhas"} entre ${dataCurta(`${inicio.value}T12:00:00`)} e ${dataCurta(`${fim.value}T12:00:00`)}`;
    renderizar(
      $("[data-previa-resumo]"),
      html`${previa.resumo.map((item) => html`<div><dt>${item.rotulo}</dt><dd>${formatarCelula(item.valor, item.formato)}</dd></div>`)}`,
    );
    if (!previa.linhas.length) {
      renderizar(alvo, html`<div class="vazio vazio-compacto"><span class="vazio-icone">${html([icone("caixa")])}</span><p class="vazio-titulo">Nada no período</p><p class="vazio-texto">Escolha outro intervalo de datas.</p></div>`);
      return;
    }
    renderizar(
      alvo,
      html`<table class="tabela tabela-previa">
        <thead><tr>${previa.colunas.map((coluna) => html`<th scope="col" class="${["moeda", "numero", "percentual"].includes(coluna.formato) ? "celula-numero" : ""}">${coluna.titulo}</th>`)}</tr></thead>
        <tbody>${previa.linhas.map(
          (linha) => html`<tr>${previa.colunas.map(
            (coluna) => html`<td class="${["moeda", "numero", "percentual"].includes(coluna.formato) ? "celula-numero" : ""}">${formatarCelula(linha[coluna.campo], coluna.formato)}</td>`,
          )}</tr>`,
        )}</tbody>
      </table>`,
    );
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === "AbortError") return;
    renderizar(alvo, html`<div class="vazio vazio-compacto vazio-erro"><span class="vazio-icone">${html([icone("alerta")])}</span><p class="vazio-texto">${mensagemDeErro(erro)}</p></div>`);
  } finally {
    delete alvo.dataset.carregando;
  }
};

const previaAtrasada = (() => {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  return (): void => {
    clearTimeout(temporizador);
    temporizador = setTimeout(carregarPrevia, 350);
  };
})();

const marcarDias = (): void => {
  const formulario = construtor();
  const inicio = campoData(formulario, "inicio");
  const fim = campoData(formulario, "fim");
  const dias = Math.round((new Date(fim.value).getTime() - new Date(inicio.value).getTime()) / 86400000) + 1;
  const hoje = dataIso(new Date());
  $$("[data-dias]").forEach((botao) => botao.setAttribute("aria-pressed", String(fim.value === hoje && Number(botao.dataset.dias) === dias)));
};

const gerar = async (evento: SubmitEvent): Promise<void> => {
  evento.preventDefault();
  const formulario = evento.currentTarget as HTMLFormElement;
  if (!formulario.reportValidity()) return;
  const dados = lerFormulario(formulario) as Record<string, string>;
  if (dados.inicio > dados.fim) {
    mostrarErros(formulario, { fim: "A data final precisa ser depois da inicial." });
    return;
  }
  if (!dados.nome) delete dados.nome;
  const botao = $<HTMLButtonElement>("[data-gerar]");
  carregando(botao, true);
  try {
    const relatorio = await api.criar<Relatorio>("/relatorios", dados);
    await api.baixar(`/relatorios/${relatorio.id}/baixar`, null, `bento-${relatorio.tipo}.${relatorio.formato}`);
    avisoSucesso("Relatório gerado", `${relatorio.nome}: ${numero(relatorio.linhas)} linhas, ${bytes(relatorio.tamanhoBytes)}.`);
    estado.historico?.recarregar({ voltarInicio: true });
  } catch (erro) {
    if (erro instanceof ErroApi && erro.codigo === "VALIDACAO" && mostrarErros(formulario, erro.detalhes)) return;
    avisar({ tipo: "erro", titulo: "Não foi possível gerar o relatório", texto: mensagemDeErro(erro) });
  } finally {
    carregando(botao, false);
  }
};

const nomeDoTipo = (tipo: string): string => estado.tipos.find((item) => item.tipo === tipo)?.nome ?? tipo;

const montarHistorico = (): unknown => {
  const historico = new TabelaDados(exigir<HTMLElement>("[data-historico]"), {
    colunas: [
      {
        campo: "nome",
        titulo: "Relatório",
        render: (relatorio: Relatorio) => html`<div class="flex min-w-0 items-center gap-3"><span class="formato-arquivo" data-formato="${relatorio.formato}">${relatorio.formato}</span><div class="celula-usuario-texto"><span class="celula-usuario-nome">${relatorio.nome}</span><span class="celula-usuario-email">${nomeDoTipo(relatorio.tipo)}, ${dataCurta(relatorio.inicio)} a ${dataCurta(relatorio.fim)}</span></div></div>`,
      },
      { campo: "linhas", titulo: "Linhas", classe: "celula-numero", render: (relatorio: Relatorio) => numero(relatorio.linhas) },
      { campo: "tamanhoBytes", titulo: "Tamanho", classe: "celula-numero", render: (relatorio: Relatorio) => bytes(relatorio.tamanhoBytes) },
      { campo: "criadoPor", titulo: "Gerado por", classe: "celula-secundaria", render: (relatorio: Relatorio) => relatorio.criadoPor?.nome ?? "Agendamento" },
      { campo: "criadoEm", titulo: "Quando", classe: "celula-data", render: (relatorio: Relatorio) => html`<time datetime="${relatorio.criadoEm}" title="${dataHora(relatorio.criadoEm)}">${relativo(relatorio.criadoEm)}</time>` },
      { campo: "acoes", titulo: "Ações", oculto: true, classe: "celula-acoes", render: (relatorio: Relatorio) => botaoAcoesLinha(relatorio.id, `Ações para ${relatorio.nome}`) },
    ],
    legenda: "Relatórios gerados",
    porPagina: 10,
    buscar: (parametros: { pagina: number; porPagina: number }, sinal: AbortSignal) => api.obter<Pagina<Relatorio>>("/relatorios", { pagina: parametros.pagina, porPagina: parametros.porPagina }, { sinal }),
    acoesLinha: (relatorio: Relatorio) => [
      relatorio.status === "pronto" && { rotulo: "Baixar", icone: "baixar", executar: () => api.baixar(`/relatorios/${relatorio.id}/baixar`, null, `bento-${relatorio.tipo}.${relatorio.formato}`).catch((erro: unknown) => avisar({ tipo: "erro", titulo: "Não foi possível baixar", texto: mensagemDeErro(erro) })) },
      pode("relatorios.gerar") && {
        rotulo: "Excluir",
        icone: "lixeira",
        perigo: true,
        executar: async () => {
          const ok = await confirmar({ titulo: `Excluir “${relatorio.nome}”?`, texto: "O arquivo deixa de ficar disponível para download.", tipo: "perigo", confirmar: "Excluir" });
          if (!ok) return;
          try {
            await api.excluir(`/relatorios/${relatorio.id}`);
            historico.recarregar({ silencioso: true });
          } catch (erro) {
            avisar({ tipo: "erro", titulo: "Não foi possível excluir", texto: mensagemDeErro(erro) });
          }
        },
      },
    ],
    vazio: { icone: "arquivo", titulo: "Nenhum relatório ainda", texto: "Os relatórios que você gerar aparecem aqui." },
  });
  estado.historico = historico;
  return historico.recarregar();
};

const carregarAgendamentos = async (): Promise<void> => {
  const alvo = exigir("[data-agendamentos]");
  try {
    const agendamentos = await api.obter<Agendamento[]>("/relatorios/agendados");
    if (!agendamentos.length) {
      renderizar(alvo, html`<div class="vazio vazio-compacto"><span class="vazio-icone">${html([icone("agendamento")])}</span><p class="vazio-titulo">Nenhum envio agendado</p><p class="vazio-texto">Agende um relatório para ser gerado todo dia, semana ou mês.</p></div>`);
      return;
    }
    renderizar(
      alvo,
      html`${agendamentos.map(
        (agendamento) => html`<div class="agendamento" data-agendamento="${agendamento.id}">
          <span class="agendamento-icone">${html([icone("agendamento")])}</span>
          <div class="agendamento-textos">
            <span class="agendamento-nome">${agendamento.nome}</span>
            <span class="agendamento-detalhe">${rotulos.frequencia[agendamento.frequencia]}, ${(rotulos.periodo[agendamento.periodo] ?? agendamento.periodo).toLowerCase()}, ${agendamento.formato.toUpperCase()}</span>
            <span class="agendamento-detalhe">${agendamento.ativo ? `Próximo: ${dataHora(agendamento.proximaExecucao)}` : "Pausado"}</span>
          </div>
          ${pode("relatorios.agendar")
            ? html`<label class="interruptor interruptor-pequeno" title="${agendamento.ativo ? "Pausar" : "Retomar"}"><input type="checkbox" data-alternar-agendamento="${agendamento.id}" ${agendamento.ativo ? "checked" : ""} aria-label="Agendamento ativo"><span class="interruptor-trilho"></span></label>
              <button type="button" class="botao botao-fantasma botao-icone botao-pequeno" data-excluir-agendamento="${agendamento.id}" aria-label="Excluir agendamento">${html([icone("lixeira")])}</button>`
            : ""}
        </div>`,
      )}`,
    );
  } catch (erro) {
    renderizar(alvo, html`<p class="text-sm texto-suave">${mensagemDeErro(erro)}</p>`);
  }
};

const abrirAgendamento = (): void => {
  const gaveta = new Gaveta({ titulo: "Agendar envio", subtitulo: "O relatório é gerado sozinho e você recebe uma notificação." }).abrir();
  gaveta.definirCorpo(html`
    <form class="formulario" id="form-agendamento" novalidate>
      <label class="campo">
        <span class="campo-rotulo campo-obrigatorio">Nome</span>
        <input class="entrada" name="nome" required maxlength="120" placeholder="Ex.: Receita semanal da diretoria">
      </label>
      <label class="campo">
        <span class="campo-rotulo">Dados</span>
        <select class="selecao" name="tipo">${estado.tipos.map((tipo) => html`<option value="${tipo.tipo}" ${tipo.tipo === tipoAtual() ? "selected" : ""}>${tipo.nome}</option>`)}</select>
      </label>
      <div class="grade-campos">
        <label class="campo">
          <span class="campo-rotulo">Frequência</span>
          <select class="selecao" name="frequencia"><option value="diaria">Todo dia</option><option value="semanal" selected>Toda semana</option><option value="mensal">Todo mês</option></select>
        </label>
        <label class="campo">
          <span class="campo-rotulo">Período coberto</span>
          <select class="selecao" name="periodo"><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="mes-anterior">Mês anterior</option></select>
        </label>
      </div>
      <fieldset class="campo">
        <legend class="campo-rotulo mb-1.5">Formato</legend>
        <div class="segmentado">
          <label><input type="radio" name="formato" value="pdf" checked><span>PDF</span></label>
          <label><input type="radio" name="formato" value="csv"><span>CSV</span></label>
        </div>
      </fieldset>
    </form>
  `);
  gaveta.definirRodape(html`<button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button><button type="submit" form="form-agendamento" class="botao botao-primario" data-salvar><i data-icone="agendamento"></i>Agendar</button>`);
  exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
  const formulario = exigir<HTMLFormElement>("#form-agendamento");
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (!formulario.reportValidity()) return;
    const botao = gaveta.rodape.querySelector<HTMLButtonElement>("[data-salvar]");
    carregando(botao, true);
    try {
      await api.criar("/relatorios/agendados", lerFormulario(formulario));
      gaveta.fechar();
      avisoSucesso("Envio agendado", "Você recebe uma notificação a cada relatório gerado.");
      carregarAgendamentos();
    } catch (erro) {
      if (erro instanceof ErroApi && erro.codigo === "VALIDACAO" && mostrarErros(formulario, erro.detalhes)) return;
      avisar({ tipo: "erro", titulo: "Não foi possível agendar", texto: mensagemDeErro(erro) });
    } finally {
      carregando(botao, false);
    }
  });
};

iniciarPagina({
  pagina: "relatorios",
  permissao: "relatorios.ver",
  aoIniciar: async () => {
    $$("[data-permissao]").forEach((elemento) => {
      if (!pode(elemento.dataset.permissao)) elemento.remove();
    });
    const formulario = construtor();
    const parametros = parametrosUrl();
    const hoje = new Date();
    campoData(formulario, "inicio").value = parametros.inicio || dataIso(somarDias(hoje, -29));
    campoData(formulario, "fim").value = parametros.fim || dataIso(hoje);
    campoData(formulario, "fim").max = dataIso(hoje);
    marcarDias();

    estado.tipos = await api.obter<TipoInfo[]>("/relatorios/tipos");
    renderizarTipos(estado.tipos.some((tipo) => tipo.tipo === parametros.tipo) ? parametros.tipo : estado.tipos[0]?.tipo);
    hidratarIcones(formulario);

    formulario.addEventListener("change", () => {
      marcarDias();
      previaAtrasada();
    });
    formulario.addEventListener("submit", gerar);
    exigir(".predefinicoes", formulario).addEventListener("click", (evento) => {
      const botao = alvoDoEvento(evento).closest<HTMLElement>("[data-dias]");
      if (!botao) return;
      campoData(formulario, "fim").value = dataIso(new Date());
      campoData(formulario, "inicio").value = dataIso(somarDias(new Date(), -(Number(botao.dataset.dias) - 1)));
      marcarDias();
      carregarPrevia();
    });

    document.addEventListener("click", (evento) => {
      const botao = alvoDoEvento(evento).closest<HTMLElement>("[data-acao]");
      if (!botao || !$("#conteudo")?.contains(botao)) return;
      if (botao.dataset.acao === "previa") carregarPrevia();
      else if (botao.dataset.acao === "agendar") abrirAgendamento();
    });

    exigir("[data-agendamentos]").addEventListener("change", async (evento) => {
      const alternador = alvoDoEvento(evento).closest<HTMLInputElement>("[data-alternar-agendamento]");
      if (!alternador) return;
      try {
        await api.atualizar(`/relatorios/agendados/${alternador.dataset.alternarAgendamento}`, { ativo: alternador.checked });
        carregarAgendamentos();
      } catch (erro) {
        alternador.checked = !alternador.checked;
        avisar({ tipo: "erro", titulo: "Não foi possível alterar", texto: mensagemDeErro(erro) });
      }
    });
    exigir("[data-agendamentos]").addEventListener("click", async (evento) => {
      const botao = alvoDoEvento(evento).closest<HTMLElement>("[data-excluir-agendamento]");
      if (!botao) return;
      const ok = await confirmar({ titulo: "Excluir agendamento?", texto: "Os relatórios já gerados continuam no histórico.", tipo: "perigo", confirmar: "Excluir" });
      if (!ok) return;
      try {
        await api.excluir(`/relatorios/agendados/${botao.dataset.excluirAgendamento}`);
        carregarAgendamentos();
      } catch (erro) {
        avisar({ tipo: "erro", titulo: "Não foi possível excluir", texto: mensagemDeErro(erro) });
      }
    });

    await Promise.all([carregarPrevia(), montarHistorico(), carregarAgendamentos()]);
  },
});

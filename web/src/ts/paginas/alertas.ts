import { iniciarPagina } from "../layout/inicio.ts";
import { html, $, $$, exigir, renderizar, parametrosUrl, atualizarUrl, carregando, atrasar, type Seguro } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { api, mensagemDeErro, ErroApi } from "../nucleo/api.ts";
import { pode } from "../nucleo/sessao.ts";
import { ouvir } from "../nucleo/eventos.ts";
import { moeda, numero, percentual, relativo, dataHora, plural } from "../nucleo/formato.ts";
import { Gaveta } from "../componentes/gaveta.ts";
import { confirmar } from "../componentes/modal.ts";
import { avisar, avisoSucesso } from "../componentes/aviso.ts";
import { limparErros, mostrarErros } from "../componentes/formulario.ts";
import { abrirMenuAcoes } from "../componentes/menu-suspenso.ts";
import type { Pagina } from "../nucleo/tipos.ts";

type Unidade = "moeda" | "numero" | "percentual";
type Modo = "valor" | "variacao";
type Operador = "maior" | "menor";
type Severidade = "info" | "alerta" | "erro";

interface Metrica {
  codigo: string;
  nome: string;
  unidade: Unidade;
  descricao: string;
}

interface Catalogo {
  metricas: Metrica[];
  janelas: { codigo: string; nome: string }[];
  minutosEntreAvaliacoes: number;
  limite: number;
}

interface Alerta {
  id: string;
  nome: string;
  metrica: string;
  janela: string;
  modo: Modo;
  operador: Operador;
  limite: number;
  severidade: Severidade;
  notificarIntegracoes: boolean;
  silencioMinutos: number;
  ativo: boolean;
  estado: "normal" | "disparado";
  ultimoValor: number | null;
  ultimaAvaliacao: string | null;
  ultimoDisparo: string | null;
  descricao: string;
  criadoPor: { id: string; nome: string } | null;
  disparos7d: number;
}

interface ListaAlertas {
  itens: Alerta[];
  resumo: { total: number; ativos: number; disparados: number; disparos7d: number };
  limite: number;
}

interface Disparo {
  id: string;
  alerta: { id: string; nome: string; metrica: string; severidade: Severidade };
  valor: number;
  limite: number;
  mensagem: string;
  criadoEm: string;
  resolvidoEm: string | null;
}

interface Simulacao {
  atual: number;
  anterior: number;
  variacao: number | null;
  valor: number | null;
  dispararia: boolean;
  descricao: string;
  valorFormatado: string;
}

type Rascunho = Pick<Alerta, "nome" | "metrica" | "janela" | "modo" | "operador" | "limite" | "severidade" | "notificarIntegracoes" | "silencioMinutos" | "ativo">;

interface Modelo {
  id: string;
  titulo: string;
  texto: string;
  icone: string;
  rascunho: Rascunho;
}

const ROTULOS_SEVERIDADE: Record<Severidade, string> = { info: "Informativo", alerta: "Atenção", erro: "Crítico" };
const CLASSE_SEVERIDADE: Record<Severidade, string> = { info: "emblema-anil", alerta: "emblema-ouro", erro: "emblema-brasa" };
const TOM_SEVERIDADE: Record<Severidade, string> = { info: "anil", alerta: "ouro", erro: "brasa" };
const SILENCIOS = [
  { valor: 15, rotulo: "15 minutos" },
  { valor: 60, rotulo: "1 hora" },
  { valor: 240, rotulo: "4 horas" },
  { valor: 1440, rotulo: "1 dia" },
  { valor: 10080, rotulo: "7 dias" },
];

const MODELOS: Modelo[] = [
  {
    id: "falhas",
    titulo: "Pagamentos falhando",
    texto: "Taxa de falha acima de 8% nas últimas 24 horas",
    icone: "cartao",
    rascunho: { nome: "Pagamentos falhando", metrica: "taxa_falha", janela: "24h", modo: "valor", operador: "maior", limite: 8, severidade: "erro", notificarIntegracoes: true, silencioMinutos: 240, ativo: true },
  },
  {
    id: "receita-semana",
    titulo: "Receita da semana em queda",
    texto: "Receita dos últimos 7 dias cai mais de 15%",
    icone: "tendencia-baixa",
    rascunho: { nome: "Receita da semana em queda", metrica: "receita", janela: "7d", modo: "variacao", operador: "menor", limite: 15, severidade: "alerta", notificarIntegracoes: false, silencioMinutos: 1440, ativo: true },
  },
  {
    id: "reembolsos",
    titulo: "Reembolsos acima do normal",
    texto: "Mais de R$ 2.000 devolvidos em 24 horas",
    icone: "desfazer",
    rascunho: { nome: "Reembolsos acima do normal", metrica: "reembolsos", janela: "24h", modo: "valor", operador: "maior", limite: 200_000, severidade: "alerta", notificarIntegracoes: false, silencioMinutos: 1440, ativo: true },
  },
  {
    id: "cancelamentos",
    titulo: "Onda de cancelamentos",
    texto: "Mais de 5 assinaturas canceladas em 7 dias",
    icone: "usuario-x",
    rascunho: { nome: "Onda de cancelamentos", metrica: "cancelamentos", janela: "7d", modo: "valor", operador: "maior", limite: 5, severidade: "alerta", notificarIntegracoes: false, silencioMinutos: 1440, ativo: true },
  },
  {
    id: "cadastros",
    titulo: "Cadastros desacelerando",
    texto: "Novos usuários caem mais de 30% na semana",
    icone: "usuario-novo",
    rascunho: { nome: "Cadastros desacelerando", metrica: "novos_usuarios", janela: "7d", modo: "variacao", operador: "menor", limite: 30, severidade: "info", notificarIntegracoes: false, silencioMinutos: 1440, ativo: true },
  },
];

const estado: {
  catalogo: Catalogo | null;
  lista: ListaAlertas | null;
  filtro: string;
  filtroDisparos: string | null;
  paginaDisparos: number;
} = { catalogo: null, lista: null, filtro: "", filtroDisparos: null, paginaDisparos: 1 };

const metricaPorCodigo = (codigo: string): Metrica | undefined => estado.catalogo?.metricas.find((metrica) => metrica.codigo === codigo);

const formatarValor = (valor: number | null, unidade: Unidade, modo: Modo): string => {
  if (valor === null) return "sem base";
  if (modo === "variacao") return `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${percentual(Math.abs(valor))}`;
  if (unidade === "moeda") return moeda(valor);
  if (unidade === "percentual") return percentual(valor);
  return numero(valor, { casas: Number.isInteger(valor) ? 0 : 1 });
};

const textoSilencio = (minutos: number): string => SILENCIOS.find((item) => item.valor === minutos)?.rotulo ?? `${numero(minutos)} minutos`;

const emblemaEstado = (alerta: Alerta): Seguro =>
  !alerta.ativo
    ? html`<span class="emblema emblema-neutro emblema-pequeno">Pausado</span>`
    : alerta.estado === "disparado"
      ? html`<span class="emblema emblema-brasa emblema-pequeno">Disparado</span>`
      : html`<span class="emblema emblema-oliva emblema-pequeno">Normal</span>`;

const itemAlerta = (alerta: Alerta): Seguro => {
  const metrica = metricaPorCodigo(alerta.metrica);
  const podeGerenciar = pode("alertas.gerenciar");
  return html`
    <article class="alerta-regra" data-id="${alerta.id}" data-estado="${alerta.ativo ? alerta.estado : "pausado"}" tabindex="-1">
      <span class="alerta-regra-icone" data-tom="${alerta.ativo && alerta.estado === "disparado" ? TOM_SEVERIDADE[alerta.severidade] : "neutro"}">${html([icone(alerta.estado === "disparado" && alerta.ativo ? "sirene" : alerta.ativo ? "radar" : "pausa")])}</span>
      <div class="alerta-regra-textos">
        <p class="alerta-regra-titulo">${alerta.nome}${emblemaEstado(alerta)}<span class="emblema emblema-pequeno ${CLASSE_SEVERIDADE[alerta.severidade]}">${ROTULOS_SEVERIDADE[alerta.severidade]}</span>${alerta.notificarIntegracoes ? html`<span class="emblema emblema-contorno emblema-pequeno" title="Também avisa no Slack, Discord ou webhook ativos">${html([icone("integracao")])}Integrações</span>` : ""}</p>
        <p class="alerta-regra-descricao">${alerta.descricao}</p>
        <p class="alerta-regra-meta">
          <span>Agora: <strong>${alerta.ultimaAvaliacao || alerta.ultimoValor !== null ? formatarValor(alerta.ultimoValor, metrica?.unidade ?? "numero", alerta.modo) : "aguardando a primeira medição"}</strong></span>
          ${alerta.ultimaAvaliacao ? html`<span>medido ${relativo(alerta.ultimaAvaliacao)}</span>` : ""}
          <span>${alerta.disparos7d ? plural(alerta.disparos7d, "disparo") + " em 7 dias" : "nenhum disparo em 7 dias"}</span>
          <span>silêncio de ${textoSilencio(alerta.silencioMinutos)}</span>
        </p>
      </div>
      <div class="alerta-regra-acoes">
        <button type="button" class="botao botao-fantasma botao-pequeno" data-acao-alerta="historico" aria-label="Ver os disparos de ${alerta.nome}" title="Ver disparos">${html([icone("historico")])}</button>
        ${podeGerenciar
          ? html`<button type="button" class="botao botao-fantasma botao-pequeno" data-acao-alerta="avaliar" ${alerta.ativo ? "" : "disabled"} title="Medir agora">${html([icone("testar")])}<span class="hidden sm:inline">Testar</span></button>
              <button type="button" class="botao botao-fantasma botao-pequeno" data-acao-alerta="${alerta.ativo ? "pausar" : "retomar"}" title="${alerta.ativo ? "Pausar" : "Retomar"}">${html([icone(alerta.ativo ? "pausa" : "retomar")])}<span class="hidden sm:inline">${alerta.ativo ? "Pausar" : "Retomar"}</span></button>
              <button type="button" class="botao botao-fantasma botao-pequeno botao-icone" data-acao-alerta="mais" aria-label="Mais ações para ${alerta.nome}" aria-haspopup="menu">${html([icone("mais-vertical")])}</button>`
          : ""}
      </div>
    </article>
  `;
};

const vazioComModelos = (): Seguro => html`
  <div class="alertas-vazio">
    <div class="vazio vazio-compacto">
      <span class="vazio-icone">${html([icone("radar")])}</span>
      <p class="vazio-titulo">Nenhuma regra ainda</p>
      <p class="vazio-texto">${pode("alertas.gerenciar") ? "Comece por um modelo e ajuste os números depois." : "Peça a quem gerencia alertas para criar a primeira regra."}</p>
    </div>
    ${pode("alertas.gerenciar")
      ? html`<div class="alertas-modelos">${MODELOS.map(
          (modelo) => html`<button type="button" class="alertas-modelo" data-modelo="${modelo.id}">
            <span class="alertas-modelo-icone">${html([icone(modelo.icone)])}</span>
            <span class="alertas-modelo-textos"><strong>${modelo.titulo}</strong><span>${modelo.texto}</span></span>
            ${html([icone("adicionar", "alertas-modelo-mais")])}
          </button>`,
        )}</div>`
      : ""}
  </div>
`;

const renderizarResumo = (lista: ListaAlertas): void => {
  const definir = (chave: string, valor: string, rodape: string): void => {
    const cartao = exigir(`[data-resumo="${chave}"]`);
    exigir("[data-kpi-valor]", cartao).textContent = valor;
    exigir("[data-kpi-comparacao]", cartao).textContent = rodape;
  };
  definir("ativos", numero(lista.resumo.ativos), `${plural(lista.resumo.total, "regra")} de até ${numero(lista.limite)}`);
  definir("disparados", numero(lista.resumo.disparados), lista.resumo.disparados ? "Precisam de atenção agora" : "Tudo dentro do esperado");
  definir("disparos7d", numero(lista.resumo.disparos7d), "Somando todas as regras");
  exigir('[data-resumo="disparados"]').dataset.destaque = String(lista.resumo.disparados > 0);
  if (estado.catalogo) exigir('[data-resumo="frequencia"] [data-kpi-valor]').textContent = `${estado.catalogo.minutosEntreAvaliacoes} min`;
};

const renderizarRegras = (): void => {
  const alvo = exigir("[data-regras]");
  const lista = estado.lista;
  if (!lista) return;
  if (!lista.itens.length) {
    renderizar(alvo, vazioComModelos());
    hidratarIcones(alvo);
    return;
  }
  const termo = estado.filtro.trim().toLowerCase();
  const itens = termo
    ? lista.itens.filter((alerta) => `${alerta.nome} ${alerta.descricao}`.toLowerCase().includes(termo))
    : lista.itens;
  renderizar(
    alvo,
    itens.length
      ? html`${itens.map(itemAlerta)}`
      : html`<div class="vazio vazio-compacto p-6"><span class="vazio-icone">${html([icone("buscar")])}</span><p class="vazio-titulo">Nenhuma regra com “${estado.filtro}”</p></div>`,
  );
  hidratarIcones(alvo);
};

const carregarAlertas = async (): Promise<void> => {
  try {
    estado.lista = await api.obter<ListaAlertas>("/alertas");
    renderizarResumo(estado.lista);
    renderizarRegras();
  } catch (erro) {
    renderizar(exigir("[data-regras]"), html`<div class="vazio vazio-compacto vazio-erro p-6"><span class="vazio-icone">${html([icone("alerta")])}</span><p class="vazio-texto">${mensagemDeErro(erro)}</p></div>`);
  }
};

const itemDisparo = (disparo: Disparo): Seguro => html`
  <li class="linha-tempo-item">
    <span class="linha-tempo-marcador" data-tom="${disparo.resolvidoEm ? "oliva" : TOM_SEVERIDADE[disparo.alerta.severidade]}">${html([icone(disparo.resolvidoEm ? "sucesso" : "sirene")])}</span>
    <div class="linha-tempo-conteudo">
      <p class="linha-tempo-texto"><strong>${disparo.alerta.nome}</strong> ${disparo.resolvidoEm ? "disparou e já voltou ao normal" : "está disparado"}</p>
      <p class="linha-tempo-texto texto-suave">${disparo.mensagem}</p>
      <time class="linha-tempo-tempo" datetime="${disparo.criadoEm}" title="${dataHora(disparo.criadoEm)}">${relativo(disparo.criadoEm)}${disparo.resolvidoEm ? ` · normalizou ${relativo(disparo.resolvidoEm)}` : ""}</time>
    </div>
  </li>
`;

const carregarDisparos = async (acrescentar = false): Promise<void> => {
  const alvo = exigir("[data-disparos]");
  const botaoMais = exigir<HTMLButtonElement>("[data-mais-disparos]");
  if (!acrescentar) estado.paginaDisparos = 1;
  try {
    const pagina = await api.obter<Pagina<Disparo>>("/alertas/disparos", { alerta: estado.filtroDisparos, pagina: estado.paginaDisparos, porPagina: 15 });
    const filtrado = estado.lista?.itens.find((alerta) => alerta.id === estado.filtroDisparos);
    exigir("[data-subtitulo-disparos]").textContent = filtrado ? `Só “${filtrado.nome}”` : "Todas as regras";
    exigir("[data-limpar-filtro-disparos]").hidden = !estado.filtroDisparos;
    if (!pagina.itens.length && !acrescentar) {
      renderizar(alvo, html`<li class="vazio vazio-compacto"><span class="vazio-icone">${html([icone("sino-mudo")])}</span><p class="vazio-titulo">Nenhum disparo</p><p class="vazio-texto">Quando uma regra for atendida, o aviso aparece aqui e nas notificações.</p></li>`);
    } else if (acrescentar) {
      alvo.insertAdjacentHTML("beforeend", String(html`${pagina.itens.map(itemDisparo)}`));
    } else {
      renderizar(alvo, html`${pagina.itens.map(itemDisparo)}`);
    }
    hidratarIcones(alvo);
    botaoMais.hidden = pagina.pagina >= pagina.paginas;
  } catch (erro) {
    renderizar(alvo, html`<li class="text-sm texto-suave">${mensagemDeErro(erro)}</li>`);
  }
};

const ler = (formulario: HTMLFormElement, nome: string): string => {
  const elemento = formulario.elements.namedItem(nome);
  if (elemento instanceof RadioNodeList) return elemento.value;
  return (elemento as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
};

const lerLimite = (formulario: HTMLFormElement, unidade: Unidade, modo: Modo): number | null => {
  const bruto = ler(formulario, "limite").replace(/[^\d,.-]/g, "");
  if (!bruto) return null;
  const normalizado = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) return null;
  return unidade === "moeda" && modo === "valor" ? Math.round(valor * 100) : valor;
};

const valorLimiteParaCampo = (limite: number, unidade: Unidade, modo: Modo): string => {
  const valor = unidade === "moeda" && modo === "valor" ? limite / 100 : Math.abs(limite);
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
};

const lerRascunho = (formulario: HTMLFormElement): Rascunho | null => {
  const metrica = metricaPorCodigo(ler(formulario, "metrica"));
  const modo = ler(formulario, "modo") as Modo;
  const limite = lerLimite(formulario, metrica?.unidade ?? "numero", modo);
  if (!metrica || limite === null) return null;
  return {
    nome: ler(formulario, "nome").trim(),
    metrica: metrica.codigo,
    janela: ler(formulario, "janela"),
    modo,
    operador: ler(formulario, "operador") as Operador,
    limite,
    severidade: ler(formulario, "severidade") as Severidade,
    notificarIntegracoes: (formulario.elements.namedItem("notificarIntegracoes") as HTMLInputElement).checked,
    silencioMinutos: Number(ler(formulario, "silencioMinutos")),
    ativo: (formulario.elements.namedItem("ativo") as HTMLInputElement).checked,
  };
};

const camposAlerta = (rascunho: Rascunho, novo: boolean): Seguro => {
  const catalogo = estado.catalogo;
  const metrica = metricaPorCodigo(rascunho.metrica) ?? catalogo?.metricas[0];
  return html`
    <form class="formulario" id="form-alerta" novalidate>
      ${novo
        ? html`<label class="campo">
            <span class="campo-rotulo">Começar de um modelo</span>
            <select class="selecao" name="modelo"><option value="">Em branco</option>${MODELOS.map((modelo) => html`<option value="${modelo.id}">${modelo.titulo}</option>`)}</select>
          </label>`
        : ""}
      <label class="campo">
        <span class="campo-rotulo campo-obrigatorio">Nome</span>
        <input class="entrada" name="nome" required minlength="2" maxlength="80" value="${rascunho.nome}" placeholder="Ex.: Pagamentos falhando">
      </label>
      <div class="grade-campos">
        <label class="campo campo-inteiro">
          <span class="campo-rotulo">Métrica</span>
          <select class="selecao" name="metrica">${catalogo?.metricas.map((item) => html`<option value="${item.codigo}" ${item.codigo === metrica?.codigo ? "selected" : ""}>${item.nome}</option>`)}</select>
          <span class="campo-ajuda" data-ajuda-metrica>${metrica?.descricao ?? ""}</span>
        </label>
        <label class="campo">
          <span class="campo-rotulo">Janela</span>
          <select class="selecao" name="janela">${catalogo?.janelas.map((janela) => html`<option value="${janela.codigo}" ${janela.codigo === rascunho.janela ? "selected" : ""}>${janela.nome[0].toUpperCase()}${janela.nome.slice(1)}</option>`)}</select>
        </label>
      </div>
      <fieldset class="campo">
        <legend class="campo-rotulo mb-2">Comparar</legend>
        <div class="segmentado" role="radiogroup">
          <label><input type="radio" name="modo" value="valor" ${rascunho.modo === "valor" ? "checked" : ""}><span>O valor</span></label>
          <label><input type="radio" name="modo" value="variacao" ${rascunho.modo === "variacao" ? "checked" : ""}><span>A variação vs. período anterior</span></label>
        </div>
      </fieldset>
      <div class="grade-campos">
        <label class="campo">
          <span class="campo-rotulo">Quando</span>
          <select class="selecao" name="operador" data-operador>
            <option value="maior" ${rascunho.operador === "maior" ? "selected" : ""}></option>
            <option value="menor" ${rascunho.operador === "menor" ? "selected" : ""}></option>
          </select>
        </label>
        <label class="campo">
          <span class="campo-rotulo campo-obrigatorio">Limite</span>
          <span class="entrada-caixa"><span class="entrada-caixa-prefixo" data-prefixo-limite></span><input class="entrada" name="limite" required inputmode="decimal" value="${valorLimiteParaCampo(rascunho.limite, metrica?.unidade ?? "numero", rascunho.modo)}"><span class="entrada-caixa-sufixo" data-sufixo-limite></span></span>
        </label>
      </div>
      <div class="alertas-previa" data-previa aria-live="polite"><span class="giro giro-pequeno" role="status" aria-label="Medindo"></span><span>Medindo a métrica agora…</span></div>
      <fieldset class="campo">
        <legend class="campo-rotulo mb-2">Gravidade</legend>
        <div class="segmentado" role="radiogroup">
          ${(Object.keys(ROTULOS_SEVERIDADE) as Severidade[]).map((severidade) => html`<label><input type="radio" name="severidade" value="${severidade}" ${severidade === rascunho.severidade ? "checked" : ""}><span>${ROTULOS_SEVERIDADE[severidade]}</span></label>`)}
        </div>
      </fieldset>
      <label class="campo">
        <span class="campo-rotulo">Depois de disparar, silenciar por</span>
        <select class="selecao" name="silencioMinutos">${SILENCIOS.map((item) => html`<option value="${item.valor}" ${item.valor === rascunho.silencioMinutos ? "selected" : ""}>${item.rotulo}</option>`)}</select>
        <span class="campo-ajuda">Evita avisos repetidos quando a métrica fica oscilando perto do limite.</span>
      </label>
      <label class="opcao"><input type="checkbox" class="caixa-marcacao" name="notificarIntegracoes" ${rascunho.notificarIntegracoes ? "checked" : ""}><span class="opcao-texto"><span class="opcao-titulo">Avisar também no Slack, Discord ou webhook</span><span class="opcao-descricao">Usa as integrações ativas em Configurações › Integrações, com o evento <code>alerta.disparado</code>.</span></span></label>
      <label class="opcao"><input type="checkbox" class="caixa-marcacao" name="ativo" ${rascunho.ativo ? "checked" : ""}><span class="opcao-texto"><span class="opcao-titulo">Regra ativa</span><span class="opcao-descricao">Pausada, a regra não é medida nem dispara.</span></span></label>
    </form>
  `;
};

const abrirFormulario = (alerta: Alerta | null, modelo?: Modelo): void => {
  const novo = !alerta;
  const inicial: Rascunho = alerta ?? modelo?.rascunho ?? MODELOS[0].rascunho;
  const gaveta = new Gaveta({ titulo: novo ? "Novo alerta" : "Editar alerta", subtitulo: novo ? "A regra é medida a cada poucos minutos e avisa a equipe nas notificações." : alerta.descricao }).abrir();
  gaveta.definirCorpo(camposAlerta(novo && !modelo ? { ...inicial, nome: "" } : inicial, novo));
  gaveta.definirRodape(html`<button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button><button type="submit" form="form-alerta" class="botao botao-primario" data-salvar>${html([icone("salvar")])}${novo ? "Criar alerta" : "Salvar"}</button>`);
  exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
  const formulario = exigir<HTMLFormElement>("#form-alerta", gaveta.corpo);
  if (novo && modelo) (formulario.elements.namedItem("modelo") as HTMLSelectElement).value = modelo.id;
  let controle: AbortController | null = null;

  const atualizarCampos = (): void => {
    const metrica = metricaPorCodigo(ler(formulario, "metrica"));
    const modo = ler(formulario, "modo") as Modo;
    const unidade = metrica?.unidade ?? "numero";
    exigir("[data-ajuda-metrica]", formulario).textContent = metrica?.descricao ?? "";
    const operador = exigir<HTMLSelectElement>("[data-operador]", formulario);
    operador.options[0].textContent = modo === "variacao" ? "Subir mais de" : "Ficar acima de";
    operador.options[1].textContent = modo === "variacao" ? "Cair mais de" : "Ficar abaixo de";
    exigir("[data-prefixo-limite]", formulario).textContent = unidade === "moeda" && modo === "valor" ? moeda(0).replace(/[\d\s,.]/g, "") : "";
    exigir("[data-prefixo-limite]", formulario).hidden = !(unidade === "moeda" && modo === "valor");
    exigir("[data-sufixo-limite]", formulario).textContent = modo === "variacao" || unidade === "percentual" ? "%" : "";
    exigir("[data-sufixo-limite]", formulario).hidden = !(modo === "variacao" || unidade === "percentual");
  };

  const atualizarPrevia = atrasar(async () => {
    const alvo = exigir("[data-previa]", formulario);
    const rascunho = lerRascunho(formulario);
    if (!rascunho) {
      renderizar(alvo, html`${html([icone("info")])}<span>Informe um limite para ver o valor de agora.</span>`);
      alvo.dataset.estado = "neutro";
      return;
    }
    controle?.abort();
    controle = new AbortController();
    try {
      const simulacao = await api.criar<Simulacao>("/alertas/simular", { metrica: rascunho.metrica, janela: rascunho.janela, modo: rascunho.modo, operador: rascunho.operador, limite: rascunho.limite }, { sinal: controle.signal });
      alvo.dataset.estado = simulacao.dispararia ? "disparando" : "normal";
      renderizar(
        alvo,
        html`${html([icone(simulacao.dispararia ? "sirene" : "sucesso")])}<span><strong>Agora: ${simulacao.valorFormatado}.</strong> ${simulacao.dispararia ? "Com estes números, a regra dispararia na próxima medição." : "Com estes números, a regra não dispararia agora."}</span>`,
      );
    } catch (erro) {
      if (erro instanceof DOMException && erro.name === "AbortError") return;
      alvo.dataset.estado = "neutro";
      renderizar(alvo, html`${html([icone("alerta")])}<span>${mensagemDeErro(erro)}</span>`);
    }
    hidratarIcones(alvo);
  }, 350);

  formulario.addEventListener("change", (evento) => {
    const alvo = evento.target as HTMLElement;
    if (alvo instanceof HTMLSelectElement && alvo.name === "modelo") {
      const escolhido = MODELOS.find((item) => item.id === alvo.value);
      if (escolhido) aplicarRascunho(formulario, escolhido.rascunho);
      atualizarCampos();
      atualizarPrevia();
      return;
    }
    if (alvo instanceof HTMLInputElement && alvo.name === "modo") {
      const metrica = metricaPorCodigo(ler(formulario, "metrica"));
      const limite = lerLimite(formulario, metrica?.unidade ?? "numero", alvo.value === "valor" ? "variacao" : "valor");
      if (limite !== null) exigir<HTMLInputElement>('input[name="limite"]', formulario).value = valorLimiteParaCampo(limite, metrica?.unidade ?? "numero", alvo.value === "valor" ? "variacao" : "valor");
    }
    atualizarCampos();
    if (["metrica", "janela", "modo", "operador"].includes((alvo as HTMLInputElement).name)) atualizarPrevia();
  });
  formulario.addEventListener("input", (evento) => {
    if ((evento.target as HTMLInputElement).name === "limite") atualizarPrevia();
  });

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const rascunho = lerRascunho(formulario);
    if (!rascunho) {
      mostrarErros(formulario, { limite: "Use um número, por exemplo 8 ou 1.500,00." });
      return;
    }
    const botao = exigir<HTMLButtonElement>("[data-salvar]", gaveta.rodape);
    carregando(botao, true);
    try {
      const salvo = novo ? await api.criar<Alerta>("/alertas", rascunho) : await api.atualizar<Alerta>(`/alertas/${alerta.id}`, rascunho);
      gaveta.fechar();
      avisoSucesso(novo ? "Alerta criado" : "Alerta salvo", salvo.descricao);
      await carregarAlertas();
      destacar(salvo.id);
    } catch (erro) {
      carregando(botao, false);
      if (erro instanceof ErroApi && erro.detalhes && mostrarErros(formulario, erro.detalhes)) return;
      avisar({ tipo: "erro", titulo: "Não foi possível salvar", texto: mensagemDeErro(erro) });
    }
  });

  atualizarCampos();
  atualizarPrevia();
  exigir<HTMLInputElement>('input[name="nome"]', formulario).focus();
};

const aplicarRascunho = (formulario: HTMLFormElement, rascunho: Rascunho): void => {
  const campo = <T extends Element>(nome: string) => formulario.elements.namedItem(nome) as T | null;
  const metrica = metricaPorCodigo(rascunho.metrica);
  campo<HTMLInputElement>("nome")!.value = rascunho.nome;
  campo<HTMLSelectElement>("metrica")!.value = rascunho.metrica;
  campo<HTMLSelectElement>("janela")!.value = rascunho.janela;
  campo<HTMLSelectElement>("operador")!.value = rascunho.operador;
  campo<HTMLSelectElement>("silencioMinutos")!.value = String(rascunho.silencioMinutos);
  campo<HTMLInputElement>("limite")!.value = valorLimiteParaCampo(rascunho.limite, metrica?.unidade ?? "numero", rascunho.modo);
  campo<HTMLInputElement>("notificarIntegracoes")!.checked = rascunho.notificarIntegracoes;
  campo<HTMLInputElement>("ativo")!.checked = rascunho.ativo;
  for (const nome of ["modo", "severidade"] as const) {
    for (const opcao of formulario.querySelectorAll<HTMLInputElement>(`input[name="${nome}"]`)) opcao.checked = opcao.value === rascunho[nome];
  }
};

const destacar = (id: string): void => {
  const item = $<HTMLElement>(`.alerta-regra[data-id="${id}"]`);
  if (!item) return;
  item.dataset.destacado = "true";
  item.scrollIntoView({ block: "nearest", behavior: "smooth" });
  item.focus({ preventScroll: true });
  setTimeout(() => {
    item.dataset.destacado = "false";
  }, 2400);
};

const alertaPorId = (id: string | undefined): Alerta | undefined => estado.lista?.itens.find((alerta) => alerta.id === id);

const executar = async (acao: string, alerta: Alerta, botao: HTMLElement | null): Promise<void> => {
  if (acao === "historico") {
    estado.filtroDisparos = alerta.id;
    atualizarUrl({ alerta: alerta.id });
    await carregarDisparos();
    return;
  }
  if (acao === "editar") {
    abrirFormulario(alerta);
    return;
  }
  if (acao === "duplicar") {
    abrirFormulario(null, { id: "", titulo: "", texto: "", icone: "", rascunho: { ...alerta, nome: `${alerta.nome} (cópia)`.slice(0, 80) } });
    return;
  }
  if (acao === "excluir") {
    const ok = await confirmar({ titulo: `Excluir “${alerta.nome}”?`, texto: "A regra e o histórico de disparos dela saem do painel. As notificações já enviadas continuam.", tipo: "perigo", confirmar: "Excluir alerta" });
    if (!ok) return;
    try {
      await api.excluir(`/alertas/${alerta.id}`);
      avisoSucesso("Alerta excluído");
      if (estado.filtroDisparos === alerta.id) estado.filtroDisparos = null;
      await Promise.all([carregarAlertas(), carregarDisparos()]);
    } catch (erro) {
      avisar({ tipo: "erro", titulo: "Não foi possível excluir", texto: mensagemDeErro(erro) });
    }
    return;
  }
  carregando(botao, true);
  try {
    if (acao === "avaliar") {
      const resultado = await api.criar<{ disparados: number; resolvidos: number; alerta: Alerta }>(`/alertas/${alerta.id}/avaliar`);
      const metrica = metricaPorCodigo(alerta.metrica);
      const valor = formatarValor(resultado.alerta.ultimoValor, metrica?.unidade ?? "numero", resultado.alerta.modo);
      if (resultado.disparados) avisar({ tipo: "alerta", titulo: "A regra disparou", texto: `Valor medido: ${valor}. A equipe foi avisada nas notificações.` });
      else if (resultado.resolvidos) avisoSucesso("Voltou ao normal", `Valor medido: ${valor}.`);
      else avisar({ tipo: "info", titulo: resultado.alerta.estado === "disparado" ? "Continua disparada" : "Dentro do esperado", texto: `Valor medido: ${valor}.${resultado.alerta.estado === "normal" && alerta.ultimoDisparo ? " Se acabou de disparar, o silêncio evita um aviso repetido." : ""}` });
      await Promise.all([carregarAlertas(), carregarDisparos()]);
    } else if (acao === "pausar" || acao === "retomar") {
      await api.atualizar(`/alertas/${alerta.id}`, { ativo: acao === "retomar" });
      avisoSucesso(acao === "pausar" ? "Alerta pausado" : "Alerta retomado", acao === "retomar" ? "A próxima medição acontece em instantes." : undefined);
      await carregarAlertas();
    }
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível concluir", texto: mensagemDeErro(erro) });
  } finally {
    carregando(botao, false);
  }
};

iniciarPagina({
  pagina: "alertas",
  permissao: "alertas.ver",
  aoIniciar: async () => {
    $$("[data-permissao]").forEach((elemento) => {
      if (!pode(elemento.dataset.permissao)) elemento.remove();
    });
    estado.catalogo = await api.obter<Catalogo>("/alertas/catalogo");
    const parametros = parametrosUrl();
    estado.filtroDisparos = parametros.alerta && /^[0-9a-f-]{36}$/i.test(parametros.alerta) ? parametros.alerta : null;
    await Promise.all([carregarAlertas(), carregarDisparos()]);
    if (estado.filtroDisparos) destacar(estado.filtroDisparos);

    $('[data-acao="novo-alerta"]')?.addEventListener("click", () => {
      if (estado.lista && estado.lista.itens.length >= estado.lista.limite) {
        avisar({ tipo: "alerta", titulo: "Limite de alertas atingido", texto: `Exclua uma regra antes de criar outra (máximo de ${estado.lista.limite}).` });
        return;
      }
      abrirFormulario(null);
    });
    if (parametros.novo && pode("alertas.gerenciar")) {
      atualizarUrl({ novo: null, metrica: null });
      const metrica = metricaPorCodigo(parametros.metrica ?? "");
      const sobeEhRuim = metrica?.codigo === "taxa_falha" || metrica?.codigo === "reembolsos" || metrica?.codigo === "cancelamentos";
      abrirFormulario(
        null,
        metrica
          ? {
              id: "",
              titulo: "",
              texto: "",
              icone: "",
              rascunho: { nome: `${metrica.nome} fora do normal`, metrica: metrica.codigo, janela: "24h", modo: "variacao", operador: sobeEhRuim ? "maior" : "menor", limite: 30, severidade: "alerta", notificarIntegracoes: false, silencioMinutos: 1440, ativo: true },
            }
          : undefined,
      );
    }

    const busca = exigir<HTMLInputElement>("[data-filtro-regras]");
    busca.addEventListener(
      "input",
      atrasar(() => {
        estado.filtro = busca.value;
        renderizarRegras();
      }, 120),
    );

    exigir("[data-regras]").addEventListener("click", (evento) => {
      const alvo = evento.target as Element;
      const modelo = alvo.closest<HTMLElement>("[data-modelo]");
      if (modelo) {
        const escolhido = MODELOS.find((item) => item.id === modelo.dataset.modelo);
        if (escolhido) abrirFormulario(null, escolhido);
        return;
      }
      const botao = alvo.closest<HTMLElement>("[data-acao-alerta]");
      const item = alvo.closest<HTMLElement>(".alerta-regra");
      const alerta = alertaPorId(item?.dataset.id);
      if (!botao || !alerta) return;
      const acao = botao.dataset.acaoAlerta ?? "";
      if (acao === "mais") {
        abrirMenuAcoes(botao, [
          { rotulo: "Editar", icone: "editar", executar: () => void executar("editar", alerta, null) },
          { rotulo: "Duplicar", icone: "copiar", executar: () => void executar("duplicar", alerta, null) },
          { rotulo: "Ver disparos", icone: "historico", executar: () => void executar("historico", alerta, null) },
          "separador",
          { rotulo: "Excluir", icone: "lixeira", perigo: true, executar: () => void executar("excluir", alerta, null) },
        ]);
        return;
      }
      void executar(acao, alerta, botao);
    });
    exigir("[data-regras]").addEventListener("dblclick", (evento) => {
      const alerta = alertaPorId((evento.target as Element).closest<HTMLElement>(".alerta-regra")?.dataset.id);
      if (alerta && pode("alertas.gerenciar") && !(evento.target as Element).closest("button")) abrirFormulario(alerta);
    });

    exigir("[data-limpar-filtro-disparos]").addEventListener("click", () => {
      estado.filtroDisparos = null;
      atualizarUrl({ alerta: null });
      void carregarDisparos();
    });
    exigir("[data-mais-disparos]").addEventListener("click", () => {
      estado.paginaDisparos += 1;
      void carregarDisparos(true);
    });

    ouvir<{ categoria?: string }>("tempo-real:notificacao", (notificacao) => {
      if (notificacao?.categoria === "metrica") void Promise.all([carregarAlertas(), carregarDisparos()]);
    });
  },
});

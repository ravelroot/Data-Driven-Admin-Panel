import { iniciarPagina } from "../layout/inicio.js";
import { html, $, $$, renderizar, parametrosUrl, atualizarUrl } from "../nucleo/dom.js";
import { icone } from "../nucleo/icones.js";
import { api, mensagemDeErro } from "../nucleo/api.js";
import { moeda, numero, percentual, dataIso, somarDias, data } from "../nucleo/formato.js";
import { Grafico, eixoMoeda, eixoNumero, gradienteArea } from "../componentes/graficos.js";
import { tendencia, valorGrande, formatarValor } from "../componentes/indicadores.js";
import { avisar } from "../componentes/aviso.js";

const ROTULOS_AGRUPAR = { dia: "Por dia", semana: "Por semana", mes: "Por mês" };
const ICONES_DISPOSITIVO = { Desktop: "monitor", Celular: "celular", Tablet: "tablet" };
const FORMATOS_RESUMO = { receita: "moeda", novosUsuarios: "numero", visitantes: "numero", conversao: "percentual" };

const estado = {
  filtros: null,
  tipoReceita: "area",
  graficos: {},
  dados: null,
  controlador: null,
};

const filtrosIniciais = () => {
  const parametros = parametrosUrl();
  const hoje = new Date();
  return {
    inicio: parametros.inicio || dataIso(somarDias(hoje, -29)),
    fim: parametros.fim || dataIso(hoje),
    agrupar: ["dia", "semana", "mes"].includes(parametros.agrupar) ? parametros.agrupar : "dia",
  };
};

const graficoReceita = (dados, cores) => ({
  chart: { type: estado.tipoReceita === "bar" ? "bar" : "area", height: "100%", stacked: false },
  series: [
    { name: "Receita", data: dados?.serie.receita ?? [] },
    { name: "Reembolsos", data: dados?.serie.reembolsos ?? [] },
  ],
  colors: [cores.primaria, cores.brasa],
  stroke: estado.tipoReceita === "bar" ? { width: 0 } : { curve: "smooth", width: [2.5, 1.5], dashArray: [0, 4] },
  fill: estado.tipoReceita === "bar" ? { opacity: 1 } : gradienteArea(0.3, 0.02),
  plotOptions: { bar: { columnWidth: "62%", borderRadius: 4, borderRadiusApplication: "end" } },
  xaxis: { categories: dados?.serie.rotulos ?? [], tickAmount: Math.min(window.innerWidth < 640 ? 4 : 10, (dados?.serie.rotulos ?? []).length) },
  yaxis: { tickAmount: 4, labels: { formatter: eixoMoeda } },
  tooltip: { shared: true, intersect: false, y: { formatter: (valor) => moeda(valor) } },
});

const graficoDispositivos = (dados, cores) => ({
  chart: { type: "donut", height: 180 },
  series: (dados?.dispositivos ?? []).map((item) => item.visitantes),
  labels: (dados?.dispositivos ?? []).map((item) => item.dispositivo),
  colors: [cores.primaria, cores.destaque, cores.salvia],
  stroke: { width: 3, colors: [cores.fundo] },
  plotOptions: { pie: { expandOnClick: false, donut: { size: "70%", labels: { show: true, name: { show: true, fontSize: "11px", color: cores.texto, offsetY: 16 }, value: { show: true, fontSize: "20px", fontWeight: 650, color: cores.textoForte, offsetY: -10, formatter: (valor) => numero(Number(valor), { compacto: true }) }, total: { show: true, label: "visitantes", fontSize: "11px", color: cores.texto, formatter: (grafico) => numero(grafico.globals.seriesTotals.reduce((a, b) => a + b, 0), { compacto: true }) } } } } },
  tooltip: { y: { formatter: (valor) => `${numero(valor)} visitantes` } },
});

const graficoCanais = (dados, cores) => ({
  chart: { type: "bar", height: "100%" },
  series: [
    { name: "Visitantes", data: (dados?.canais ?? []).map((item) => item.visitantes) },
    { name: "Conversões", data: (dados?.canais ?? []).map((item) => item.conversoes) },
  ],
  colors: [cores.primaria, cores.destaque],
  plotOptions: { bar: { horizontal: true, barHeight: "68%", borderRadius: 4, borderRadiusApplication: "end" } },
  xaxis: { categories: (dados?.canais ?? []).map((item) => item.canal), labels: { formatter: (valor) => eixoNumero(valor) } },
  legend: { show: true, position: "top", horizontalAlign: "right", fontSize: "12px", markers: { size: 5 } },
  tooltip: { shared: true, intersect: false, y: { formatter: (valor) => numero(valor) } },
});

const graficoUsuarios = (dados, cores) => ({
  chart: { type: "line", height: "100%" },
  series: [
    { name: "Novos", data: dados?.serie.novosUsuarios ?? [] },
    { name: "Ativos", data: dados?.serie.ativos ?? [] },
  ],
  colors: [cores.primaria, cores.destaque],
  stroke: { curve: "smooth", width: 2.5 },
  markers: { size: 0, hover: { size: 4 } },
  xaxis: { categories: dados?.serie.rotulos ?? [], tickAmount: Math.min(window.innerWidth < 640 ? 4 : 8, (dados?.serie.rotulos ?? []).length) },
  yaxis: [
    { seriesName: "Novos", tickAmount: 4, labels: { formatter: eixoNumero } },
    { seriesName: "Ativos", opposite: true, tickAmount: 4, labels: { formatter: eixoNumero } },
  ],
  tooltip: { shared: true, intersect: false, y: { formatter: (valor) => numero(valor) } },
});

const graficoAssinaturas = (dados, cores) => ({
  chart: { type: "bar", height: "100%" },
  series: [
    { name: "Novas", data: dados?.serie.assinaturasNovas ?? [] },
    { name: "Cancelamentos", data: (dados?.serie.cancelamentos ?? []).map((valor) => -valor) },
  ],
  colors: [cores.primaria, cores.brasa],
  plotOptions: { bar: { columnWidth: "70%", borderRadius: 3 } },
  xaxis: { categories: dados?.serie.rotulos ?? [], tickAmount: Math.min(window.innerWidth < 640 ? 4 : 8, (dados?.serie.rotulos ?? []).length) },
  yaxis: { tickAmount: 4, labels: { formatter: (valor) => numero(Math.abs(valor)) } },
  tooltip: { shared: true, intersect: false, y: { formatter: (valor) => numero(Math.abs(valor)) } },
});

const graficoPlanos = (dados, cores) => ({
  chart: { type: "bar", height: "100%" },
  series: [{ name: "Receita", data: (dados?.planos ?? []).map((item) => item.receita) }],
  colors: cores.serie(),
  plotOptions: { bar: { horizontal: true, distributed: true, barHeight: "62%", borderRadius: 5, borderRadiusApplication: "end" } },
  xaxis: { categories: (dados?.planos ?? []).map((item) => item.nome), tickAmount: 4, labels: { formatter: eixoMoeda } },
  tooltip: { y: { formatter: (valor) => moeda(valor) } },
});

const preencherResumo = (resumo) => {
  for (const [chave, formato] of Object.entries(FORMATOS_RESUMO)) {
    const cartao = $(`[data-resumo="${chave}"]`);
    const item = resumo[chave];
    if (!cartao || !item) continue;
    cartao.classList.remove("kpi-carregando");
    cartao.querySelector("[data-kpi-valor]").innerHTML = String(valorGrande(item.valor, formato));
    cartao.querySelector("[data-kpi-tendencia]").innerHTML = String(tendencia(item.variacao));
    cartao.querySelector("[data-kpi-comparacao]").textContent = `Período anterior: ${formatarValor(item.anterior, formato)}`;
  }
  $('[data-resumo-texto="transacoes"]').textContent = numero(resumo.transacoes?.valor ?? 0);
  $('[data-resumo-texto="ticketMedio"]').textContent = moeda(resumo.ticketMedio?.valor ?? 0);
  $('[data-resumo-texto="mrr"]').textContent = moeda(resumo.mrr?.valor ?? 0, { compacto: true });
  $('[data-resumo-texto="churn"]').textContent = percentual(resumo.churn?.valor ?? 0);
};

const preencherFunil = (funil) => {
  const topo = funil[0]?.valor || 1;
  renderizar(
    $("[data-funil]"),
    html`${funil.map((etapa, indice) => {
      const largura = etapa.valor > 0 ? Math.max(8, (etapa.valor / topo) * 100) : 0;
      const anterior = indice ? funil[indice - 1].valor : null;
      const taxa = indice === 0 ? (etapa.valor > 0 ? "100%" : percentual(0)) : anterior > 0 ? percentual((etapa.valor / anterior) * 100) : percentual(0);
      return html`<div class="funil-etapa">
        <span class="funil-nome">${etapa.etapa}<small>${numero(etapa.valor, { compacto: etapa.valor >= 10000 })}</small></span>
        <div class="funil-trilho"><span class="funil-barra" style="--valor:${largura.toFixed(1)}%"></span></div>
        <span class="funil-taxa">${taxa}<small>${indice === 0 ? "do total" : "da anterior"}</small></span>
      </div>`;
    })}`,
  );
};

const preencherDispositivos = (dispositivos) => {
  renderizar(
    $("[data-dispositivos]"),
    html`${dispositivos.map(
      (item) => html`<div class="analytics-dispositivo">${html([icone(ICONES_DISPOSITIVO[item.dispositivo] ?? "monitor")])}<strong>${percentual(item.percentual, 0)}</strong><span>${item.dispositivo}</span></div>`,
    )}`,
  );
};

const preencherPaises = (paises) => {
  const maximo = Math.max(...paises.map((pais) => pais.visitantes), 1);
  renderizar(
    $("[data-paises]"),
    html`${paises.map(
      (pais) => html`<li class="lista-ranking-item">
        <div class="lista-ranking-topo">
          <span class="lista-ranking-nome"><span class="lista-ranking-bandeira">${pais.codigo}</span>${pais.pais}</span>
          <span class="lista-ranking-valor">${numero(pais.visitantes)}<small>${moeda(pais.receita, { compacto: true })}</small></span>
        </div>
        <div class="lista-ranking-barra"><span style="--valor:${((pais.visitantes / maximo) * 100).toFixed(1)}%"></span></div>
      </li>`,
    )}`,
  );
};

const preencherMapaCalor = (mapa) => {
  const alvo = $("[data-mapa-calor]");
  const maximo = Math.max(...mapa.valores.flat(), 1);
  const nivel = (valor) => (valor <= 0 ? 0 : Math.min(5, Math.ceil((valor / maximo) * 5)));
  renderizar(
    alvo,
    html`<span></span>${mapa.horas.map((horaDoDia) => html`<span class="mapa-calor-hora">${horaDoDia}</span>`)}
    ${mapa.dias.map(
      (dia, indiceDia) => html`<span class="mapa-calor-rotulo">${dia}</span>${mapa.valores[indiceDia].map(
        (valor, indiceHora) => html`<span class="mapa-calor-celula" data-nivel="${nivel(valor)}" title="${dia}, ${mapa.horas[indiceHora]}h: ${numero(valor)} transações"></span>`,
      )}`,
    )}`,
  );
};

const nivelRetencao = (valor) => (valor >= 90 ? 5 : valor >= 70 ? 4 : valor >= 50 ? 3 : valor >= 30 ? 2 : valor > 0 ? 1 : 0);

const preencherCoortes = (coortes) => {
  const colunas = Math.max(...coortes.map((coorte) => coorte.retencao.length), 1);
  renderizar(
    $("[data-coortes]"),
    html`<caption class="sr-only">Retenção de clientes por mês de cadastro</caption>
      <thead><tr><th scope="col">Coorte</th>${Array.from({ length: colunas }, (_, indice) => html`<th scope="col" class="celula-numero">Mês ${indice}</th>`)}</tr></thead>
      <tbody>
        ${coortes.map(
          (coorte) => html`<tr>
            <th scope="row" class="coorte-rotulo">${coorte.rotulo}<span class="coorte-tamanho">${numero(coorte.tamanho)} clientes</span></th>
            ${Array.from({ length: colunas }, (_, indice) => {
              const valor = coorte.retencao[indice];
              return valor === undefined ? html`<td></td>` : html`<td class="coorte-celula" data-nivel="${nivelRetencao(valor)}">${percentual(valor, 0)}</td>`;
            })}
          </tr>`,
        )}
      </tbody>`,
  );
};

const marcarPredefinicao = () => {
  const { inicio, fim } = estado.filtros;
  const dias = Math.round((new Date(fim) - new Date(inicio)) / 86400000) + 1;
  const hoje = dataIso(new Date());
  const inicioAno = `${new Date().getFullYear()}-01-01`;
  $$("[data-predefinicao]").forEach((botao) => {
    const valor = botao.dataset.predefinicao;
    const ativo = fim === hoje && (valor === "ano" ? inicio === inicioAno : Number(valor) === dias);
    botao.setAttribute("aria-pressed", String(ativo));
  });
};

const carregar = async () => {
  estado.controlador?.abort();
  estado.controlador = new AbortController();
  atualizarUrl(estado.filtros);
  marcarPredefinicao();
  $("[data-rotulo-agrupamento]").textContent = `${ROTULOS_AGRUPAR[estado.filtros.agrupar]}, de ${data(`${estado.filtros.inicio}T12:00:00`)} a ${data(`${estado.filtros.fim}T12:00:00`)}`;
  $("[data-exportar]").href = `/relatorios?inicio=${estado.filtros.inicio}&fim=${estado.filtros.fim}`;
  try {
    const dados = await api.obter("/analytics", estado.filtros, { sinal: estado.controlador.signal });
    estado.dados = dados;
    preencherResumo(dados.resumo);
    preencherFunil(dados.funil);
    preencherDispositivos(dados.dispositivos);
    preencherPaises(dados.paises);
    preencherMapaCalor(dados.mapaCalor);
    preencherCoortes(dados.coortes);
    await Promise.all(Object.values(estado.graficos).map((grafico) => grafico.renderizar(dados)));
  } catch (erro) {
    if (erro?.name === "AbortError") return;
    avisar({ tipo: "erro", titulo: "Não foi possível carregar o analytics", texto: mensagemDeErro(erro) });
  }
};

const aplicarPredefinicao = (valor) => {
  const hoje = new Date();
  estado.filtros.fim = dataIso(hoje);
  if (valor === "ano") estado.filtros.inicio = `${hoje.getFullYear()}-01-01`;
  else estado.filtros.inicio = dataIso(somarDias(hoje, -(Number(valor) - 1)));
  const dias = (new Date(estado.filtros.fim) - new Date(estado.filtros.inicio)) / 86400000;
  estado.filtros.agrupar = dias > 120 ? "mes" : dias > 45 ? "semana" : "dia";
};

const sincronizarFormulario = (formulario) => {
  formulario.elements.inicio.value = estado.filtros.inicio;
  formulario.elements.fim.value = estado.filtros.fim;
  formulario.elements.agrupar.value = estado.filtros.agrupar;
  formulario.elements.inicio.max = estado.filtros.fim;
  formulario.elements.fim.min = estado.filtros.inicio;
  formulario.elements.fim.max = dataIso(new Date());
};

iniciarPagina({
  pagina: "analytics",
  permissao: "analytics.ver",
  aoIniciar: async () => {
    estado.filtros = filtrosIniciais();
    const formulario = $("[data-filtros]");
    sincronizarFormulario(formulario);

    estado.graficos = {
      receita: new Grafico($('[data-grafico="receita"]'), graficoReceita),
      dispositivos: new Grafico($('[data-grafico="dispositivos"]'), graficoDispositivos),
      canais: new Grafico($('[data-grafico="canais"]'), graficoCanais),
      usuarios: new Grafico($('[data-grafico="usuarios"]'), graficoUsuarios),
      assinaturas: new Grafico($('[data-grafico="assinaturas"]'), graficoAssinaturas),
      planos: new Grafico($('[data-grafico="planos"]'), graficoPlanos),
    };

    formulario.addEventListener("change", () => {
      const { inicio, fim, agrupar } = formulario.elements;
      if (!inicio.value || !fim.value) return;
      if (inicio.value > fim.value) {
        avisar({ tipo: "alerta", titulo: "Período inválido", texto: "A data inicial precisa vir antes da data final." });
        sincronizarFormulario(formulario);
        return;
      }
      estado.filtros = { inicio: inicio.value, fim: fim.value, agrupar: agrupar.value };
      sincronizarFormulario(formulario);
      carregar();
    });
    formulario.addEventListener("submit", (evento) => evento.preventDefault());

    $(".predefinicoes").addEventListener("click", (evento) => {
      const botao = evento.target.closest("[data-predefinicao]");
      if (!botao) return;
      aplicarPredefinicao(botao.dataset.predefinicao);
      sincronizarFormulario(formulario);
      carregar();
    });

    $$("[data-tipo-receita]").forEach((botao) => {
      botao.addEventListener("click", async () => {
        if (estado.tipoReceita === botao.dataset.tipoReceita) return;
        estado.tipoReceita = botao.dataset.tipoReceita;
        $$("[data-tipo-receita]").forEach((outro) => outro.setAttribute("aria-pressed", String(outro === botao)));
        estado.graficos.receita.destruir();
        estado.graficos.receita = new Grafico($('[data-grafico="receita"]'), graficoReceita);
        if (estado.dados) await estado.graficos.receita.renderizar(estado.dados);
      });
    });

    await carregar();
  },
});

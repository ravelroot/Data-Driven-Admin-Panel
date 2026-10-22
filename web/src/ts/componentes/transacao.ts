import { html, type Seguro } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";
import { api, mensagemDeErro } from "../nucleo/api.ts";
import { moeda, dataHora, dataCurta, rotulos, corAvatar } from "../nucleo/formato.ts";
import { Gaveta } from "./gaveta.ts";
import type { Pessoa, Referencia, Transacao } from "../nucleo/tipos.ts";

interface AssinaturaTransacao {
  id: string;
  plano: Referencia | null;
  status: string;
  ciclo: string;
  valor: number;
  iniciadaEm: string;
  renovacaoEm: string | null;
}

interface DetalheTransacao extends Transacao {
  assinatura: AssinaturaTransacao | null;
}

export const emblemaStatusTransacao = (status: string): Seguro => html`<span class="emblema" data-status="${status}">${rotulos.transacao[status] ?? status}</span>`;

export const ICONES_METODO: Record<string, string> = { cartao: "cartao", pix: "raio", boleto: "recibo" };

export const metodo = (valor: string): Seguro => html`<span class="celula-icone-texto">${html([icone(ICONES_METODO[valor] ?? "carteira")])}${rotulos.metodo[valor] ?? valor}</span>`;

export const clienteCelula = (usuario: Partial<Pessoa> | null | undefined, { comEmail = true }: { comEmail?: boolean } = {}): Seguro => html`
  <div class="celula-usuario">
    <span class="avatar avatar-pequeno" data-cor="${corAvatar(usuario?.email ?? usuario?.nome ?? "")}" aria-hidden="true">${usuario?.iniciais ?? "?"}</span>
    <div class="celula-usuario-texto">
      <span class="celula-usuario-nome">${usuario?.nome ?? "Cliente removido"}</span>
      ${comEmail && usuario?.email ? html`<span class="celula-usuario-email">${usuario.email}</span>` : ""}
    </div>
  </div>
`;

export const linhaTransacao = (transacao: Transacao, { nova = false }: { nova?: boolean } = {}): Seguro => html`
  <tr data-chave="${transacao.id}" data-clicavel="true" tabindex="0" ${nova ? html`data-nova="true"` : ""}>
    <td>${clienteCelula(transacao.usuario)}</td>
    <td>${transacao.plano?.nome ?? html`<span class="texto-fraco">—</span>`}</td>
    <td>${metodo(transacao.metodo)}</td>
    <td>${emblemaStatusTransacao(transacao.status)}</td>
    <td class="celula-moeda" ${transacao.tipo === "reembolso" || transacao.status === "reembolsada" ? html`data-negativo="true"` : ""}>${moeda(transacao.valor)}</td>
  </tr>
`;

export const abrirTransacao = async (id: string): Promise<Gaveta> => {
  const gaveta = new Gaveta({ titulo: "Transação", subtitulo: "Carregando detalhes…" }).abrir();
  try {
    const transacao = await api.obter<DetalheTransacao>(`/transacoes/${id}`);
    gaveta.definirTitulo(transacao.codigo, dataHora(transacao.criadoEm));
    gaveta.definirCorpo(html`
      <section class="gaveta-secao">
        <div class="linha-entre">
          <p class="cartao-numero">${moeda(transacao.valor)}</p>
          ${emblemaStatusTransacao(transacao.status)}
        </div>
        <p class="mt-1 text-sm texto-suave">${rotulos.tipoTransacao[transacao.tipo] ?? transacao.tipo} paga com ${(rotulos.metodo[transacao.metodo] ?? transacao.metodo).toLowerCase()}</p>
      </section>
      <section class="gaveta-secao">
        <h3 class="gaveta-secao-titulo">Cliente</h3>
        <div class="linha-entre">
          ${clienteCelula(transacao.usuario)}
          <a class="botao botao-secundario botao-pequeno" href="/usuarios?usuario=${encodeURIComponent(transacao.usuario?.id ?? "")}">${html([icone("usuario")])}Abrir cadastro</a>
        </div>
      </section>
      <section class="gaveta-secao">
        <h3 class="gaveta-secao-titulo">Detalhes</h3>
        <dl class="lista-definicao">
          <dt>Código</dt><dd><code>${transacao.codigo}</code></dd>
          <dt>Plano</dt><dd>${transacao.plano?.nome ?? "—"}</dd>
          <dt>Tipo</dt><dd>${rotulos.tipoTransacao[transacao.tipo] ?? transacao.tipo}</dd>
          <dt>Método</dt><dd>${metodo(transacao.metodo)}</dd>
          <dt>Moeda</dt><dd>${transacao.moeda}</dd>
          <dt>Data</dt><dd>${dataHora(transacao.criadoEm)}</dd>
        </dl>
      </section>
      ${transacao.assinatura
        ? html`<section class="gaveta-secao">
            <h3 class="gaveta-secao-titulo">Assinatura</h3>
            <div class="assinatura-resumo">
              <span class="assinatura-resumo-icone">${html([icone("repetir")])}</span>
              <div class="assinatura-resumo-textos">
                <span class="assinatura-resumo-plano">${transacao.assinatura.plano?.nome ?? "Plano"}, ${rotulos.ciclo[transacao.assinatura.ciclo] ?? transacao.assinatura.ciclo}</span>
                <span class="assinatura-resumo-detalhe">Desde ${dataCurta(transacao.assinatura.iniciadaEm)}${transacao.assinatura.renovacaoEm ? `, renova em ${dataCurta(transacao.assinatura.renovacaoEm)}` : ""}</span>
              </div>
              <span class="emblema" data-status="${transacao.assinatura.status}">${rotulos.assinatura[transacao.assinatura.status] ?? transacao.assinatura.status}</span>
            </div>
          </section>`
        : ""}
    `);
  } catch (erro) {
    gaveta.definirTitulo("Transação", "");
    gaveta.definirCorpo(html`<div class="vazio vazio-erro"><span class="vazio-icone">${html([icone("alerta")])}</span><p class="vazio-titulo">Não foi possível abrir a transação</p><p class="vazio-texto">${mensagemDeErro(erro)}</p></div>`);
  }
  return gaveta;
};

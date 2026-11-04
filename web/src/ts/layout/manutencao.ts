import { html, renderizar } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";
import { api, mensagemDeErro } from "../nucleo/api.ts";
import { ouvir, emitir } from "../nucleo/eventos.ts";
import { atualizarSistema, pode, sessao } from "../nucleo/sessao.ts";
import { relativo } from "../nucleo/formato.ts";
import { avisar } from "../componentes/aviso.ts";
import type { EstadoManutencao } from "../nucleo/tipos.ts";

let faixa: HTMLElement | null = null;

const desenhar = (estado: EstadoManutencao | null | undefined): void => {
  const ativo = Boolean(estado?.ativo);
  document.documentElement.dataset.manutencao = String(ativo);
  if (!ativo || !estado) {
    faixa?.remove();
    faixa = null;
    return;
  }
  if (!faixa) {
    faixa = document.createElement("div");
    faixa.className = "faixa-manutencao";
    faixa.setAttribute("role", "status");
    const cabecalho = document.querySelector(".casca-principal > .cabecalho");
    if (cabecalho) cabecalho.after(faixa);
    else document.body.prepend(faixa);
    faixa.addEventListener("click", async (evento) => {
      const botao = (evento.target as Element | null)?.closest<HTMLButtonElement>("[data-encerrar-manutencao]");
      if (!botao) return;
      botao.disabled = true;
      try {
        await api.substituir<EstadoManutencao>("/sistema/manutencao", { ativo: false });
        definirManutencao({ ativo: false, mensagem: "", desde: null, porId: null, porNome: null });
        avisar({ tipo: "sucesso", titulo: "Manutenção encerrada", texto: "O painel voltou a aceitar alterações." });
      } catch (erro) {
        botao.disabled = false;
        avisar({ tipo: "erro", titulo: "Não foi possível encerrar", texto: mensagemDeErro(erro) });
      }
    });
  }
  const administra = pode("configuracoes.sistema");
  renderizar(
    faixa,
    html`
      <span class="faixa-manutencao-icone">${html([icone("manutencao")])}</span>
      <p class="faixa-manutencao-texto">
        <strong>Modo de manutenção.</strong>
        ${administra ? "Só quem configura o sistema pode alterar dados agora." : "O painel aceita só consultas por enquanto."}
        ${estado.mensagem ? html`<span class="faixa-manutencao-mensagem">${estado.mensagem}</span>` : ""}
        ${estado.desde ? html`<span class="faixa-manutencao-meta">Desde ${relativo(estado.desde)}${estado.porNome ? ` · ${estado.porNome}` : ""}</span>` : ""}
      </p>
      ${administra ? html`<button type="button" class="botao botao-secundario botao-pequeno" data-encerrar-manutencao>${html([icone("confirmar")])}Encerrar</button>` : ""}
    `,
  );
};

export const definirManutencao = (estado: EstadoManutencao): void => {
  atualizarSistema({ manutencao: estado });
  desenhar(estado);
  emitir("sistema:manutencao", estado);
};

export const iniciarAvisoManutencao = (): void => {
  desenhar(sessao().sistema?.manutencao);
  ouvir<{ manutencao?: EstadoManutencao } | null>("tempo-real:sistema", (dados) => {
    if (dados?.manutencao) definirManutencao(dados.manutencao);
  });
};

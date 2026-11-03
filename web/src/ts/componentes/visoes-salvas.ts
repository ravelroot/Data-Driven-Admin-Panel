import { html, criar, renderizar } from "../nucleo/dom.ts";
import { hidratarIcones } from "../nucleo/icones.ts";
import { lerJson, gravarJson } from "../nucleo/armazenamento.ts";
import { usuarioAtual } from "../nucleo/sessao.ts";
import { adicionarVisao, normalizarConsulta, removerVisao, validarVisoes, visaoAtiva, LIMITE_VISOES, TAMANHO_NOME_VISAO } from "../nucleo/visoes.ts";
import type { VisaoSalva } from "../nucleo/visoes.ts";
import { confirmar } from "./modal.ts";
import { avisar, avisoSucesso } from "./aviso.ts";

export interface OpcoesVisoesSalvas {
  pagina: string;
  depoisDe: Element;
  ignorar?: string[];
  descricao?: string;
}

export interface ControleVisoes {
  atualizar: () => void;
}

export const iniciarVisoesSalvas = ({ pagina, depoisDe, ignorar = [], descricao = "os filtros, a busca e a ordenação" }: OpcoesVisoesSalvas): ControleVisoes => {
  const chave = `visoes:${usuarioAtual()?.id ?? "anonimo"}:${pagina}`;
  let visoes = validarVisoes(lerJson<unknown>(chave, []));
  const consultaAtual = (): string => normalizarConsulta(location.search, ignorar);
  const persistir = (lista: VisaoSalva[]): void => {
    visoes = lista;
    if (!gravarJson(chave, visoes)) avisar({ tipo: "alerta", titulo: "Não foi possível guardar", texto: "O navegador recusou o armazenamento local." });
  };

  const barra = criar<HTMLElement>(html`<div class="chips-filtro visoes-salvas" role="group" aria-label="Visões salvas" data-visoes-salvas></div>`);
  depoisDe.after(barra);

  const desenhar = (): void => {
    const consulta = consultaAtual();
    const ativa = visaoAtiva(visoes, consulta);
    renderizar(
      barra,
      html`
        ${visoes.map(
          (visao) =>
            html`<button type="button" class="chip-filtro" data-visao="${visao.id}" aria-pressed="${visao.id === ativa?.id}" title="Aplicar a visão ${visao.nome}"><i data-icone="marcador"></i>${visao.nome}</button>`,
        )}
        ${consulta && !ativa
          ? html`<button type="button" class="chip-filtro" data-visao-acao="salvar" aria-pressed="false"><i data-icone="adicionar"></i>Salvar visão</button>`
          : ""}
        ${ativa ? html`<button type="button" class="limpar-filtros" data-visao-acao="remover"><i data-icone="lixeira"></i>Remover visão</button>` : ""}
      `,
    );
    barra.hidden = visoes.length === 0 && !consulta;
    hidratarIcones(barra);
  };

  barra.addEventListener("click", async (evento) => {
    const alvo = (evento.target as Element | null)?.closest<HTMLElement>("[data-visao], [data-visao-acao]");
    if (!alvo) return;
    const id = alvo.dataset.visao;
    if (id) {
      const visao = visoes.find((item) => item.id === id);
      if (!visao) return;
      const destino = new URL(location.href);
      destino.search = visao.consulta;
      location.assign(destino.toString());
      return;
    }
    const consulta = consultaAtual();
    if (alvo.dataset.visaoAcao === "salvar") {
      if (visoes.length >= LIMITE_VISOES) {
        avisar({ tipo: "alerta", titulo: "Limite de visões", texto: `Remova uma das ${LIMITE_VISOES} visões salvas para criar outra.` });
        return;
      }
      const nome = await confirmar({
        titulo: "Salvar visão",
        texto: `Guarda ${descricao} atuais para voltar a eles com um clique. Fica salvo neste navegador.`,
        confirmar: "Salvar visão",
        campo: { rotulo: `Nome (até ${TAMANHO_NOME_VISAO} caracteres)`, placeholder: "Ex.: Pix pendentes da semana", obrigatorio: true },
      });
      if (typeof nome !== "string" || !nome.trim()) return;
      persistir(adicionarVisao(visoes, nome, consulta));
      avisoSucesso("Visão salva", visaoAtiva(visoes, consulta)?.nome ?? "");
      desenhar();
    } else if (alvo.dataset.visaoAcao === "remover") {
      const ativa = visaoAtiva(visoes, consulta);
      if (!ativa) return;
      persistir(removerVisao(visoes, ativa.id));
      avisoSucesso("Visão removida", ativa.nome);
      desenhar();
    }
  });

  desenhar();
  return { atualizar: desenhar };
};

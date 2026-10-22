import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-mono/500.css";
import "../../css/bento.css";

import { html, exigir, renderizar, type Seguro } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { ErroApi, mensagemDeErro } from "../nucleo/api.ts";
import { carregarSessao, pode, sessao } from "../nucleo/sessao.ts";
import { iniciarTema, sincronizarPreferencias } from "../nucleo/tema.ts";
import { conectarTempoReal } from "../nucleo/tempo-real.ts";
import { montarCasca } from "./casca.ts";
import { paginaPorId } from "./navegacao.ts";
import type { Sessao } from "../nucleo/tipos.ts";

export interface ContextoPagina {
  conteudo: HTMLElement;
  sessao: Sessao;
}

export interface OpcoesPagina {
  pagina: string;
  permissao?: string;
  aoIniciar?: (contexto: ContextoPagina) => unknown;
}

iniciarTema();

const telaDeErro = (titulo: string, texto: string, { acao = true }: { acao?: boolean } = {}): Seguro => html`
  <div class="vazio-pagina">
    <div class="vazio vazio-erro">
      <span class="vazio-icone">${html([icone("alerta")])}</span>
      <h1 class="vazio-titulo">${titulo}</h1>
      <p class="vazio-texto">${texto}</p>
      ${acao ? html`<div class="vazio-acoes"><button type="button" class="botao botao-primario" data-recarregar>${html([icone("atualizar")])}Tentar de novo</button></div>` : ""}
    </div>
  </div>
`;

const telaSemAcesso = (): Seguro => html`
  <div class="vazio-pagina">
    <div class="vazio">
      <span class="vazio-icone">${html([icone("cadeado")])}</span>
      <h1 class="vazio-titulo">Seu papel não dá acesso a esta página</h1>
      <p class="vazio-texto">Peça a um administrador para liberar a permissão em Usuários › Permissões.</p>
      <div class="vazio-acoes"><a class="botao botao-secundario" href="/">${html([icone("seta-esquerda")])}Voltar para o início</a></div>
    </div>
  </div>
`;

document.addEventListener("click", (evento) => {
  if ((evento.target as Element | null)?.closest("[data-recarregar]")) location.reload();
});

export const iniciarPagina = async ({ pagina, permissao, aoIniciar }: OpcoesPagina): Promise<void> => {
  const conteudo = exigir("#conteudo");
  const item = paginaPorId(pagina);
  const titulo = item?.rotulo ?? document.title;
  hidratarIcones(document);

  try {
    await carregarSessao();
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 401) return;
    document.body.dataset.pronto = "true";
    renderizar(conteudo, telaDeErro("A API não respondeu", `${mensagemDeErro(erro)} Rode "npm run dev" na pasta do projeto e recarregue esta página.`));
    return;
  }

  sincronizarPreferencias(sessao().preferencias);
  montarCasca({ pagina, titulo });
  conectarTempoReal();

  if (permissao && !pode(permissao)) {
    renderizar(conteudo, telaSemAcesso());
    document.body.dataset.pronto = "true";
    return;
  }

  try {
    await aoIniciar?.({ conteudo, sessao: sessao() });
  } catch (erro) {
    console.error(erro);
    renderizar(conteudo, telaDeErro("Algo deu errado ao montar a página", mensagemDeErro(erro)));
  } finally {
    hidratarIcones(conteudo);
    document.body.dataset.pronto = "true";
  }
};

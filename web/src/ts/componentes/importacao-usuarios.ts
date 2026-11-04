import { html, carregando, exigir } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { api, mensagemDeErro } from "../nucleo/api.ts";
import { numero, plural } from "../nucleo/formato.ts";
import { pode } from "../nucleo/sessao.ts";
import { Gaveta } from "./gaveta.ts";
import { avisar, avisoSucesso } from "./aviso.ts";
import type { Referencia } from "../nucleo/tipos.ts";

export const LIMITE_BYTES_IMPORTACAO = 900_000;

interface LinhaImportacao {
  linha: number;
  nome: string;
  email: string;
  papel: string;
  situacao: "criar" | "ignorar" | "erro";
  mensagem: string;
}

interface ResultadoImportacao {
  simulacao: boolean;
  total: number;
  criar: number;
  ignorar: number;
  erros: number;
  criados: number;
  colunas: { reconhecidas: string[]; ignoradas: string[] };
  linhas: LinhaImportacao[];
  linhasOmitidas: number;
}

interface OpcoesImportacao {
  papeis: Referencia[];
  aoImportar: (criados: number) => void;
}

const ROTULOS_SITUACAO: Record<LinhaImportacao["situacao"], string> = { criar: "Criar", ignorar: "Ignorar", erro: "Erro" };
const STATUS_SITUACAO: Record<LinhaImportacao["situacao"], string> = { criar: "sucesso", ignorar: "inativo", erro: "erro" };

export const decodificarPlanilha = (bytes: ArrayBuffer): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
};

export const abrirImportacaoUsuarios = ({ papeis, aoImportar }: OpcoesImportacao): void => {
  const gaveta = new Gaveta({ titulo: "Importar usuários", subtitulo: "Envie uma planilha CSV, confira a prévia e confirme.", largura: "larga" }).abrir();
  let conteudo = "";
  let nomeArquivo = "";
  const papeisPermitidos = papeis.filter((papel) => pode("usuarios.permissoes") || !["admin", "gerente"].includes(papel.codigo));

  const passoArquivo = (): void => {
    gaveta.definirCorpo(html`
      <form class="formulario" id="form-importacao" novalidate>
        <label class="importacao-zona" data-zona>
          <input type="file" accept=".csv,text/csv,text/plain" class="sr-only" data-arquivo>
          <span class="importacao-zona-icone">${html([icone("importar")])}</span>
          <span class="importacao-zona-titulo" data-arquivo-nome>${nomeArquivo || "Escolha ou arraste a planilha"}</span>
          <span class="importacao-zona-texto">CSV separado por vírgula, ponto e vírgula ou tabulação, com cabeçalho. Até 2.000 contas e 900 KB.</span>
        </label>
        <details class="importacao-colar">
          <summary>Ou cole o conteúdo da planilha</summary>
          <textarea class="entrada" rows="6" data-colar placeholder="nome;email;papel&#10;Ana Souza;ana@empresa.com;analista"></textarea>
        </details>
        <div class="grade-campos">
          <label class="campo">
            <span class="campo-rotulo">Papel quando a coluna vier vazia</span>
            <select class="selecao" name="papelPadrao">${papeisPermitidos.map((papel) => html`<option value="${papel.codigo}" ${papel.codigo === "cliente" ? "selected" : ""}>${papel.nome}</option>`)}</select>
          </label>
          <label class="campo">
            <span class="campo-rotulo">Status quando a coluna vier vazia</span>
            <select class="selecao" name="statusPadrao">
              <option value="ativo" selected>Ativo</option>
              <option value="pendente">Pendente</option>
              <option value="inativo">Inativo</option>
            </select>
          </label>
        </div>
        <div class="alerta alerta-info alerta-compacto">${html([icone("info")])}<span>Colunas reconhecidas: <code>nome</code> e <code>email</code> (obrigatórias), <code>papel</code>, <code>status</code>, <code>cargo</code>, <code>empresa</code>, <code>telefone</code>, <code>cidade</code>, <code>pais</code> e <code>canal</code>. As contas entram sem senha: use <strong>Redefinir senha</strong> para quem vai acessar o painel.</span></div>
      </form>
    `);
    gaveta.definirRodape(html`
      <div class="gaveta-rodape-esquerda"><button type="button" class="botao botao-fantasma" data-modelo>${html([icone("arquivo-baixar")])}Baixar modelo</button></div>
      <button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button>
      <button type="submit" form="form-importacao" class="botao botao-primario" data-conferir>${html([icone("verificacoes")])}Conferir planilha</button>
    `);
    const formulario = exigir<HTMLFormElement>("#form-importacao", gaveta.corpo);
    const entradaArquivo = exigir<HTMLInputElement>("[data-arquivo]", formulario);
    const zona = exigir("[data-zona]", formulario);
    const colar = exigir<HTMLTextAreaElement>("[data-colar]", formulario);
    if (conteudo && !nomeArquivo) colar.value = conteudo;

    const lerArquivo = async (arquivo: File | undefined): Promise<void> => {
      if (!arquivo) return;
      if (arquivo.size > LIMITE_BYTES_IMPORTACAO) {
        avisar({ tipo: "erro", titulo: "Planilha grande demais", texto: "Divida o arquivo em partes de até 900 KB." });
        return;
      }
      conteudo = decodificarPlanilha(await arquivo.arrayBuffer());
      nomeArquivo = arquivo.name;
      colar.value = "";
      exigir("[data-arquivo-nome]", zona).textContent = `${arquivo.name} · ${plural(Math.max(0, conteudo.split(/\r?\n/).filter((linha) => linha.trim()).length - 1), "linha", "linhas")}`;
      zona.dataset.pronta = "true";
    };

    entradaArquivo.addEventListener("change", () => void lerArquivo(entradaArquivo.files?.[0]));
    zona.addEventListener("dragover", (evento) => {
      evento.preventDefault();
      zona.dataset.arrastando = "true";
    });
    zona.addEventListener("dragleave", () => delete zona.dataset.arrastando);
    zona.addEventListener("drop", (evento) => {
      evento.preventDefault();
      delete zona.dataset.arrastando;
      void lerArquivo(evento.dataTransfer?.files?.[0]);
    });
    colar.addEventListener("input", () => {
      if (colar.value.trim()) {
        conteudo = colar.value;
        nomeArquivo = "";
        exigir("[data-arquivo-nome]", zona).textContent = "Escolha ou arraste a planilha";
        delete zona.dataset.pronta;
      }
    });
    exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
    exigir("[data-modelo]", gaveta.rodape).addEventListener("click", async (evento) => {
      const botao = evento.currentTarget as HTMLButtonElement;
      carregando(botao, true);
      try {
        await api.baixar("/usuarios/importar/modelo", null, "bento-modelo-importacao.csv");
      } catch (erro) {
        avisar({ tipo: "erro", titulo: "Não foi possível baixar o modelo", texto: mensagemDeErro(erro) });
      } finally {
        carregando(botao, false);
      }
    });
    formulario.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      if (!conteudo.trim()) {
        avisar({ tipo: "alerta", titulo: "Escolha uma planilha", texto: "Envie um arquivo CSV ou cole o conteúdo no campo." });
        return;
      }
      const botao = gaveta.rodape.querySelector<HTMLButtonElement>("[data-conferir]");
      carregando(botao, true);
      const opcoes = {
        papelPadrao: (formulario.elements.namedItem("papelPadrao") as HTMLSelectElement).value,
        statusPadrao: (formulario.elements.namedItem("statusPadrao") as HTMLSelectElement).value,
      };
      try {
        const resultado = await api.criar<ResultadoImportacao>("/usuarios/importar", { csv: conteudo, simular: true, ...opcoes });
        passoPrevia(resultado, opcoes);
      } catch (erro) {
        avisar({ tipo: "erro", titulo: "Não foi possível ler a planilha", texto: mensagemDeErro(erro) });
      } finally {
        carregando(botao, false);
      }
    });
  };

  const passoPrevia = (resultado: ResultadoImportacao, opcoes: { papelPadrao: string; statusPadrao: string }): void => {
    gaveta.definirCorpo(html`
      <div class="importacao-resumo">
        <div class="importacao-numero" data-situacao="criar"><span class="importacao-numero-valor">${numero(resultado.criar)}</span><span class="importacao-numero-rotulo">${resultado.criar === 1 ? "conta nova" : "contas novas"}</span></div>
        <div class="importacao-numero" data-situacao="ignorar"><span class="importacao-numero-valor">${numero(resultado.ignorar)}</span><span class="importacao-numero-rotulo">${resultado.ignorar === 1 ? "ignorada" : "ignoradas"}</span></div>
        <div class="importacao-numero" data-situacao="erro"><span class="importacao-numero-valor">${numero(resultado.erros)}</span><span class="importacao-numero-rotulo">com erro</span></div>
      </div>
      <p class="importacao-colunas">
        Colunas reconhecidas: ${resultado.colunas.reconhecidas.map((coluna) => html`<code>${coluna}</code> `)}
        ${resultado.colunas.ignoradas.length ? html`<br>Ignoradas: ${resultado.colunas.ignoradas.map((coluna) => html`<code>${coluna}</code> `)}` : ""}
      </p>
      <div class="tabela-moldura importacao-tabela">
        <table class="tabela">
          <caption class="sr-only">Prévia da importação, linha a linha</caption>
          <thead><tr><th scope="col">Linha</th><th scope="col">Conta</th><th scope="col">Papel</th><th scope="col">Situação</th></tr></thead>
          <tbody>
            ${resultado.linhas.slice(0, 200).map(
              (linha) => html`<tr>
                <td class="celula-codigo">${linha.linha}</td>
                <td><span class="celula-usuario-nome">${linha.nome || "—"}</span><span class="celula-usuario-email">${linha.email || "—"}</span></td>
                <td>${papeis.find((papel) => papel.codigo === linha.papel)?.nome ?? linha.papel ?? "—"}</td>
                <td><span class="emblema emblema-pequeno" data-status="${STATUS_SITUACAO[linha.situacao]}">${ROTULOS_SITUACAO[linha.situacao]}</span><span class="importacao-mensagem">${linha.mensagem}</span></td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      ${resultado.linhas.length > 200 || resultado.linhasOmitidas ? html`<p class="texto-suave text-xs mt-2">Mostrando as primeiras 200 linhas, com erros e ignoradas primeiro.</p>` : ""}
    `);
    gaveta.definirRodape(html`
      <div class="gaveta-rodape-esquerda"><button type="button" class="botao botao-fantasma" data-voltar>${html([icone("seta-esquerda")])}Trocar a planilha</button></div>
      <button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button>
      <button type="button" class="botao botao-primario" data-importar ${resultado.criar ? "" : "disabled"}>${html([icone("importar")])}${resultado.criar ? `Importar ${plural(resultado.criar, "conta", "contas")}` : "Nada para importar"}</button>
    `);
    hidratarIcones(gaveta.corpo);
    exigir("[data-voltar]", gaveta.rodape).addEventListener("click", () => passoArquivo());
    exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
    exigir("[data-importar]", gaveta.rodape).addEventListener("click", async (evento) => {
      const botao = evento.currentTarget as HTMLButtonElement;
      carregando(botao, true);
      try {
        const final = await api.criar<ResultadoImportacao>("/usuarios/importar", { csv: conteudo, simular: false, ...opcoes });
        gaveta.fechar();
        avisoSucesso(`${plural(final.criados, "conta importada", "contas importadas")}`, final.ignorar || final.erros ? `${numero(final.ignorar)} ignoradas e ${numero(final.erros)} com erro ficaram de fora.` : undefined);
        aoImportar(final.criados);
      } catch (erro) {
        carregando(botao, false);
        avisar({ tipo: "erro", titulo: "Não foi possível importar", texto: mensagemDeErro(erro) });
      }
    });
  };

  passoArquivo();
};

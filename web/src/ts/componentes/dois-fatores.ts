import { html, exigir, renderizar, carregando, copiar } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { api, mensagemDeErro, ErroApi } from "../nucleo/api.ts";
import { atualizarDoisFatores, usuarioAtual } from "../nucleo/sessao.ts";
import { relativo } from "../nucleo/formato.ts";
import { Gaveta } from "./gaveta.ts";
import { avisar, avisoSucesso } from "./aviso.ts";
import { limparErros, mostrarErros, ligarMostrarSenha } from "./formulario.ts";
import { svgQr } from "./qr.ts";
import type { EstadoDoisFatores } from "../nucleo/tipos.ts";

interface Configuracao {
  segredo: string;
  uri: string;
  emissor: string;
  conta: string;
  expiraEm: string;
}

interface ComCodigos {
  codigos: string[];
  estado: EstadoDoisFatores;
}

const base = "/configuracoes/seguranca/dois-fatores";

const campoSenha = (id: string) => html`
  <label class="campo">
    <span class="campo-rotulo campo-obrigatorio">Senha atual</span>
    <span class="entrada-caixa"><input class="entrada" type="password" name="senhaAtual" id="${id}" required autocomplete="current-password"><button type="button" class="entrada-caixa-acao" data-mostrar-senha aria-label="Mostrar senha">${html([icone("olho")])}</button></span>
  </label>
`;

const campoCodigo = (ajuda: string) => html`
  <label class="campo">
    <span class="campo-rotulo campo-obrigatorio">Código</span>
    <input class="entrada entrada-codigo-config" name="codigo" required inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="000000" spellcheck="false">
    <span class="campo-ajuda">${ajuda}</span>
  </label>
`;

const tratarErro = (formulario: HTMLFormElement, erro: unknown, titulo: string): void => {
  if (erro instanceof ErroApi && erro.codigo === "CREDENCIAIS") {
    mostrarErros(formulario, [{ campo: "senhaAtual", mensagem: erro.message }]);
    return;
  }
  if (erro instanceof ErroApi && erro.detalhes && mostrarErros(formulario, erro.detalhes)) return;
  avisar({ tipo: "erro", titulo, texto: mensagemDeErro(erro) });
};

const textoCodigos = (codigos: string[]): string =>
  [`Códigos de recuperação do Bento para ${usuarioAtual()?.email ?? "sua conta"}`, `Gerados em ${new Date().toLocaleString("pt-BR")}`, "Cada código vale uma vez.", "", ...codigos].join("\n");

const baixarCodigos = (codigos: string[]): void => {
  const url = URL.createObjectURL(new Blob([textoCodigos(codigos)], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "bento-codigos-de-recuperacao.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const mostrarCodigos = (gaveta: Gaveta, codigos: string[], titulo: string, aoConcluir: () => void): void => {
  gaveta.definirTitulo(titulo, "Guarde os códigos em um gerenciador de senhas ou impressos. Eles não aparecem de novo.");
  gaveta.definirCorpo(html`
    <div class="pilha">
      <div class="alerta alerta-alerta">${html([icone("chave")])}<div class="alerta-textos"><p class="alerta-titulo">Para quando o celular não estiver à mão</p><p class="alerta-texto">Cada código entra uma única vez no lugar do código do aplicativo. Gerar novos invalida estes.</p></div></div>
      <ol class="codigos-recuperacao" aria-label="Códigos de recuperação">${codigos.map((codigo) => html`<li><code>${codigo}</code></li>`)}</ol>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="botao botao-secundario botao-pequeno" data-copiar-codigos>${html([icone("copiar")])}<span>Copiar</span></button>
        <button type="button" class="botao botao-secundario botao-pequeno" data-baixar-codigos>${html([icone("baixar")])}Baixar .txt</button>
      </div>
      <label class="opcao"><input type="checkbox" class="caixa-marcacao" data-guardei><span class="opcao-texto"><span class="opcao-titulo">Guardei os códigos em um lugar seguro</span></span></label>
    </div>
  `);
  gaveta.definirRodape(html`<button type="button" class="botao botao-primario" data-concluir disabled>${html([icone("confirmar")])}Concluir</button>`);
  const concluir = exigir<HTMLButtonElement>("[data-concluir]", gaveta.rodape);
  exigir<HTMLInputElement>("[data-guardei]", gaveta.corpo).addEventListener("change", (evento) => {
    concluir.disabled = !(evento.currentTarget as HTMLInputElement).checked;
  });
  const botaoCopiar = exigir<HTMLButtonElement>("[data-copiar-codigos]", gaveta.corpo);
  botaoCopiar.addEventListener("click", async () => {
    const ok = await copiar(codigos.join("\n"));
    exigir("span", botaoCopiar).textContent = ok ? "Copiados" : "Copie manualmente";
  });
  exigir("[data-baixar-codigos]", gaveta.corpo).addEventListener("click", () => baixarCodigos(codigos));
  concluir.addEventListener("click", () => {
    gaveta.fechar();
    aoConcluir();
  });
};

const abrirAtivacao = (recarregar: () => Promise<void>): void => {
  const gaveta = new Gaveta({ titulo: "Ativar a verificação em duas etapas", subtitulo: "Etapa 1 de 3: confirme que é você." }).abrir();
  gaveta.definirCorpo(html`
    <form class="formulario" id="form-2fa-senha" novalidate>
      <p class="text-sm texto-suave">Você vai precisar de um aplicativo autenticador no celular, como Google Authenticator, Microsoft Authenticator, 1Password ou Authy.</p>
      ${campoSenha("senha-2fa")}
    </form>
  `);
  ligarMostrarSenha(gaveta.corpo);
  gaveta.definirRodape(html`<button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button><button type="submit" form="form-2fa-senha" class="botao botao-primario" data-continuar>Continuar${html([icone("seta-direita")])}</button>`);
  exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
  const formulario = exigir<HTMLFormElement>("#form-2fa-senha", gaveta.corpo);
  exigir<HTMLInputElement>("#senha-2fa", gaveta.corpo).focus();
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = exigir<HTMLButtonElement>("[data-continuar]", gaveta.rodape);
    carregando(botao, true);
    try {
      const configuracao = await api.criar<Configuracao>(`${base}/iniciar`, { senhaAtual: exigir<HTMLInputElement>("#senha-2fa", gaveta.corpo).value });
      mostrarQr(gaveta, configuracao, recarregar);
    } catch (erro) {
      carregando(botao, false);
      tratarErro(formulario, erro, "Não foi possível começar");
    }
  });
};

const mostrarQr = (gaveta: Gaveta, configuracao: Configuracao, recarregar: () => Promise<void>): void => {
  gaveta.definirTitulo("Ativar a verificação em duas etapas", "Etapa 2 de 3: leia o QR code no aplicativo.");
  gaveta.definirCorpo(html`
    <form class="formulario" id="form-2fa-codigo" novalidate>
      <div class="qr-configuracao">
        <figure class="qr-imagem">${html([svgQr(configuracao.uri, `QR code para adicionar ${configuracao.conta} ao aplicativo autenticador`)])}</figure>
        <div class="pilha-pequena">
          <p class="text-sm">No aplicativo, toque em <strong>Adicionar conta</strong> e aponte a câmera para o QR code.</p>
          <p class="text-sm texto-suave">Sem câmera? Escolha digitar a chave e use:</p>
          <div class="segredo segredo-compacto"><code data-segredo>${configuracao.segredo}</code><button type="button" class="botao botao-secundario botao-pequeno" data-copiar-segredo>${html([icone("copiar")])}<span>Copiar</span></button></div>
          <p class="campo-ajuda">Conta: ${configuracao.emissor} (${configuracao.conta}). A chave vale até ${new Date(configuracao.expiraEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.</p>
        </div>
      </div>
      ${campoCodigo("Digite o código de 6 dígitos que o aplicativo mostra agora.")}
    </form>
  `);
  gaveta.definirRodape(html`<button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button><button type="submit" form="form-2fa-codigo" class="botao botao-primario" data-ativar>${html([icone("escudo-ok")])}Ativar</button>`);
  exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
  const botaoCopiar = exigir<HTMLButtonElement>("[data-copiar-segredo]", gaveta.corpo);
  botaoCopiar.addEventListener("click", async () => {
    const ok = await copiar(configuracao.segredo.replace(/\s/g, ""));
    exigir("span", botaoCopiar).textContent = ok ? "Copiada" : "Copie manualmente";
  });
  const formulario = exigir<HTMLFormElement>("#form-2fa-codigo", gaveta.corpo);
  const entrada = exigir<HTMLInputElement>('input[name="codigo"]', formulario);
  entrada.focus();
  const enviar = async (): Promise<void> => {
    limparErros(formulario);
    const codigo = entrada.value.replace(/\D/g, "");
    if (codigo.length !== 6) {
      mostrarErros(formulario, [{ campo: "codigo", mensagem: "Digite os 6 dígitos." }]);
      return;
    }
    const botao = exigir<HTMLButtonElement>("[data-ativar]", gaveta.rodape);
    carregando(botao, true);
    try {
      const { codigos, estado } = await api.criar<ComCodigos>(`${base}/ativar`, { codigo });
      atualizarDoisFatores(estado);
      avisoSucesso("Verificação em duas etapas ativada", "As outras sessões foram encerradas.");
      mostrarCodigos(gaveta, codigos, "Ativar a verificação em duas etapas", () => void recarregar());
      gaveta.definirTitulo("Ativar a verificação em duas etapas", "Etapa 3 de 3: guarde os códigos de recuperação.");
      void recarregar();
    } catch (erro) {
      carregando(botao, false);
      tratarErro(formulario, erro, "Não foi possível ativar");
      entrada.select();
    }
  };
  formulario.addEventListener("submit", (evento) => {
    evento.preventDefault();
    void enviar();
  });
  entrada.addEventListener("input", () => {
    if (entrada.value.replace(/\D/g, "").length === 6) void enviar();
  });
};

const abrirNovosCodigos = (recarregar: () => Promise<void>): void => {
  const gaveta = new Gaveta({ titulo: "Novos códigos de recuperação", subtitulo: "Os códigos atuais deixam de valer." }).abrir();
  gaveta.definirCorpo(html`<form class="formulario" id="form-2fa-codigos" novalidate>${campoSenha("senha-codigos")}${campoCodigo("Código do aplicativo ou um dos códigos de recuperação atuais.")}</form>`);
  ligarMostrarSenha(gaveta.corpo);
  const entradaCodigo = exigir<HTMLInputElement>('input[name="codigo"]', gaveta.corpo);
  entradaCodigo.inputMode = "text";
  entradaCodigo.placeholder = "000000 ou XXXX-XXXX";
  gaveta.definirRodape(html`<button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button><button type="submit" form="form-2fa-codigos" class="botao botao-primario" data-gerar>${html([icone("atualizar")])}Gerar códigos</button>`);
  exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
  const formulario = exigir<HTMLFormElement>("#form-2fa-codigos", gaveta.corpo);
  exigir<HTMLInputElement>("#senha-codigos", gaveta.corpo).focus();
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = exigir<HTMLButtonElement>("[data-gerar]", gaveta.rodape);
    carregando(botao, true);
    try {
      const { codigos, estado } = await api.criar<ComCodigos>(`${base}/codigos`, { senhaAtual: exigir<HTMLInputElement>("#senha-codigos", gaveta.corpo).value, codigo: entradaCodigo.value.trim() });
      atualizarDoisFatores(estado);
      mostrarCodigos(gaveta, codigos, "Novos códigos de recuperação", () => void recarregar());
      void recarregar();
    } catch (erro) {
      carregando(botao, false);
      tratarErro(formulario, erro, "Não foi possível gerar os códigos");
    }
  });
};

const abrirDesativacao = (recarregar: () => Promise<void>): void => {
  const gaveta = new Gaveta({ titulo: "Desativar a verificação em duas etapas", subtitulo: "A conta volta a entrar só com a senha." }).abrir();
  gaveta.definirCorpo(html`
    <form class="formulario" id="form-2fa-desativar" novalidate>
      <div class="alerta alerta-erro">${html([icone("escudo-alerta")])}<div class="alerta-textos"><p class="alerta-texto">Sem o segundo passo, quem descobrir a sua senha entra no painel.</p></div></div>
      ${campoSenha("senha-desativar")}
      ${campoCodigo("Código do aplicativo ou um código de recuperação.")}
    </form>
  `);
  ligarMostrarSenha(gaveta.corpo);
  const entrada = exigir<HTMLInputElement>('input[name="codigo"]', gaveta.corpo);
  entrada.inputMode = "text";
  entrada.placeholder = "000000 ou XXXX-XXXX";
  gaveta.definirRodape(html`<button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button><button type="submit" form="form-2fa-desativar" class="botao botao-perigo" data-desativar>Desativar</button>`);
  exigir("[data-cancelar]", gaveta.rodape).addEventListener("click", () => gaveta.fechar());
  const formulario = exigir<HTMLFormElement>("#form-2fa-desativar", gaveta.corpo);
  exigir<HTMLInputElement>("#senha-desativar", gaveta.corpo).focus();
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros(formulario);
    if (!formulario.reportValidity()) return;
    const botao = exigir<HTMLButtonElement>("[data-desativar]", gaveta.rodape);
    carregando(botao, true);
    try {
      const estado = await api.criar<EstadoDoisFatores>(`${base}/desativar`, {
        senhaAtual: exigir<HTMLInputElement>("#senha-desativar", gaveta.corpo).value,
        codigo: entrada.value.trim(),
      });
      atualizarDoisFatores(estado);
      gaveta.fechar();
      avisoSucesso("Verificação em duas etapas desativada");
      void recarregar();
    } catch (erro) {
      carregando(botao, false);
      tratarErro(formulario, erro, "Não foi possível desativar");
    }
  });
};

export const iniciarDoisFatores = async (alvo: HTMLElement): Promise<void> => {
  const recarregar = async (): Promise<void> => {
    try {
      const estado = await api.obter<EstadoDoisFatores>(base);
      atualizarDoisFatores(estado);
      const poucos = estado.ativo && estado.codigosRestantes <= 2;
      renderizar(
        alvo,
        html`<div class="dois-fatores" data-ativo="${estado.ativo}">
          <span class="sessao-icone">${html([icone(estado.ativo ? "escudo-ok" : "escudo")])}</span>
          <div class="sessao-textos">
            <p class="sessao-titulo">Aplicativo autenticador<span class="emblema emblema-pequeno ${estado.ativo ? "emblema-oliva" : "emblema-neutro"}">${estado.ativo ? "Ativa" : "Desligada"}</span>${estado.obrigatorio ? html`<span class="emblema emblema-pequeno emblema-ouro">Obrigatória para o seu papel</span>` : ""}</p>
            <p class="sessao-detalhe">${estado.ativo
              ? `Ativada ${relativo(estado.ativadoEm ?? "")}. ${estado.codigosRestantes} de 10 códigos de recuperação disponíveis.`
              : "Depois da senha, o painel pede o código de 6 dígitos do aplicativo."}</p>
            ${poucos ? html`<p class="sessao-detalhe dois-fatores-aviso">Restam poucos códigos de recuperação. Gere novos para não ficar sem acesso.</p>` : ""}
          </div>
          <div class="dois-fatores-acoes">
            ${estado.ativo
              ? html`<button type="button" class="botao botao-secundario botao-pequeno" data-2fa="codigos">${html([icone("chave")])}Novos códigos</button>
                  ${estado.obrigatorio ? "" : html`<button type="button" class="botao botao-perigo-suave botao-pequeno" data-2fa="desativar">Desativar</button>`}`
              : html`<button type="button" class="botao botao-primario botao-pequeno" data-2fa="ativar">${html([icone("qr")])}Ativar</button>`}
          </div>
        </div>`,
      );
      hidratarIcones(alvo);
    } catch (erro) {
      renderizar(alvo, html`<p class="text-sm texto-suave">${mensagemDeErro(erro)}</p>`);
    }
  };
  alvo.addEventListener("click", (evento) => {
    const botao = (evento.target as Element).closest<HTMLElement>("[data-2fa]");
    if (!botao) return;
    if (botao.dataset["2fa"] === "ativar") abrirAtivacao(recarregar);
    if (botao.dataset["2fa"] === "codigos") abrirNovosCodigos(recarregar);
    if (botao.dataset["2fa"] === "desativar") abrirDesativacao(recarregar);
  });
  await recarregar();
};

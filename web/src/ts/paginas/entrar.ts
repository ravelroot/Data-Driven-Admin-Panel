import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "../../css/bento.css";

import { $$, carregando, exigir, parametrosUrl } from "../nucleo/dom.ts";
import { hidratarIcones, LOGO_BENTO } from "../nucleo/icones.ts";
import { api, ErroApi, mensagemDeErro } from "../nucleo/api.ts";
import { iniciarTema, alternarTema, sincronizarPreferencias } from "../nucleo/tema.ts";
import { ligarMostrarSenha } from "../componentes/formulario.ts";
import { hrefPaginaInicial } from "../layout/navegacao.ts";
import type { Preferencias } from "../nucleo/tipos.ts";

interface CamposEntrar extends HTMLFormControlsCollection {
  email: HTMLInputElement;
  senha: HTMLInputElement;
  lembrar: HTMLInputElement;
}

interface FormularioEntrar extends HTMLFormElement {
  readonly elements: CamposEntrar;
}

interface RespostaEntrar {
  preferencias?: Partial<Preferencias> | null;
  permissoes?: string[];
  doisFatores?: boolean | { pendente?: boolean };
  expiraEm?: string;
  codigosRestantes?: number | null;
}

iniciarTema();

const MENSAGENS: Record<string, string> = {
  CREDENCIAIS: "E-mail ou senha incorretos. Confira e tente de novo.",
  BLOQUEADO: "Esta conta está bloqueada. Fale com um administrador para liberar o acesso.",
  SEM_ACESSO_PAINEL: "Sua conta não tem acesso ao painel administrativo.",
  LIMITE: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
};

const destinoSeguro = (contexto?: RespostaEntrar | null): string => {
  const { voltar } = parametrosUrl();
  if (voltar && voltar.startsWith("/") && !/^\/[/\\]/.test(voltar) && !voltar.startsWith("/entrar")) return voltar;
  const permissoes = new Set(contexto?.permissoes ?? []);
  return hrefPaginaInicial(contexto?.preferencias?.paginaInicial, (permissao) => !permissao || permissoes.has(permissao));
};

const mostrarErro = (texto: string): void => {
  exigir("[data-erro-texto]").textContent = texto;
  exigir("[data-erro]").hidden = !texto;
};

const mostrarErroCodigo = (texto: string): void => {
  exigir("[data-erro-codigo-texto]").textContent = texto;
  exigir("[data-erro-codigo]").hidden = !texto;
};

const destinoAposEntrar = (resposta: RespostaEntrar): string => {
  if (typeof resposta.doisFatores === "object" && resposta.doisFatores?.pendente) return "/configuracoes?secao=seguranca&obrigatorio=1";
  if (typeof resposta.codigosRestantes === "number" && resposta.codigosRestantes <= 2) return "/configuracoes?secao=seguranca";
  return destinoSeguro(resposta);
};

let temporizadorDesafio = 0;

const mostrarEtapa = (etapa: "senha" | "codigo"): void => {
  exigir('[data-etapa="senha"]').hidden = etapa !== "senha";
  exigir('[data-etapa="codigo"]').hidden = etapa !== "codigo";
  const campo = exigir<HTMLInputElement>(etapa === "senha" ? 'input[name="senha"]' : "[data-campo-codigo]");
  requestAnimationFrame(() => campo.focus());
};

const definirModoRecuperacao = (ativo: boolean): void => {
  const campo = exigir<HTMLInputElement>("[data-campo-codigo]");
  const botao = exigir<HTMLButtonElement>("[data-alternar-recuperacao]");
  campo.value = "";
  campo.dataset.recuperacao = String(ativo);
  campo.inputMode = ativo ? "text" : "numeric";
  campo.autocomplete = ativo ? "off" : "one-time-code";
  campo.maxLength = ativo ? 9 : 7;
  campo.pattern = ativo ? "[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}" : "[0-9 ]{6,7}";
  campo.placeholder = ativo ? "XXXX-XXXX" : "000 000";
  exigir("[data-codigo-rotulo]").textContent = ativo ? "Código de recuperação" : "Código do aplicativo";
  exigir("[data-codigo-instrucao]").textContent = ativo
    ? "Digite um dos códigos de recuperação que você guardou ao ativar a verificação. Cada um vale uma vez."
    : "Abra o aplicativo autenticador e digite o código de 6 dígitos do Bento.";
  botao.querySelector("span")!.textContent = ativo ? "Usar o código do aplicativo" : "Usar um código de recuperação";
  mostrarErroCodigo("");
  campo.focus();
};

const iniciarContagem = (expiraEm: string | undefined, aoExpirar: () => void): void => {
  window.clearInterval(temporizadorDesafio);
  const limite = expiraEm ? new Date(expiraEm).getTime() : Date.now() + 300_000;
  const validade = exigir("[data-codigo-validade]");
  const atualizar = (): void => {
    const restante = Math.max(0, Math.round((limite - Date.now()) / 1000));
    if (restante === 0) {
      window.clearInterval(temporizadorDesafio);
      aoExpirar();
      return;
    }
    const minutos = Math.floor(restante / 60);
    validade.textContent = `O código do aplicativo muda a cada 30 segundos. Esta etapa vale por mais ${minutos}:${String(restante % 60).padStart(2, "0")}.`;
  };
  atualizar();
  temporizadorDesafio = window.setInterval(atualizar, 1000);
};

const iniciar = async (): Promise<void> => {
  for (const alvo of $$("[data-logo]")) alvo.innerHTML = LOGO_BENTO;
  hidratarIcones(document);
  ligarMostrarSenha(document);

  try {
    const contexto = await api.obter<RespostaEntrar>("/auth/eu");
    location.replace(destinoSeguro(contexto));
    return;
  } catch {
    document.body.dataset.pronto = "true";
  }

  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || parametrosUrl().demo !== undefined) {
    exigir("[data-contas-demo]").hidden = false;
  }

  const formulario = exigir<FormularioEntrar>("[data-entrar]");
  exigir("[data-alternar-tema]").addEventListener("click", () => alternarTema());

  exigir("[data-contas-demo]").addEventListener("click", (evento) => {
    const botao = (evento.target as Element | null)?.closest<HTMLElement>("[data-conta]");
    if (!botao) return;
    formulario.elements.email.value = botao.dataset.conta ?? "";
    formulario.elements.senha.value = "bento123";
    formulario.requestSubmit();
  });

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    mostrarErro("");
    if (!formulario.reportValidity()) return;
    const botao = exigir<HTMLButtonElement>("[data-botao-entrar]");
    carregando(botao, true);
    try {
      const resposta = await api.criar<RespostaEntrar>("/auth/entrar", {
        email: formulario.elements.email.value.trim(),
        senha: formulario.elements.senha.value,
        lembrar: formulario.elements.lembrar.checked,
      });
      if (resposta.doisFatores === true) {
        carregando(botao, false);
        definirModoRecuperacao(false);
        mostrarEtapa("codigo");
        iniciarContagem(resposta.expiraEm, () => {
          mostrarEtapa("senha");
          mostrarErro("A verificação expirou. Entre com a senha de novo.");
          formulario.elements.senha.value = "";
        });
        return;
      }
      sincronizarPreferencias(resposta.preferencias);
      location.replace(destinoAposEntrar(resposta));
    } catch (erro) {
      carregando(botao, false);
      mostrarErro(erro instanceof ErroApi ? (MENSAGENS[erro.codigo] ?? erro.message) : mensagemDeErro(erro));
      formulario.elements.senha.select();
    }
  });

  const formularioCodigo = exigir<HTMLFormElement>("[data-form-codigo]");
  const campoCodigo = exigir<HTMLInputElement>("[data-campo-codigo]");
  const enviarCodigo = async (): Promise<void> => {
    mostrarErroCodigo("");
    const recuperacao = campoCodigo.dataset.recuperacao === "true";
    const codigo = recuperacao ? campoCodigo.value.trim().toUpperCase() : campoCodigo.value.replace(/\D/g, "");
    if (recuperacao ? !/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(codigo) : codigo.length !== 6) {
      mostrarErroCodigo(recuperacao ? "Use o formato XXXX-XXXX." : "Digite os 6 dígitos do aplicativo.");
      campoCodigo.focus();
      return;
    }
    const botao = exigir<HTMLButtonElement>("[data-botao-codigo]");
    carregando(botao, true);
    try {
      const resposta = await api.criar<RespostaEntrar>("/auth/dois-fatores", { codigo }, { semRenovar: true });
      window.clearInterval(temporizadorDesafio);
      sincronizarPreferencias(resposta.preferencias);
      location.replace(destinoAposEntrar(resposta));
    } catch (erro) {
      carregando(botao, false);
      if (erro instanceof ErroApi && erro.codigo === "NAO_AUTENTICADO") {
        window.clearInterval(temporizadorDesafio);
        mostrarEtapa("senha");
        mostrarErro(erro.message);
        return;
      }
      mostrarErroCodigo(erro instanceof ErroApi ? (erro.codigo === "LIMITE" ? MENSAGENS.LIMITE : erro.message) : mensagemDeErro(erro));
      campoCodigo.select();
    }
  };

  formularioCodigo.addEventListener("submit", (evento) => {
    evento.preventDefault();
    void enviarCodigo();
  });
  campoCodigo.addEventListener("input", () => {
    if (campoCodigo.dataset.recuperacao === "true") return;
    const digitos = campoCodigo.value.replace(/\D/g, "").slice(0, 6);
    campoCodigo.value = digitos.length > 3 ? `${digitos.slice(0, 3)} ${digitos.slice(3)}` : digitos;
    if (digitos.length === 6) void enviarCodigo();
  });
  exigir("[data-alternar-recuperacao]").addEventListener("click", () => definirModoRecuperacao(campoCodigo.dataset.recuperacao !== "true"));
  exigir("[data-voltar-senha]").addEventListener("click", () => {
    window.clearInterval(temporizadorDesafio);
    mostrarErroCodigo("");
    mostrarEtapa("senha");
  });
};

iniciar();

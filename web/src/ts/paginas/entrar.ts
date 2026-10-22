import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-mono/500.css";
import "../../css/bento.css";

import { $$, carregando, exigir, parametrosUrl } from "../nucleo/dom.ts";
import { hidratarIcones, LOGO_BENTO } from "../nucleo/icones.ts";
import { api, ErroApi, mensagemDeErro } from "../nucleo/api.ts";
import { iniciarTema, alternarTema, sincronizarPreferencias } from "../nucleo/tema.ts";
import { ligarMostrarSenha } from "../componentes/formulario.ts";
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
}

iniciarTema();

const MENSAGENS: Record<string, string> = {
  CREDENCIAIS: "E-mail ou senha incorretos. Confira e tente de novo.",
  BLOQUEADO: "Esta conta está bloqueada. Fale com um administrador para liberar o acesso.",
  SEM_ACESSO_PAINEL: "Sua conta não tem acesso ao painel administrativo.",
  LIMITE: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
};

const destinoSeguro = (): string => {
  const { voltar } = parametrosUrl();
  if (voltar && voltar.startsWith("/") && !voltar.startsWith("//") && !voltar.startsWith("/entrar")) return voltar;
  return "/";
};

const mostrarErro = (texto: string): void => {
  exigir("[data-erro-texto]").textContent = texto;
  exigir("[data-erro]").hidden = !texto;
};

const iniciar = async (): Promise<void> => {
  for (const alvo of $$("[data-logo]")) alvo.innerHTML = LOGO_BENTO;
  hidratarIcones(document);
  ligarMostrarSenha(document);

  try {
    await api.obter("/auth/eu");
    location.replace(destinoSeguro());
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
      sincronizarPreferencias(resposta.preferencias);
      location.replace(destinoSeguro());
    } catch (erro) {
      carregando(botao, false);
      mostrarErro(erro instanceof ErroApi ? (MENSAGENS[erro.codigo] ?? erro.message) : mensagemDeErro(erro));
      formulario.elements.senha.select();
    }
  });
};

iniciar();

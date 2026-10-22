import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-mono/500.css";
import "../../css/bento.css";

import { $, $$, carregando, parametrosUrl } from "../nucleo/dom.js";
import { hidratarIcones, LOGO_BENTO } from "../nucleo/icones.js";
import { api, ErroApi, mensagemDeErro } from "../nucleo/api.js";
import { iniciarTema, alternarTema, sincronizarPreferencias } from "../nucleo/tema.js";
import { ligarMostrarSenha } from "../componentes/formulario.js";

iniciarTema();

const MENSAGENS = {
  CREDENCIAIS: "E-mail ou senha incorretos. Confira e tente de novo.",
  BLOQUEADO: "Esta conta está bloqueada. Fale com um administrador para liberar o acesso.",
  SEM_ACESSO_PAINEL: "Sua conta não tem acesso ao painel administrativo.",
  LIMITE: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
};

const destinoSeguro = () => {
  const { voltar } = parametrosUrl();
  if (voltar && voltar.startsWith("/") && !voltar.startsWith("//") && !voltar.startsWith("/entrar")) return voltar;
  return "/";
};

const mostrarErro = (texto) => {
  $("[data-erro-texto]").textContent = texto;
  $("[data-erro]").hidden = !texto;
};

const iniciar = async () => {
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
    $("[data-contas-demo]").hidden = false;
  }

  const formulario = $("[data-entrar]");
  $("[data-alternar-tema]").addEventListener("click", alternarTema);

  $("[data-contas-demo]").addEventListener("click", (evento) => {
    const botao = evento.target.closest("[data-conta]");
    if (!botao) return;
    formulario.elements.email.value = botao.dataset.conta;
    formulario.elements.senha.value = "bento123";
    formulario.requestSubmit();
  });

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    mostrarErro("");
    if (!formulario.reportValidity()) return;
    const botao = $("[data-botao-entrar]");
    carregando(botao, true);
    try {
      const resposta = await api.criar("/auth/entrar", {
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

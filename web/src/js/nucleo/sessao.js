import { api } from "./api.js";
import { definirMoeda } from "./formato.js";
import { emitir } from "./eventos.js";

const estado = {
  usuario: null,
  permissoes: new Set(),
  preferencias: null,
  sistema: null,
};

export const carregarSessao = async () => {
  const dados = await api.obter("/auth/eu");
  estado.usuario = dados.usuario;
  estado.permissoes = new Set(dados.permissoes ?? []);
  estado.preferencias = dados.preferencias ?? null;
  estado.sistema = dados.sistema ?? null;
  definirMoeda(estado.sistema?.moeda);
  return sessao();
};

export const sessao = () => ({
  usuario: estado.usuario,
  permissoes: estado.permissoes,
  preferencias: estado.preferencias,
  sistema: estado.sistema,
});

export const usuarioAtual = () => estado.usuario;

export const pode = (permissao) => !permissao || estado.permissoes.has(permissao);

export const podeAlguma = (...permissoes) => permissoes.some((permissao) => estado.permissoes.has(permissao));

export const atualizarUsuarioAtual = (usuario) => {
  estado.usuario = { ...estado.usuario, ...usuario };
  emitir("sessao:usuario", estado.usuario);
};

export const atualizarPreferencias = (preferencias) => {
  estado.preferencias = { ...estado.preferencias, ...preferencias };
};

export const atualizarSistema = (sistema) => {
  estado.sistema = { ...estado.sistema, ...sistema };
  definirMoeda(estado.sistema?.moeda);
};

export const sair = async () => {
  try {
    await api.criar("/auth/sair", {}, { semRenovar: true });
  } finally {
    location.replace("/entrar");
  }
};

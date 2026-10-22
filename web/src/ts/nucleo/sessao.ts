import { api } from "./api.ts";
import { definirMoeda } from "./formato.ts";
import { emitir } from "./eventos.ts";
import type { Preferencias, Sessao, Sistema, Usuario } from "./tipos.ts";

interface RespostaEu {
  usuario: Usuario;
  permissoes?: string[];
  preferencias?: Preferencias | null;
  sistema?: Sistema | null;
}

const estado: Sessao = {
  usuario: null,
  permissoes: new Set<string>(),
  preferencias: null,
  sistema: null,
};

export const carregarSessao = async (): Promise<Sessao> => {
  const dados = await api.obter<RespostaEu>("/auth/eu");
  estado.usuario = dados.usuario;
  estado.permissoes = new Set(dados.permissoes ?? []);
  estado.preferencias = dados.preferencias ?? null;
  estado.sistema = dados.sistema ?? null;
  definirMoeda(estado.sistema?.moeda);
  return sessao();
};

export const sessao = (): Sessao => ({
  usuario: estado.usuario,
  permissoes: estado.permissoes,
  preferencias: estado.preferencias,
  sistema: estado.sistema,
});

export const usuarioAtual = (): Usuario | null => estado.usuario;

export const pode = (permissao?: string | null): boolean => !permissao || estado.permissoes.has(permissao);

export const podeAlguma = (...permissoes: string[]): boolean => permissoes.some((permissao) => estado.permissoes.has(permissao));

export const atualizarUsuarioAtual = (usuario: Partial<Usuario>): void => {
  estado.usuario = { ...(estado.usuario as Usuario), ...usuario };
  emitir("sessao:usuario", estado.usuario);
};

export const atualizarPreferencias = (preferencias: Partial<Preferencias>): void => {
  estado.preferencias = { ...(estado.preferencias as Preferencias), ...preferencias };
};

export const atualizarSistema = (sistema: Partial<Sistema>): void => {
  estado.sistema = { ...(estado.sistema as Sistema), ...sistema };
  definirMoeda(estado.sistema?.moeda);
};

export const sair = async (): Promise<void> => {
  try {
    await api.criar("/auth/sair", {}, { semRenovar: true });
  } finally {
    location.replace("/entrar");
  }
};

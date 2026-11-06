import { api } from "./api.ts";
import { definirMoeda } from "./formato.ts";
import { emitir } from "./eventos.ts";
import type { EstadoDoisFatores, Preferencias, Sessao, Sistema, Usuario } from "./tipos.ts";

interface RespostaEu {
  usuario: Usuario;
  permissoes?: string[];
  preferencias?: Preferencias | null;
  sistema?: Sistema | null;
  doisFatores?: EstadoDoisFatores | null;
}

const estado: Sessao = {
  usuario: null,
  permissoes: new Set<string>(),
  preferencias: null,
  sistema: null,
  doisFatores: null,
};

export const carregarSessao = async (): Promise<Sessao> => {
  const dados = await api.obter<RespostaEu>("/auth/eu");
  estado.usuario = dados.usuario;
  estado.permissoes = new Set(dados.permissoes ?? []);
  estado.preferencias = dados.preferencias ?? null;
  estado.sistema = dados.sistema ?? null;
  estado.doisFatores = dados.doisFatores ?? null;
  definirMoeda(estado.sistema?.moeda);
  return sessao();
};

export const sessao = (): Sessao => ({
  usuario: estado.usuario,
  permissoes: estado.permissoes,
  preferencias: estado.preferencias,
  sistema: estado.sistema,
  doisFatores: estado.doisFatores,
});

export const atualizarDoisFatores = (doisFatores: EstadoDoisFatores): void => {
  estado.doisFatores = doisFatores;
  emitir("sessao:dois-fatores", doisFatores);
};

export const usuarioAtual = (): Usuario | null => estado.usuario;

export const pode = (permissao?: string | null): boolean => !permissao || estado.permissoes.has(permissao);

export const podeAlguma = (...permissoes: string[]): boolean => permissoes.some((permissao) => estado.permissoes.has(permissao));

export const atualizarUsuarioAtual = (usuario: Partial<Usuario>): void => {
  estado.usuario = { ...(estado.usuario as Usuario), ...usuario };
  emitir("sessao:usuario", estado.usuario);
};

export const atualizarPreferencias = (preferencias: Partial<Preferencias>): void => {
  estado.preferencias = { ...(estado.preferencias as Preferencias), ...preferencias };
  emitir("sessao:preferencias", estado.preferencias);
};

export const preferencia = <K extends keyof Preferencias>(chave: K, padrao: NonNullable<Preferencias[K]>): NonNullable<Preferencias[K]> =>
  (estado.preferencias?.[chave] ?? padrao) as NonNullable<Preferencias[K]>;

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

export interface VisaoSalva {
  id: string;
  nome: string;
  consulta: string;
  criadaEm: string;
}

export const LIMITE_VISOES = 12;
export const TAMANHO_NOME_VISAO = 40;

const IGNORADOS_PADRAO = ["pagina"];

export const normalizarConsulta = (busca: string, ignorar: readonly string[] = []): string => {
  const fora = new Set([...IGNORADOS_PADRAO, ...ignorar]);
  const parametros = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca);
  const pares = [...parametros.entries()].filter(([chave, valor]) => !fora.has(chave) && valor.trim() !== "");
  pares.sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(pares).toString();
};

export const limparNomeVisao = (nome: string): string => nome.replace(/\s+/g, " ").trim().slice(0, TAMANHO_NOME_VISAO);

export const validarVisoes = (bruto: unknown): VisaoSalva[] => {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter(
      (item): item is VisaoSalva =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as VisaoSalva).id === "string" &&
        typeof (item as VisaoSalva).nome === "string" &&
        typeof (item as VisaoSalva).consulta === "string",
    )
    .map((item) => ({ id: item.id, nome: limparNomeVisao(item.nome), consulta: normalizarConsulta(item.consulta), criadaEm: String(item.criadaEm ?? "") }))
    .filter((item) => item.nome !== "")
    .slice(0, LIMITE_VISOES);
};

export const adicionarVisao = (lista: readonly VisaoSalva[], nome: string, consulta: string, agora = new Date()): VisaoSalva[] => {
  const limpo = limparNomeVisao(nome);
  if (!limpo) return [...lista];
  const normalizada = normalizarConsulta(consulta);
  const restantes = lista.filter((visao) => visao.consulta !== normalizada && visao.nome.toLocaleLowerCase("pt-BR") !== limpo.toLocaleLowerCase("pt-BR"));
  const nova: VisaoSalva = { id: `v${agora.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, nome: limpo, consulta: normalizada, criadaEm: agora.toISOString() };
  return [...restantes, nova].slice(-LIMITE_VISOES);
};

export const removerVisao = (lista: readonly VisaoSalva[], id: string): VisaoSalva[] => lista.filter((visao) => visao.id !== id);

export const visaoAtiva = (lista: readonly VisaoSalva[], consulta: string): VisaoSalva | undefined => {
  const normalizada = normalizarConsulta(consulta);
  return lista.find((visao) => visao.consulta === normalizada);
};

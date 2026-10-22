const barramento = new EventTarget();

export const emitir = <T = unknown>(nome: string, detalhe?: T): boolean => barramento.dispatchEvent(new CustomEvent<T | undefined>(nome, { detail: detalhe }));

export const ouvir = <T = any>(nome: string, manipulador: (detalhe: T) => void): (() => void) => {
  const ouvinte = (evento: Event) => manipulador((evento as CustomEvent<T>).detail);
  barramento.addEventListener(nome, ouvinte);
  return () => barramento.removeEventListener(nome, ouvinte);
};

export const ouvirUmaVez = <T = any>(nome: string, manipulador: (detalhe: T) => void): void => {
  const ouvinte = (evento: Event) => manipulador((evento as CustomEvent<T>).detail);
  barramento.addEventListener(nome, ouvinte, { once: true });
};

const barramento = new EventTarget();

export const emitir = (nome, detalhe) => barramento.dispatchEvent(new CustomEvent(nome, { detail: detalhe }));

export const ouvir = (nome, manipulador) => {
  const ouvinte = (evento) => manipulador(evento.detail);
  barramento.addEventListener(nome, ouvinte);
  return () => barramento.removeEventListener(nome, ouvinte);
};

export const ouvirUmaVez = (nome, manipulador) => {
  const ouvinte = (evento) => manipulador(evento.detail);
  barramento.addEventListener(nome, ouvinte, { once: true });
};

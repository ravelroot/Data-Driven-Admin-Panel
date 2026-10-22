import { EventEmitter } from 'node:events';
import type { FastifyBaseLogger } from 'fastify';
import type { Banco } from '../banco/conexao.js';

export type TipoEvento = 'notificacao' | 'transacao' | 'usuario';

export interface EventoTempoReal {
  tipo: TipoEvento;
  destinatarioId: string | null;
  dados: unknown;
}

export interface Barramento {
  iniciar(): Promise<void>;
  parar(): Promise<void>;
  publicar(evento: EventoTempoReal): Promise<void>;
  assinar(ouvinte: (evento: EventoTempoReal) => void): () => void;
}

const CANAL = 'bento_eventos';
const LIMITE_CARGA = 7_500;

export function criarBarramento(banco: Banco, log: FastifyBaseLogger): Barramento {
  const emissor = new EventEmitter();
  emissor.setMaxListeners(0);
  let cancelar: (() => Promise<void>) | null = null;
  let parado = false;
  let tentativa: NodeJS.Timeout | null = null;

  const entregar = (evento: EventoTempoReal) => {
    emissor.emit('evento', evento);
  };

  const conectar = async (): Promise<void> => {
    if (parado) return;
    try {
      cancelar = await banco.ouvir(
        CANAL,
        (carga) => {
          try {
            entregar(JSON.parse(carga) as EventoTempoReal);
          } catch (erro) {
            log.warn({ erro }, 'Evento de tempo real ilegível');
          }
        },
        (erro) => {
          log.warn({ erro }, 'Conexão de tempo real perdida; reconectando');
          cancelar = null;
          agendarReconexao();
        },
      );
    } catch (erro) {
      log.warn({ erro }, 'Não foi possível ouvir eventos de tempo real; tentando de novo');
      agendarReconexao();
    }
  };

  const agendarReconexao = () => {
    if (parado || tentativa) return;
    tentativa = setTimeout(() => {
      tentativa = null;
      void conectar();
    }, 3_000);
    tentativa.unref();
  };

  return {
    iniciar: conectar,
    async parar() {
      parado = true;
      if (tentativa) clearTimeout(tentativa);
      emissor.removeAllListeners();
      if (cancelar) await cancelar().catch(() => undefined);
      cancelar = null;
    },
    async publicar(evento) {
      const carga = JSON.stringify(evento);
      if (carga.length > LIMITE_CARGA || !cancelar) {
        entregar(evento);
        return;
      }
      try {
        await banco.notificar(CANAL, carga);
      } catch (erro) {
        log.warn({ erro }, 'Falha ao publicar evento; entregando só nesta instância');
        entregar(evento);
      }
    },
    assinar(ouvinte) {
      emissor.on('evento', ouvinte);
      return () => {
        emissor.off('evento', ouvinte);
      };
    },
  };
}

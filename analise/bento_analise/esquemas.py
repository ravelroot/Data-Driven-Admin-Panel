from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Texto = Annotated[str, Field(min_length=1, max_length=120)]
StatusEvento = Literal["paga", "falhou", "reembolsada", "pendente"]
TipoEvento = Literal["assinatura", "upgrade", "avulsa", "reembolso"]


class Modelo(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Plano(Modelo):
    codigo: Texto
    nome: Texto
    preco_mensal: int = Field(gt=0)
    preco_anual: int = Field(gt=0)


class Dia(Modelo):
    dia: date
    receita: float = Field(default=0, ge=0)
    reembolsos: float = Field(default=0, ge=0)
    pagas: int = Field(default=0, ge=0)
    falhas: int = Field(default=0, ge=0)
    novos: int = Field(default=0, ge=0)
    visitantes: int = Field(default=0, ge=0)
    cadastros: int = Field(default=0, ge=0)
    conversoes: int = Field(default=0, ge=0)


class Assinatura(Modelo):
    id: Annotated[str, Field(min_length=1, max_length=64)]
    plano: Texto
    ciclo: Literal["mensal", "anual"]
    metodo: Literal["cartao", "pix", "boleto"]
    canal: Texto | None = None
    valor: int = Field(ge=0)
    status: Literal["ativa", "teste", "cancelada", "inadimplente"]
    inicio: date
    teste_ate: date | None = None
    convertida: date | None = None
    cancelada: date | None = None
    ultimo_acesso: date | None = None


class Conjunto(Modelo):
    referencia: date
    planos: list[Plano] = Field(default_factory=list, max_length=200)
    diario: list[Dia] = Field(default_factory=list, max_length=4_000)
    assinaturas: list[Assinatura] = Field(default_factory=list, max_length=250_000)
    eventos: list[tuple[int, date, StatusEvento, int, TipoEvento]] = Field(default_factory=list, max_length=1_500_000)


class Cenario(Modelo):
    ativos: int = Field(ge=0, le=10_000_000)
    arpu: float = Field(ge=0, le=100_000_000)
    churn: float = Field(ge=0, le=1)
    novos: float = Field(ge=0, le=1_000_000)
    preco: float = Field(default=0, ge=-50, le=200)
    churn_pp: float = Field(default=0, ge=-20, le=20)
    aquisicao: float = Field(default=0, ge=-100, le=300)
    elasticidade: float = Field(default=0, ge=0, le=3)
    meses: int = Field(default=12, ge=3, le=36)
    referencia: date


class Planilha(Modelo):
    nome: Annotated[str, Field(min_length=1, max_length=200)]
    conteudo: Annotated[str, Field(min_length=1, max_length=8_000_000)]

"""Modelo de alquiler de vivienda."""

from __future__ import annotations

from dataclasses import dataclass

from .comun import ConfigError, comprobar_campos, resolver_horizonte

NOMBRE = "alquiler"

COLUMNAS = ["mes", "cuota_alquiler", "recurrentes", "gasto_mes",
            "gasto_acumulado", "comentario"]

CAMPOS_OBLIGATORIOS = {
    "cuota_inicial", "incremento_pct", "intervalo_incremento_meses",
    "fianza_mensualidades", "seguro_hogar",
}
CAMPOS_OPCIONALES = {"agencia", "horizonte_meses", "horizonte_anios"}


@dataclass(frozen=True)
class Config:
    cuota_inicial: float  # €/mes
    incremento_pct: float  # % por revisión, compuesto
    intervalo_incremento_meses: int  # 0 = sin revisiones (cuota constante)
    fianza_mensualidades: float  # nº de mensualidades depositadas al inicio
    agencia: float  # €
    seguro_hogar: float  # €/año


def cargar(data: dict) -> tuple[Config, int]:
    """Valida la configuración y devuelve (config, horizonte en meses)."""
    comprobar_campos(data, CAMPOS_OBLIGATORIOS, CAMPOS_OPCIONALES, NOMBRE)
    horizonte = resolver_horizonte(data)

    cfg = Config(
        cuota_inicial=float(data["cuota_inicial"]),
        incremento_pct=float(data["incremento_pct"]),
        intervalo_incremento_meses=int(data["intervalo_incremento_meses"]),
        fianza_mensualidades=float(data["fianza_mensualidades"]),
        agencia=float(data.get("agencia", 0.0)),
        seguro_hogar=float(data["seguro_hogar"]),
    )

    if cfg.cuota_inicial <= 0:
        raise ConfigError("'cuota_inicial' debe ser positiva")
    if cfg.intervalo_incremento_meses < 0:
        raise ConfigError("'intervalo_incremento_meses' no puede ser negativo")
    if cfg.intervalo_incremento_meses == 0 and cfg.incremento_pct != 0:
        raise ConfigError(
            "'intervalo_incremento_meses' = 0 significa sin revisiones; "
            "'incremento_pct' debe ser 0 en ese caso"
        )
    if cfg.incremento_pct < 0:
        raise ConfigError("'incremento_pct' no puede ser negativo")
    for campo in ("fianza_mensualidades", "agencia", "seguro_hogar"):
        if getattr(cfg, campo) < 0:
            raise ConfigError(f"'{campo}' no puede ser negativo")

    return cfg, horizonte


# ---------------------------------------------------------------------------
# Cálculos
# ---------------------------------------------------------------------------

def cuota_en_mes(cfg: Config, mes: int) -> float:
    """Cuota del mes dado (mes >= 1): se revisa cada `intervalo` meses, con
    incremento compuesto. Los meses 1..intervalo se pagan a la cuota
    inicial; la primera revisión aplica a partir del mes intervalo + 1."""
    if cfg.intervalo_incremento_meses == 0:
        return cfg.cuota_inicial
    factor = (1 + cfg.incremento_pct / 100) ** (
        (mes - 1) // cfg.intervalo_incremento_meses
    )
    return cfg.cuota_inicial * factor


# ---------------------------------------------------------------------------
# Simulación
# ---------------------------------------------------------------------------

def simular(cfg: Config, horizonte: int) -> list[dict]:
    """Genera una fila por mes, de 0 (firma) a `horizonte`.

    Convención idéntica al modelo de compra: el mes 0 concentra los gastos
    únicos (fianza + agencia, sin devolución) y la primera mensualidad se
    paga en el mes 1.
    """
    seguro_mes = cfg.seguro_hogar / 12
    desembolso_inicial = cfg.fianza_mensualidades * cfg.cuota_inicial + cfg.agencia

    filas = []
    acumulado = 0.0
    cuota_anterior = None
    for mes in range(0, horizonte + 1):
        if mes == 0:
            cuota_mes, rec_mes, gasto = 0.0, 0.0, desembolso_inicial
            comentario = "firma"
        else:
            cuota_mes = cuota_en_mes(cfg, mes)
            rec_mes = seguro_mes
            gasto = cuota_mes + rec_mes
            comentario = ("revisión de cuota"
                          if cuota_anterior is not None and cuota_mes != cuota_anterior
                          else "")
            cuota_anterior = cuota_mes
        acumulado += gasto
        filas.append({
            "mes": mes,
            "cuota_alquiler": cuota_mes,
            "recurrentes": rec_mes,
            "gasto_mes": gasto,
            "gasto_acumulado": acumulado,
            "comentario": comentario,
        })
    return filas


def resumen(cfg: Config, filas: list[dict]) -> str:
    ultima = filas[-1]
    if cfg.intervalo_incremento_meses == 0:
        revision = "sin revisiones (cuota constante)"
    else:
        revision = (f"+{cfg.incremento_pct}% cada "
                    f"{cfg.intervalo_incremento_meses} meses")
    lineas = [
        f"Modelo:               alquiler",
        f"Cuota inicial:        {cfg.cuota_inicial:,.2f} €/mes",
        f"Revisión:             {revision}",
        f"Cuota en el mes {ultima['mes']}:   {ultima['cuota_alquiler']:,.2f} €/mes",
        f"Desembolso inicial:   {filas[0]['gasto_mes']:,.2f} € (fianza + agencia)",
        f"Total pagado:         {ultima['gasto_acumulado']:,.2f} € "
        f"en {ultima['mes']} meses",
    ]
    return "\n".join(lineas)

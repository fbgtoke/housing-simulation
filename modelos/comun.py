"""Utilidades compartidas por todos los modelos de simulación."""

from __future__ import annotations

import csv


class ConfigError(Exception):
    """Error en la configuración de entrada."""


def comprobar_campos(data: dict, obligatorios: set[str], opcionales: set[str],
                     nombre_modelo: str) -> None:
    """Valida que el JSON tenga los campos obligatorios y ningún campo ajeno
    al modelo."""
    faltan = obligatorios - data.keys()
    if faltan:
        raise ConfigError(
            f"Faltan campos obligatorios del modelo '{nombre_modelo}': "
            f"{sorted(faltan)}"
        )
    desconocidos = data.keys() - obligatorios - opcionales - {"modelo"}
    if desconocidos:
        raise ConfigError(
            f"Campos no válidos para el modelo '{nombre_modelo}': "
            f"{sorted(desconocidos)}"
        )


def resolver_horizonte(data: dict) -> int:
    """Resuelve el horizonte temporal en meses, dado en 'horizonte_meses'
    o 'horizonte_anios' (no ambos)."""
    meses = data.get("horizonte_meses")
    anios = data.get("horizonte_anios")
    if meses is not None and anios is not None:
        if int(anios * 12) != int(meses):
            raise ConfigError(
                "'horizonte_meses' y 'horizonte_anios' son inconsistentes"
            )
        horizonte = int(meses)
    elif meses is not None:
        horizonte = int(meses)
    elif anios is not None:
        horizonte = int(anios * 12)
    else:
        raise ConfigError("Falta 'horizonte_meses' o 'horizonte_anios'")
    if horizonte <= 0:
        raise ConfigError("El horizonte temporal debe ser positivo")
    return horizonte


def escribir_csv(filas: list[dict], columnas: list[str], path: str) -> None:
    """Escribe las filas en un CSV con las columnas indicadas por el modelo."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(columnas)
        for fila in filas:
            writer.writerow([_formatear(fila[c]) for c in columnas])


def _formatear(valor) -> str:
    if isinstance(valor, float):
        return f"{valor:.2f}"
    return valor

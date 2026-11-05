#!/usr/bin/env python3
"""
Simulación de gastos de vivienda (España, Cataluña).

Modelos disponibles: compra (con hipoteca de tipo fijo) y alquiler.
Lee un fichero JSON con los parámetros del modelo elegido y genera un CSV
con una fila por mes: gasto mensual y gasto acumulado.

Uso:
    python simulate.py config.json [-o salida.csv]
"""

from __future__ import annotations

import argparse
import json
import sys

from modelos import MODELOS
from modelos.comun import ConfigError, escribir_csv


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Simula los gastos de una vivienda (compra o alquiler)."
    )
    parser.add_argument("config", help="fichero JSON de configuración")
    parser.add_argument("-o", "--output", default="simulacion.csv",
                        help="fichero CSV de salida (por defecto: simulacion.csv)")
    args = parser.parse_args(argv)

    try:
        with open(args.config, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"No se encuentra el fichero: {args.config}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f"El fichero {args.config} no es un JSON válido: {e}",
              file=sys.stderr)
        return 1

    if not isinstance(data, dict):
        print("Error de configuración: el JSON debe ser un objeto",
              file=sys.stderr)
        return 1

    nombre_modelo = data.get("modelo")
    if nombre_modelo not in MODELOS:
        disponibles = ", ".join(sorted(MODELOS))
        print(f"Error de configuración: 'modelo' debe ser uno de: "
              f"{disponibles}", file=sys.stderr)
        return 1

    modelo = MODELOS[nombre_modelo]
    try:
        cfg, horizonte = modelo.cargar(data)
    except ConfigError as e:
        print(f"Error de configuración: {e}", file=sys.stderr)
        return 1

    filas = modelo.simular(cfg, horizonte)
    escribir_csv(filas, modelo.COLUMNAS, args.output)
    print(modelo.resumen(cfg, filas))
    print(f"\nCSV generado en: {args.output} ({len(filas)} filas)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

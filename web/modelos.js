"use strict";

// Traducción a JavaScript de los modelos del paquete modelos/ (Python).
//
// IMPORTANTE: la lógica de este fichero debe mantenerse en paridad con la
// versión Python (modelos/*.py), que sigue siendo la implementación de
// referencia para simulate.py. Cualquier corrección o extensión debe
// aplicarse en ambas.

// ---------------------------------------------------------------------------
// Común (modelos/comun.py)
// ---------------------------------------------------------------------------

class ConfigError extends Error {}

function comprobarCampos(data, obligatorios, opcionales, nombreModelo) {
    const claves = Object.keys(data);
    const faltan = [...obligatorios].filter((c) => !claves.includes(c)).sort();
    if (faltan.length > 0) {
        throw new ConfigError(
            `Faltan campos obligatorios del modelo '${nombreModelo}': ` +
            `[${faltan.map((c) => `'${c}'`).join(", ")}]`
        );
    }
    const desconocidos = claves
        .filter((c) => !obligatorios.has(c) && !opcionales.has(c) && c !== "modelo")
        .sort();
    if (desconocidos.length > 0) {
        throw new ConfigError(
            `Campos no válidos para el modelo '${nombreModelo}': ` +
            `[${desconocidos.map((c) => `'${c}'`).join(", ")}]`
        );
    }
}

function resolverHorizonte(data) {
    const meses = data["horizonte_meses"];
    const anios = data["horizonte_anios"];
    let horizonte;
    if (meses !== undefined && anios !== undefined) {
        if (Math.trunc(anios * 12) !== Math.trunc(meses)) {
            throw new ConfigError(
                "'horizonte_meses' y 'horizonte_anios' son inconsistentes");
        }
        horizonte = Math.trunc(meses);
    } else if (meses !== undefined) {
        horizonte = Math.trunc(meses);
    } else if (anios !== undefined) {
        horizonte = Math.trunc(anios * 12);
    } else {
        throw new ConfigError("Falta 'horizonte_meses' o 'horizonte_anios'");
    }
    if (horizonte <= 0) {
        throw new ConfigError("El horizonte temporal debe ser positivo");
    }
    return horizonte;
}

// Equivalente al formato {valor:,.2f} de Python (agrupación en-US).
function eur2(valor) {
    return valor.toLocaleString("en-US",
        { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Modelo de compra (modelos/compra.py)
// ---------------------------------------------------------------------------

const compra = {
    NOMBRE: "compra",

    CAMPOS_OBLIGATORIOS: new Set([
        "tipo_operacion", "valor_propiedad", "entrada", "tasacion",
        "comision_apertura_pct", "notaria", "registro", "gestoria",
        "seguro_hogar", "ibi", "comunidad", "tipo_fijo", "n_mensualidades",
    ]),
    CAMPOS_OPCIONALES: new Set([
        "itp_reducido", "seguro_vida", "horizonte_meses", "horizonte_anios",
    ]),

    // Constantes fiscales (Cataluña).
    ITP_TRAMOS: [
        [100000, 0.06], [200000, 0.07], [400000, 0.08], [600000, 0.09],
        [1000000, 0.10], [Infinity, 0.11],
    ],
    IVA_PCT: 0.10,
    AJD_PCT: 0.015,
    ITP_REDUCIDO_PCT: 0.05,

    cargar(data) {
        comprobarCampos(data, this.CAMPOS_OBLIGATORIOS, this.CAMPOS_OPCIONALES,
                        this.NOMBRE);
        const horizonte = resolverHorizonte(data);

        if (!["obra_nueva", "segunda_mano"].includes(data["tipo_operacion"])) {
            throw new ConfigError(
                "'tipo_operacion' debe ser 'obra_nueva' o 'segunda_mano'");
        }

        const cfg = {
            tipo_operacion: data["tipo_operacion"],
            valor_propiedad: Number(data["valor_propiedad"]),
            entrada: Number(data["entrada"]),
            tasacion: Number(data["tasacion"]),
            comision_apertura_pct: Number(data["comision_apertura_pct"]),
            notaria: Number(data["notaria"]),
            registro: Number(data["registro"]),
            gestoria: Number(data["gestoria"]),
            seguro_hogar: Number(data["seguro_hogar"]),
            seguro_vida: Number(data["seguro_vida"] ?? 0),
            ibi: Number(data["ibi"]),
            comunidad: Number(data["comunidad"]),
            tipo_fijo: Number(data["tipo_fijo"]),
            n_mensualidades: Math.trunc(Number(data["n_mensualidades"])),
            itp_reducido: Boolean(data["itp_reducido"] ?? false),
        };
        for (const campo of ["valor_propiedad", "entrada", "tasacion",
                             "comision_apertura_pct", "notaria", "registro",
                             "gestoria", "seguro_hogar", "seguro_vida",
                             "ibi", "comunidad", "tipo_fijo"]) {
            if (!Number.isFinite(cfg[campo])) {
                throw new ConfigError(`'${campo}' debe ser un número`);
            }
        }

        if (cfg.itp_reducido && cfg.tipo_operacion !== "segunda_mano") {
            throw new ConfigError(
                "'itp_reducido' solo es aplicable a operaciones de segunda mano");
        }
        if (cfg.entrada >= cfg.valor_propiedad) {
            throw new ConfigError("'entrada' debe ser menor que 'valor_propiedad'");
        }
        if (cfg.n_mensualidades <= 0) {
            throw new ConfigError("'n_mensualidades' debe ser positivo");
        }
        if (cfg.tipo_fijo < 0) {
            throw new ConfigError("'tipo_fijo' no puede ser negativo");
        }
        for (const campo of ["valor_propiedad", "entrada", "tasacion",
                             "notaria", "registro", "gestoria",
                             "seguro_hogar", "seguro_vida", "ibi",
                             "comunidad"]) {
            if (cfg[campo] < 0) {
                throw new ConfigError(`'${campo}' no puede ser negativo`);
            }
        }
        return { cfg, horizonte };
    },

    calcularItp(valor, reducido = false) {
        if (reducido) return valor * this.ITP_REDUCIDO_PCT;
        let total = 0.0;
        let anterior = 0.0;
        for (const [limite, tipo] of this.ITP_TRAMOS) {
            if (valor <= limite) {
                return total + (valor - anterior) * tipo;
            }
            total += (limite - anterior) * tipo;
            anterior = limite;
        }
        return total;
    },

    calcularImpuestos(cfg) {
        if (cfg.tipo_operacion === "obra_nueva") {
            return cfg.valor_propiedad * (this.IVA_PCT + this.AJD_PCT);
        }
        return this.calcularItp(cfg.valor_propiedad, cfg.itp_reducido);
    },

    cuotaHipoteca(prestamo, tipoFijo, n) {
        if (prestamo === 0) return 0.0;
        const i = tipoFijo / 100 / 12;
        if (i === 0) return prestamo / n;
        return prestamo * i / (1 - (1 + i) ** -n);
    },

    simular(cfg, horizonte) {
        const prestamo = cfg.valor_propiedad - cfg.entrada;
        const cuota = this.cuotaHipoteca(prestamo, cfg.tipo_fijo,
                                         cfg.n_mensualidades);
        const impuestos = this.calcularImpuestos(cfg);
        const comisionApertura = prestamo * cfg.comision_apertura_pct / 100;
        const recurrentesMes = (cfg.seguro_hogar + cfg.seguro_vida
                                + cfg.ibi + cfg.comunidad) / 12;
        const desembolsoFirma = (cfg.entrada + impuestos + cfg.tasacion
                                 + comisionApertura + cfg.notaria
                                 + cfg.registro + cfg.gestoria);

        const filas = [];
        let acumulado = 0.0;
        for (let mes = 0; mes <= horizonte; mes++) {
            let cuotaMes, recMes, gasto, comentario;
            if (mes === 0) {
                cuotaMes = 0.0; recMes = 0.0; gasto = desembolsoFirma;
                comentario = "firma";
            } else {
                cuotaMes = mes <= cfg.n_mensualidades ? cuota : 0.0;
                recMes = recurrentesMes;
                gasto = cuotaMes + recMes;
                comentario = mes === cfg.n_mensualidades
                    ? "última cuota hipoteca" : "";
            }
            acumulado += gasto;
            filas.push({
                mes,
                cuota_hipoteca: cuotaMes,
                recurrentes: recMes,
                gasto_mes: gasto,
                gasto_acumulado: acumulado,
                comentario,
            });
        }
        return filas;
    },

    resumen(cfg, filas) {
        const prestamo = cfg.valor_propiedad - cfg.entrada;
        const cuota = filas.length > 1 ? filas[1].cuota_hipoteca : 0.0;
        const totalHipoteca = cuota * cfg.n_mensualidades;
        const ltv = prestamo / cfg.valor_propiedad * 100;
        const detalleImp = cfg.itp_reducido ? "ITP reducido (5%)"
            : cfg.tipo_operacion === "segunda_mano" ? "ITP tramos 6-11%"
            : "IVA 10% + AJD 1,5%";
        const lineas = [
            `Operación:            ${cfg.tipo_operacion}`,
            `Valor propiedad:      ${eur2(cfg.valor_propiedad)} €`,
            `Entrada:              ${eur2(cfg.entrada)} €`,
            `Préstamo:             ${eur2(prestamo)} €  (LTV ${ltv.toFixed(1)}%)`,
            `Impuestos:            ${eur2(this.calcularImpuestos(cfg))} €  (${detalleImp})`,
            `Desembolso en firma:  ${eur2(filas[0].gasto_mes)} €`,
            `Cuota mensual:        ${eur2(cuota)} €  (${cfg.n_mensualidades} meses a ${cfg.tipo_fijo}%)`,
            `Total hipoteca:       ${eur2(totalHipoteca)} €`,
            `Intereses totales:    ${eur2(totalHipoteca - prestamo)} €`,
        ];
        if (ltv > 80) {
            lineas.push(
                "Aviso: LTV > 80%; la mayoría de bancos no financian por encima " +
                "de ese umbral (esto es solo un aviso, no un error del modelo).");
        }
        return lineas.join("\n");
    },
};

// ---------------------------------------------------------------------------
// Modelo de alquiler (modelos/alquiler.py)
// ---------------------------------------------------------------------------

const alquiler = {
    NOMBRE: "alquiler",

    CAMPOS_OBLIGATORIOS: new Set([
        "cuota_inicial", "incremento_pct", "intervalo_incremento_meses",
        "fianza_mensualidades", "seguro_hogar",
    ]),
    CAMPOS_OPCIONALES: new Set(["agencia", "horizonte_meses", "horizonte_anios"]),

    cargar(data) {
        comprobarCampos(data, this.CAMPOS_OBLIGATORIOS, this.CAMPOS_OPCIONALES,
                        this.NOMBRE);
        const horizonte = resolverHorizonte(data);

        const cfg = {
            cuota_inicial: Number(data["cuota_inicial"]),
            incremento_pct: Number(data["incremento_pct"]),
            intervalo_incremento_meses:
                Math.trunc(Number(data["intervalo_incremento_meses"])),
            fianza_mensualidades: Number(data["fianza_mensualidades"]),
            agencia: Number(data["agencia"] ?? 0),
            seguro_hogar: Number(data["seguro_hogar"]),
        };
        for (const campo of ["cuota_inicial", "incremento_pct",
                             "intervalo_incremento_meses",
                             "fianza_mensualidades", "agencia",
                             "seguro_hogar"]) {
            if (!Number.isFinite(cfg[campo])) {
                throw new ConfigError(`'${campo}' debe ser un número`);
            }
        }

        if (cfg.cuota_inicial <= 0) {
            throw new ConfigError("'cuota_inicial' debe ser positiva");
        }
        if (cfg.intervalo_incremento_meses < 0) {
            throw new ConfigError("'intervalo_incremento_meses' no puede ser negativo");
        }
        if (cfg.intervalo_incremento_meses === 0 && cfg.incremento_pct !== 0) {
            throw new ConfigError(
                "'intervalo_incremento_meses' = 0 significa sin revisiones; " +
                "'incremento_pct' debe ser 0 en ese caso");
        }
        if (cfg.incremento_pct < 0) {
            throw new ConfigError("'incremento_pct' no puede ser negativo");
        }
        for (const campo of ["fianza_mensualidades", "agencia", "seguro_hogar"]) {
            if (cfg[campo] < 0) {
                throw new ConfigError(`'${campo}' no puede ser negativo`);
            }
        }
        return { cfg, horizonte };
    },

    cuotaEnMes(cfg, mes) {
        if (cfg.intervalo_incremento_meses === 0) return cfg.cuota_inicial;
        const factor = (1 + cfg.incremento_pct / 100) ** (
            Math.floor((mes - 1) / cfg.intervalo_incremento_meses));
        return cfg.cuota_inicial * factor;
    },

    simular(cfg, horizonte) {
        const seguroMes = cfg.seguro_hogar / 12;
        const desembolsoInicial =
            cfg.fianza_mensualidades * cfg.cuota_inicial + cfg.agencia;

        const filas = [];
        let acumulado = 0.0;
        let cuotaAnterior = null;
        for (let mes = 0; mes <= horizonte; mes++) {
            let cuotaMes, recMes, gasto, comentario;
            if (mes === 0) {
                cuotaMes = 0.0; recMes = 0.0; gasto = desembolsoInicial;
                comentario = "firma";
            } else {
                cuotaMes = this.cuotaEnMes(cfg, mes);
                recMes = seguroMes;
                gasto = cuotaMes + recMes;
                comentario = (cuotaAnterior !== null && cuotaMes !== cuotaAnterior)
                    ? "revisión de cuota" : "";
                cuotaAnterior = cuotaMes;
            }
            acumulado += gasto;
            filas.push({
                mes,
                cuota_alquiler: cuotaMes,
                recurrentes: recMes,
                gasto_mes: gasto,
                gasto_acumulado: acumulado,
                comentario,
            });
        }
        return filas;
    },

    resumen(cfg, filas) {
        const ultima = filas[filas.length - 1];
        const revision = cfg.intervalo_incremento_meses === 0
            ? "sin revisiones (cuota constante)"
            : `+${cfg.incremento_pct}% cada ${cfg.intervalo_incremento_meses} meses`;
        return [
            "Modelo:               alquiler",
            `Cuota inicial:        ${eur2(cfg.cuota_inicial)} €/mes`,
            `Revisión:             ${revision}`,
            `Cuota en el mes ${ultima.mes}:   ${eur2(ultima.cuota_alquiler)} €/mes`,
            `Desembolso inicial:   ${eur2(filas[0].gasto_mes)} € (fianza + agencia)`,
            `Total pagado:         ${eur2(ultima.gasto_acumulado)} € en ${ultima.mes} meses`,
        ].join("\n");
    },
};

// ---------------------------------------------------------------------------
// Modelo de cooperativa (modelos/cooperativa.py)
// ---------------------------------------------------------------------------

const cooperativa = {
    NOMBRE: "cooperativa",

    CAMPOS_OBLIGATORIOS: new Set([
        "coste_total_proyecto", "porcentaje_participacion_pct",
        "pago_inicial_pct", "subvencion_pct", "tipo_fijo",
        "n_mensualidades", "cuota_cooperativa",
    ]),
    CAMPOS_OPCIONALES: new Set(["horizonte_meses", "horizonte_anios"]),

    PAGO_INICIAL_MIN_PCT: 5.0,
    PAGO_INICIAL_MAX_PCT: 15.0,

    cargar(data) {
        comprobarCampos(data, this.CAMPOS_OBLIGATORIOS, this.CAMPOS_OPCIONALES,
                        this.NOMBRE);
        const horizonte = resolverHorizonte(data);

        const cfg = {
            coste_total_proyecto: Number(data["coste_total_proyecto"]),
            porcentaje_participacion_pct:
                Number(data["porcentaje_participacion_pct"]),
            pago_inicial_pct: Number(data["pago_inicial_pct"]),
            subvencion_pct: Number(data["subvencion_pct"]),
            tipo_fijo: Number(data["tipo_fijo"]),
            n_mensualidades: Math.trunc(Number(data["n_mensualidades"])),
            cuota_cooperativa: Number(data["cuota_cooperativa"]),
        };
        for (const campo of ["coste_total_proyecto",
                             "porcentaje_participacion_pct",
                             "pago_inicial_pct", "subvencion_pct",
                             "tipo_fijo", "n_mensualidades",
                             "cuota_cooperativa"]) {
            if (!Number.isFinite(cfg[campo])) {
                throw new ConfigError(`'${campo}' debe ser un número`);
            }
        }

        if (cfg.coste_total_proyecto <= 0) {
            throw new ConfigError("'coste_total_proyecto' debe ser positivo");
        }
        if (!(0 < cfg.porcentaje_participacion_pct && cfg.porcentaje_participacion_pct <= 100)) {
            throw new ConfigError("'porcentaje_participacion_pct' debe estar en (0, 100]");
        }
        if (!(0 < cfg.pago_inicial_pct && cfg.pago_inicial_pct < 100)) {
            throw new ConfigError("'pago_inicial_pct' debe estar en (0, 100)");
        }
        if (!(0 <= cfg.subvencion_pct && cfg.subvencion_pct <= 100)) {
            throw new ConfigError("'subvencion_pct' debe estar en [0, 100]");
        }
        if (cfg.tipo_fijo < 0) {
            throw new ConfigError("'tipo_fijo' no puede ser negativo");
        }
        if (cfg.n_mensualidades <= 0) {
            throw new ConfigError("'n_mensualidades' debe ser positivo");
        }
        if (cfg.cuota_cooperativa < 0) {
            throw new ConfigError("'cuota_cooperativa' no puede ser negativa");
        }
        return { cfg, horizonte };
    },

    participacion(cfg) {
        return cfg.coste_total_proyecto * cfg.porcentaje_participacion_pct / 100;
    },
    pagoInicial(cfg) {
        return this.participacion(cfg) * cfg.pago_inicial_pct / 100;
    },
    subvencionUnidad(cfg) {
        return this.participacion(cfg) * (1 - cfg.pago_inicial_pct / 100)
               * cfg.subvencion_pct / 100;
    },
    hipotecaUnidad(cfg) {
        return this.participacion(cfg) * (1 - cfg.pago_inicial_pct / 100)
               * (1 - cfg.subvencion_pct / 100);
    },
    cuotaHipoteca(prestamo, tipoFijo, n) {
        if (prestamo === 0) return 0.0;
        const i = tipoFijo / 100 / 12;
        if (i === 0) return prestamo / n;
        return prestamo * i / (1 - (1 + i) ** -n);
    },

    simular(cfg, horizonte) {
        const cuota = this.cuotaHipoteca(this.hipotecaUnidad(cfg),
                                         cfg.tipo_fijo, cfg.n_mensualidades);
        const filas = [];
        let acumulado = 0.0;
        for (let mes = 0; mes <= horizonte; mes++) {
            let cuotaHip, cuotaCoop, gasto, comentario;
            if (mes === 0) {
                cuotaHip = 0.0; cuotaCoop = 0.0; gasto = this.pagoInicial(cfg);
                comentario = "firma";
            } else {
                cuotaHip = mes <= cfg.n_mensualidades ? cuota : 0.0;
                cuotaCoop = cfg.cuota_cooperativa;
                gasto = cuotaHip + cuotaCoop;
                comentario = mes === cfg.n_mensualidades
                    ? "última cuota hipoteca" : "";
            }
            acumulado += gasto;
            filas.push({
                mes,
                cuota_hipoteca: cuotaHip,
                cuota_cooperativa: cuotaCoop,
                gasto_mes: gasto,
                gasto_acumulado: acumulado,
                comentario,
            });
        }
        return filas;
    },

    resumen(cfg, filas) {
        const prestamo = this.hipotecaUnidad(cfg);
        const cuota = filas.length > 1 ? filas[1].cuota_hipoteca : 0.0;
        const totalHipoteca = cuota * cfg.n_mensualidades;
        const lineas = [
            `Coste total proyecto:     ${eur2(cfg.coste_total_proyecto)} €`,
            `Mi participación:         ${cfg.porcentaje_participacion_pct}%  (${eur2(this.participacion(cfg))} €)`,
            `Pago inicial:             ${eur2(this.pagoInicial(cfg))} €  (${cfg.pago_inicial_pct}% del proyecto)`,
            `Subvención (mi parte):    ${eur2(this.subvencionUnidad(cfg))} €`,
            `Mi hipoteca:              ${eur2(prestamo)} €`,
            `Cuota mensual:            ${eur2(cuota)} €  (${cfg.n_mensualidades} meses a ${cfg.tipo_fijo}%)`,
            `Cuota cooperativa:        ${eur2(cfg.cuota_cooperativa)} €/mes`,
            `Total hipoteca:           ${eur2(totalHipoteca)} €`,
            `Intereses totales:        ${eur2(totalHipoteca - prestamo)} €`,
        ];
        if (!(this.PAGO_INICIAL_MIN_PCT <= cfg.pago_inicial_pct
              && cfg.pago_inicial_pct <= this.PAGO_INICIAL_MAX_PCT)) {
            lineas.push(
                `Aviso: el pago inicial (${cfg.pago_inicial_pct}%) está fuera ` +
                `del rango habitual de ${this.PAGO_INICIAL_MIN_PCT.toFixed(0)}-` +
                `${this.PAGO_INICIAL_MAX_PCT.toFixed(0)}% en cooperativas ` +
                "(esto es solo un aviso, no un error del modelo).");
        }
        return lineas.join("\n");
    },
};

// ---------------------------------------------------------------------------
// Registro de modelos y especificación de la interfaz
// ---------------------------------------------------------------------------

const MODELOS = { compra, alquiler, cooperativa };

// Campos del formulario y valores por defecto de cada modelo (en paridad
// con los config.*.example.json y con la descripción de campos del README).
const ESPECIFICACION_UI = {
    "compra": {
        campos: [
            { clave: "tipo_operacion", etiqueta: "Tipo de operación",
              tipo: "selector", opciones: ["obra_nueva", "segunda_mano"] },
            { clave: "itp_reducido", etiqueta: "ITP reducido (5%)",
              tipo: "booleano" },
            { clave: "valor_propiedad", etiqueta: "Valor de la propiedad (€)",
              tipo: "numero" },
            { clave: "entrada", etiqueta: "Entrada (€)", tipo: "numero" },
            { clave: "tasacion", etiqueta: "Tasación (€)", tipo: "numero" },
            { clave: "comision_apertura_pct",
              etiqueta: "Comisión de apertura (% s/ préstamo)", tipo: "numero" },
            { clave: "notaria", etiqueta: "Notaría (€)", tipo: "numero" },
            { clave: "registro", etiqueta: "Registro de la propiedad (€)",
              tipo: "numero" },
            { clave: "gestoria", etiqueta: "Gestoría (€)", tipo: "numero" },
            { clave: "seguro_hogar", etiqueta: "Seguro de hogar (€/año)",
              tipo: "numero" },
            { clave: "seguro_vida", etiqueta: "Seguro de vida (€/año)",
              tipo: "numero" },
            { clave: "ibi", etiqueta: "IBI (€/año)", tipo: "numero" },
            { clave: "comunidad", etiqueta: "Comunidad (€/año)", tipo: "numero" },
            { clave: "tipo_fijo", etiqueta: "Tipo de interés fijo (%)",
              tipo: "numero" },
            { clave: "n_mensualidades", etiqueta: "Mensualidades",
              tipo: "numero" },
        ],
        defectos: {
            tipo_operacion: "segunda_mano", itp_reducido: false,
            valor_propiedad: 350000, entrada: 87500, tasacion: 450,
            comision_apertura_pct: 0.5, notaria: 850, registro: 600,
            gestoria: 350, seguro_hogar: 250, seguro_vida: 0, ibi: 900,
            comunidad: 1200, tipo_fijo: 3.0, n_mensualidades: 300,
        },
    },
    "alquiler": {
        campos: [
            { clave: "cuota_inicial", etiqueta: "Cuota mensual inicial (€)",
              tipo: "numero" },
            { clave: "incremento_pct", etiqueta: "Incremento por revisión (%)",
              tipo: "numero" },
            { clave: "intervalo_incremento_meses",
              etiqueta: "Meses entre revisiones", tipo: "numero" },
            { clave: "fianza_mensualidades",
              etiqueta: "Fianza (nº de mensualidades)", tipo: "numero" },
            { clave: "agencia", etiqueta: "Comisión de agencia (€)",
              tipo: "numero" },
            { clave: "seguro_hogar", etiqueta: "Seguro de hogar (€/año)",
              tipo: "numero" },
        ],
        defectos: {
            cuota_inicial: 1200, incremento_pct: 2.5,
            intervalo_incremento_meses: 12, fianza_mensualidades: 2,
            agencia: 0, seguro_hogar: 120,
        },
    },
    "cooperativa": {
        campos: [
            { clave: "coste_total_proyecto",
              etiqueta: "Coste total del proyecto (€)", tipo: "numero" },
            { clave: "porcentaje_participacion_pct",
              etiqueta: "Participación de mi unidad (%)", tipo: "numero" },
            { clave: "pago_inicial_pct",
              etiqueta: "Pago inicial del proyecto (%)", tipo: "numero" },
            { clave: "subvencion_pct",
              etiqueta: "Subvención del coste restante (%)", tipo: "numero" },
            { clave: "tipo_fijo", etiqueta: "Tipo de interés fijo (%)",
              tipo: "numero" },
            { clave: "n_mensualidades", etiqueta: "Mensualidades",
              tipo: "numero" },
            { clave: "cuota_cooperativa", etiqueta: "Cuota cooperativa (€/mes)",
              tipo: "numero" },
        ],
        defectos: {
            coste_total_proyecto: 1000000,
            porcentaje_participacion_pct: 25, pago_inicial_pct: 10,
            subvencion_pct: 20, tipo_fijo: 3.5, n_mensualidades: 300,
            cuota_cooperativa: 150,
        },
    },
};

// Permite usar el módulo desde Node.js (pruebas de paridad con Python).
if (typeof module !== "undefined") {
    module.exports = { MODELOS, ESPECIFICACION_UI, ConfigError };
}

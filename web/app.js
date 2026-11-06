"use strict";

// Interfaz interactiva: por cada modelo puede haber varias instancias, cada
// una con su recuadro de parámetros (nombre, activo, quitar) y una línea en
// los gráficos etiquetada con su nombre. La lógica de simulación vive en
// modelos.js (traducción de modelos/), así que todo funciona sin backend.

const PALETA = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];
const DEBOUNCE_MS = 300;

let graficoMensual = null;
let graficoAcumulado = null;
let temporizador = null;
let contadorInstancias = 0;  // ids únicos de instancia
let indiceColor = 0;
const coloresInstancia = new Map();  // id de instancia -> color de su línea

function formatoEUR(valor) {
    return valor.toLocaleString("es-ES", { maximumFractionDigits: 0 }) + " €";
}

// ---------------------------------------------------------------------------
// Construcción de la interfaz
// ---------------------------------------------------------------------------

function crearCampo(campo, defectos) {
    const envoltorio = document.createElement("label");
    envoltorio.className = "campo";
    const etiqueta = document.createElement("span");
    etiqueta.textContent = campo.etiqueta;
    envoltorio.appendChild(etiqueta);

    let entrada;
    if (campo.tipo === "booleano") {
        entrada = document.createElement("input");
        entrada.type = "checkbox";
        entrada.checked = Boolean(defectos[campo.clave]);
        envoltorio.classList.add("booleano");
    } else if (campo.tipo === "selector") {
        entrada = document.createElement("select");
        for (const opcion of campo.opciones) {
            const option = document.createElement("option");
            option.value = opcion;
            option.textContent = opcion;
            entrada.appendChild(option);
        }
        entrada.value = defectos[campo.clave] ?? campo.opciones[0];
    } else {  // numero
        entrada = document.createElement("input");
        entrada.type = "number";
        entrada.step = "any";
        entrada.value = defectos[campo.clave] ?? 0;
    }
    entrada.dataset.clave = campo.clave;
    envoltorio.appendChild(entrada);
    return envoltorio;
}

function recogerValores(contenedor) {
    const valores = {};
    contenedor.querySelectorAll("[data-clave]").forEach((entrada) => {
        const clave = entrada.dataset.clave;
        if (entrada.type === "checkbox") {
            valores[clave] = entrada.checked;
        } else if (entrada.type === "number") {
            valores[clave] = parseFloat(entrada.value);
        } else {
            valores[clave] = entrada.value;
        }
    });
    return valores;
}

function crearInstancia(modelo) {
    const spec = ESPECIFICACION_UI[modelo];
    const grupo = document.querySelector(
        `.grupo-modelo[data-modelo="${modelo}"] .instancias`);

    const existentes = grupo.querySelectorAll(".instancia").length;
    const nombreDefecto = existentes === 0 ? modelo : `${modelo} ${existentes + 1}`;

    const id = `inst-${++contadorInstancias}`;
    const color = PALETA[indiceColor++ % PALETA.length];
    coloresInstancia.set(id, color);

    const card = document.createElement("article");
    card.className = "instancia";
    card.dataset.modelo = modelo;
    card.dataset.id = id;
    card.style.borderLeftColor = color;

    const cabecera = document.createElement("div");
    cabecera.className = "cabecera";
    const activo = document.createElement("input");
    activo.type = "checkbox";
    activo.className = "activo";
    activo.checked = true;
    const nombre = document.createElement("input");
    nombre.type = "text";
    nombre.className = "nombre";
    nombre.value = nombreDefecto;
    nombre.placeholder = modelo;
    const quitar = document.createElement("button");
    quitar.className = "quitar";
    quitar.textContent = "✕";
    quitar.title = "Quitar instancia";
    quitar.addEventListener("click", () => {
        card.remove();
        recalcular();
    });
    cabecera.append(activo, nombre, quitar);

    const error = document.createElement("div");
    error.className = "error";

    const campos = document.createElement("div");
    campos.className = "campos";
    for (const campo of spec.campos) {
        campos.appendChild(crearCampo(campo, spec.defectos));
    }

    const resumen = document.createElement("pre");
    resumen.className = "resumen";

    card.append(cabecera, error, campos, resumen);
    grupo.appendChild(card);
}

function renderizarGrupos() {
    const contenedor = document.getElementById("modelos");
    for (const modelo of Object.keys(ESPECIFICACION_UI)) {
        const grupo = document.createElement("section");
        grupo.className = "grupo-modelo";
        grupo.dataset.modelo = modelo;

        const cabecera = document.createElement("div");
        cabecera.className = "cabecera-grupo";
        const titulo = document.createElement("h2");
        titulo.textContent = modelo;
        const anadir = document.createElement("button");
        anadir.textContent = "+ Añadir instancia";
        anadir.addEventListener("click", () => {
            crearInstancia(modelo);
            recalcular();
        });
        cabecera.append(titulo, anadir);

        const instancias = document.createElement("div");
        instancias.className = "instancias";

        grupo.append(cabecera, instancias);
        contenedor.appendChild(grupo);
        crearInstancia(modelo);  // una instancia inicial por modelo
    }
}

// ---------------------------------------------------------------------------
// Recálculo
// ---------------------------------------------------------------------------

function recalcular() {
    const valor = parseFloat(document.getElementById("horizonte").value);
    const unidades = document.getElementById("horizonte-unidades").value;
    const horizonteMeses = Math.round(valor * (unidades === "anios" ? 12 : 1));
    if (!Number.isFinite(horizonteMeses) || horizonteMeses < 1) return;

    const resultado = {};
    document.querySelectorAll(".instancia").forEach((card) => {
        if (!card.querySelector(".activo").checked) return;
        const modelo = card.dataset.modelo;
        const nombre = card.querySelector(".nombre").value.trim() || modelo;
        const id = card.dataset.id;
        try {
            const { cfg, horizonte } = MODELOS[modelo].cargar({
                ...recogerValores(card),
                modelo,
                horizonte_meses: horizonteMeses,
            });
            const filas = MODELOS[modelo].simular(cfg, horizonte);
            resultado[id] = {
                nombre,
                resumen: MODELOS[modelo].resumen(cfg, filas),
                serie: {
                    gasto_mes: filas.map((f) => f.gasto_mes),
                    gasto_acumulado: filas.map((f) => f.gasto_acumulado),
                    comentarios: filas
                        .filter((f) => f.comentario)
                        .map((f) => ({ mes: f.mes, texto: f.comentario })),
                },
            };
        } catch (e) {
            resultado[id] = {
                nombre,
                error: e instanceof ConfigError ? e.message : `error inesperado: ${e}`,
            };
        }
    });
    actualizarInstancias(resultado);
    actualizarGraficos(resultado);
}

function programarRecalculo() {
    clearTimeout(temporizador);
    temporizador = setTimeout(recalcular, DEBOUNCE_MS);
}

function actualizarInstancias(resultado) {
    document.querySelectorAll(".instancia").forEach((card) => {
        const res = resultado[card.dataset.id];
        const error = card.querySelector(".error");
        const resumen = card.querySelector(".resumen");
        if (!res) {  // instancia inactiva
            error.textContent = "";
            resumen.textContent = "";
            return;
        }
        error.textContent = res.error || "";
        resumen.textContent = res.error ? "" : res.resumen;
    });
}

// ---------------------------------------------------------------------------
// Gráficos
// ---------------------------------------------------------------------------

function configuracionGrafico(titulo, etiquetaY) {
    return {
        type: "line",
        data: { datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "nearest", axis: "x", intersect: false },
            scales: {
                x: {
                    type: "linear",
                    title: { display: true, text: "mes" },
                    ticks: { stepSize: 12, maxRotation: 0, autoSkip: false },
                },
                y: {
                    title: { display: true, text: etiquetaY },
                    ticks: { callback: (v) => formatoEUR(v) },
                },
            },
            plugins: {
                title: { display: true, text: titulo },
                legend: {
                    labels: {
                        filter: (item, data) =>
                            !data.datasets[item.datasetIndex].marcador,
                    },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.dataset.marcador) {
                                return ` ${ctx.dataset.label}: ${ctx.raw.texto} (mes ${ctx.parsed.x})`;
                            }
                            return ` ${ctx.dataset.label}: ${formatoEUR(ctx.parsed.y)}`;
                        },
                    },
                },
            },
        },
    };
}

function construirDatasets(resultado, claveSerie, incluirMes0) {
    const datasets = [];
    for (const [id, res] of Object.entries(resultado)) {
        if (!res.serie) continue;
        const color = coloresInstancia.get(id);

        datasets.push({
            label: res.nombre,
            data: res.serie[claveSerie].map((v, mes) => ({
                x: mes,
                y: mes === 0 && !incluirMes0 ? null : v,
            })),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 0,
        });

        // Hitos (firma, revisiones, última cuota) como marcadores.
        const marcadores = res.serie.comentarios
            .filter((c) => incluirMes0 || c.mes !== 0)
            .map((c) => ({
                x: c.mes,
                y: res.serie[claveSerie][c.mes],
                texto: c.texto,
            }));
        if (marcadores.length > 0) {
            datasets.push({
                marcador: true,
                type: "scatter",
                label: res.nombre,
                data: marcadores,
                backgroundColor: color,
                pointRadius: 5,
                pointStyle: "rectRot",
            });
        }
    }
    return datasets;
}

function actualizarGraficos(resultado) {
    const incluirFirma = document.getElementById("incluir-firma").checked;
    graficoMensual.data.datasets =
        construirDatasets(resultado, "gasto_mes", incluirFirma);
    graficoAcumulado.data.datasets =
        construirDatasets(resultado, "gasto_acumulado", true);
    graficoMensual.update("none");
    graficoAcumulado.update("none");
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function iniciar() {
    renderizarGrupos();

    graficoMensual = new Chart(
        document.getElementById("grafico-mensual"),
        configuracionGrafico("Gasto mensual", "gasto (€/mes)"));
    graficoAcumulado = new Chart(
        document.getElementById("grafico-acumulado"),
        configuracionGrafico("Gasto acumulado", "gasto acumulado (€)"));

    document.addEventListener("input", programarRecalculo);
    document.addEventListener("change", programarRecalculo);
    recalcular();
}

document.addEventListener("DOMContentLoaded", iniciar);

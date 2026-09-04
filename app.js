/* ============================================================
   MCCAIN · RASTREO DE EMBARQUES REFRIGERADOS
   app.js — búsqueda, render de dashboard y gráfica de temperatura
   ============================================================

   FUENTE DE DATOS
   ----------------------------------------------------------
   DATA_SOURCE = "supabase" (recomendado, producción):
     El sitio estático (Cloudflare Pages) llama DIRECTO a la API
     REST que Supabase genera sola a partir de tus tablas
     (PostgREST) — no hace falta una función intermedia tipo
     Azure Function ni Power Automate. El filtrado por los 3
     campos y el anidado de las lecturas de temperatura ocurren
     en un solo request HTTP (ver findOrderSupabase()).
     Configura SUPABASE_URL y SUPABASE_ANON_KEY abajo. La "anon
     key" es pública por diseño (no es secreta): el acceso de
     solo lectura está controlado por las políticas RLS definidas
     en supabase-schema.sql. NUNCA pongas aquí la "service_role
     key" — esa sí es secreta y permite escribir/borrar datos.

   DATA_SOURCE = "json" (pruebas locales, sin backend):
     Lee "data.json" tal cual lo exportaste del Excel de logística.
   ============================================================ */

const DATA_SOURCE = "supabase";           // "supabase" | "json"

const SUPABASE_URL = "https://zyoriesorhihnecosqwv.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "sb_publishable_-XaLq_WFCj01VmsdDCiHOw_2_570tq4";

// Alias que traducen las columnas snake_case de Postgres a los
// mismos nombres camelCase que ya usa el resto de este archivo.
const SUPABASE_SELECT = [
  "ordenCliente:orden_cliente",
  "cliente",
  "ordenInternaSAP:orden_interna_sap",
  "shipmentNumber:shipment_number",
  "temperaturaRequeridaMin:temperatura_req_min",
  "temperaturaRequeridaMax:temperatura_req_max",
  "fechaCarga:fecha_carga",
  "horaCarga:hora_carga",
  "fechaEntrega:fecha_entrega",
  "horaCitaCliente:hora_cita_cliente",
  "lineaTransporte:linea_transporte",
  "numeroCaja:numero_caja",
  "nombreChofer:nombre_chofer",
  "horaLlegadaCliente:hora_llegada_cliente",
  "horaAperturaCaja:hora_apertura_caja",
  "temperaturaApertura:temperatura_apertura",
  "lecturasTemperatura:lecturas_temperatura(fechaHora:fecha_hora,temperaturaReal:temperatura_real,setpoint,limiteSuperior:limite_superior,limiteInferior:limite_inferior)",
].join(",");

let ORDERS_CACHE = null; // solo se usa en modo "json"
let tempChartInstance = null;
let currentOrder = null;
let currentRange = "all"; // "6" | "12" | "24" | "all"

/* ---------------- Utilidades de datos ---------------- */

function normalize(str) {
  return String(str ?? "").trim().toLowerCase();
}

async function getOrdersFromJson() {
  if (ORDERS_CACHE) return ORDERS_CACHE;
  const res = await fetch("data.json");
  if (!res.ok) throw new Error("No se pudo leer data.json");
  const json = await res.json();
  ORDERS_CACHE = json.orders;
  return ORDERS_CACHE;
}

async function findOrderInJson(query) {
  const q = normalize(query);
  if (!q) return null;
  const orders = await getOrdersFromJson();
  return orders.find(o =>
    normalize(o.ordenCliente) === q ||
    normalize(o.ordenInternaSAP) === q ||
    normalize(o.shipmentNumber) === q
  ) || null;
}

async function findOrderInSupabase(query) {
  const q = String(query ?? "").trim();
  if (!q) return null;

  // .ilike. = comparación exacta sin distinguir mayúsculas/minúsculas
  // (equivalente al normalize() que usábamos en modo "json").
  const filtro = `or=(orden_cliente.ilike.${encodeURIComponent(q)},orden_interna_sap.ilike.${encodeURIComponent(q)},shipment_number.ilike.${encodeURIComponent(q)})`;

  const url =
    `${SUPABASE_URL}/rest/v1/embarques` +
    `?select=${encodeURIComponent(SUPABASE_SELECT)}` +
    `&${filtro}` +
    `&lecturas_temperatura.order=fecha_hora.asc` + // ordena la serie anidada
    `&limit=1`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase respondió ${res.status}. Revisa SUPABASE_URL / SUPABASE_ANON_KEY y las políticas RLS.`);
  }
  const rows = await res.json();
  return rows[0] || null;
}

async function findOrder(query) {
  return DATA_SOURCE === "json" ? findOrderInJson(query) : findOrderInSupabase(query);
}


/* ---------------- Formateo ---------------- */

function fmtFecha(iso) {
  if (!iso) return "Pendiente";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmtHora(hhmm) {
  return hhmm || "Pendiente";
}

function fmtTemp(v) {
  if (v === null || v === undefined) return "Pendiente";
  return `${v}°`;
}

function fmtRangoTemp(min, max) {
  return `${min}° a ${max}°`;
}

/* ---------------- Render: estados de búsqueda ---------------- */

const els = {
  form: document.getElementById("searchForm"),
  input: document.getElementById("searchInput"),
  loading: document.getElementById("loadingState"),
  empty: document.getElementById("emptyState"),
  emptyDetail: document.getElementById("emptyStateDetail"),
  dashboard: document.getElementById("dashboard"),
};

function showOnly(section) {
  els.loading.hidden = section !== "loading";
  els.empty.hidden = section !== "empty";
  els.dashboard.hidden = section !== "dashboard";
}

/* ---------------- Render: journey track ---------------- */

function renderJourney(order) {
  document.getElementById("journeyCarga").textContent =
    `${fmtFecha(order.fechaCarga)} · ${fmtHora(order.horaCarga)}`;
  document.getElementById("journeyEntrega").textContent =
    order.horaLlegadaCliente
      ? `${fmtFecha(order.fechaEntrega)} · ${order.horaLlegadaCliente}`
      : `Programada ${fmtFecha(order.fechaEntrega)}`;

  const steps = document.querySelectorAll(".journey-step");
  steps.forEach(s => s.classList.remove("is-done", "is-current"));

  const cargaStep = document.querySelector('[data-step="carga"]');
  const transitoStep = document.querySelector('[data-step="transito"]');
  const entregaStep = document.querySelector('[data-step="entrega"]');
  const transitoValue = document.getElementById("journeyTransito");

  if (order.horaLlegadaCliente) {
    cargaStep.classList.add("is-done");
    transitoStep.classList.add("is-done");
    entregaStep.classList.add("is-done");
    transitoValue.textContent = "Completado";
  } else {
    cargaStep.classList.add("is-done");
    transitoStep.classList.add("is-current");
    transitoValue.textContent = "En curso";
  }
}

/* ---------------- Render: secciones de datos ---------------- */

function renderDashboardData(order) {
  // Sección 1 — Información general
  document.getElementById("kpiOrdenCliente").textContent = order.ordenCliente;
  document.getElementById("kpiCliente").textContent = order.cliente;
  document.getElementById("kpiSAP").textContent = order.ordenInternaSAP;
  document.getElementById("kpiShipment").textContent = order.shipmentNumber;

  // Sección 2 — Requerimientos del cliente
  document.getElementById("reqTemperatura").textContent =
    fmtRangoTemp(order.temperaturaRequeridaMin, order.temperaturaRequeridaMax);
  document.getElementById("reqFechaEntrega").textContent = fmtFecha(order.fechaEntrega);
  document.getElementById("reqHoraCita").textContent = fmtHora(order.horaCitaCliente);

  // Sección 3 — Información de embarque
  document.getElementById("embFechaCarga").textContent = fmtFecha(order.fechaCarga);
  document.getElementById("embHoraCarga").textContent = fmtHora(order.horaCarga);
  document.getElementById("embLinea").textContent = order.lineaTransporte;
  document.getElementById("embCaja").textContent = order.numeroCaja;
  document.getElementById("embChofer").textContent = order.nombreChofer;

  // Sección 4 — Evidencia de recepción
  const evLlegada = document.getElementById("evLlegada");
  const evApertura = document.getElementById("evApertura");
  const evTemp = document.getElementById("evTemp");

  setEvidenceChip(evLlegada, order.horaLlegadaCliente
    ? `${fmtFecha(order.fechaEntrega)} · ${order.horaLlegadaCliente}` : null);
  setEvidenceChip(evApertura, order.horaAperturaCaja);
  setEvidenceChip(evTemp, order.temperaturaApertura !== null ? fmtTemp(order.temperaturaApertura) : null);

  // Resalta si la temperatura de apertura se sale del rango pactado
  evTemp.classList.remove("is-alert");
  if (order.temperaturaApertura !== null && order.temperaturaApertura !== undefined) {
    const fuera = order.temperaturaApertura > order.temperaturaRequeridaMax ||
                  order.temperaturaApertura < order.temperaturaRequeridaMin;
    if (fuera) evTemp.classList.add("is-alert");
  }
}

function setEvidenceChip(chipEl, value) {
  chipEl.classList.remove("is-pending");
  const valueEl = chipEl.querySelector(".data-value");
  if (value) {
    valueEl.textContent = value;
  } else {
    valueEl.textContent = "Pendiente";
    chipEl.classList.add("is-pending");
  }
}

/* ---------------- Render: gráfica de temperatura ---------------- */

function filterReadingsByRange(readings, range) {
  if (range === "all") return readings;
  const hours = Number(range);
  const last = new Date(readings[readings.length - 1].fechaHora);
  const cutoff = new Date(last.getTime() - hours * 3600 * 1000);
  return readings.filter(r => new Date(r.fechaHora) >= cutoff);
}

function buildChart(order) {
  const ctx = document.getElementById("tempChart").getContext("2d");
  const readings = filterReadingsByRange(order.lecturasTemperatura, currentRange);

  const styles = getComputedStyle(document.documentElement);
  const colorText = styles.getPropertyValue("--text-muted").trim();
  const colorGrid = styles.getPropertyValue("--border").trim();
  const colorAccent = styles.getPropertyValue("--accent").trim();
  const colorAlert = styles.getPropertyValue("--alert").trim();
  const colorSuccess = styles.getPropertyValue("--success").trim();

  const dataReal = readings.map(r => ({ x: r.fechaHora, y: r.temperaturaReal }));
  const dataSetpoint = readings.map(r => ({ x: r.fechaHora, y: r.setpoint }));
  const dataSup = readings.map(r => ({ x: r.fechaHora, y: r.limiteSuperior }));
  const dataInf = readings.map(r => ({ x: r.fechaHora, y: r.limiteInferior }));

  // Colorea puntos fuera de rango en rojo de alerta
  const pointColors = readings.map(r =>
    (r.temperaturaReal > r.limiteSuperior || r.temperaturaReal < r.limiteInferior)
      ? colorAlert : colorAccent
  );

  if (tempChartInstance) tempChartInstance.destroy();

  tempChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Temperatura real",
          data: dataReal,
          borderColor: colorAccent,
          backgroundColor: colorAccent,
          pointBackgroundColor: pointColors,
          pointBorderColor: pointColors,
          pointRadius: 2.5,
          pointHoverRadius: 5,
          borderWidth: 2,
          tension: 0.25,
          spanGaps: true,
        },
        {
          label: "Setpoint",
          data: dataSetpoint,
          borderColor: colorSuccess,
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: "Límite superior de alerta",
          data: dataSup,
          borderColor: colorAlert,
          borderDash: [2, 3],
          borderWidth: 1.2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: "Límite inferior de alerta",
          data: dataInf,
          borderColor: colorAlert,
          borderDash: [2, 3],
          borderWidth: 1.2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: colorText, boxWidth: 14, font: { size: 11.5 } },
        },
        tooltip: {
          callbacks: {
            title(items) {
              const d = new Date(items[0].parsed.x);
              return d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
            },
            label(item) {
              return `${item.dataset.label}: ${item.parsed.y}°`;
            },
          },
        },
        zoom: {
          pan: { enabled: true, mode: "x" },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
          },
          limits: { x: { minRange: 3600 * 1000 } },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "hour", tooltipFormat: "d MMM HH:mm" },
          grid: { color: colorGrid },
          ticks: { color: colorText, maxRotation: 0, autoSkip: true, font: { size: 11 } },
        },
        y: {
          grid: { color: colorGrid },
          ticks: { color: colorText, callback: v => `${v}°`, font: { size: 11 } },
          title: { display: true, text: "Temperatura (°C)", color: colorText },
        },
      },
    },
  });

  // Banner de alerta si hubo excursión de temperatura en la ventana visible
  const huboExcursion = readings.some(r =>
    r.temperaturaReal > r.limiteSuperior || r.temperaturaReal < r.limiteInferior);
  const banner = document.getElementById("chartAlertBanner");
  banner.hidden = !huboExcursion;
}

function setActiveRangePill(range) {
  document.querySelectorAll(".pill").forEach(p => {
    p.classList.toggle("is-active", p.dataset.range === range);
  });
}

/* ---------------- Flujo principal de búsqueda ---------------- */

async function runSearch(query) {
  showOnly("loading");
  try {
    const order = await findOrder(query);
    if (!order) {
      document.getElementById("emptyStateDetail").textContent =
        `No encontramos ninguna orden que coincida con "${query}". Revisa el número e inténtalo de nuevo.`;
      showOnly("empty");
      return;
    }
    currentOrder = order;
    currentRange = "all";
    setActiveRangePill("all");
    renderJourney(order);
    renderDashboardData(order);
    buildChart(order);
    showOnly("dashboard");
    els.dashboard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    document.getElementById("emptyStateDetail").textContent =
      "Ocurrió un problema al consultar la información. Intenta de nuevo en unos minutos.";
    showOnly("empty");
  }
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (q) runSearch(q);
});

document.querySelectorAll(".chip-example").forEach(btn => {
  btn.addEventListener("click", () => {
    els.input.value = btn.dataset.q;
    runSearch(btn.dataset.q);
  });
});

document.querySelectorAll(".pill").forEach(btn => {
  btn.addEventListener("click", () => {
    currentRange = btn.dataset.range;
    setActiveRangePill(currentRange);
    if (currentOrder) buildChart(currentOrder);
  });
});

document.getElementById("resetZoom").addEventListener("click", () => {
  if (tempChartInstance) tempChartInstance.resetZoom();
});

/* ---------------- Modo oscuro ---------------- */

const THEME_KEY = "mccain-dashboard-theme";
const themeToggle = document.getElementById("themeToggle");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"
  );
  if (currentOrder) buildChart(currentOrder); // recolorea la gráfica con el nuevo tema
}

(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
})();

themeToggle.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

/* ---------------- Autobúsqueda desde QR (?buscar=) ----------------
   Un QR puede apuntar a index.html?buscar=103122501 para que la
   página busque automáticamente el embarque de esa caja. */
(function initFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get("buscar");
  if (q) {
    els.input.value = q;
    runSearch(q);
  }
})();

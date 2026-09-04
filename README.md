# Rastreo de Embarques Refrigerados — McCain Foods

Dashboard web responsivo, accesible por QR, para consultar el estado de un
embarque (orden de cliente, orden SAP o shipment number) con monitoreo
interactivo de temperatura en tránsito.

```
mccain-qr-dashboard/
├── index.html            → estructura de la página (buscador + dashboard)
├── styles.css            → estilos, tema claro/oscuro, responsive
├── app.js                → búsqueda, render de secciones y gráfica
├── data.json             → datos de ejemplo para pruebas locales sin backend
├── supabase-schema.sql    → tablas + seguridad (RLS) para Supabase — usar esta
├── supabase-seed.sql      → carga los 3 embarques de ejemplo en Supabase
├── schema.sql             → versión SQL Server/Azure SQL (alternativa, no requerida)
└── README.md              → este documento
```

> Si ya empezaste a crear un **Static Web App en Azure** con el nombre
> `mccain-embarques`, puedes eliminarlo (Resource Group `QR-logistica` →
> `mccain-embarques` → **Delete**) para no seguir pagando el plan *Standard*.
> Con Cloudflare Pages + Supabase no necesitas Azure en absoluto.

## 1. Arquitectura

```
┌────────────┐      ┌───────────────────────┐      ┌──────────────────────────┐
│  Caja /     │ QR   │ Cloudflare Pages       │ GET  │  Supabase                 │
│  Shipment   │─────▶│ (index.html/css/js,    │─────▶│  API REST automática       │
│  (etiqueta) │      │  hosting estático,     │      │  (PostgREST) generada a    │
└────────────┘      │  gratis, CDN global)   │      │  partir de tus tablas      │
                     └───────────────────────┘      │  + Postgres                │
                                                      └──────────────────────────┘
```

**Por qué es mejor que la versión con Azure Function/Power Automate:**
- **Un salto menos**: el navegador llama directo a la API de Supabase — no
  hay una función intermedia que mantener, desplegar ni autenticar por
  separado. Supabase genera esa API sola al crear las tablas.
- **Cloudflare Pages** es gratis para este tamaño de sitio, con CDN global
  (el QR carga rápido sin importar desde qué ciudad se escanee) y despliega
  solo con cada `git push`.
- **Supabase** es Postgres real (no un servicio propietario cerrado): puedes
  exportar, respaldar o migrar los datos cuando quieras, y el plan gratuito
  alcanza sin problema para un tablero de consulta como este.
- El filtrado por los 3 campos de búsqueda y el anidado de las lecturas de
  temperatura ocurren en **una sola llamada HTTP** (ver `findOrderInSupabase()`
  en `app.js`), gracias al *resource embedding* de PostgREST.

## 2. Crear el proyecto en Supabase

1. Ve a **supabase.com** → **Start your project** → inicia sesión (puedes
   usar tu cuenta de GitHub) → **New project**.
2. Ponle nombre (ej. `mccain-embarques`), define una contraseña de base de
   datos (guárdala, la pide para conexiones directas aunque aquí no la
   usaremos) y elige la región más cercana.
3. Espera 1-2 minutos a que aprovisione el proyecto.
4. En el menú lateral, ve a **SQL Editor** → **New query**.
5. Copia y pega **todo el contenido de `supabase-schema.sql`** → **Run**.
   Esto crea las tablas `embarques` y `lecturas_temperatura`, sus índices, y
   las políticas de seguridad (RLS) de solo lectura.
6. Repite el paso con **todo el contenido de `supabase-seed.sql`** → **Run**.
   Esto carga los 3 embarques de ejemplo (los mismos de `data.json`).
7. Verifica: **Table Editor** (menú lateral) → tabla `embarques` → deberías
   ver 3 filas; tabla `lecturas_temperatura` → deberías ver ~180 filas.

### Obtener las credenciales para el frontend

1. En el proyecto de Supabase: **Project Settings** (ícono de engrane) →
   **API**.
2. Copia dos valores:
   - **Project URL** → algo como `https://abcdxyz.supabase.co`
   - **anon public** (dentro de "Project API keys") → una clave larga que
     empieza con `eyJ...`
3. Pégalos en `app.js`:
   ```js
   const SUPABASE_URL = "https://abcdxyz.supabase.co";
   const SUPABASE_ANON_KEY = "eyJ...tu-clave-anon...";
   ```

> **Importante**: usa siempre la clave marcada **"anon" / "public"**, nunca
> la **"service_role"** (esa es secreta y permite escribir/borrar datos; si
> la pones en un archivo JS que viaja al navegador, cualquiera podría
> alterar tu base de datos). El acceso de la clave `anon` está limitado a
> solo lectura por las políticas RLS que ya definiste en el paso anterior.

## 3. Prueba local antes de publicar

```bash
cd mccain-qr-dashboard
python3 -m http.server 8000
```

Abre `http://localhost:8000`, busca `OCSEP01` y confirma que carga el
dashboard con datos viniendo de Supabase (no de `data.json`, ya que dejamos
`DATA_SOURCE = "supabase"` en `app.js`). Si ves un dashboard vacío o un
error en la consola del navegador, revisa la sección **Solución de
problemas** más abajo.

## 4. Publicar en Cloudflare Pages

1. Sube el proyecto a GitHub si aún no lo has hecho:
   ```bash
   cd mccain-qr-dashboard
   git init
   git add .
   git commit -m "Dashboard de rastreo de embarques"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/mccain-qr-dashboard.git
   git push -u origin main
   ```
2. Ve a **dash.cloudflare.com** → inicia sesión (o crea una cuenta gratis) →
   en el menú lateral **Workers & Pages** → **Create** → pestaña **Pages** →
   **Connect to Git**.
3. Autoriza a Cloudflare a acceder a tu cuenta de GitHub y selecciona el
   repositorio `mccain-qr-dashboard`.
4. En **Set up builds and deployments**:
   - **Framework preset**: `None`
   - **Build command**: (déjalo vacío)
   - **Build output directory**: `/` (raíz del proyecto)
5. **Save and Deploy**. Cloudflare construye y publica en 30-60 segundos.
6. Te da una URL como `https://mccain-qr-dashboard.pages.dev`. Ábrela y
   prueba una búsqueda igual que en local.

Cada vez que hagas `git push` a `main`, Cloudflare vuelve a desplegar solo.

### Dominio propio (opcional)

Si el dominio de McCain (o un subdominio como `embarques.mccain.com`) ya
está en Cloudflare: entra al proyecto de Pages → **Custom domains** →
**Set up a custom domain** → escribe el subdominio → Cloudflare configura el
DNS automáticamente (es casi instantáneo si el dominio ya vive ahí). Si el
dominio está en otro proveedor, te da un registro CNAME para agregar
manualmente.

## 5. Genera los códigos QR

Con tu URL final de Cloudflare Pages, genera un QR por embarque incluyendo
el shipment number para que la página busque automáticamente al escanear:

```bash
pip install qrcode[pil] --break-system-packages
```

```python
import qrcode
url = "https://mccain-qr-dashboard.pages.dev/?buscar=103122501"
qrcode.make(url).save("QR_103122501.png")
```

Si necesitas generar cientos de QR (uno por shipment) a partir de tu lista
de Excel, dímelo y te armo el script que lee la lista y exporta todos los
PNG en lote.

## 6. Cargar embarques reales (uso diario)

Con el esquema ya creado, cargar un nuevo embarque es un `INSERT` en el
**SQL Editor** de Supabase (o, si prefieres una interfaz, en **Table
Editor** → `embarques` → **Insert row**):

```sql
insert into public.embarques (
  orden_cliente, cliente, orden_interna_sap, shipment_number,
  temperatura_req_min, temperatura_req_max,
  fecha_carga, hora_carga, fecha_entrega, hora_cita_cliente,
  linea_transporte, numero_caja, nombre_chofer
) values (
  'OCSEP08', 'Nuevo Cliente SA', '33695200', '103122700',
  -18, -12,
  '2026-09-10', '14:00', '2026-09-12', '09:00',
  'Transportes del Bajío', '7001', 'Ricardo Paredes'
);
```

Y las lecturas de temperatura del datalogger/reefer se insertan en
`lecturas_temperatura` referenciando el `id` que generó el `INSERT` anterior
(ver el patrón completo en `supabase-seed.sql`). Si ya cuentan con un
sistema de telemetría en las cajas, lo ideal a mediano plazo es que ese
sistema escriba directo a esta tabla vía la API de Supabase (con una
*service role key* guardada de forma segura del lado del servidor de ese
sistema, no en el navegador).

Si por ahora prefieren seguir capturando todo en Excel y solo quieren
sincronizarlo a Supabase periódicamente, dímelo y armamos ese flujo
(Power Automate o un script) sin tocar el frontend.

## 7. Mapeo de columnas del Excel a las tablas de Supabase

| Columna del Excel      | Columna en Supabase (`embarques`)            |
|-------------------------|------------------------------------------------|
| OrdenCliente             | `orden_cliente`                                |
| Cliente                  | `cliente`                                      |
| OrdenInternaSAP          | `orden_interna_sap`                            |
| ShipmentNumber           | `shipment_number`                              |
| TemperaturaRequerida     | `temperatura_req_min` / `temperatura_req_max` (rango dividido en dos columnas numéricas) |
| FechaCarga               | `fecha_carga`                                  |
| HoraCarga                | `hora_carga`                                   |
| FechaEntrega             | `fecha_entrega`                                |
| HoraCitaCliente          | `hora_cita_cliente`                            |
| LineaTransporte          | `linea_transporte`                             |
| NumeroCaja               | `numero_caja`                                  |
| NombreChofer             | `nombre_chofer`                                |
| HoraLlegadaCliente       | `hora_llegada_cliente`                         |
| HoraAperturaCaja         | `hora_apertura_caja`                           |
| TemperaturaApertura      | `temperatura_apertura`                         |
| RutaImagenGrafica        | tabla `lecturas_temperatura` (serie de datos, no una imagen — así se logra el zoom y los filtros de tiempo) |

## 8. Código de la gráfica

La gráfica (Sección 5) usa **Chart.js** vía CDN (ya referenciado en
`index.html`) con `chartjs-plugin-zoom` para arrastrar/hacer zoom, y botones
de rango (6h / 12h / 24h / Todo) en `app.js` (`buildChart()` y
`filterReadingsByRange()`). Los puntos fuera del rango pactado
(`limiteSuperior` / `limiteInferior`) se pintan en rojo de alerta
automáticamente y se muestra un aviso arriba de la gráfica.

## 9. Validación cuando la orden no existe

`findOrder()` en `app.js` regresa `null` si Supabase no encuentra
coincidencia por ninguno de los tres campos, y la página muestra el estado
"No encontramos esa orden" con el texto de ayuda correspondiente.

## 10. Solución de problemas

- **"Supabase respondió 401/403" en consola**: revisa que copiaste la clave
  `anon public` completa (son muy largas) y que no quedaron espacios extra.
- **Dashboard vacío pero sin error**: probablemente `supabase-schema.sql` no
  terminó de correr (revisa la pestaña de resultados del SQL Editor) o las
  políticas RLS no se crearon — vuelve a ejecutar la sección "SEGURIDAD" del
  script.
- **Funciona en local pero no en Cloudflare Pages**: confirma que el
  `git push` subió los cambios más recientes de `app.js` (con tus claves de
  Supabase ya puestas) y que Cloudflare terminó el nuevo deploy — revisa la
  pestaña **Deployments** del proyecto en Cloudflare.
- **La búsqueda no encuentra un embarque que sí existe**: revisa que el
  valor buscado no tenga espacios de más y que coincida exactamente con
  `orden_cliente`, `orden_interna_sap` o `shipment_number` (la comparación
  ignora mayúsculas/minúsculas, pero no espacios ni caracteres de más).

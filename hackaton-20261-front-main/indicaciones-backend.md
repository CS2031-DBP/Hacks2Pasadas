# Indicaciones - Backend para TropelCare Pizza Protocol

Este documento es la especificacion para implementar el backend cerrado de la hackathon
frontend. Los alumnos solo recibiran la URL, credenciales y el contrato publico.

La meta es un backend simple, deterministico y desplegable rapidamente. No se busca una
plataforma de produccion general ni alta disponibilidad multi-region.

---

## Objetivo y Alcance

Construir **TropelCare Control API**, una API multi-tenant para 200-300 alumnos durante
una hackathon de 2 horas.

Debe soportar:

- autenticacion por equipo;
- aislamiento estricto entre workspaces;
- dashboard;
- paginacion, filtros, busqueda y ordenamiento;
- feed cursor-based para infinite scroll;
- consulta y actualizacion simple de Senales;
- contenido deterministico para scrollytelling;
- fallos controlados para evaluacion docente;
- deploy reproducible en GCP.

Fuera de alcance:

- SSE, WebSockets, polling o eventos en tiempo real;
- concurrencia optimista, `ETag`, `If-Match` e idempotency keys;
- Redis, Pub/Sub y microservicios;
- servicios o APIs de IA;
- generacion dinamica de texto, imagenes o narrativa;
- SMTP, webhooks y almacenamiento de archivos.

Toda la informacion se genera con un seed deterministico antes de la hackathon. La
narrativa de los sectores usa plantillas locales versionadas en el repositorio. Esto no
consume tokens ni creditos de IA.

---

## Carga Esperada

| Dimension | Objetivo |
|:----------|:---------|
| Alumnos | 200-300 |
| Equipos/workspaces | 70-100 |
| Usuarios por equipo | 3 |
| Requests pico | 60-100 req/s |
| Latencia de lectura | p95 menor a 800 ms |
| Latencia de mutacion | p95 menor a 1000 ms |
| Errores 5xx | Menor a 1% |
| Ventana principal | 3 horas |

---

## Stack

- Node.js 22+ (imagen Docker Node 24).
- Fastify.
- TypeScript estricto.
- PostgreSQL 16.
- `pg` con queries parametrizadas.
- TypeBox para schemas y tipos compartidos.
- `@fastify/swagger` para generar OpenAPI desde los mismos schemas.
- JWT.
- Pino con logs estructurados.
- Vitest.

OpenAPI no es IA ni un servicio externo. Es un JSON/YAML que describe requests y
responses. Se genera desde los schemas de Fastify para evitar que el frontend y backend
interpreten el contrato de manera distinta.

---

## Arquitectura

```txt
Frontends de equipos
        |
        v
Cloud Run - API Fastify stateless
        |
        v
Cloud SQL for PostgreSQL
```

Reglas:

- Toda consulta usa `workspaceId` extraido del JWT.
- Un ID de otro workspace responde `404`, incluso si existe.
- No hay estado relevante en memoria entre requests.
- Migraciones y seed se ejecutan como job separado, nunca en el startup de la API.
- Pool inicial por instancia: maximo 10 conexiones.
- La API no depende de IA ni de servicios externos durante la hackathon.

---

## Multi-Tenancy y Autenticacion

Crear 100 workspaces:

```txt
TEAM-001 ... TEAM-100
```

Cada workspace tiene tres usuarios operadores y un dataset aislado.

Login:

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "teamCode": "TEAM-001",
  "email": "operator@tuckersoft.com",
  "password": "password-del-equipo"
}
```

Respuesta:

```json
{
  "token": "jwt",
  "expiresAt": "2026-06-22T20:00:00Z",
  "user": {
    "id": "usr_001",
    "displayName": "Operator 1",
    "email": "operator@tuckersoft.com",
    "teamCode": "TEAM-001",
    "role": "OPERATOR"
  }
}
```

El JWT contiene `sub`, `workspaceId`, `teamCode`, `role` y `exp`. Duracion: 4 horas.

---

## Modelo de Datos

### Workspace

- `id`
- `teamCode`, unico
- `displayName`
- `createdAt`

### User

- `id`
- `workspaceId`
- `displayName`
- `email`
- `passwordHash`
- `role`
- `createdAt`

### Sector

- `id`
- `workspaceId`
- `sectorCode`
- `name`
- `climate`
- `capacity`
- `currentLoad`
- `stabilityLevel`
- `updatedAt`

### Tropel

- `id`
- `workspaceId`
- `name`
- `species`
- `vitalState`
- `energyLevel`
- `chaosIndex`
- `mutationStage`
- `sectorId`
- `guardianName`
- `createdAt`
- `updatedAt`

### Signal

- `id`
- `workspaceId`
- `tropelId`
- `signalType`
- `severity`
- `status`
- `rawContent`
- `createdAt`
- `updatedAt`

### SectorStoryStage

- `id`
- `workspaceId`
- `sectorId`
- `stageOrder`, entero de 0 a 7
- `title`
- `narrative`
- `dominantEvent`
- `metrics`, JSONB validado
- `assetKey`
- `colorToken`
- `progress`, decimal entre 0 y 1

Clave unica: `(workspaceId, sectorId, stageOrder)`.

### Valores Permitidos

```txt
species: BLOBITO, CHISPA, GRUNON, DORMILON, GLITCHY
vitalState: ESTABLE, HAMBRIENTO, AGITADO, MUTANDO, CRITICO
signalType: HAMBRE, ABANDONO, MUTACION, FUGA, CONFLICTO,
            REPRODUCCION_MASIVA, SENAL_CORRUPTA
severity: LEVE, MODERADO, GRAVE, CRITICO
status: RECIBIDA, PROCESANDO, ATENDIDA
climate: PIXEL_FOREST, NEON_CAVE, CLOUD_AQUARIUM, RETRO_ARCADE
```

### Indices Obligatorios

```sql
users(workspace_id, email) UNIQUE
sectors(workspace_id, sector_code) UNIQUE
tropels(workspace_id, name)
tropels(workspace_id, species, vital_state, sector_id)
tropels(workspace_id, updated_at DESC)
signals(workspace_id, created_at DESC, id DESC)
signals(workspace_id, signal_type, severity, status, created_at DESC, id DESC)
signals(workspace_id, tropel_id, created_at DESC)
sector_story_stages(workspace_id, sector_id, stage_order) UNIQUE
```

---

## Seed Deterministico y Simulacion

Usar una semilla fija por workspace, derivada de `teamCode`. Ejecutar el seed una sola
vez antes de publicar la API. Debe ser idempotente.

Por workspace:

- 3 usuarios.
- 12 sectores.
- 120 Tropeles.
- 600 Senales.
- mezcla suficiente de filtros y estados.
- 8 etapas de historia por sector.

Total para 100 equipos:

- 1200 sectores.
- 12000 Tropeles.
- 60000 Senales.
- 9600 etapas de historia.

Las Senales, metricas y narrativas son datos simulados localmente. No llamar OpenAI,
Gemini ni otra API. Las mismas entradas siempre deben producir el mismo dataset.

---

## Endpoints Publicos

Prefijo: `/api/v1`.

| Metodo | Endpoint | Auth | Descripcion |
|:-------|:---------|:----:|:------------|
| GET | `/health` | No | Liveness |
| GET | `/ready` | No | Readiness con DB y migraciones |
| GET | `/openapi.json` | No | Contrato congelado |
| POST | `/auth/login` | No | Login por equipo |
| GET | `/auth/me` | JWT | Restaurar sesion |
| GET | `/dashboard/summary` | JWT | KPIs del workspace |
| GET | `/tropels` | JWT | Paginacion clasica |
| GET | `/tropels/:id` | JWT | Detalle |
| GET | `/signals/feed` | JWT | Feed cursor-based |
| GET | `/signals/:id` | JWT | Detalle |
| PATCH | `/signals/:id/status` | JWT | Actualizar estado |
| GET | `/sectors` | JWT | Lista de sectores |
| GET | `/sectors/:id/story` | JWT | Scrollytelling |

---

## Contratos Esenciales

### Dashboard

```json
{
  "totalTropels": 120,
  "criticalTropels": 14,
  "openSignals": 83,
  "sectorStabilityAvg": 68,
  "signalsBySeverity": {
    "LEVE": 30,
    "MODERADO": 25,
    "GRAVE": 18,
    "CRITICO": 10
  },
  "generatedAt": "2026-06-22T15:00:00Z"
}
```

Cache opcional por workspace durante 5 segundos.

### Tropel DTO

```json
{
  "id": "trp_001",
  "name": "Pixelin",
  "species": "CHISPA",
  "vitalState": "AGITADO",
  "energyLevel": 72,
  "chaosIndex": 31,
  "mutationStage": 2,
  "guardianName": "Ada",
  "sector": {
    "id": "sec_001",
    "name": "Bosque Norte",
    "sectorCode": "SEC-01"
  },
  "createdAt": "2026-06-20T10:00:00Z",
  "updatedAt": "2026-06-22T14:30:00Z"
}
```

`GET /tropels?page=0&size=20&species=&vitalState=&sectorId=&q=&sort=updatedAt,desc`

```json
{
  "content": [],
  "totalElements": 120,
  "totalPages": 6,
  "currentPage": 0,
  "size": 20
}
```

Reglas:

- `page` default 0.
- `size`: 10, 20 o 50; default 20.
- `q` maximo 80 caracteres.
- `sort`: `name,asc`, `updatedAt,desc` o `chaosIndex,desc`.
- Responder `400` para valores invalidos.

### Signal DTO

```json
{
  "id": "sig_001",
  "signalType": "HAMBRE",
  "severity": "GRAVE",
  "status": "RECIBIDA",
  "rawContent": "Patron de energia por debajo del umbral",
  "tropel": {
    "id": "trp_001",
    "name": "Pixelin",
    "species": "CHISPA"
  },
  "createdAt": "2026-06-22T14:00:00Z",
  "updatedAt": "2026-06-22T14:00:00Z"
}
```

### Feed de Senales

`GET /signals/feed?cursor=&limit=15&signalType=&severity=&status=&q=`

```json
{
  "items": [],
  "nextCursor": "cursor_opaco_o_null",
  "hasMore": true,
  "totalEstimate": 600
}
```

Reglas:

- Orden estable: `createdAt DESC`, luego `id DESC`.
- Cursor opaco con `createdAt`, `id` y hash de filtros.
- Rechazar un cursor usado con filtros distintos.
- `limit` default 15, maximo 30.
- No repetir IDs entre paginas.
- El dataset no cambia automaticamente durante la evaluacion.

### Actualizar una Senal

```http
PATCH /api/v1/signals/sig_001/status
Authorization: Bearer <jwt>
Content-Type: application/json
```

```json
{
  "status": "ATENDIDA"
}
```

Solo aceptar `PROCESANDO` o `ATENDIDA`. Actualizar `updatedAt` y devolver el Signal DTO
completo. No requiere headers especiales ni actualizacion optimista.

### Sectores y Story

`GET /sectors` devuelve una lista liviana:

```json
{
  "items": [
    {
      "id": "sec_001",
      "sectorCode": "SEC-01",
      "name": "Bosque Norte",
      "climate": "PIXEL_FOREST",
      "capacity": 20,
      "currentLoad": 10,
      "stabilityLevel": 68
    }
  ]
}
```

`GET /sectors/:id/story` devuelve el sector y exactamente 8 etapas ordenadas:

```json
{
  "sector": {
    "id": "sec_001",
    "name": "Bosque Norte",
    "climate": "PIXEL_FOREST"
  },
  "stages": [
    {
      "id": "stage_001",
      "order": 0,
      "title": "Primer pulso",
      "narrative": "La actividad despierta entre pixeles verdes.",
      "dominantEvent": "HAMBRE",
      "metrics": {
        "stability": 68,
        "energy": 72,
        "alerts": 4
      },
      "assetKey": "pixel_forest-stage-1",
      "colorToken": "emerald",
      "progress": 0
    }
  ]
}
```

`assetKey` y `colorToken` son identificadores, no URLs generadas. El frontend construye
el visual con CSS y assets locales.

## OpenAPI y Contrato Congelado

TypeBox debe ser la unica fuente para validacion y tipos HTTP. `@fastify/swagger` genera
`openapi.json` durante build o startup.

Antes de la hackathon:

1. generar `openapi.json`;
2. ejecutar contract tests;
3. copiar los ejemplos relevantes al enunciado frontend;
4. congelar rutas, campos, enums y errores;
5. no hacer cambios incompatibles durante la evaluacion.

Los alumnos no necesitan instalar nada de OpenAPI y esto no consume servicios pagados.

---

## Herramientas Docentes Privadas

No publicar estas rutas en el enunciado ni en OpenAPI publico.

| Metodo | Endpoint | Uso |
|:-------|:---------|:----|
| POST | `/admin/workspaces/:teamCode/reset` | Restaurar el seed del equipo |
| POST | `/admin/workspaces/:teamCode/scenario` | Configurar delay o siguiente error |

Proteger con `X-Admin-Token`.

El escenario permite:

- delay entre 0 y 3000 ms;
- siguiente request de lectura con `500`;
- siguiente PATCH con `500`;
- limpiar el escenario.

El efecto se limita al workspace seleccionado y se consume una sola vez. Esto permite
evaluar requests obsoletas y recuperación de error sin un simulador permanente.

---

## Errores

Formato unico:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Parametro size invalido",
  "timestamp": "2026-06-22T15:00:00Z",
  "path": "/api/v1/tropels",
  "details": {}
}
```

Codigos requeridos:

- `400 VALIDATION_ERROR`
- `401 UNAUTHORIZED`
- `404 NOT_FOUND`
- `429 RATE_LIMITED`, con `Retry-After`
- `500 INTERNAL_ERROR`

---

## Seguridad y CORS

- Passwords con Argon2 o bcrypt.
- JWT firmado con secret de alta entropia.
- No loggear `Authorization` ni passwords.
- Limitar body a 32 KB.
- Validar params, query y body.
- Rate limit por `workspaceId + userId`.
- Base: 600 requests/minuto por workspace.
- Login: 30 requests/minuto por IP.
- CORS con allowlist para localhost y patrones limitados de Vercel/Netlify. Validar el
  hostname completo; no aceptar cualquier origen que solo contenga esas palabras.
- Acceso cruzado responde `404`.
- Rutas admin usan token distinto y nunca quedan enlazadas publicamente.

---

## Observabilidad

Logs JSON:

- `requestId`;
- `workspaceId` cuando exista;
- ruta normalizada;
- status;
- duracion;
- error code.

Metricas y alertas minimas:

- requests por segundo;
- p50/p95/p99;
- 4xx y 5xx;
- pool DB activo y en espera;
- uso de CPU y memoria;
- instancias de Cloud Run.

Healthchecks:

- `/api/v1/health`: proceso vivo, sin consultar DB.
- `/api/v1/ready`: DB disponible, migracion esperada instalada y setup completo.

---

## Deploy Recomendado en GCP

```txt
Internet
   |
Cloud Run: tropelcare-api
   |
Cloud SQL PostgreSQL 16

Cloud Build -> Artifact Registry -> Cloud Run
Secret Manager -> Cloud Run
Cloud Run Job -> migrate y seed
```

### Configuracion Inicial

| Recurso | Configuracion |
|:--------|:--------------|
| Region | `us-central1` para todos los recursos |
| Cloud Run | 1 vCPU, 1 GiB, concurrency 80, timeout 60 s |
| Escalado | `minInstances=1`, `maxInstances=3` durante el evento |
| Cloud SQL | PostgreSQL 16 Enterprise zonal, `db-custom-1-3840`, SSD 20 GB |
| Pool | Maximo 10 conexiones por instancia |
| Imagen | Artifact Registry regional, tag inmutable por commit |
| Migracion | Cloud Run Job separado |

Los USD 300 de credito son suficientes para esta configuracion durante desarrollo,
pruebas y hackathon con amplio margen. Cloud SQL se factura mientras exista; configurar
budget alerts y destruir los recursos al terminar. Confirmar siempre el estimado en la
calculadora de GCP para la cuenta real.

La API conecta a Cloud SQL mediante el socket administrado:

```txt
/cloudsql/<PROJECT:REGION:INSTANCE>
```

La service account de runtime recibe `roles/cloudsql.client` y acceso solo a sus secretos.

---

## Infraestructura como Codigo con Pulumi

Pulumi se instala en la maquina de despliegue o CI, no dentro de la API. Usar TypeScript.

```txt
infra/
  foundation/
    Pulumi.yaml
    index.ts
  application/
    Pulumi.yaml
    index.ts
  deploy.sh
  destroy.sh
Dockerfile
.dockerignore
```

### Stack foundation

Crear:

- APIs de Cloud Run, Cloud SQL, Artifact Registry, Cloud Build, Secret Manager,
  Monitoring y Billing Budgets;
- Artifact Registry regional;
- Cloud SQL, database y usuario;
- secretos `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_TOKEN` y `CREDENTIALS_SECRET`;
- service accounts e IAM minimo;
- budget alerts.

### Stack application

Crear:

- Cloud Run v2 Service publico;
- Cloud Run v2 Job con comando `node dist/db/setup.js` (equivalente a `npm run db:setup:prod`) para migracion y seed;
- referencias a Secret Manager;
- probes `/api/v1/health` y `/api/v1/ready`;
- dashboard y alertas;
- outputs `apiUrl`, `healthUrl`, `sqlInstanceName` e `imageDigest`.

Separar ambos stacks evita el ciclo inicial: Artifact Registry debe existir antes de
subir la imagen requerida por Cloud Run.

### Deploy de un Solo Comando

Prerrequisitos:

- proyecto GCP con billing activo;
- `gcloud`, Pulumi y Node.js 22+ (imagen Docker Node 24);
- sesion `gcloud` y Application Default Credentials;
- backend de estado de Pulumi configurado.

```bash
gcloud auth login
gcloud auth application-default login
./infra/deploy.sh
```

`deploy.sh` debe:

1. validar proyecto, billing, cuenta, region y herramientas;
2. ejecutar `pulumi up --yes` en `foundation`;
3. construir y subir con Cloud Build usando tag del commit;
4. ejecutar `pulumi up --yes` en `application`;
5. ejecutar migracion y seed, esperando resultado;
6. probar `/api/v1/ready`, login, listado, feed, PATCH y story;
7. imprimir URL y resumen, nunca secretos.

Opciones:

```txt
--skip-seed
--destroy
```

Primer despliegue estimado: 15-25 minutos por Cloud SQL. Redeploy normal: 3-7 minutos.
Crear y ensayar la infraestructura antes del evento.

`destroy.sh` debe mostrar proyecto y stack, pedir confirmacion, eliminar primero la
aplicacion y luego la base. Permitir backup opcional.

Yo puedo implementar y ejecutar este flujo cuando el repositorio backend exista y la
cuenta de `gcloud` tenga acceso al proyecto. No hace falta entregar una clave JSON si la
sesion CLI y Application Default Credentials estan autenticadas.

---

## Variables de Entorno

```properties
PORT=8080
NODE_ENV=production
DB_HOST=/cloudsql/<PROJECT:REGION:INSTANCE>
DB_PORT=5432
DB_NAME=tropelcare
DB_USER=tropelcare_api
DB_PASSWORD=<secret-manager>
DB_POOL_MAX=10
JWT_SECRET=<secret-manager>
ADMIN_TOKEN=<secret-manager>
CORS_ORIGINS=http://localhost:5173,https://frontend-aprobado.example
CORS_ORIGIN_PATTERNS=https://*.vercel.app,https://*.netlify.app
RATE_LIMIT_PER_WORKSPACE=600
```

---

## Pruebas Obligatorias

- Login valido e invalido.
- Restauracion con `/auth/me`.
- Toda consulta filtra por workspace.
- ID de otro workspace responde 404.
- Paginacion y allowlist de sort.
- Cursor rechaza filtros distintos.
- Feed no repite IDs.
- PATCH solo acepta estados permitidos.
- PATCH de otro workspace responde 404.
- Story devuelve 8 etapas ordenadas.
- Reset admin restaura solo el workspace objetivo.
- Escenario de delay/error se consume una vez.
- `/api/v1/ready` falla si DB o migracion no estan disponibles.

## Prueba de Carga

Antes de publicar:

- 100 clientes concurrentes.
- 60% feed, 20% Tropeles, 10% dashboard, 10% PATCH.
- 10 minutos.

Aceptar si:

- lecturas p95 menor a 800 ms;
- mutaciones p95 menor a 1000 ms;
- 5xx menor a 1%;
- pool DB sin espera sostenida;
- ninguna respuesta cruza workspaces.

---

## Checklist de Lanzamiento

- [ ] OpenAPI generado, revisado y congelado.
- [ ] 100 workspaces y credenciales generados.
- [ ] Seed deterministico e idempotente ejecutado.
- [ ] Aislamiento multi-tenant probado.
- [ ] Paginacion, cursor y filtros probados.
- [ ] Story con 8 etapas por sector probada.
- [ ] Herramientas docentes probadas.
- [ ] CORS probado desde localhost y dominio de deploy.
- [ ] Prueba de carga aprobada.
- [ ] `pulumi preview` revisado.
- [ ] `deploy.sh` probado desde cero.
- [ ] Dashboard, alertas y budget configurados.
- [ ] Backup y `destroy.sh` probados.
- [ ] Credenciales distribuidas sin exponer otros equipos.

---

## Referencias Tecnicas

- Cloud Run: https://cloud.google.com/run/docs
- Cloud Run con Cloud SQL: https://cloud.google.com/sql/docs/postgres/connect-run
- Pulumi para GCP: https://www.pulumi.com/docs/iac/get-started/gcp/
- Pulumi Cloud Run v2: https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/service/
- GCP Pricing Calculator: https://cloud.google.com/products/calculator


## Precisiones del contrato para la hackathon (19 de octubre de 2026)

- Todos los indicadores pertenecen al workspace autenticado. `openSignals` y
  `signalsBySeverity` cuentan únicamente `RECIBIDA` y `PROCESANDO`; la suma de
  severidades coincide con `openSignals`. `currentLoad` cuenta los Tropeles reales
  asignados al sector, incluso si la distribución no es uniforme.
- Filtros opcionales vacíos equivalen a omitidos: `species`, `vitalState`, `sectorId`,
  `signalType`, `severity`, `status` y `q`. `cursor=` inicia la primera página.
  Un enum desconocido no vacío da 400. Esto no permite vacíos en page/size/limit/sort.
- `q` busca sin distinguir mayúsculas (máximo 80 caracteres): nombre en Tropeles;
  rawContent o nombre del Tropel en señales. `%` y `_` conservan la semántica de
  comodines SQL LIKE; los valores se parametrizan.
- El feed ordena `createdAt DESC, id DESC`. `totalEstimate` es el total filtrado,
  no el restante tras el cursor. Un cambio real de filtros requiere reiniciar el cursor.
- PATCH devuelve la señal completa y actualiza `updatedAt`. Al volver al feed,
  reconciliar el DTO con el filtro activo: retirar la señal si ya no coincide,
  manteniendo coherentes las páginas y la posición visual. No se exige polling,
  actualización optimista ni control de versiones. Logout elimina la sesión local.
- `assetKey` (por ejemplo `pixel_forest-stage-1`) y `colorToken` son identificadores,
  no URLs. Se permite un mapa local de CSS/assets y la paleta emerald, violet, cyan,
  amber, rose, indigo, lime, sky. Las narrativas y métricas deben venir de la API.
  `stability` y `energy` son porcentajes 0–100; `alerts` es una cantidad no negativa.
  Son snapshots narrativos simulados, diferentes de los KPIs actuales.
  `progress≈order/7` (redondeado a cuatro decimales) indica la posición de la etapa, no el scroll actual del usuario.
- Errores comunes: 400 VALIDATION_ERROR, 401 UNAUTHORIZED, 404 NOT_FOUND,
  413 PAYLOAD_TOO_LARGE (body >32 KiB), 429 RATE_LIMITED y 500 INTERNAL_ERROR.
  CORS admite PATCH y permite leer `Retry-After` desde JavaScript.
- Cuota compartida entre instancias: 600 solicitudes/minuto por workspace,
  agregando sus tres usuarios; login tiene 30/minuto por IP. Ventanas de minuto
  de reloj; `Retry-After` indica segundos hasta la siguiente ventana.
- Salud: `/api/v1/health`; disponibilidad: `/api/v1/ready`, que exige migraciones
  y setup completo. Documentación pública: `/docs` y `/api/v1/openapi.json`.

# TropelCare Backend — entrega docente

API cerrada para la hackathon. El frontend consume `/api/v1` y consulta `/docs`.
El contrato versionado está en `contract/openapi.json`; `contract/examples.json` contiene respuestas reales del dataset de prueba completo. Los dos enunciados incluyen
las precisiones aprobadas sobre señales abiertas, filtros vacíos y carga real.

## Arranque local

Requiere Node 22+ (Docker usa Node 24) y Docker Compose:

```bash
cp .env.example .env
docker compose up -d postgres
npm ci
npm run build
npm run db:setup:prod
npm start
```

El servidor no migra ni siembra al arrancar. El setup usa bloqueo de PostgreSQL,
transacciones por equipo y verificación de cantidades; se puede repetir tras un fallo.
Una base no preparada falla `/api/v1/ready`. `/api/v1/health` no consulta la base.
Repetir setup conserva los equipos completos y sus cambios; reset restaura un equipo.
La migración 2 regulariza `currentLoad` y sustituye las contraseñas antiguas predecibles.

## Credenciales privadas

Cada equipo tiene operator@tuckersoft.com, operator2@tuckersoft.com y
operator3@tuckersoft.com, con una contraseña propia del equipo. Se deriva con
HMAC-SHA256 de un secreto privado; en PostgreSQL solo se guardan hashes bcrypt.
Conocer la contraseña de un equipo no permite calcular las de otros.

```bash
npm run credentials:export -- /ruta/privada/credenciales-equipos.json
```

Exporta con permisos 0600, sin sobrescribir archivos y verifica que el secreto coincide
con las cuentas almacenadas. No publicar este archivo. Entregar individualmente solo
URL de API, URL de docs, código de equipo y sus credenciales. No entregar código,
dumps, seeds ni el token administrativo a los estudiantes.

Producción exige JWT_SECRET, ADMIN_TOKEN y CREDENTIALS_SECRET explícitos, distintos
y de al menos 32 caracteres. Conservar CREDENTIALS_SECRET al reiniciar/restaurar datos;
cambiarlo requiere planificar la rotación de cuentas, no simplemente volver a exportar.
El reset conserva hashes y usuarios existentes. Se eliminó la credencial remota del
antiguo `.env.example`; si era vigente, el administrador debe rotarla externamente.

## Verificación local

Usar exclusivamente una base de pruebas: la suite modifica los equipos 1 y 2.

```bash
npm run typecheck
npm run build
npm test
npm run contract:check
npx playwright install chromium
npm run test:browser
```

`test:browser` necesita un setup previo y usa una base de pruebas: limpia los contadores
y modifica una señal. Comprueba fetch cross-origin real, preflight PATCH y Retry-After.
La suite de integración comprueba errores, aislamiento, reset, cuotas atómicas entre
instancias y datos coherentes. `contract:update` actualiza el snapshot después de revisar
un cambio intencional del contrato.

Carga: preparar otra base con los 100 equipos, ejecutar setup y `npm run test:load`.
El runner abre una API local con pool 10 y ejecuta 100 clientes durante 600 segundos,
aproximadamente 80 req/s: 60% feed, 20% Tropeles, 10% dashboard y 10% PATCH.
Genera `load-result.json`, mide p95, errores, aislamiento de IDs y espera del pool.
Usa JWT generados internamente para separar capacidad de las cuotas de login;
login se verifica por separado. Es un benchmark local, no certifica rendimiento GCP.

## Herramientas del TA — privadas

Requieren cabecera `X-Admin-Token`, no aparecen en Swagger:

- POST `/api/v1/admin/workspaces/TEAM-001/reset`: restaura solo ese equipo.
- POST `/api/v1/admin/workspaces/TEAM-001/scenario`: recibe `delayMs` (0–3000),
  `nextReadError`, `nextPatchError` o `clear`.

Los escenarios se consumen una sola vez por la siguiente operación elegible del
workspace; evitar otras peticiones en vuelo al probar. Un PATCH fallido no modifica
la señal y puede reintentarse. El alumno recibe 500 INTERNAL_ERROR normal.
Los logs contienen ruta normalizada, requestId, workspaceId, status, duración,
código de error y uso/espera del pool; no registrar cuerpos ni credenciales.

## Despliegue en GCP

Infraestructura en `infra/foundation` y `infra/application`; consultar `infra/README.md`.
No se publica automáticamente al instalar o arrancar. Docker ejecuta como usuario
sin privilegios con Node 24. La API permanece sin estado en memoria; PostgreSQL
comparte las cuotas entre instancias. Pool máximo 10 por proceso, 3 instancias máximo.

# Infraestructura docente

Requiere Pulumi CLI con estado cifrado, gcloud autenticado y ADC, Node 22+, proyecto
con billing y permisos de creación de Cloud SQL, IAM, Run, secretos y presupuestos.
El entorno que preparó estos archivos no tiene Pulumi CLI/gcloud: se verificó TypeScript,
pero preview, IAM efectivo, alertas y despliegue deben verificarse en el proyecto real.

```bash
export PROJECT_ID=proyecto-del-evento
export BILLING_ACCOUNT=000000-000000-000000
export REGION=us-central1
export ALERT_EMAIL=docente@example.org
export CORS_ORIGINS=http://localhost:5173,https://frontend-aprobado.example
export STACK=event
./infra/deploy.sh
```

Los valores anteriores son ejemplos. El presupuesto por defecto es USD 50 con avisos
50/90/100%; no detiene automáticamente el gasto. Ajustar `budgetUsd` en foundation.
Cloud SQL se factura hasta destruirlo. Las versiones de dependencias están fijadas
por package-lock.json. El deploy usa digest inmutable de imagen de Cloud Build.

Primer despliegue: foundation, imagen, job, ejecución del setup, publicación de API y
smoke autenticado. `publish` empieza ausente/false. Redeploy actualiza primero el job de forma dirigida y conserva el servicio
existente mientras el job verifica la base; no usar el evento como ventana de migración.
`--skip-seed` solo es válido con base previamente preparada. Startup probe exige ready;
la API nunca ejecuta DDL ni seed por sí misma.

El principal que ejecuta deploy necesita acceso al secreto de credenciales para el
smoke; los alumnos no. Los service accounts de ejecución reciben cloudsql.client y
acceso individual a los cuatro secretos, sin roles editor/owner. Se crea un service account de Cloud Build con escritura en su repositorio, lectura
del bucket privado de fuentes y creación de objetos en el bucket privado de logs.
El operador necesita iam.serviceAccounts.actAs sobre ese account y permisos para
subir las fuentes al bucket. Los buckets temporales se borran con foundation. Las políticas de la
organización pueden impedir IAM allUsers: comprobar con `pulumi preview` antes del evento.

`trustedProxies` es una lista explícita de direcciones/CIDR de proxies confiables,
por defecto loopback y link-local en Cloud Run. Verificar la IP efectiva y el límite de login desde
clientes distintos en el despliegue real. No habilitar confianza irrestricta en
X-Forwarded-For. El límite autenticado se basa en workspace y no depende de la IP.

Alertas: 5xx sostenidos, p95 >800 ms y espera sostenida del pool; dashboard de peticiones, latencia e instancias.
Verificar recepción del email. Los logs incluyen dbWaiting para revisar saturación;
el benchmark local comprueba también espera de pool. No confundir el presupuesto
con un límite de gasto ni el smoke con una prueba de carga del entorno publicado.

```bash
./infra/destroy.sh
```

Comprueba proyecto/stack y exige escribir PROJECT_ID. Permite export SQL a un bucket
privado existente antes de eliminar aplicación y foundation. El service account de
Cloud SQL necesita acceso de escritura al bucket de backup; el script aborta si falla
la exportación. Los secretos y la base se eliminan con foundation. Proteger el estado
Pulumi, que contiene secretos cifrados, y guardar el backup fuera de los recursos eliminados.

Referencias de proveedor: documentación oficial de Pulumi para
[Cloud Run v2](https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/service/)
y [presupuestos](https://www.pulumi.com/registry/packages/gcp/api-docs/billing/budget/).


Comprobaciones offline desde `backend/`:

```bash
npm ci --prefix infra
npm run infra:typecheck
npm run infra:check
node infra/check-deploy.mjs
```

Estos mocks verifican la separación job/publicación, probes, referencias a secretos y
recursos básicos. El simulador del script comprueba primer despliegue, redeploy y
aborto antes de publicación cuando falla el job. No llaman a GCP ni validan permisos efectivos del proveedor.
Para exportar credenciales de producción desde `scripts/credentials.mjs`, conectar
la base por Cloud SQL Auth Proxy y cargar el mismo CREDENTIALS_SECRET del job en el
entorno privado. El script comprueba las contraseñas contra los hashes antes de exportar.
No imprimir secretos ni pasarlos como argumentos de comandos compartidos.

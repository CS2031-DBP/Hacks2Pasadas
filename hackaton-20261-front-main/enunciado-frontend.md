# Hackathon Frontend: TropelCare Control Room - Pizza Protocol

## Descripcion General

Tuckersoft opera una colonia de criaturas digitales llamadas Tropeles. Cada criatura pertenece a un sector, cambia de estado y emite senales que deben ser atendidas por sus operadores.

El backend ya existe y sera entregado como una API cerrada. Cada equipo trabajara en un workspace aislado. No recibiran codigo del backend, acceso a base de datos, logs ni paneles administrativos.

Su mision es construir **TropelCare Control Room**, una consola operativa en React + TypeScript capaz de manejar paginacion, filtros, infinite scroll, estado sincronizado con URL y una experiencia visual avanzada de scrollytelling.

El uso de IA para programar esta permitido, pero la aplicacion no debe consumir APIs de IA. Toda la data y narrativa, junto con los identificadores para construir el contenido visual con CSS/assets locales, llegan desde el backend deterministico. La evaluacion se hara sobre comportamiento verificable.

---

## Duracion y Formato

- **Tiempo:** 2 horas exactas.
- **Equipos:** 3 estudiantes.
- **Recursos:** IA, documentacion e Internet permitidos.
- **Backend:** API compartida del curso, aislada por equipo.
- **Evaluacion:** aprobacion binaria en navegador + revision de Network + revision de codigo.
- **Entrega:** repositorio publico y deploy funcional.

Los cinco checkpoints son requisitos obligatorios y el Checkpoint 5 concentra el reto
hard. No existe puntaje parcial: completar y demostrar todo otorga 20; cualquier
checkpoint incompleto produce una calificacion de 0.

### Distribucion Sugerida del Equipo

Para que completar el reto en 2 horas sea posible, se recomienda trabajar en paralelo:

- integrante A: autenticacion, layout, dashboard y deploy;
- integrante B: Tropeles, filtros URL y feed infinito;
- integrante C: Sector Story Engine;
- ultimos 20-25 minutos: integracion, deploy y correcciones.

Esta distribucion es una recomendacion, no una regla de evaluacion.

---

## Stack Obligatorio

- React 18+.
- TypeScript estricto.
- Componentes en `.tsx`.
- Vite.
- React Router.
- Tailwind CSS.
- Fetch API o Axios.

### No Permitido

- Material UI, Ant Design, Chakra, Mantine, NextUI o dashboards completos.
- React Query, SWR, TanStack Query, RTK Query o equivalentes.
- Librerias que resuelvan cache de servidor o infinite scroll.
- Cargar el dataset completo para simular paginacion.
- Copiar un template de dashboard.

---

## Acceso a la API

El TA entregara a cada equipo:

```txt
VITE_API_BASE_URL=https://<backend-url>/api/v1
API_DOCUMENTATION_URL=https://<backend-url>/docs
TEAM_CODE=TEAM-0XX
EMAIL=operator@tuckersoft.com
PASSWORD=<password-del-equipo>
```

El `TEAM_CODE` identifica el workspace. Los datos y cambios de otros equipos no seran visibles.

Swagger UI es el contrato publico completo de la API. Alli se documentan campos,
parametros, enums, respuestas y errores de todos los endpoints disponibles para los
equipos. Las herramientas privadas de evaluacion no aparecen en Swagger.

Rutas protegidas:

```txt
Authorization: Bearer <jwt_token>
```

---

## API Publica

| Metodo | Endpoint | Uso |
|:-------|:---------|:----|
| POST | `/auth/login` | Login con `teamCode`, `email`, `password` |
| GET | `/auth/me` | Restaurar sesion |
| GET | `/dashboard/summary` | Indicadores del workspace |
| GET | `/tropels` | Lista paginada |
| GET | `/tropels/{id}` | Detalle de Tropel |
| GET | `/signals/feed` | Feed cursor-based |
| GET | `/signals/{id}` | Detalle de Senal |
| PATCH | `/signals/{id}/status` | Actualizar estado |
| GET | `/sectors` | Sectores disponibles |
| GET | `/sectors/{id}/story` | Historia visual del sector |

### Paginacion de Tropeles

`GET /tropels`

| Parametro | Regla |
|:----------|:------|
| `page` | Inicia en 0 |
| `size` | 10, 20 o 50 |
| `species` | Filtro opcional |
| `vitalState` | Filtro opcional |
| `sectorId` | Filtro opcional |
| `q` | Busqueda opcional |
| `sort` | `name,asc`, `updatedAt,desc` o `chaosIndex,desc` |

La respuesta contiene `content`, `totalElements`, `totalPages`, `currentPage` y `size`.

### Feed de Senales

`GET /signals/feed`

| Parametro | Regla |
|:----------|:------|
| `cursor` | Cursor opaco recibido anteriormente |
| `limit` | Default 15, maximo 30 |
| `signalType` | Filtro opcional |
| `severity` | Filtro opcional |
| `status` | Filtro opcional |
| `q` | Busqueda opcional |

La respuesta contiene `items`, `nextCursor`, `hasMore` y `totalEstimate`.

### Actualizacion de Estado

`PATCH /signals/{id}/status` recibe:

```json
{
  "status": "ATENDIDA"
}
```

Estados permitidos:

```txt
PROCESANDO
ATENDIDA
```

La respuesta exitosa contiene la Senal actualizada. No se evaluan optimistic updates,
conflictos de version, idempotencia ni actualizaciones en tiempo real.

---

## Checkpoint 1 - Encender la Consola

**Dificultad:** facil.

Construir:

- Login con las credenciales del equipo.
- Ruta privada para el dashboard.
- Restauracion de sesion al recargar.
- Logout.
- Dashboard consumiendo datos reales.
- Loading, error y estado vacio.

### Validacion TA

1. Abrir `/dashboard` sin sesion.
2. Hacer login.
3. Recargar la pagina.
4. Cerrar sesion.

---

## Checkpoint 2 - Atlas de Tropeles

**Dificultad:** media.

Construir una vista de Tropeles con:

- Paginacion real del servidor.
- Filtros combinables.
- Busqueda.
- Ordenamiento.
- Estado completo reflejado en la URL.
- Restauracion del mismo estado al recargar o compartir la URL.
- Proteccion contra respuestas antiguas que llegan tarde.
- Estados de loading, error y sin resultados sin mover el layout.

### Validacion TA

1. Cambiar filtros y pagina rapidamente.
2. Alterar el ordenamiento durante una request.
3. Copiar la URL y abrirla en otra pestana.
4. Revisar que no aparezcan resultados de una request anterior.

---

## Checkpoint 3 - Feed Infinito

**Dificultad:** media.

Construir el feed de Senales con:

- Infinite scroll basado en cursor.
- Carga automatica al llegar al final.
- Deduplicacion por ID.
- Una sola carga adicional en vuelo.
- Cancelacion o descarte de requests obsoletas.
- Filtros persistidos en URL.
- Conservacion de posicion al abrir y cerrar un detalle.
- Fin de lista correcto.
- Recuperacion de error sin borrar paginas ya cargadas.

### Validacion TA

1. Hacer scroll rapido durante varias paginas.
2. Cambiar filtros con una request en vuelo.
3. Forzar un error al cargar una pagina posterior.
4. Buscar IDs repetidos y cargas simultaneas en Network.

---

## Checkpoint 4 - Atender una Senal

**Dificultad:** media.

Construir el detalle de una Senal y permitir actualizar su estado.

La interfaz debe:

- Abrir el detalle desde el feed sin perder la posicion anterior.
- Mostrar datos reales, loading y error.
- Cambiar el estado a `PROCESANDO` o `ATENDIDA`.
- Deshabilitar la accion mientras la request esta en vuelo.
- Mostrar confirmacion al completar.
- Mostrar un error accionable y conservar el estado anterior si falla.
- Reflejar el resultado en el feed al volver.

### Validacion TA

1. Abrir una Senal desde una pagina avanzada del feed.
2. Actualizar su estado.
3. Volver y comprobar el estado y la posicion.
4. Forzar un error y comprobar que la interfaz permite reintentar.

---

## Checkpoint 5 - Sector Story Engine

**Dificultad:** hard. Este es el reto principal de la hackathon.

Construir `/sectors/:id/story` como una experiencia de scrollytelling basada exclusivamente en la data del endpoint.

Debe incluir:

- Narrativa por etapas activadas por scroll.
- Visual persistente que cambie con la etapa activa.
- Progreso de recorrido.
- CSS Scroll-driven Animations cuando exista soporte y fallback funcional cuando no exista.
- View Transition API entre resumen e historia cuando exista soporte y fallback funcional cuando no exista.
- Comportamiento equivalente en desktop y mobile.
- Soporte para `prefers-reduced-motion`.
- Navegacion por teclado sin perder contenido.

No se acepta video, GIF, canvas pregrabado ni una lista de cards con animacion decorativa.

### Validacion TA

1. Recorrer toda la historia en desktop.
2. Cambiar a mobile.
3. Activar reduced motion.
4. Navegar por teclado.
5. Verificar que las metricas correspondan a la etapa activa.

---

## Evaluacion

La evaluacion es **todo o nada**:

| Resultado | Nota |
|:----------|:----:|
| Los cinco checkpoints pasan completamente | **20** |
| Falta un checkpoint o falla una validacion obligatoria | **0** |

No se suman funcionalidades parciales ni se redondea la nota. Una funcionalidad cuenta
solo si puede demostrarse en el deploy entregado.

Ademas de los cinco checkpoints:

- `npm run typecheck` debe terminar sin errores;
- `npm run build` debe terminar sin errores;
- no se acepta `any` para respuestas de API;
- no se exigen tests automatizados de frontend.

---

## Reglas de Evaluacion

- Los checkpoints se validan por comportamiento, no por cantidad de archivos.
- Un screenshot no demuestra una funcionalidad.
- Datos hardcodeados invalidan la entrega.
- Paginacion simulada en cliente invalida la entrega.
- Boton `Cargar mas` en lugar de infinite scroll invalida la entrega.
- Una actualizacion que no maneja loading o error invalida la entrega.
- Una animacion que ignora reduced motion invalida la entrega.
- El deploy debe abrir directamente en cualquier ruta de la aplicacion.

---

## Entregables

1. Repositorio publico.
2. Link del deploy.
3. README con:
   - integrantes y codigos,
   - instalacion y comandos,
   - variables requeridas,
   - link del deploy,
   - decisiones tecnicas importantes.

No entregar backend, dumps, seeds ni credenciales fuera de las asignadas.

---

## Referencias Permitidas

- React: https://react.dev/
- View Transition API: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- Scroll-driven animations: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations


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

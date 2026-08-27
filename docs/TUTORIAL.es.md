🇩🇪 [Deutsch](TUTORIAL.md) | 🇬🇧 [English](TUTORIAL.en.md) | 🇪🇸 Español

# Tutorial: UltraStar - Dirty Little Helper

Este tutorial te lleva desde la instalación hasta una colección de karaoke bien cuidada — paso a paso. No hacen falta conocimientos previos.

**Contenido**
1. [Instalación y primer arranque](#1-instalación-y-primer-arranque)
2. [Ajustes básicos](#2-ajustes-básicos)
3. [Importar una colección existente](#3-importar-una-colección-existente)
4. [Buscar y descargar canciones](#4-buscar-y-descargar-canciones)
5. [Descargas masivas con la cola](#5-descargas-masivas-con-la-cola)
6. [La colección: filtrar, ordenar, encontrar](#6-la-colección-filtrar-ordenar-encontrar)
7. [Completar géneros automáticamente](#7-completar-géneros-automáticamente)
8. [Reparar vídeos](#8-reparar-vídeos)
9. [Solución de problemas](#9-solución-de-problemas)

---

## 1. Instalación y primer arranque

1. Descarga el `UltraStar-DLH-Setup-*.exe` más reciente desde las [releases](https://github.com/normannormalmann/ultrastar-dlh/releases).
2. Ejecútalo. Windows SmartScreen muestra un aviso (la aplicación no está firmada): elige **«Más información» → «Ejecutar de todas formas»**. La instalación continúa sin más preguntas e inicia la aplicación.
3. En el primer arranque ocurre solo:
   - La aplicación crea una **cuenta de USDB** anónima e inicia sesión (el punto de estado «USDB» de abajo a la izquierda se pone verde).
   - Si faltan **yt-dlp** o **ffmpeg**, la aplicación descarga ambos por su cuenta (los puntos se ponen verdes poco después). No tienes que hacer nada.

Los tres puntos de estado al final de la barra lateral muestran en todo momento: sesión de USDB, yt-dlp y ffmpeg. Todo en verde significa que puedes empezar.

> **Actualizaciones:** desde la versión 1.4.0 la aplicación te avisa por sí sola cuando hay una versión nueva: **Ajustes → Aplicación → «Buscar actualizaciones»**, descargar y reiniciar. Como el instalador no está firmado, SmartScreen vuelve a preguntar también al actualizar. A mano sigue funcionando: instala la versión nueva encima de la antigua — los ajustes, la colección y la cola se conservan.

## 2. Ajustes básicos

Abre **Ajustes** (el engranaje de la barra lateral):

- **Carpeta de descargas:** la carpeta donde están (o estarán) tus canciones — p. ej. `D:\Ultrastar`. Se elige con «Examinar…». *Es la misma carpeta que indicas como SongDir en UltraStar Deluxe.*
- **Navegador para las cookies de YouTube:** elige el navegador en el que hayas **iniciado sesión** en YouTube (p. ej. Edge o Chrome). YouTube bloquea a menudo las descargas anónimas; con las cookies de tu navegador la aplicación lo sortea. Importante al descargar: cierra el navegador, si no su base de datos de cookies queda bloqueada.
- **Descargas:**
  - *Estructura de carpetas para las descargas nuevas* — cómo se guardan las canciones nuevas:
    - `Intérprete - Título` (plana): todo en un solo nivel — la opción por defecto.
    - `Intérprete / Intérprete - Título`: una subcarpeta por intérprete.
    - `A / Intérprete - Título`: subcarpetas por letra inicial.
    La línea de ejemplo de debajo muestra la ruta en vivo. UltraStar Deluxe funciona con todas las variantes (incluso mezcladas); las canciones que ya tienes no se mueven.
  - *Descargas simultáneas* (1–5): cuántas canciones se cargan a la vez. 2–3 es un buen valor.
  - *Calidad de vídeo*: máx. 720p ahorra espacio, máx. 1080p es lo predeterminado y «La mejor disponible» coge lo que YouTube ofrezca.
- **Fuente de géneros:** ver el [capítulo 7](#7-completar-géneros-automáticamente).
- **Idioma:** alemán, inglés o español. Si no eliges nada, la aplicación sigue el idioma de tu sistema.

No olvides **Guardar** (una marca lo confirma).

## 3. Importar una colección existente

¿Ya tienes canciones en el disco? Impórtalas primero — si no, la aplicación no sabe qué tienes y descargaría canciones dos veces.

1. Asegúrate de que la **carpeta de descargas** (capítulo 2) apunta a tu colección.
2. Abre **Descargadas** en la barra lateral → pulsa **«Importar colección»**.
3. La aplicación recorre todas las carpetas de canciones (también anidadas un nivel, p. ej. `ABBA\ABBA - Waterloo\`) y toma cada carpeta que tenga un `song.txt` — **sin descargar nada**. En colecciones grandes (más de 10 000) tarda unos minutos; una barra de progreso muestra por dónde va.
4. Lee el mensaje del resultado: «N canciones importadas (N de ellas sin vídeo — ejecuta la reparación) · M ya estaban». Las canciones **sin vídeo** solo aparecen en la lista tras una [reparación](#8-reparar-vídeos), pero ya están protegidas contra descargas duplicadas.

**Conviene saber:**
- La importación lee el idioma, el género, el año y lo demás directamente de los archivos song.txt — tus filtros funcionan de inmediato.
- Volver a pulsar «Importar colección» nunca hace daño: encuentra carpetas nuevas y completa los metadatos que falten en entradas ya importadas.
- ¿Has borrado o cambiado carpetas fuera de la aplicación? Pulsa **«Actualizar»** — la aplicación vuelve a comprobar lo que hay en el disco.

## 4. Buscar y descargar canciones

1. Abre **Buscar** (la lupa). Escribe intérprete o título, pulsa `Intro` o «Buscar».
2. La tabla muestra portada, intérprete, título, idiomas, valoración (★) y visitas. Las canciones que ya tienes llevan un **✓** verde — con esas no hay nada que hacer.
3. Despliega los **Filtros** (el icono de deslizadores) para tener más control:
   - **Idioma, género, año** — se filtran en el servidor sobre *toda* la base de datos, no solo la página actual.
   - **Ordenación** y sentido (p. ej. «Valoración descendente» para las más populares primero).
   - **Solo golden notes / Solo songcheck** — marcas de calidad de la base de datos.
   - **Colección:** «Solo las que faltan» oculta lo que ya tienes — perfecto para buscar novedades.
   - Cambiar un filtro vuelve a buscar por sí solo (un contador junto al botón de filtros muestra los activos).
4. **Descargar:** el botón ⬇ de la fila descarga la canción al instante. Abajo aparece la barra de descargas con el progreso. Una canción completa (letra + portada + vídeo) suele tardar menos de un minuto, según el vídeo.

La canción terminada queda como carpeta dentro de tu carpeta de descargas — con `song.txt`, `cover.jpg` y `video.mp4` — y se puede cantar de inmediato en UltraStar Deluxe (allí, si hace falta, vuelve a leer las canciones).

## 5. Descargas masivas con la cola

Para todo lo que pase de unas pocas canciones:

1. Reúnelas desde la búsqueda:
   - **«＋ Cola»** en la fila: una sola canción.
   - **«＋ Página a la cola»**: todos los resultados (visibles) de la página actual.
   - **«＋ Las N páginas»**: *todas* las páginas de la búsqueda actual — p. ej. «Idioma: German, Género: Schlager» al completo. Respeta todos los filtros activos.
   - **«Base de datos completa a la cola»**: literalmente todo (decenas de miles de canciones — con diálogo de confirmación).
   Las canciones que ya tienes o que ya están en la cola se omiten automáticamente; el contador junto a «Cola» en la barra lateral crece en consecuencia.
2. Abre **Cola** → **«▶ Descargar N canciones»**. La aplicación recorre la lista con la simultaneidad que hayas configurado.
3. Puedes **cancelar** en cualquier momento (tras el lote en curso) — la cola queda guardada, también entre reinicios y caídas de la aplicación. «▶» simplemente continúa más tarde.
4. Las **descargas fallidas** van al bloque desplegable de debajo (la causa más habitual: la protección antibots de YouTube → ver [solución de problemas](#9-solución-de-problemas)). «↻ Reintentar» las devuelve a la cola; además, en la carpeta de canciones hay un `failed-downloads.xlsx` con todos los detalles.

## 6. La colección: filtrar, ordenar, encontrar

**Descargadas** es tu vista de lo que tienes:

- El **filtro de texto** busca en intérprete y título.
- Los **desplegables de idioma y género** solo ofrecen valores que encajan con el resto de la selección — con el número de resultados. Las canciones en varios idiomas («Japanese, German») aparecen bajo cada uno.
- **Año desde/hasta** acota períodos («solo los 80»: 1980–1989).
- **Ordenación:** más recientes primero, intérprete A–Z, título A–Z, año ascendente.
- La lista carga más a medida que bajas («Mostrando X de Y»).
- **«Carpeta»** en cada fila abre la canción en el explorador.
- **«Actualizar»** concilia la lista con lo que hay realmente en el disco (p. ej. tras borrar algo a mano).

## 7. Completar géneros automáticamente

Muchas canciones de USDB llegan sin género — y tus filtros se quedan igual de vacíos. La aplicación puede completar los géneros (y los años) que falten a partir de bases de datos musicales en línea:

1. Elige una **Ajustes → Fuente de géneros**:
   - **Deezer** (recomendada): sin registro, buena tasa de aciertos, alrededor de 1–2 horas para 10 000 canciones.
   - **Last.fm**: la mayor variedad de géneros, necesita una [clave de API](https://www.last.fm/api/account/create) gratuita (el campo aparece al elegirla).
   - **MusicBrainz**: base de datos abierta que encuentra canciones en parte distintas — pero limitada a una consulta por segundo (y por tanto lenta).
2. **Descargadas → «Completar géneros»**. Progreso: «Buscando géneros… (x/y · z encontrados)».
3. Puedes **cancelar en cualquier momento** — el estado queda guardado y la siguiente pasada omite las canciones ya completadas. Descargar a la vez no supone ningún problema.
4. Los géneros encontrados se normalizan (un «Hip-Hop» uniforme en lugar de «rap/hip hop» y demás), se escriben en la colección **y** como `#GENRE:` en el song.txt correspondiente — así también se ven en UltraStar Deluxe.

**Truco para la máxima cobertura:** primero una pasada completa con Deezer, después cambia la fuente a MusicBrainz y vuelve a ejecutarla — la segunda pasada solo prueba las canciones que quedaron y suele encontrar más. Lo que siga faltando normalmente no existe en esas bases de datos (remezclas, títulos de nicho) — eso puedes añadirlo a mano en el song.txt si te interesa.

## 8. Reparar vídeos

Cuando faltan vídeos o están dañados (descargas interrumpidas, archivos borrados, colecciones importadas sin vídeo):

1. **Reparación** en la barra lateral → **«Iniciar análisis»**.
2. La aplicación recorre la carpeta de descargas en busca de canciones con un `video.mp4` ausente o sospechosamente pequeño y vuelve a descargar **solo los vídeos** — las letras y las portadas quedan intactas. Las canciones sin registro de seguimiento se reconstruyen por el camino.
3. El informe final muestra reparadas / reconstruidas / irreparables. Las canciones recién reparadas aparecen después en la colección.

Aquí vale lo mismo: si los comentarios de USDB contienen una corrección de VIDEOGAP para el vídeo, la aplicación la lleva al song.txt automáticamente.

## 9. Solución de problemas

**«YouTube bot protection blocked the download» / muchos fallos seguidos**
YouTube está bloqueando las descargas anónimas. La solución: en los ajustes, elige el navegador en el que hayas **iniciado sesión** en YouTube, **cierra** ese navegador y vuelve a intentarlo («↻ Reintentar» en las fallidas). Para casos tercos: coloca un `cookies.txt` (extensión de navegador «Get cookies.txt») en la carpeta de canciones.

**El punto de estado de yt-dlp o ffmpeg sigue en rojo**
Ajustes → Herramientas → «Instalar automáticamente las herramientas que faltan». Si eso también falla (proxy corporativo o similar): instala [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) y [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) a mano, añádelos al PATH y reinicia la aplicación.

**Canción descargada, pero el vídeo va desfasado respecto a la letra**
Borra la carpeta de la canción, pulsa «Actualizar» en la colección y vuelve a descargarla — la aplicación ya toma las correcciones de VIDEOGAP de los comentarios de USDB automáticamente.

**La colección sigue mostrando canciones borradas / faltan carpetas nuevas**
«Actualizar» en la colección (concilia con el disco) o «Importar colección» (recoge las carpetas nuevas).

**La importación dice «X sin vídeo»**
Es normal en colecciones a las que les faltan vídeos. Esas canciones están registradas (sin descarga duplicada), pero solo aparecen en la lista tras una [reparación](#8-reparar-vídeos).

**La aplicación pide una clave de Last.fm**
Solo la fuente Last.fm necesita una — gratis en [last.fm/api/account/create](https://www.last.fm/api/account/create), o quédate simplemente con Deezer.

---

¿Preguntas, fallos, deseos? → [GitHub Issues](https://github.com/normannormalmann/ultrastar-dlh/issues)

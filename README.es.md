🇬🇧 [English](README.en.md) | 🇩🇪 [Deutsch](README.md) | 🇪🇸 Español

# UltraStar - Dirty Little Helper

**La aplicación de escritorio que crea, mantiene y hace buscable tu colección de karaoke UltraStar.**

Busca en la mayor base de datos de UltraStar (USDB), descarga carpetas de canciones completas y listas para cantar —letra, carátula y vídeo de una sola vez— y administra decenas de miles de canciones con filtros de verdad. Sin montajes manuales, sin carpetas rotas. Buscar, descargar, cantar.

➡️ **¿Es tu primera vez? [Ve al tutorial paso a paso](docs/TUTORIAL.es.md)**

---

## ✨ Funciones

### Buscar y descargar
- **Búsqueda en USDB con filtros de verdad:** idioma, género, año, golden notes y songcheck — en el servidor y sobre toda la base de datos, con ordenación seleccionable (última modificación, intérprete, título, año, valoración, visitas). Al cambiar un filtro se vuelve a buscar automáticamente.
- **Cotejo con tu colección dentro de la búsqueda:** las canciones que ya tienes aparecen marcadas (✓) y se omiten automáticamente en las descargas masivas — también las colecciones importadas. Conmutable: mostrar todos los resultados / solo los que faltan / solo los que ya tienes.
- **Descargas masivas:** una canción, la página de resultados completa, todas las páginas de una búsqueda o la base de datos entera a la cola — con progreso, cancelación, reanudación tras un cierre inesperado y reintento de las descargas fallidas.
- **Vista previa de carátulas** en los resultados de búsqueda y en la biblioteca (incluidas las carátulas locales de canciones importadas).
- **Correcciones de VIDEOGAP desde los comentarios de USDB** se aplican automáticamente — el vídeo queda sincronizado con la letra.

### Crear canciones
- **Asistente de cinco pasos:** convierte cualquier tema en una canción cantable — elige la fuente (búsqueda en YouTube, un enlace o un archivo local), obtén la letra, escoge la carátula, revisa y listo.
- **Canalización de IA en segundo plano:** un proceso auxiliar en Python separa la voz, la transcribe, alinea la letra con el canto y detecta los tonos — el resultado es un `song.txt` completo con sus notas.
- **Cola propia:** las creaciones se ejecutan junto a las descargas, con progreso, cancelación y acceso directo a la carpeta terminada.
- **Configuración única:** la aplicación instala por sí sola el entorno de IA (Python, Torch, modelos) con solo pulsar un botón — incluida la detección de GPU si la hay.

### Biblioteca
- **Importación de archivos existentes:** incorpora colecciones ya montadas (incluso decenas de miles de canciones y estructuras de carpetas anidadas) sin volver a descargar nada — incluidos los metadatos de los archivos song.txt.
- **Filtros por facetas:** idioma, género, rango de años y búsqueda de texto se pueden combinar; los contadores de los desplegables se adaptan a la selección actual; las canciones multilingües aparecen bajo cada uno de sus idiomas. Ordenación A–Z, por año o las más recientes primero. Desplazamiento infinito en lugar de límites de página.
- **Enriquecimiento de géneros:** completa los géneros (y años) que falten a través de una base de datos en línea — a elegir entre Deezer (sin registro), Last.fm (clave de API) o MusicBrainz. Se ejecuta en segundo plano, se puede cancelar en cualquier momento y continúa sin problemas en el siguiente inicio. Si lo deseas, escribe directamente en los archivos song.txt (#GENRE).
- **Reparación de vídeos:** encuentra vídeos que faltan o están dañados y descarga únicamente esos — los metadatos permanecen intactos.

### Comodidad
- **Todo automático:** la aplicación configura por sí misma tu cuenta de USDB, yt-dlp y ffmpeg — no hace falta ninguna instalación manual.
- **Configurable:** estructura de carpetas para las descargas nuevas (plana, por intérprete, por letra inicial), descargas simultáneas (1–5), calidad máxima de vídeo (720p/1080p/la mejor) y navegador para las cookies de YouTube.
- **Actualizaciones automáticas:** la aplicación avisa por sí sola de las versiones nuevas y las instala con un botón — se acabó descargarlas a mano.
- **Protección contra duplicados entre sesiones**, registro de descargas fallidas en un archivo de Excel y tema oscuro.

---

## 🚀 Instalación (Windows)

1. Descarga el `UltraStar-DLH-Setup-*.exe` más reciente desde las [GitHub Releases](https://github.com/normannormalmann/ultrastar-dlh/releases).
2. Ejecútalo. Windows SmartScreen advierte sobre aplicaciones sin firmar — **«Más información» → «Ejecutar de todas formas»**.
3. Listo. En el primer arranque, la aplicación descarga yt-dlp y ffmpeg automáticamente y crea una cuenta de USDB.

A partir de ahí la aplicación te avisa cuando hay una versión nueva: **Ajustes → Aplicación → «Buscar actualizaciones»**, descargar y reiniciar. Como el instalador no está firmado, SmartScreen vuelve a preguntar también al actualizar.

Para Linux se incluye un `UltraStar-DLH-*.AppImage` — dale permisos de ejecución y ábrelo.

Instalación detallada, incluida la importación de colecciones: **[Tutorial](docs/TUTORIAL.es.md)**

---

## 🖥️ Versión de terminal (CLI/TUI)

Para servidores, usuarios avanzados y macOS/Linux sigue existiendo una interfaz de terminal construida sobre el mismo núcleo (búsqueda, cola, reparación):

```bash
# Requisitos: yt-dlp, ffmpeg, Bun (https://bun.sh)
bunx --bun github:normannormalmann/ultrastar-dlh
```

| Atajo | Acción |
| :--- | :--- |
| `Tab` / `Enter` | Cambiar de campo / Buscar |
| `↑↓` `←→` | Seleccionar canción / Pasar páginas de resultados |
| `Enter` | Descargar de inmediato |
| `Ctrl+Q` / `Ctrl+A` / `Ctrl+P` | Encolar canción / página / todas las páginas |
| `Ctrl+D` | Iniciar la cola |
| `Ctrl+V` | Modo de reparación |
| `Ctrl+F` | Ver descargas fallidas (reintentar con `Enter`) |
| `Ctrl+S` | Configuración (ruta, navegador de cookies) |
| `Esc` | Volver / Salir |

---

## 🛠️ Cómo funciona

1. **Buscar:** la aplicación se autentica en USDB y consulta la base de datos.
2. **Resolver:** los enlaces de vídeo salen de los comentarios de USDB (incluidas las correcciones de VIDEOGAP allí guardadas); si falta alguno, la aplicación busca directamente en YouTube.
3. **Descargar:** vídeo y audio con `yt-dlp` en la calidad configurada, combinados con `ffmpeg`.
4. **Montar:** la carátula y la letra se obtienen y se guardan como un `song.txt` conforme al estándar — compatible con UltraStar Deluxe, Vocaluxe y UltraStar Play.
5. **Registrar:** los aciertos y los fallos se anotan localmente (`downloaded.json`, `failed-downloads.xlsx`) — para la protección contra duplicados y para reintentar con comodidad.

---

## 👨‍💻 Desarrollo

El proyecto usa Bun de forma nativa (TypeScript, Effect, Electron + React, Ink para la TUI).

```bash
git clone https://github.com/normannormalmann/ultrastar-dlh.git
cd ultrastar-dlh
bun install

bun run start          # TUI en modo desarrollo
bun run desktop:dev    # Aplicación de escritorio con recarga en caliente
bun run test           # Pruebas unitarias
bun run test:e2e       # Prueba de humo con Playwright (compila primero)
bun run desktop:dist   # Compilar el instalador de la plataforma actual (dist/)
bun run desktop:dist:win     # Forzar la compilación del instalador de Windows
bun run desktop:dist:linux   # Forzar la compilación del AppImage de Linux
bun run lint           # Biome
```

Arquitectura: `src/core/` (núcleo compartido: API de USDB, descargas, almacenamiento, proveedores de géneros) ← `src/desktop/` (Electron: main/preload/renderer con un contrato IPC tipado) y `src/tui/` (Ink). Documentos de diseño en `docs/superpowers/`.

---

## 🚨 Solución de problemas

- **«Sign in to confirm you're not a bot» (protección antibots de YouTube):** en los ajustes, elige el navegador en el que hayas iniciado sesión en YouTube — la aplicación usa sus cookies. Cierra el navegador antes de descargar (si no, la base de datos de cookies queda bloqueada). Como alternativa, coloca un `cookies.txt` en la carpeta de canciones.
- **Faltan yt-dlp o ffmpeg:** Ajustes → Herramientas → «Instalar automáticamente las herramientas que faltan». Si falla, instálalos a mano, añádelos al PATH y reinicia la aplicación.
- **Las canciones no aparecen en la biblioteca:** ejecuta primero «Importar colección» (recoge los archivos existentes); pulsa «Actualizar» si se han borrado o cambiado carpetas desde fuera.
- **El enriquecimiento de géneros se detiene:** vuelve a iniciarlo — las canciones ya enriquecidas se omiten. Si el problema persiste, cambia de fuente (Ajustes → Fuente de géneros).

Hay más en el **[Tutorial → Solución de problemas](docs/TUTORIAL.es.md#9-solución-de-problemas)**.

## 🔗 Enlaces y créditos

- [USDB (UltraStar Database)](https://usdb.animux.de) — la mayor base de datos de letras para UltraStar
- [UltraStar Deluxe](https://github.com/UltraStar-Deluxe/USDX) — el juego de karaoke
- Nació como un fork de [UltraScrap-cli](https://github.com/martiinii/UltraScrap-cli) de Marcin Gąsienica-Makowski — ¡gracias! 🙏

Licencia: [MIT](LICENSE.md)

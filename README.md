# Visor WuWa 3D (Android, offline)

Visor 3D para Android de los modelos de personajes de Wuthering Waves. No incluye ningún modelo:
importa los `.zip` que descargas desde el visor 3D de encore.moe (botón **Download .zip**).

## Funciones
- Render toon con contornos, sombras de color por material, brillos de borde.
- Animaciones del paquete (menú, gestos, combate) con cintas (ribbon) y expresiones faciales.
- Objetos de las animaciones (props) y armas unidos a los huesos del personaje.
- Herramienta de pose: rotación por hueso, IK de manos y pies, deshacer, espejo, exportar/importar/guardar poses.
- Física simple para pelo, faldas y cintas.
- Ropa: ocultar secciones de material, «modo tijera» para ocultar piezas sueltas tocándolas, lista de piezas.
- Cara: todos los morph targets con buscador.
- Luces: tantas como quieras (direccional, puntual, foco, hemisférica, ambiente), color, intensidad, posición, sombras, presets.
- Escena: fondos (degradado, color, imagen propia, transparente), suelo, cámaras predefinidas, auto-giro, capturas PNG (también transparentes).

## Estructura
- `web/` — el visor (three.js, sin build). `web/src/ueformat.js` lee `.uemodel`/`.ueanim` (UEFormat).
- `android/` — app Kotlin con WebView que sirve `web/` desde los assets y los modelos importados desde el almacenamiento interno.
- `tools/devserver.mjs` — servidor para probar el visor en el navegador con una carpeta descomprimida.

## Compilar
```
cd android && ./gradlew assembleDebug   # requiere Android SDK (compileSdk 35)
```

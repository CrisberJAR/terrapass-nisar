# TerraPass — Guion de exposición de 5 minutos (español)

Dos expositores: **Crisber** (C) y **Jhon** (J). Son unas 690 palabras, a unas 140 palabras por minuto. Los tiempos son una meta: ensayen con cronómetro.
Tengan la app abierta en otra pestaña para la diapositiva 5: https://terrapass-nisar-crisber.azurewebsites.net. Si falla internet, reproduzcan el video de 30 segundos.

Diapositivas en español: https://claude.ai/artifact/UYBqCMJi9cZmfabVtFiXLb (las notas del orador tienen este mismo texto).

---

### Diapositiva 1 · Portada — 0:00–0:30 (C)
«Buenos días, jurado. El 24 de junio de 2026, un sismo de magnitud 7,2, seguido segundos después por otro de 7,5, sacudió el norte de Venezuela.
Doce días después, un satélite ya había medido cuánto se movió el suelo: a través de las nubes, de noche, en cualquier lugar del planeta.
Somos TerraPass, y creemos que cada rincón de la Tierra merece un pasaporte: un registro verificable de cómo cambia.»

### Diapositiva 2 · El problema — 0:30–1:10 (C)
«NISAR, la misión conjunta de la NASA y la ISRO, mapea toda la tierra del planeta cada 12 días con radar de banda L. Ya hay más de 550 000 granulos científicos en el catálogo de la NASA.
Pero para un agricultor, un alcalde o una aseguradora, esos datos son ilegibles: archivos HDF5 de gigabytes, polarimetría compleja y fase.
Por eso, quienes más necesitan saber *dónde cambió el terreno* —después de una inundación, un sismo o una tala ilegal— nunca lo ven.»

### Diapositiva 3 · Nuestra solución — 1:10–1:50 (J)
«TerraPass divide el terreno en celdas y le da a cada una un **pasaporte de cambio**.
Para cada celda comparamos cada nueva pasada del radar con su propia historia, usando una línea base estadística robusta: la mediana y la MAD de al menos cuatro pasadas anteriores.
Luego, cinco reglas físicas convierten la señal en una hipótesis en lenguaje simple: deformación cortical, inundación abierta, inundación *bajo* el bosque, pérdida de vegetación o actividad agrícola.
Cada resultado tiene un puntaje de confianza de cinco partes: magnitud, persistencia, coherencia, acuerdo de reglas y profundidad de la línea base. Sin cajas negras.»

### Diapositiva 4 · Datos reales de la NASA — 1:50–2:30 (J)
«Nuestro primer prototipo usaba radar simulado. En esta versión todo es real.
Consultamos en vivo el catálogo de la NASA para obtener la retrodispersión GCOV y los interferogramas GUNW de NISAR, georreferenciamos las vistas previas de ASF sobre cada zona y las colocamos sobre un gemelo 3D hecho con elevación real.
Además fusionamos cuatro fuentes: los eventos naturales de NASA EONET, la lluvia y la humedad del suelo de NASA POWER, el catálogo de sismos del USGS y nuestro propio nodo ESP32 de verdad de campo, que transmite por Supabase Realtime.»

### Diapositiva 5 · Demo en vivo — 2:30–3:45 (C maneja la demo, J narra)
*(Cambien al navegador.)*
- **Venezuela:** «Esto no es una animación. Es el interferograma real de NISAR que abarca el sismo. Cada ciclo de color es un contorno de movimiento del suelo. Al hacer clic en una celda, su pasaporte muestra *deformación del terreno, confianza alta*, porque un par interferométrico real y el catálogo del USGS coinciden.»
- **Perú:** «En el valle arrocero del Huallaga, la banda L ve bajo el dosel. El magenta es doble rebote y el verde es vegetación. Nuestras reglas detectan los ciclos de inundación de los arrozales y el agua escondida bajo el bosque. Los satélites ópticos no lo ven.»
- **Atacama:** «Y este es nuestro control negativo, el desierto más seco del planeta. El mapa de cambio real se mantiene quieto. Un pasaporte confiable también debe poder decir *no pasó nada*.»
- «Cada pasaporte se puede descargar como JSON y cualquiera puede auditarlo.»

### Diapositiva 6 · Arquitectura y honestidad — 3:45–4:25 (J)
«TerraPass corre en **Microsoft Azure App Service** con Node 24, con un servidor que guarda en caché las APIs de la NASA y hace de proxy para las imágenes. El despliegue se hace con un solo comando, con CI/CD en GitHub Actions e infraestructura como código en Bicep.
También somos honestos con nuestros límites. Hoy usamos vistas previas de unos 150 metros, no datos calibrados de resolución completa. La georreferencia sale de la huella del granulo. Y cada resultado es una hipótesis con su evidencia, nunca un veredicto. El sistema ya está preparado para usar GCOV de resolución completa.»

### Diapositiva 7 · Impacto y cierre — 4:25–5:00 (C)
«¿Quién lo usa? Defensa Civil después de sismos e inundaciones. Agricultores y aseguradoras que verifican los ciclos de cultivo. Comunidades que documentan la deforestación. Todos con los mismos datos abiertos de la NASA.
Lo siguiente es procesar los productos HDF5 completos, añadir el producto de humedad del suelo de NISAR y desplegar nodos IoT de bajo costo en el Perú.
NISAR observa todo el planeta cada 12 días. TerraPass hace que cada rincón tenga una historia que cualquiera pueda leer.
Gracias. TerraPass: cada rincón de la Tierra merece un pasaporte.»

---

## Preguntas probables del jurado (respuestas cortas)
- **«¿Los datos son reales?»** Sí. Los granulos GCOV y GUNW vienen de NASA CMR y del ASF DAAC. Sus identificadores están en la tabla de la app y en cada pasaporte JSON. Las capas de escenario están marcadas claramente como MODEL.
- **«¿Por qué banda L?»** Su longitud de onda de 24 cm atraviesa el dosel y mantiene más coherencia sobre la vegetación que la banda C. Por eso detecta inundaciones bajo el bosque y deformación en zonas con vegetación.
- **«¿Cómo evitan falsos positivos?»** Con una línea base robusta (mediana y MAD), persistencia entre pasadas, acuerdo de reglas, evidencia independiente y el control negativo de Atacama.
- **«¿Qué aporta Azure?»** Caché de las APIs y proxy de imágenes (sin problemas de CORS ni de límites de uso), HTTPS, escalado, CI/CD e infraestructura como código. Está listo para producción; no es una demo estática.

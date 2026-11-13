# TerraPass v3 — Pasaporte de Cambio Terrestre (NASA Space Apps 2026 · "Dancing with the SARs")

Aplicación web que convierte **datos reales de radar NISAR (NASA-ISRO)** en un "pasaporte de cambio" por celda: deformación sísmica, inundaciones (incluso bajo bosque), pérdida de vegetación y actividad agrícola. Se valida con IoT (ESP32/Wokwi + Supabase), NASA POWER, NASA EONET y USGS.

**Equipo:** Jhon Alberto Aguilar Quispe & Crisber Ambicho Reynoso

## Estructura
```
server.js              API gateway (Express): NASA CMR/NISAR, EONET, POWER, USGS, proxy de imágenes, caché
public/index.html      App principal (globo 3D, gemelo digital, pasaporte, Cal/Val, física, eventos)
public/promo.html      Película de 30 s (render en vivo + grabador de video)
public/js/*.js         globe, terrain, nisar, engine (reglas), calval, charts, app, promo
deploy/                Scripts de despliegue a Azure (PowerShell y bash)
infra/main.bicep       Infraestructura como código (Azure)
.github/workflows/     CI/CD a Azure App Service
supabase/schema.sql    Esquema de base de datos + RLS + Realtime
docs/                  Recursos añadidos, guion del video (30 s) y guion de exposición (5 min)
```

## Ejecutar en local
```powershell
npm install
$env:PORT=3000; npm start      # abrir http://localhost:3000
```
(El puerto 8080 de tu PC está ocupado por Jenkins: usa otro.)

## Desplegar en Azure (App Service, Linux, Node 20)
1. Instala Azure CLI: `winget install -e --id Microsoft.AzureCLI` y vuelve a abrir la terminal.
2. Desde la carpeta del proyecto:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\deploy\deploy-azure.ps1 -AppName terrapass-nisar-<tu-nombre> -Location eastus -Sku B1
   ```
   Se abre el navegador para iniciar sesión en Azure (Azure for Students sirve). Al final imprime la URL `https://<app>.azurewebsites.net`.
   - Si tu suscripción no permite `eastus`, prueba con `-Location brazilsouth` o `-Location centralus`.
   - `-Sku F1` es gratis, pero tiene límite de CPU; `B1` es lo recomendado para la demo.
3. (Opcional) Supabase: crea un proyecto, ejecuta `supabase/schema.sql` en el SQL Editor y vuelve a desplegar con
   `-SupabaseUrl https://xxxx.supabase.co -SupabaseKey sb_publishable_xxx`.
   Sin Supabase, el módulo Cal/Val funciona en "modo local".

Alternativas: `infra/main.bicep` (IaC), el `Dockerfile` (Azure Container Apps) o el workflow de GitHub Actions.

## Entregables
| Pedido | Inglés | Español |
|--------|--------|---------|
| 1. Recursos añadidos | `docs/RESOURCES_ADDED.md` y la sección **06 · What's new** de la app | — |
| 2. Video de 30 s con audio | `docs/video/TerraPass-30s-EN.mp4` · `/promo.html` | `docs/video/TerraPass-30s-ES.mp4` · `/promo.html?lang=es` · `docs/GUION_VIDEO_30s_ES.md` |
| 3. Exposición de 5 min | `docs/PRESENTATION_5min_SCRIPT.md` | `docs/GUION_EXPOSICION_5min_ES.md` |
| 4. 7 diapositivas | https://claude.ai/artifact/Roz8gPhDAJCAKC77skFkyR | https://claude.ai/artifact/UYBqCMJi9cZmfabVtFiXLb |

Las diapositivas se exportan a .pptx o PDF desde Compartir › Exportar, con las notas del orador incluidas.
App en Azure: https://terrapass-nisar-crisber.azurewebsites.net (App Service, Linux, Node 24 LTS, Brazil South).

## Fuentes de datos
NASA CMR / ASF DAAC (NISAR L2 GCOV y GUNW), NASA EONET v3, NASA POWER, NASA Blue/Black Marble, USGS ComCat, AWS Terrain Tiles, Esri World Imagery.

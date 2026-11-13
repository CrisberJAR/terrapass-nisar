# TerraPass v3 — Resources added

What we added on top of the TerraPass v2 prototype (https://nasa-dsjj.onrender.com/). The v2 prototype ran on Render with Supabase and simulated radar series.

## 1. NASA data sources (all live, no API key required)

| # | Resource | Provider | What TerraPass does with it | Endpoint used |
|---|----------|----------|------------------------------|---------------|
| 1 | **NISAR L2 GCOV** (geocoded polarimetric covariance, HH/HV) | NASA-ISRO · ASF DAAC via **NASA CMR** | Builds a real repeat-pass stack per study area, drapes it on the 3D terrain and computes a real robust z-score change map | `cmr.earthdata.nasa.gov/search/granules.json?short_name=NISAR_L2_GCOV_V1` |
| 2 | **NISAR L2 GUNW** (geocoded unwrapped interferograms) | NASA-ISRO · ASF DAAC via NASA CMR | Shows **real coseismic fringes** of the 24 Jun 2026 M7.2/M7.5 Venezuela earthquake doublet on 3D terrain | `short_name=NISAR_L2_GUNW_V1` |
| 3 | NISAR browse quicklooks (`*_LATLON.png`) | ASF Earthdata Cloud | Georeferenced with the granule footprint, cropped and sampled into a 48 × 48 grid | `nisar.asf.earthdatacloud.nasa.gov/BROWSE/...` |
| 4 | NISAR archive statistics | NASA CMR | Live counter of indexed NISAR granules (>550,000) | `CMR-Hits` header |
| 5 | **NASA EONET v3** | NASA Earth Observatory | Live wildfires, floods, storms and volcanoes on the globe; used as passport evidence | `eonet.gsfc.nasa.gov/api/v3/events` |
| 6 | **NASA POWER** | NASA Langley | Daily rainfall (IMERG) and surface soil wetness (GWETTOP, MERRA-2) as an independent Cal/Val reference | `power.larc.nasa.gov/api/temporal/daily/point` |
| 7 | **NASA Blue Marble / Black Marble** | NASA Visible Earth | Photoreal globe: day texture, night lights, ocean mask and relief | local textures |

## 2. Complementary open data

| Resource | Use |
|----------|-----|
| USGS ComCat earthquake catalogue | Independent validation of InSAR deformation, auto-matching interferograms that span each event |
| AWS Terrain Tiles (SRTM / GMTED / ETOPO1) | Real elevation for the 3D digital twin |
| Esri World Imagery (fallback NASA GIBS) | Satellite imagery draped on the terrain |

## 3. New features

1. Photoreal 3D Earth: real-time solar terminator, ocean sun-glint, procedural clouds, atmospheric scattering and bloom.
2. NISAR spacecraft model: bus, 12 m mesh reflector and boom, flying a 747 km, 98.4° sun-synchronous orbit and painting its 242 km swath.
3. Real-terrain digital twin for each study area, with shadows, sea level, a fly-over scan line and a "Dance" mode where cells pulse with detected change.
4. Real NISAR filmstrips: interferograms and backscatter over time, with granule table and links to the HDF5 files.
5. Evidence fusion in every passport: radar rules + USGS + EONET + IoT + NASA POWER.
6. Downloadable JSON passport (`terrapass.passport/v3`) with series, events, 5-part confidence breakdown and evidence.
7. Guided demo (6 cases): real quake, deformation model, real backscatter in Peru, rice cycles, flooding under canopy, Atacama negative control.
8. 30-second film (`/promo.html`) rendered live with an ambient soundtrack and a built-in 1080p video recorder.
9. Cal/Val module with Supabase Realtime and an automatic local fallback.
10. English UI for international judging.

## 4. Cloud and DevOps

| Item | File |
|------|------|
| Node/Express API gateway with cache and a CORS-safe image proxy | `server.js` |
| One-command Azure App Service deployment | `deploy/deploy-azure.ps1`, `deploy/deploy-azure.sh` |
| Infrastructure as Code | `infra/main.bicep` |
| CI/CD | `.github/workflows/azure-webapp.yml` |
| Container image (Azure Container Apps) | `Dockerfile` |
| Database schema + RLS + Realtime | `supabase/schema.sql` |

## 5. Corrections to the v2 prototype

- **Venezuela study area**: moved to the epicentral zone of the real 24 Jun 2026 doublet (USGS M7.2 near San Felipe and M7.5 near Catia La Mar).
- **Cal/Val soil moisture**: the Peru scenario sent 80–96 % volumetric moisture, which is physically impossible (soil saturates at about 45–55 %). It now uses 46–55 %. The dielectric constant now comes from an exact inverse of the Topp (1980) equation.
- **Confidence labels and texts** translated, and the real/model source labelled on every layer ("REAL · NASA/ASF" vs "MODEL · scenario").
- **Supabase**: the v2 project URL no longer resolves. The app degrades gracefully to local mode, and the full schema is included to recreate it.

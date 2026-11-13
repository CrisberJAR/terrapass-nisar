# TerraPass — 5-minute pitch script (English)

Two speakers: **Crisber** (C) and **Jhon** (J). About 680 words, roughly 140 words per minute. The times are targets, so rehearse with a timer.
Have the live app open in a second tab for slide 5. If the internet fails, play the 30-second film instead.

---

### Slide 1 · Title — 0:00–0:30 (C)
"Good morning, judges. On June 24th, 2026, a magnitude 7.2 earthquake, followed seconds later by a 7.5, struck northern Venezuela.
Twelve days later, a satellite had already measured how much the ground moved — through clouds, at night, anywhere on Earth.
We are TerraPass, and we believe every patch of Earth deserves a passport: a verifiable record of how it changes."

### Slide 2 · The problem — 0:30–1:10 (C)
"NISAR, the joint NASA–ISRO mission, maps all of Earth's land every 12 days with L-band radar. It produces more than half a million science files: over 550,000 granules are already in NASA's catalogue.
But for a farmer, a mayor or an insurer, this data is unreadable. It is gigabyte-sized HDF5 files, complex polarimetry and phase.
So the people who most need to know *where the land changed* — after a flood, a quake or illegal logging — never see it."

### Slide 3 · Our solution — 1:10–1:50 (J)
"TerraPass divides the land into cells and gives each one a **change passport**.
For every cell we compare each new radar pass against its own history using a robust statistical baseline — the median and MAD of at least four previous passes.
Then five physical rules turn the signal into a plain-language hypothesis: crustal deformation, open-water flooding, flooding *under* the forest, vegetation loss, or agricultural activity.
Every result has a five-part confidence score — magnitude, persistence, coherence, rule agreement and baseline depth. No black boxes."

### Slide 4 · Real NASA data — 1:50–2:30 (J)
"Our first prototype used simulated radar. In this version everything is real.
We query NASA's Common Metadata Repository live for NISAR GCOV backscatter and GUNW interferograms, georeference the ASF quicklooks over each study area, and drape them on a 3D twin made from real elevation.
We fuse four more sources: NASA EONET natural events, NASA POWER rainfall and soil wetness, the USGS earthquake catalogue, and our own ESP32 ground-truth node streaming through Supabase Realtime."

### Slide 5 · Live demo — 2:30–3:45 (C drives, J narrates)
*(Switch to the browser.)*
- **Venezuela:** "This is not an animation. This is NISAR's real interferogram spanning the earthquake. Each colour cycle is a contour of ground motion. When I click a cell, its passport shows *ground deformation, high confidence*, because a real interferometric pair and the USGS catalogue agree."
- **Peru:** "In the Huallaga rice valley, L-band sees under the canopy. Magenta is double bounce, green is vegetation. Our rules detect paddy flooding cycles and water hidden beneath the forest — optical satellites miss this."
- **Atacama:** "And this is our negative control, the driest desert on Earth. The real change map stays quiet. A trustworthy passport must also be able to say *nothing happened*."
- "Every passport can be downloaded as JSON and audited by anyone."

### Slide 6 · Architecture & honesty — 3:45–4:25 (J)
"TerraPass runs on **Microsoft Azure App Service**, with a Node gateway that caches NASA's APIs and proxies the imagery. Deployment is one command, with GitHub Actions CI/CD and Bicep infrastructure as code.
We are also honest about our limits. Today we use browse quicklooks at about 150 metres, not calibrated full-resolution data. Georeferencing comes from the footprint. And every output is a hypothesis with its evidence, never a verdict. The pipeline is ready to swap in full-resolution GCOV."

### Slide 7 · Impact & close — 4:25–5:00 (C)
"Who uses it? Civil defence after earthquakes and floods. Farmers and insurers verifying crop cycles. Communities documenting deforestation. All of them use the same open NASA data.
Next we will process full HDF5 products, add NISAR's soil moisture product, and deploy low-cost IoT nodes in Peru.
NISAR watches the whole planet every 12 days. TerraPass makes sure every patch of it has a story anyone can read.
Thank you — TerraPass: every patch of Earth deserves a passport."

---

## Likely judge questions (short answers)
- **"Is the data real?"** Yes. The GCOV and GUNW granules come from NASA CMR and the ASF DAAC. The granule IDs are in the table and in every passport JSON. The scenario layers are clearly labelled MODEL.
- **"Why L-band?"** Its 24 cm wavelength penetrates canopy and is more coherent over vegetation than C-band, so it can see floods under forests and deformation in vegetated areas.
- **"How do you avoid false positives?"** A robust baseline (median/MAD), persistence across passes, rule agreement, independent evidence, and the Atacama negative control.
- **"What does Azure add?"** API caching and an image proxy (no CORS or rate-limit issues), HTTPS, scaling, CI/CD and IaC. It is production-ready, not a static demo.

# Ingest type matrix — 2026-11-14

Run 0494744a against http://localhost:3040. Representatives: smallest real file per type, except real large originals (NSTA LAS 6.5 MiB, Volve 2D SEG-Y 12.6 MiB) which prove the streaming path. RMOTC is on hold (owner decision); its USA NAD27/83 no-transform behaviour is proven separately by scripts/verify-datasets.mjs with an unregistered-CRS survey.

| Dataset | Type | File | Mode | Result | Note |
| --- | --- | --- | --- | --- | --- |
| sodir | gis | dataservice/layers/4503-sbm-survey-line.csv | attach | pass | 188 bytes, sha ok, download identical |
| sodir | tops | dataservice/tables/9001-csd-injection.csv | attach | pass | 1344 bytes, sha ok, download identical |
| sodir | gis | layers/ed50utm32/603-apa-gross.csv | attach | pass | 196 bytes, sha ok, download identical |
| sodir | gis | layers/wgs84/403-seismic-surveys-pending.geojson | attach | pass | 42 bytes, sha ok, download identical |
| sodir | documents | metadata/dataservice-ed50.service.json | attach | pass | 29666 bytes, sha ok, download identical |
| sodir | production | production/sodir-field-production-yearly.csv | attach | pass | 138444 bytes, sha ok, download identical |
| sodir | tops | tables/513-field-parts-relation.csv | attach | pass | 94 bytes, sha ok, download identical |
| sodir | access | dataservice/layers/1001-block.csv | restricted | pass | hidden from reader in list, detail, download |
| sodir | immutability | - | delete published | pass | 405 as required |
| nsta | documents | cgg/CGG_Narrative to accompany data publication.docx | attach | pass | 17918 bytes, sha ok, download identical |
| nsta | deviation | deviation/204-25a-8Y__29926q-source document.csv | attach | pass | 11104 bytes, sha ok, download identical |
| nsta | logs | logs/11-25-2__1723_d.las | attach+stream | pass | 6579209 bytes, sha ok, download identical |
| nsta | production | production/pprs-field-monthly.csv | attach+stream | pass | 5841687 bytes, sha ok, download identical |
| nsta | seismic-2d | seismic-2d/nsta-2d-line-index.ed50.json | attach | pass | 857994 bytes, sha ok, download identical |
| nsta | well-header | wells/nsta-wellbores.csv | publish | pass | well 685f80fa-986f-438b-a2f3-bf78bd4b4932 |
| nsta | well-header | wells/nsta-wellbores.csv | attach | pass | 2371795 bytes, sha ok, download identical |
| nsta | access | cgg/CGG_Additional_JDWLs.zip | restricted | pass | hidden from reader in list, detail, download |
| nsta | immutability | - | delete published | pass | 405 as required |
| volve | deviation | deviation/NPD-8267.csv | attach | pass | 22181 bytes, sha ok, download identical |
| volve | logs | logs/NO_15_9-F-15_B_KLOGH_NEW.las | attach | pass | 3066 bytes, sha ok, download identical |
| volve | production | production/volve-field-production-monthly.csv | attach | pass | 8099 bytes, sha ok, download identical |
| volve | seismic-2d | seismic-2d/lines/ST0299-05002+MIG_FIN.segy | attach+stream | pass | 12659760 bytes, sha ok, download identical |
| volve | seismic-3d | seismic-3d/SeismicOrderSummary+Header.txt | attach | pass | 446268 bytes, sha ok, download identical |
| volve | well-header | wells/volve-wellbores.csv | publish | pass | well 3e6c8e7c-c232-46d8-b83d-fa16b0c70ec2 |
| volve | well-header | wells/volve-wellbores.csv | attach | pass | 4204 bytes, sha ok, download identical |
| volve | access | deviation/NPD-3145.csv | restricted | pass | hidden from reader in list, detail, download |
| volve | immutability | - | delete published | pass | 405 as required |

## Notes and limitations

- Sodir packages carry layers/tables/production/metadata but no well headers; real-header publish is proven for NSTA and Volve, and synthetic full-industry headers by scripts/verify-well-header.mjs.
- Backup/restore was not exercised: both staff accounts remain in forced-password-change state and changing dev credentials is out of scope for this commission; immutability, provenance checksums, and access control are exercised above.
- Domain parsing/viewers (LAS curves, SEG-Y traces) remain out of scope per Release 1: ingestion is governed cataloging with preserved originals.
- The Volve seismic-3d group holds order summary/header text only; no full 3D cube is present in the demo set. The large-original path is proven with the real 12.6 MiB 2D SEG-Y, the real 6.5 MiB NSTA LAS, and the 6 MiB synthetic stream test in scripts/verify-datasets.mjs.

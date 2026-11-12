export const DOCS_HTML = `
<section class="docs-section" id="docs-purpose" data-doc-section>
  <p class="docs-eyebrow">01 / Purpose</p>
  <h2>Why this page exists</h2>
  <p>Atlasio is built around choices that are easy to lose: why coordinates are stored the way they are, why a published version never changes, why a category shows a dash instead of a zero, and why the catalog is grouped into six domains. This page keeps those choices beside the product so a client, reviewer, or future maintainer can understand the reasoning without reconstructing it from commits or conversations.</p>
  <p>Read it in three ways. The <a href="#/docs" data-doc-link="docs-invariants">invariants</a> are the rules we do not break. The <a href="#/docs" data-doc-link="docs-decisions">decision log</a> records what we chose, when, and what it costs. The <a href="#/docs" data-doc-link="docs-glossary">glossary</a> fixes the vocabulary used by the interface and the API.</p>
  <div class="docs-note"><strong>Status.</strong> This describes the Release 1 local demo and the decisions through v0.1.20. It is a working reference, not a marketing page. Synthetic fixtures only; no licensed customer data is stored in this repository.</div>
</section>

<section class="docs-section" id="docs-architecture" data-doc-section>
  <p class="docs-eyebrow">02 / Architecture</p>
  <h2>One system of record, several replaceable edges</h2>
  <p>The browser is a view. Domain rules, authorization, identity resolution, and coordinate handling live behind the API so the map, search, and record pages cannot disagree about the same well.</p>
  <div class="docs-stack" aria-label="System layers">
    <div class="docs-stack-row"><b>Web client</b><span>Vanilla JavaScript modules with Vite and MapLibre GL JS. Hash routes for dashboard, workspace, and this reference. Natural Earth geometry is bundled for offline basemaps.</span></div>
    <div class="docs-stack-row"><b>API</b><span>Rust with Axum. Role-scoped endpoints for dashboard coverage, imports, wells, search, map queries, files, and publication. Stable JSON contracts; domain rules stay server-side.</span></div>
    <div class="docs-stack-row"><b>System of record</b><span>PostgreSQL with PostGIS. Relational metadata, geometry, constraints, version history, audit events, and spatial indexes. Published rows are protected by database triggers.</span></div>
    <div class="docs-stack-row"><b>Object storage</b><span>S3-compatible storage in deployment, with a local filesystem fallback for development. Original and derived binaries keep their checksums; the database holds metadata and references, not seismic cubes.</span></div>
    <div class="docs-stack-row"><b>CRS engine</b><span>Target: a PROJ-based engine with pinned coordinate operations and required grids. The demo fixtures are WGS 84 and record an identity operation; real transformations remain a pilot requirement.</span></div>
  </div>
  <h3>Why this shape</h3>
  <ul>
    <li><strong>Rules in one place.</strong> Publication, duplicate detection, and coordinate policy are enforced at the API and storage boundary, not repeated in each screen.</li>
    <li><strong>Large files stay practical.</strong> Seismic volumes and original documents are referenced by metadata and checksum, so the database stays responsive.</li>
    <li><strong>Private by default.</strong> The stack can run on-premises or in a private cloud. Core use does not require public cloud connectivity.</li>
    <li><strong>Replaceable edges.</strong> The web client, storage provider, and CRS service can change without rewriting the domain model.</li>
  </ul>
  <p class="docs-muted">Recorded in <code>docs/decisions/0001-rust-core.md</code> as Decision 0001, accepted 10 November 2026.</p>
</section>

<section class="docs-section" id="docs-invariants" data-doc-section>
  <p class="docs-eyebrow">03 / Invariants</p>
  <h2>Rules we do not break</h2>
  <p>These are product rules, not implementation preferences. A change that violates one needs an explicit product decision and a new record in the decision log.</p>
  <ol class="docs-numbered">
    <li><strong>Stable internal identity.</strong> Every managed entity has an Atlasio ID. External IDs, names, and aliases are stored separately and may conflict.</li>
    <li><strong>Originals survive.</strong> The source file and its checksum are retained. Normalized values and derivatives point back to the origin.</li>
    <li><strong>Published versions are immutable.</strong> A correction creates a new version. Drafts and approved versions are visibly distinct, and previous published versions remain inspectable.</li>
    <li><strong>Source coordinates are never overwritten.</strong> Source X/Y and source CRS are preserved. Display coordinates and the exact transformation operation are stored alongside them.</li>
    <li><strong>No silent datum or CRS choice.</strong> Missing CRS is not assumed to be WGS 84. Competing datum transformations are shown for human resolution, never picked silently.</li>
    <li><strong>Separate coordinate concepts.</strong> Horizontal CRS, vertical datum, KB/DF/GL elevation reference, MD/TVD, units, and seismic time/depth domain are distinct. Do not transform one by implying another.</li>
    <li><strong>Well identity is not wellbore identity.</strong> A well may have multiple wellbores. Possible duplicates are flagged for human review; they are never merged automatically.</li>
    <li><strong>Large binaries live outside the database.</strong> Object storage or governed external storage holds the bytes; the database holds metadata, indexes, relationships, and checksums.</li>
    <li><strong>Authorization at the boundary.</strong> Role checks apply at the API and storage layer, not only in the interface. License and confidentiality metadata travel with every source package.</li>
  </ol>
  <div class="docs-note"><strong>Test the edges, not just the happy path.</strong> Representative cases include missing CRS, alternate well names, duplicate candidates, version replacement, and a second-country fixture that catches country-specific assumptions.</div>
</section>

<section class="docs-section" id="docs-model" data-doc-section>
  <p class="docs-eyebrow">04 / Data model</p>
  <h2>The entities a client will hear about</h2>
  <div class="docs-table-wrap">
    <table class="docs-table">
      <thead><tr><th>Entity</th><th>What it represents</th><th>Rule that matters</th></tr></thead>
      <tbody>
        <tr><td>Asset</td><td>A basin, concession or block, field, prospect, or other named area.</td><td>Identity is internal; names are aliases, not keys.</td></tr>
        <tr><td>Well</td><td>The stable identity of a well across names and sources.</td><td>Aliases and external IDs stay separate; duplicates need human resolution.</td></tr>
        <tr><td>Wellbore</td><td>A physical borehole associated with a well.</td><td>One well may have several wellbores; do not collapse them.</td></tr>
        <tr><td>Dataset</td><td>A logical item such as a log, tops set, survey, volume, report, image, horizon, or fault.</td><td>Datasets group versions; they are not the version itself.</td></tr>
        <tr><td>Dataset version</td><td>An immutable published snapshot with source, lineage, checksum, and review history.</td><td>Published means immutable. Corrections create a new version.</td></tr>
        <tr><td>File asset</td><td>An original or derived binary with URI, size, type, checksum, and access policy.</td><td>The file is evidence; the record points to it and never silently replaces it.</td></tr>
        <tr><td>Interpretation</td><td>A person's or team's technical result linked to source datasets.</td><td>Working interpretations are distinct from approved corporate versions.</td></tr>
        <tr><td>Import batch</td><td>A traceable delivery or load event with files, mapping choices, QC findings, and outcomes.</td><td>Review and publication are recorded against the batch, not lost in logs.</td></tr>
      </tbody>
    </table>
  </div>
  <div class="docs-note"><strong>Implemented versus target.</strong> Release 1 implements wells, well versions, import batches, file assets, and audit events. Assets, wellbores, datasets, interpretations, and dataset-version objects are target-model concepts that become tables when their workflows are built.</div>
  <h3>Lifecycle</h3>
  <p>The current implementation moves a batch through <code>staged</code>, <code>submitted</code>, <code>published</code>, or <code>rejected</code>. Database triggers forbid updates or deletes on published well versions, published batches, and their source files. A later correction is a new batch and a new version number, not an edit.</p>
</section>

<section class="docs-section" id="docs-coordinates" data-doc-section>
  <p class="docs-eyebrow">05 / Coordinates</p>
  <h2>Display is a convenience; source truth is not</h2>
  <p>Every spatial record carries its source coordinates and source CRS. Atlasio calculates a display point for the map and stores the exact operation used. The map’s coordinate rail labels its display CRS as <code>EPSG:4326</code>; that label describes the view, not the source data.</p>
  <ul>
    <li><strong>Never overwrite.</strong> The source position remains available after any display transformation.</li>
    <li><strong>Never guess.</strong> A missing CRS is a finding. An ambiguous datum is a review item, not a default.</li>
    <li><strong>Never conflate.</strong> Horizontal CRS, vertical datum, elevation reference, depth reference, and time/depth domain are separate fields with separate meanings.</li>
    <li><strong>Prove the operation.</strong> Transformations require known control points and tolerances approved for the relevant CRS and operation. Round-trip tests alone do not prove correctness.</li>
  </ul>
  <div class="docs-note"><strong>Demo status.</strong> The synthetic fixtures are WGS 84, so the stored operation is the identity operation. That is a fixture assumption, not a production policy. Licensed pilot data must supply its own CRS definitions and approved operations.</div>
  <div class="docs-note"><strong>Why clients care.</strong> A well that appears in the right place on the map but cannot be traced back to its source coordinates is not a governed record. The display point must be reproducible from the stored operation and inputs.</div>
</section>

<section class="docs-section" id="docs-workflow" data-doc-section>
  <p class="docs-eyebrow">06 / Workflow</p>
  <h2>From a delivered package to a discoverable record</h2>
  <ol class="docs-steps">
    <li><b>Stage.</b> An importer delivers a package. Original files are retained with checksums; metadata is extracted or entered into a staging record.</li>
    <li><b>Check.</b> Atlasio reports missing CRS, out-of-range coordinates, unlikely units, missing identifiers, possible duplicates, conflicting values, and invalid geometry. Findings are errors, warnings, or informational.</li>
    <li><b>Resolve.</b> A human resolves identity, location, duplicates, and ambiguous transformations. The system proposes; it does not merge or transform silently.</li>
    <li><b>Review.</b> A reviewer approves, rejects with a reason, or returns the batch for correction. The review is attributed and time-stamped.</li>
    <li><b>Publish.</b> Publication creates an immutable version, updates the current version, and records audit events. The previous version remains available.</li>
    <li><b>Discover.</b> Search, records, and the map read the same authoritative version. Coverage counts reflect what the current role may see.</li>
  </ol>
  <h3>Roles in the demo</h3>
  <div class="docs-badges"><span>Reader · view approved data</span><span>Importer · stage and correct</span><span>Reviewer · approve or reject</span></div>
  <p>Demo keys are synthetic and exist to exercise the workflow. In deployment, authentication and role assignment are configured per operator; authorization is enforced at the API and storage boundary.</p>
</section>

<section class="docs-section" id="docs-catalog" data-doc-section>
  <p class="docs-eyebrow">07 / Catalog</p>
  <h2>Six domains, twenty-four categories</h2>
  <p>The dashboard separates surface and land context from subsurface data, and separates drilling from production. That gives each record type a clear owner and a place for its own lifecycle. Counts come from the API and are scoped to the current role.</p>
  <div class="docs-table-wrap">
    <table class="docs-table">
      <thead><tr><th>Domain</th><th>Categories</th><th>Why it is separate</th></tr></thead>
      <tbody>
        <tr><td>Culture &amp; Lands</td><td>Concession Maps, Permits &amp; Licenses, Land &amp; Lease Records, GIS &amp; Basemaps</td><td>Surface context and land rights carry dates, issuing authorities, and confidentiality rules that documents do not.</td></tr>
        <tr><td>Well Data</td><td>E&amp;P Projects, Wells, Well Versions, Horizontal Wells, Well Logs, Formation Tops, Well Interpretations</td><td>Registry, content, and interpretations share a well identity and version history.</td></tr>
        <tr><td>Seismic Data</td><td>Seismic Surveys, 2D Seismic Lines, 3D Seismic Cubes, Seismic Interpretations</td><td>Survey identity, footprint, navigation, volumes, and interpretations follow a different access and storage pattern.</td></tr>
        <tr><td>Drilling &amp; Completions</td><td>Drilling Records, Completion Records, Workover Records</td><td>Operational records describe what happened at the wellbore and need their own timeline.</td></tr>
        <tr><td>Production Data</td><td>Production Records, Production Tests, Injection Records</td><td>Time-series volumes and tests have units, allocations, and QC that differ from well headers.</td></tr>
        <tr><td>Documents &amp; Reports</td><td>Reports, M&amp;A Reports, Original Files</td><td>Narrative and commercial evidence stays linked to the records it supports.</td></tr>
      </tbody>
    </table>
  </div>
  <div class="docs-note"><strong>Cataloged is not the same as planned.</strong> An item with data shows a count. An item without data shows a dash and participates in the “planned” legend. It is never rendered as zero, because zero would claim that none exist.</div>
</section>

<section class="docs-section" id="docs-interface" data-doc-section>
  <p class="docs-eyebrow">08 / Interface</p>
  <h2>Decisions a client can see</h2>
  <h3>Map-led discovery</h3>
  <p>The dashboard pairs coverage with a map scoped to an explicit area of interest. The map is a discovery and inspection surface; the authoritative record is the versioned dataset. Area choice and its source stay visible, and location access requires browser permission.</p>
  <h3>One theme control</h3>
  <p>A single control cycles automatic, light, and dark. Automatic follows the operating-system palette, with a local-time night rule from 19:00 to 07:00 so an evening workspace turns dark even when the OS stays light. Explicit light and dark are never overridden. Every theme state is tested; a dark-only surface in light mode is a defect.</p>
  <h3>Open triangle, two contours</h3>
  <p>The mark is an open triangle whose base is replaced by a lower contour, with a second contour stacked above it and a crimson point at the summit. It reads as terrain and as an open “A”, keeps the contour vocabulary, and survives the 26 px mobile header. The favicon uses the same geometry on a dark tile.</p>
  <h3>Dense coverage ledger</h3>
  <p>The catalog uses a three-column ledger at wide widths, two columns under 1240 px, and one column on mobile. On shorter laptops the page scrolls instead of hiding categories inside a nested scroll area. The summary reports how many categories are cataloged, not how many are planned.</p>
  <p class="docs-muted">Interaction quality floor: visible keyboard focus, reduced-motion support, readable contrast in both themes, and responsive layouts down to mobile.</p>
</section>

<section class="docs-section" id="docs-security" data-doc-section>
  <p class="docs-eyebrow">09 / Security &amp; governance</p>
  <h2>Access is a boundary, not a badge</h2>
  <ul>
    <li><strong>Role checks at the API and storage layer.</strong> The interface reflects permissions, but it is not the enforcement point.</li>
    <li><strong>License and confidentiality metadata per package.</strong> Download and export are permitted only when the user's role and the source license allow it.</li>
    <li><strong>Private deployment path.</strong> Database, object storage, and services can sit under the customer's control; core use does not require a public cloud.</li>
    <li><strong>Backup and restore together.</strong> Metadata and object storage are backed up and restored as a pair, with a documented procedure.</li>
    <li><strong>Fixtures are labeled.</strong> Tests use synthetic or explicitly licensed material, including a second-country fixture. Licensed customer data stays out of the repository.</li>
  </ul>
  <h3>Managed access and recovery</h3>
  <p>Administrator and Data Manager keys bootstrap from the server environment. Viewer, importer, and reviewer profiles are records in PostgreSQL: demo keys are visible so the pilot gate can hand them out, while custom keys are stored as SHA-256 hashes and shown once at creation or rotation. Revoking a profile stops it on the next request; rotating a demo key updates the public sign-in gate without a rebuild.</p>
  <p>The <code>#/admin</code> panel is linked in the header only for those two roles. Data Managers manage profiles and run, download, and verify backups. Restoring or deleting a backup is reserved for Administrators. A restore requires typing <code>RESTORE &lt;backup id&gt;</code>, takes a fresh pre-restore backup first, verifies the archive checksum, and pauses every non-admin session until it finishes. Verification restores the archive into a scratch database and compares record counts, which catches a truncated or mismatched dump before anyone relies on it.</p>
  <p>With local object storage, original files are copied into the backup archive. With S3, the archive holds the database dump only, so an operator must take a provider snapshot or bucket copy alongside it. A failed restore deliberately leaves maintenance on; the pre-restore backup is the recovery path, and the failure is recorded in the audit trail.</p>
  <p>The panel also renders the product's change log from the repository <code>CHANGELOG.md</code>, newest first, with version, release date, build identifier, change type, commit, and the user-visible changes. The server reads the file on request, so a deployment can update its build history without rebuilding the client. Each entry is added in the same commit that bumps <code>VERSION</code>; the published table below stays a shorter client-facing summary.</p>
</section>

<section class="docs-section" id="docs-versioning" data-doc-section>
  <p class="docs-eyebrow">10 / Releases</p>
  <h2>Versioning that can be audited</h2>
  <p>The root <code>VERSION</code> file contains a plain <code>m.n.p</code> string. Every <code>feat</code>, <code>fix</code>, or <code>perf</code> commit increments the patch number. The commit subject begins with <code>v{VERSION}</code>, and an <code>Alfazen-Build</code> trailer records the UTC <code>yymmddc</code> build identifier. Documentation and maintenance commits leave the version unchanged.</p>
  <div class="docs-table-wrap">
    <table class="docs-table">
      <thead><tr><th>Version</th><th>Change</th></tr></thead>
      <tbody>
        <tr><td>0.1.0</td><td>Rust core decision, README, Apache 2.0 license, versioning baseline.</td></tr>
        <tr><td>0.1.1–0.1.4</td><td>Governed well workflow, map-led explorer, area dashboard, web UI rebuilt as a survey instrument.</td></tr>
        <tr><td>0.1.5–0.1.9</td><td>Footer consolidation, single theme control, footer fixes, color-scheme alignment with the Alfazen platform.</td></tr>
        <tr><td>0.1.10</td><td>Contour logo mark and site favicon.</td></tr>
        <tr><td>0.1.11</td><td>Automatic theme turns dark after nightfall.</td></tr>
        <tr><td>0.1.12–0.1.13</td><td>Open logo triangle; lower contour replaces the base, upper contour stacked above.</td></tr>
        <tr><td>0.1.14</td><td>Larger brand name and descriptor.</td></tr>
        <tr><td>0.1.15</td><td>Catalog regrouped into six domains and twenty-four categories.</td></tr>
        <tr><td>0.1.16</td><td>This reference page, linked from the header and the access gate.</td></tr>
        <tr><td>0.1.17</td><td>Admin panel: managed access profiles, demo-key rotation, verified backups, guarded restore, and an administrative audit trail.</td></tr>
        <tr><td>0.1.18</td><td>Backup adapter honours the configured database, so verification and restore compare the same dataset.</td></tr>
        <tr><td>0.1.19</td><td>Admin change log records every released build from the repository change log.</td></tr>
        <tr><td>0.1.20</td><td>Header tagline states the product promise: governed subsurface data, in place.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section class="docs-section" id="docs-decisions" data-doc-section>
  <p class="docs-eyebrow">11 / Decision log</p>
  <h2>What we chose, and what it costs</h2>
  <p>Each entry records context, the decision, the reason, and the trade-off. Superseding a decision means adding a new entry, not rewriting history.</p>

  <article class="decision">
    <div class="decision-head"><span class="decision-id">D-0001</span><span class="decision-tag">Accepted</span><span class="decision-tag">v0.1.0</span></div>
    <h3>Rust core and server</h3>
    <dl>
      <dt>Context</dt><dd>A desktop edition may later reuse the domain rules and interface. Python is not wanted as a runtime dependency for the core.</dd>
      <dt>Decision</dt><dd>Rust for shared domain rules and the backend API; PostgreSQL/PostGIS as system of record; S3-compatible storage for binaries; a locally bundled web client.</dd>
      <dt>Why</dt><dd>One implementation of rules across server and a possible desktop edition, with predictable deployment and no Python runtime.</dd>
      <dt>Trade-off</dt><dd>A smaller ecosystem for some geospatial tooling. Specialist tools may integrate through governed APIs when a concrete workflow needs them.</dd>
    </dl>
    <p class="docs-muted">Full record: <code>docs/decisions/0001-rust-core.md</code></p>
  </article>

  <article class="decision">
    <div class="decision-head"><span class="decision-id">D-0002</span><span class="decision-tag">Accepted</span><span class="decision-tag">v0.1.11</span></div>
    <h3>Automatic theme turns dark after nightfall</h3>
    <dl>
      <dt>Context</dt><dd>Automatic mode mirrored only the OS palette. On a machine reporting a light OS at 20:37, the workspace stayed light all evening.</dd>
      <dt>Decision</dt><dd>Automatic resolves to dark when the OS is dark <em>or</em> local time is 19:00–07:00. The rule is applied before first paint and re-checked every 30 seconds. Explicit light and dark are untouched.</dd>
      <dt>Why</dt><dd>Evening work should not require hunting for a toggle, and a local-time rule needs no network, geolocation, or sunrise table.</dd>
      <dt>Trade-off</dt><dd>Fixed hours are predictable but not solar. A high-latitude winter evening may still be light at 19:00. The constants are isolated so a solar rule can replace them later.</dd>
    </dl>
  </article>

  <article class="decision">
    <div class="decision-head"><span class="decision-id">D-0003</span><span class="decision-tag">Accepted</span><span class="decision-tag">v0.1.12–0.1.13</span></div>
    <h3>Open triangle with two stacked contours</h3>
    <dl>
      <dt>Context</dt><dd>The old mark was a closed triangle with one inner contour. It was legible but did not express the product's terrain and contour language strongly enough.</dd>
      <dt>Decision</dt><dd>Remove the base, let the lower contour span tip to tip in its place, and stack the original inner contour above it. Keep the crimson summit point. Apply the same geometry to the favicon.</dd>
      <dt>Why</dt><dd>It reads as an open “A” and as a contoured landform, preserves the earlier identity, and stays recognizable at 26 px.</dd>
      <dt>Trade-off</dt><dd>Two contours plus the point are dense at a 16 px favicon; the strokes begin to merge. Tested at 16, 32, 48, 96, and 128 px, and the silhouette remains readable.</dd>
    </dl>
  </article>

  <article class="decision">
    <div class="decision-head"><span class="decision-id">D-0004</span><span class="decision-tag">Accepted</span><span class="decision-tag">v0.1.15</span></div>
    <h3>Six catalog domains and Title Case labels</h3>
    <dl>
      <dt>Context</dt><dd>The earlier four groups mixed land records, wells, drilling, and production, and concession maps sat with documents.</dd>
      <dt>Decision</dt><dd>Use Culture &amp; Lands, Well Data, Seismic Data, Drilling &amp; Completions, Production Data, and Documents &amp; Reports; twenty-four categories; Title Case labels; a three-column ledger at wide widths.</dd>
      <dt>Why</dt><dd>Surface and land context gain their own lifecycle, drilling and production are not buried under wells, and the catalog reads as a governed ledger rather than a generic tally.</dd>
      <dt>Trade-off</dt><dd>More items than fit a short laptop viewport, so the page scrolls instead of clipping categories. Items without data still display as planned, not zero.</dd>
    </dl>
  </article>

  <article class="decision">
    <div class="decision-head"><span class="decision-id">D-0005</span><span class="decision-tag">Accepted</span><span class="decision-tag">Coverage</span></div>
    <h3>Planned is never rendered as zero</h3>
    <dl>
      <dt>Context</dt><dd>A coverage dashboard can mislead when an uncataloged category looks empty.</dd>
      <dt>Decision</dt><dd>The API returns <code>state: available | not_cataloged</code>. The interface shows a count for available items and a dash for planned items, with a legend and a cataloged summary.</dd>
      <dt>Why</dt><dd>“None exist” and “not managed yet” are different facts. Clients need to see the difference before relying on a count.</dd>
      <dt>Trade-off</dt><dd>New categories must be added to the API contract to remain explicit. The dashboard may look sparse, which is the honest state.</dd>
    </dl>
  </article>

  <article class="decision">
    <div class="decision-head"><span class="decision-id">D-0006</span><span class="decision-tag">Accepted</span><span class="decision-tag">v0.1.6</span></div>
    <h3>One theme control, three states</h3>
    <dl>
      <dt>Context</dt><dd>Theme controls had appeared in more than one place, making state ambiguous.</dd>
      <dt>Decision</dt><dd>A single slot cycles automatic, light, and dark. Glyphs cross-fade with a short rotation; the automatic flip animates once and respects reduced motion. The label and title describe the current and next state.</dd>
      <dt>Why</dt><dd>One control means one state. The cycle is discoverable through the label and keeps the header calm.</dd>
      <dt>Trade-off</dt><dd>A three-state cycle asks the user to read the label once. Explicit control is preserved, and the state persists in local storage.</dd>
    </dl>
  </article>

  <article class="decision">
    <div class="decision-head"><span class="decision-id">D-0007</span><span class="decision-tag">Accepted</span><span class="decision-tag">v0.1.16</span></div>
    <h3>Reference documentation lives with the product</h3>
    <dl>
      <dt>Context</dt><dd>Decisions were spread across the PRD, commit messages, decision records, and conversation. A client could not read the reasoning without repository access.</dd>
      <dt>Decision</dt><dd>Add a public <code>#/docs</code> page, linked in the header before the theme control and from the access gate. It records invariants, architecture, the catalog, interface choices, releases, decisions, references, and glossary.</dd>
      <dt>Why</dt><dd>The reasoning stays beside the interface it explains, and clients can audit it before a pilot.</dd>
      <dt>Trade-off</dt><dd>The page must be maintained. Material decisions require a new card and a release-history row; stale claims are treated as defects.</dd>
    </dl>
  </article>

  <article class="decision">
    <div class="decision-head"><span class="decision-id">D-0008</span><span class="decision-tag">Accepted</span><span class="decision-tag">Coordinates</span></div>
    <h3>EPSG:4326 is a display CRS, not a source assumption</h3>
    <dl>
      <dt>Context</dt><dd>The map needs one coordinate space to render wells consistently.</dd>
      <dt>Decision</dt><dd>Map display uses EPSG:4326. Each record retains its source CRS, source coordinates, and the operation used to derive the display point.</dd>
      <dt>Why</dt><dd>A single display space keeps the map usable without weakening source truth or silently redefining the data.</dd>
      <dt>Trade-off</dt><dd>Every derived point needs provenance, and a missing operation is a review finding rather than a default.</dd>
    </dl>
  </article>

  <article class="decision">
    <div class="decision-head"><span class="decision-id">D-0009</span><span class="decision-tag">Accepted</span><span class="decision-tag">v0.1.17</span></div>
    <h3>Administration is a role, and recovery is a ceremony</h3>
    <dl>
      <dt>Context</dt><dd>Demo keys lived only in server configuration, access profiles could not be managed in the product, and a database restore had no guided path. PostgreSQL is an enterprise system of record, but recovery steps should not be improvised during an incident.</dd>
      <dt>Decision</dt><dd>Add an <code>#/admin</code> panel for Administrators and Data Managers. Environment keys bootstrap the two operational roles; viewer, importer, and reviewer profiles live in PostgreSQL, with custom keys stored as SHA-256 hashes and shown once. A backup is a custom-format dump plus a manifest with checksum, record counts, and object summary; local originals are copied into the archive. Restore requires an Administrator, a typed confirmation, a fresh pre-restore backup, checksum verification, and maintenance mode that pauses non-admin sessions.</dd>
      <dt>Why</dt><dd>Access changes and recovery become visible, auditable operations rather than shell history. Data Managers can run routine work; only an Administrator can replace the database.</dd>
      <dt>Trade-off</dt><dd>Custom keys are hashed without a salt because they are machine-generated with 256 bits of entropy; losing one means rotating it. S3 deployments must pair the database archive with a provider snapshot. A failed restore leaves maintenance on deliberately so the pre-restore backup stays the recovery path.</dd>
    </dl>
  </article>

  <article class="decision">
    <div class="decision-head"><span class="decision-id">D-0010</span><span class="decision-tag">Accepted</span><span class="decision-tag">v0.1.19</span></div>
    <h3>Build history is a product artifact</h3>
    <dl>
      <dt>Context</dt><dd>Release history lived in git and in the public docs table. The Administration panel could show the current version but not how the deployment got there, so an operator reconstructing a build had to leave the product.</dd>
      <dt>Decision</dt><dd>Keep a repository <code>CHANGELOG.md</code> with one section per release and serve it as structured entries in the Administration panel. The server reads the file on each request and accepts an <code>ATLASIO_CHANGELOG</code> override. Entries carry version, date, build identifier, change type, commit reference, and user-visible changes; the newest release is marked.</dd>
      <dt>Why</dt><dd>The build history travels with the deployment, stays readable in code review, and can be corrected without a server rebuild or client release.</dd>
      <dt>Trade-off</dt><dd>A second release record beside the public docs table. The file must be updated in the same commit as the version bump, or the panel goes stale; the docs table stays the short client-facing summary while the change log is the detailed build record.</dd>
    </dl>
  </article>
</section>

<section class="docs-section" id="docs-references" data-doc-section>
  <p class="docs-eyebrow">12 / References</p>
  <h2>Standards and prior art</h2>
  <p>These sources inform vocabulary and expectations. They are not Release 1 dependencies or endorsements; formats are adopted only when a concrete workflow needs them.</p>
  <ul class="docs-refs">
    <li><b><a href="https://ppdm.org/" target="_blank" rel="noreferrer">PPDM Association</a></b><span>Petroleum data model and data-management practice. Informs well, land, facility, and spatial vocabulary.</span></li>
    <li><b><a href="https://osduforum.org/" target="_blank" rel="noreferrer">OSDU Forum</a></b><span>Open subsurface data platform standards. A reference for future interoperability, not a Release 1 schema commitment.</span></li>
    <li><b><a href="https://energistics.org/" target="_blank" rel="noreferrer">Energistics</a></b><span>WITSML, RESQML, and PRODML standards for drilling, reservoir, and production exchange.</span></li>
    <li><b><a href="https://epsg.org/" target="_blank" rel="noreferrer">EPSG Registry</a></b><span>Authoritative CRS identifiers and coordinate-operation definitions.</span></li>
    <li><b><a href="https://proj.org/" target="_blank" rel="noreferrer">PROJ</a></b><span>Coordinate transformation engine; operations and grids must be pinned and recorded.</span></li>
    <li><b><a href="https://www.cwls.org/" target="_blank" rel="noreferrer">CWLS</a></b><span>LAS well-log format stewardship.</span></li>
    <li><b><a href="https://seg.org/" target="_blank" rel="noreferrer">SEG</a></b><span>SEG-Y seismic data standard.</span></li>
    <li><b><a href="https://postgis.net/" target="_blank" rel="noreferrer">PostGIS</a></b><span>Spatial types, indexes, and queries in PostgreSQL.</span></li>
    <li><b><a href="https://maplibre.org/" target="_blank" rel="noreferrer">MapLibre GL JS</a></b><span>Open map rendering used by the web client.</span></li>
    <li><b><a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a></b><span>Public-domain basemap geometry bundled for offline use.</span></li>
    <li><b><a href="https://www.slb.com/" target="_blank" rel="noreferrer">SLB Studio</a></b><span>Reference product for shared subsurface project data.</span></li>
    <li><b><a href="https://www.petrosysgroup.com/" target="_blank" rel="noreferrer">Petrosys</a></b><span>Reference product for mapping and subsurface data integration.</span></li>
    <li><b><a href="https://www.halliburton.com/" target="_blank" rel="noreferrer">Halliburton OpenWorks</a></b><span>Reference product for exploration and production data management.</span></li>
  </ul>
</section>

<section class="docs-section" id="docs-glossary" data-doc-section>
  <p class="docs-eyebrow">13 / Glossary</p>
  <h2>Terms used consistently</h2>
  <dl class="docs-glossary">
    <div><dt>Asset</dt><dd>A named area such as a basin, concession, block, field, or prospect.</dd></div>
    <div><dt>Well / wellbore</dt><dd>A well is the stable identity; a wellbore is a physical borehole. One well may have several.</dd></div>
    <div><dt>Dataset</dt><dd>A logical collection such as a log, tops set, survey, or interpretation.</dd></div>
    <div><dt>Dataset version</dt><dd>An immutable published snapshot with source, review, and checksum.</dd></div>
    <div><dt>File asset</dt><dd>An original or derived binary referenced by a record, with size, type, and SHA-256.</dd></div>
    <div><dt>Provenance</dt><dd>The origin, chain of custody, transformations, and review history of a record.</dd></div>
    <div><dt>CRS</dt><dd>Coordinate reference system: the horizontal definition used to interpret X/Y.</dd></div>
    <div><dt>Datum</dt><dd>The reference surface and parameters behind a CRS or vertical reference.</dd></div>
    <div><dt>Vertical datum</dt><dd>The reference for elevations or depths; separate from the horizontal CRS.</dd></div>
    <div><dt>KB / DF / GL</dt><dd>Kelly bushing, derrick floor, and ground level: distinct elevation references.</dd></div>
    <div><dt>MD / TVD</dt><dd>Measured depth along the wellbore versus true vertical depth; never interchangeable.</dd></div>
    <div><dt>Culture data</dt><dd>Human-made surface context such as roads, pipelines, facilities, boundaries, and settlements.</dd></div>
    <div><dt>Concession</dt><dd>A licensed area with boundaries, terms, and an issuing authority.</dd></div>
    <div><dt>Cataloged / planned</dt><dd>Cataloged has managed records and a count; planned is acknowledged but not yet managed.</dd></div>
  </dl>
</section>

<section class="docs-section" id="docs-open" data-doc-section>
  <p class="docs-eyebrow">14 / Open questions</p>
  <h2>What the pilot must answer</h2>
  <p>These are deliberately unresolved until pilot material and operator constraints are known. They change interfaces, not the invariants above.</p>
  <ul class="docs-open">
    <li><b>Datasets and control points.</b><span>Which licensed packages and geomatics control points define acceptance?</span></li>
    <li><b>Formats.</b><span>Which files need parsing in Release 1, and which are catalog-only?</span></li>
    <li><b>Deployment.</b><span>Which environment, identity provider, and data-residency rules will the first operator impose?</span></li>
    <li><b>CRS definitions.</b><span>Which exact CRS, transformation grids, and vertical references occur in the pilot?</span></li>
    <li><b>Export priority.</b><span>Which export or integration target matters first to the pilot user?</span></li>
  </ul>
</section>

<section class="docs-section" id="docs-maintenance" data-doc-section>
  <p class="docs-eyebrow">15 / Maintenance</p>
  <h2>Keeping this page honest</h2>
  <ul>
    <li><strong>Material decision → new card.</strong> Record the context, decision, reason, and trade-off. Supersede; do not rewrite history.</li>
    <li><strong>Feature or fix → release row.</strong> Add the version and a one-line description when behavior changes.</li>
    <li><strong>Reference → link and context.</strong> Say what the source informs; do not imply a dependency or endorsement.</li>
    <li><strong>Client review → plain language.</strong> Explain consequences, not internal shorthand. Stale or promotional claims are defects.</li>
  </ul>
</section>
`;

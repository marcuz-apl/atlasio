export const USER_DOCS_HTML = `
<section class="docs-section" id="user-getting-in" data-doc-section>
  <p class="docs-eyebrow">01 / Getting in</p>
  <h2>Enter the workspace</h2>
  <p>The sign-in gate offers three ways in. A <strong>demo role</strong> opens a sandbox viewer, importer, or reviewer session using the keys <code>viewer-demo</code>, <code>importer-demo</code>, and <code>reviewer-demo</code>. An <strong>access key</strong> connects with a managed key from your team. An <strong>Administrator or Data Manager</strong> signs in with a username and password.</p>
  <p>Staff accounts must choose their own password at first sign-in, and privileged changes stay blocked until they do. If your deployment requires multi-factor authentication, the account also enrols an authenticator app before it can administer anything.</p>
  <ul>
    <li><strong>Account menu.</strong> Click the account chip in the top-right for User profile, Change password, Set up MFA, and Log out. The MFA entry becomes Manage MFA once an authenticator is on; it opens its own dialog.</li>
    <li><strong>Theme.</strong> One control cycles automatic, light, and dark. Automatic follows the operating system and turns dark after nightfall.</li>
    <li><strong>Docs.</strong> The Docs link in the header returns to this guide at any time.</li>
  </ul>
</section>

<section class="docs-section" id="user-roles" data-doc-section>
  <p class="docs-eyebrow">02 / Roles</p>
  <h2>What each role can see and do</h2>
  <p>Every API request is scoped to the role behind it. The interface reflects those limits, but the server is the enforcement point.</p>
  <div class="docs-table-wrap">
    <table class="docs-table">
      <thead><tr><th>Role</th><th>Can see</th><th>Can do</th></tr></thead>
      <tbody>
        <tr><td>Viewer</td><td>Approved records and public originals</td><td>Search, inspect versions and provenance, download where the license allows</td></tr>
        <tr><td>Importer</td><td>All catalog records</td><td>Stage packages, correct metadata, resolve QC findings, submit for review</td></tr>
        <tr><td>Reviewer</td><td>All catalog records</td><td>Review submitted packages, resolve well identity, publish or reject</td></tr>
        <tr><td>Data Manager</td><td>Administration</td><td>Manage access profiles, create and verify backups, read the audit trail</td></tr>
        <tr><td>Administrator</td><td>Administration</td><td>Everything a Data Manager can do, plus delete and restore backups</td></tr>
      </tbody>
    </table>
  </div>
  <p class="docs-muted">Restricted records are hidden from viewers rather than shown as empty. Confidentiality and license metadata travel with each package.</p>
</section>

<section class="docs-section" id="user-dashboard" data-doc-section>
  <p class="docs-eyebrow">03 / Dashboard</p>
  <h2>Start from an area of interest</h2>
  <p>The dashboard pairs coverage with a map. Choose <strong>Global overview</strong>, a country, or your current location; the selection stays visible so you always know the scope of the counts.</p>
  <ol class="docs-steps">
    <li>Set the <strong>area of interest</strong> and press Locate if you want the browser to use your position.</li>
    <li>Read the <strong>coverage ledger</strong> by domain. A number means the category is cataloged for this role; a dash means it is planned or not yet represented.</li>
    <li>Use the <strong>Published wells</strong> map to see verified positions. Select a well to inspect its record.</li>
  </ol>
  <p>Coverage counts describe records this role may see. Planned categories are never shown as zero, so a dash and a zero mean different things.</p>
  <p><strong>Wells</strong> counts current wells. <strong>Well Versions</strong> counts every published version, including earlier corrections, so a reissued well raises that number without adding another well. <strong>Source Files</strong> counts the original uploads preserved behind published packages.</p>
</section>

<section class="docs-section" id="user-explore" data-doc-section>
  <p class="docs-eyebrow">04 / Explore</p>
  <h2>Inspect a well and its evidence</h2>
  <p>The workspace map is a discovery and inspection surface. Pan, zoom, and select a well; the inspector opens beside the map with the record behind that position.</p>
  <ul>
    <li><strong>Identity.</strong> Name, aliases, external ID, and the stable Atlasio identifier stay separate so sources can disagree without overwriting each other.</li>
    <li><strong>Coordinates.</strong> Source X/Y and source CRS are preserved. The display position and the recorded transformation are shown beside them.</li>
    <li><strong>Versions.</strong> The current version is highlighted; older published versions remain inspectable. Corrections create a new version instead of rewriting history.</li>
    <li><strong>Original file.</strong> The source file name, size, SHA-256 checksum, license, and confidentiality are attached to the record.</li>
  </ul>
  <p>Download is offered only when the package is published, the source license permits it, and your role may see its confidentiality class. If the button is absent, the record is inspectable but not downloadable.</p>
</section>

<section class="docs-section" id="user-search" data-doc-section>
  <p class="docs-eyebrow">05 / Search &amp; records</p>
  <h2>Find a record by any name it has used</h2>
  <p>Search matches the current name, aliases, and external identifiers, so a well can be found by the label on an old report. Results respect the same confidentiality rules as the map.</p>
  <ul>
    <li>Use the <strong>Records</strong> tab for a sortable list of cataloged versions.</li>
    <li>Open a row to inspect the full version history and the original file.</li>
    <li>Keep the source and license in view when you reuse a number or coordinate in another system.</li>
  </ul>
</section>

<section class="docs-section" id="user-ingest" data-doc-section>
  <p class="docs-eyebrow">06 / Ingest</p>
  <h2>Stage, correct, and submit a package</h2>
  <p>Importers turn a source package into a reviewed record. The original file is stored unchanged; its checksum proves the bytes survived.</p>
  <ol class="docs-steps">
    <li><strong>Stage the package.</strong> Provide the header manifest and the original file. The upload limit in this slice is 5 MiB.</li>
    <li><strong>Read the QC findings.</strong> Blocking errors must be resolved; warnings need a judgement, not a dismissal.</li>
    <li><strong>Correct metadata</strong> on the staged record. Every correction updates the QC result and is recorded in the audit trail.</li>
    <li><strong>Submit for review.</strong> A staged package is editable; a submitted package is not.</li>
  </ol>
  <p>Duplicate candidates are surfaced for a human decision. Atlasio does not merge wells automatically.</p>
</section>

<section class="docs-section" id="user-review" data-doc-section>
  <p class="docs-eyebrow">07 / Review</p>
  <h2>Resolve identity, then publish</h2>
  <p>Reviewers are the gate between a staged package and the catalog. The queue shows submitted packages with their metadata, QC result, and source file.</p>
  <ol class="docs-steps">
    <li>Check the manifest, the QC findings, and the original file checksum.</li>
    <li>Resolve identity as a <strong>new well</strong> or one of the proposed duplicate candidates.</li>
    <li><strong>Approve</strong> to publish an immutable version, or <strong>reject</strong> with a reason the importer can act on.</li>
  </ol>
  <p>Publishing takes effect immediately in search and on the map. A later correction becomes a new version; the published version keeps its original evidence.</p>
</section>

<section class="docs-section" id="user-account" data-doc-section>
  <p class="docs-eyebrow">08 / Account &amp; help</p>
  <h2>Keep your account and data trustworthy</h2>
  <ul>
    <li><strong>Password and MFA.</strong> Use the account menu. Changing a password or disabling MFA signs out your other sessions. If you lose both the authenticator and the recovery codes, a server operator can run the <code>reset-mfa</code> command for your username to clear MFA without changing your password.</li>
    <li><strong>Session lifetime.</strong> Staff sessions last twelve hours. Repeated failed sign-ins lock the account for five minutes.</li>
    <li><strong>Ask for access.</strong> Administrators and Data Managers manage access keys and roles. Password or MFA recovery needs a server operator; there is no self-service bypass.</li>
    <li><strong>Check the source.</strong> Atlasio keeps provenance visible, but the license and confidentiality of a package still govern how you may use it.</li>
  </ul>
  <div class="docs-note"><strong>Scope.</strong> This guide describes the Release 1 local demo. Fixtures are synthetic; no licensed customer data is stored in the repository.</div>
</section>
`;

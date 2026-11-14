use atlasio_domain::{crs, qc_findings, source_position, Manifest};
use serde_json::json;

fn base() -> Manifest {
    serde_json::from_value(json!({
        "name": "SYNTHETIC HEADER WELL",
        "source": "SYNTHETIC PACKAGE",
        "license": "SYNTHETIC TEST USE",
        "source_crs": "EPSG:23032",
        "x": 362699.019998,
        "y": 5763046.671862
    }))
    .expect("base manifest parses")
}

fn with(extra: serde_json::Value) -> Manifest {
    let mut value = json!({
        "name": "SYNTHETIC HEADER WELL",
        "source": "SYNTHETIC PACKAGE",
        "license": "SYNTHETIC TEST USE",
        "source_crs": "EPSG:23032",
        "x": 362699.019998,
        "y": 5763046.671862
    });
    let object = value.as_object_mut().expect("object");
    for (key, item) in extra.as_object().expect("extra object") {
        object.insert(key.clone(), item.clone());
    }
    serde_json::from_value(value).expect("manifest parses")
}

fn codes(manifest: &Manifest) -> Vec<(String, String)> {
    qc_findings(manifest, &[])
        .iter()
        .map(|finding| (finding.code.clone(), finding.severity.clone()))
        .collect()
}

fn has(manifest: &Manifest, code: &str, severity: &str) -> bool {
    codes(manifest)
        .iter()
        .any(|(found, level)| found == code && level == severity)
}

#[test]
fn parses_industry_header_columns() {
    let manifest = with(json!({
        "folder": "SYNTHETIC FOLDER",
        "well_symbol": "OIL",
        "drilling_structure": "SYNTHETIC STRUCTURE",
        "operator": "SYNTHETIC OPERATOR",
        "datum_name": "KB",
        "datum_value": 25.5,
        "datum_unit": "m",
        "td_md": 3500.0,
        "td_unit": "m",
        "bottom_hole_x": 362799.0,
        "bottom_hole_y": 5763146.0,
        "source_lat": 51.9992313,
        "source_lon": 6.9987599,
        "source_geo_crs": "EPSG:4230",
        "spud_date": "1990-05-13",
        "completion_date": "1990-08-02"
    }));
    assert_eq!(manifest.folder.as_deref(), Some("SYNTHETIC FOLDER"));
    assert_eq!(manifest.well_symbol.as_deref(), Some("OIL"));
    assert_eq!(manifest.drilling_structure.as_deref(), Some("SYNTHETIC STRUCTURE"));
    assert_eq!(manifest.operator.as_deref(), Some("SYNTHETIC OPERATOR"));
    assert_eq!(manifest.datum_name.as_deref(), Some("KB"));
    assert_eq!(manifest.datum_value, Some(25.5));
    assert_eq!(manifest.datum_unit.as_deref(), Some("m"));
    assert_eq!(manifest.td_md, Some(3500.0));
    assert_eq!(manifest.td_unit.as_deref(), Some("m"));
    assert_eq!(manifest.bottom_hole_x, Some(362799.0));
    assert_eq!(manifest.bottom_hole_y, Some(5763146.0));
    assert_eq!(manifest.source_lat, Some(51.9992313));
    assert_eq!(manifest.source_lon, Some(6.9987599));
    assert_eq!(manifest.source_geo_crs.as_deref(), Some("EPSG:4230"));
    assert_eq!(manifest.spud_date.as_deref(), Some("1990-05-13"));
    assert_eq!(manifest.completion_date.as_deref(), Some("1990-08-02"));
}

#[test]
fn legacy_manifest_defaults_new_columns_to_none() {
    let manifest = base();
    assert!(manifest.folder.is_none());
    assert!(manifest.well_symbol.is_none());
    assert!(manifest.drilling_structure.is_none());
    assert!(manifest.operator.is_none());
    assert!(manifest.datum_name.is_none());
    assert!(manifest.datum_value.is_none());
    assert!(manifest.datum_unit.is_none());
    assert!(manifest.td_md.is_none());
    assert!(manifest.td_unit.is_none());
    assert!(manifest.bottom_hole_x.is_none());
    assert!(manifest.bottom_hole_y.is_none());
    assert!(manifest.source_lat.is_none());
    assert!(manifest.source_lon.is_none());
    assert!(manifest.source_geo_crs.is_none());
    assert!(manifest.spud_date.is_none());
    assert!(manifest.completion_date.is_none());
}

#[test]
fn normalize_crs_accepts_codes_and_aliases() {
    assert_eq!(crs::normalize("EPSG:23032"), "23032");
    assert_eq!(crs::normalize("23032"), "23032");
    assert_eq!(crs::normalize("ED50 / UTM zone 32N"), "23032");
    assert_eq!(crs::normalize("ED50 / UTM zone 31N"), "23031");
    assert_eq!(crs::normalize("ED50"), "4230");
    assert_eq!(crs::normalize("WGS 84"), "4326");
}

#[test]
fn normalize_crs_leaves_unregistered_names_unchanged() {
    assert_eq!(crs::normalize("NAD27 / Texas South"), "NAD27 / Texas South");
}

#[test]
fn source_position_prefers_projected_pair() {
    let manifest = with(json!({
        "source_lat": 51.9992313,
        "source_lon": 6.9987599,
        "source_geo_crs": "EPSG:4230"
    }));
    let position = source_position(&manifest).expect("position resolves");
    assert_eq!(position.crs, "23032");
    assert_eq!(position.x, 362699.019998);
    assert_eq!(position.y, 5763046.671862);
}

#[test]
fn source_position_falls_back_to_geographic_pair() {
    let manifest = with(json!({
        "source_crs": null,
        "x": null,
        "y": null,
        "source_lat": 51.9992313,
        "source_lon": 6.9987599,
        "source_geo_crs": "EPSG:4230"
    }));
    let position = source_position(&manifest).expect("geographic position resolves");
    assert_eq!(position.crs, "4230");
    assert_eq!(position.x, 6.9987599);
    assert_eq!(position.y, 51.9992313);
}

#[test]
fn source_position_none_without_any_pair() {
    let manifest = with(json!({ "x": null, "y": null }));
    assert!(source_position(&manifest).is_none());
}

#[test]
fn qc_accepts_geographic_only_position() {
    let manifest = with(json!({
        "source_crs": null,
        "x": null,
        "y": null,
        "source_lat": 51.9992313,
        "source_lon": 6.9987599,
        "source_geo_crs": "EPSG:4230"
    }));
    assert!(
        !codes(&manifest).iter().any(|(_, severity)| severity == "error"),
        "geographic-only header must not raise blocking findings: {:?}",
        codes(&manifest)
    );
}

#[test]
fn qc_warns_when_datum_value_has_no_unit() {
    let manifest = with(json!({ "datum_name": "KB", "datum_value": 25.5 }));
    assert!(has(&manifest, "missing_datum_unit", "warning"));
}

#[test]
fn qc_warns_when_td_has_no_unit() {
    let manifest = with(json!({ "td_md": 3500.0 }));
    assert!(has(&manifest, "missing_td_unit", "warning"));
}

#[test]
fn qc_warns_on_unknown_datum_name() {
    let manifest = with(json!({ "datum_name": "MSL", "datum_value": 25.5, "datum_unit": "m" }));
    assert!(has(&manifest, "unknown_datum_name", "warning"));
}

#[test]
fn qc_accepts_known_datum_names_case_insensitively() {
    let manifest = with(json!({ "datum_name": "kb", "datum_value": 25.5, "datum_unit": "m" }));
    assert!(!has(&manifest, "unknown_datum_name", "warning"));
}

#[test]
fn qc_warns_when_latlon_has_no_geographic_crs() {
    let manifest = with(json!({ "source_lat": 51.9992313, "source_lon": 6.9987599 }));
    assert!(has(&manifest, "missing_source_geo_crs", "warning"));
}

#[test]
fn qc_warns_on_position_mismatch() {
    let manifest = with(json!({
        "source_lat": 52.5,
        "source_lon": 7.5,
        "source_geo_crs": "EPSG:4230"
    }));
    assert!(has(&manifest, "position_mismatch", "warning"));
}

#[test]
fn qc_no_mismatch_warning_for_consistent_pairs() {
    let manifest = with(json!({
        "source_lat": 51.9992313,
        "source_lon": 6.9987599,
        "source_geo_crs": "EPSG:4230"
    }));
    assert!(!has(&manifest, "position_mismatch", "warning"));
}

#[test]
fn qc_warns_on_non_iso_spud_date() {
    let manifest = with(json!({ "spud_date": "13/05/1990" }));
    assert!(has(&manifest, "invalid_spud_date", "warning"));
}

#[test]
fn qc_accepts_alias_crs_without_unverified_error() {
    let manifest = with(json!({ "source_crs": "ED50 / UTM zone 32N" }));
    assert!(!has(&manifest, "unverified_crs", "error"));
}
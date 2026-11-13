use atlasio_domain::{Manifest, crs, qc_findings};
use serde::Deserialize;

#[derive(Deserialize)]
struct Control {
    source_crs: String,
    x: f64,
    y: f64,
    expected_lon: f64,
    expected_lat: f64,
}

#[derive(Deserialize)]
struct Fixture {
    operation: String,
    accuracy_m: f64,
    controls: Vec<Control>,
}

fn fixture() -> Fixture {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/crs-control-points.json"
    );
    let text = std::fs::read_to_string(path).expect("control-point fixture is present");
    serde_json::from_str(&text).expect("control-point fixture parses")
}

#[test]
fn ed50_transforms_match_proj_controls() {
    let data = fixture();
    assert_eq!(data.operation, "EPSG:1311");
    assert_eq!(data.accuracy_m, 1.0);
    assert!(data.controls.len() >= 20, "expected a spread of controls");
    for control in &data.controls {
        let result = crs::transform(&control.source_crs, control.x, control.y)
            .unwrap_or_else(|error| panic!("{}: {error}", control.source_crs));
        let dlon = (result.longitude - control.expected_lon).abs();
        let dlat = (result.latitude - control.expected_lat).abs();
        // ~1 cm tolerance: proves the implementation reproduces PROJ, not a
        // round-trip of itself.
        assert!(
            dlon < 1e-7 && dlat < 1e-7,
            "{} ({}, {}) -> ({}, {}) expected ({}, {}) dlon={dlon:e} dlat={dlat:e}",
            control.source_crs,
            control.x,
            control.y,
            result.longitude,
            result.latitude,
            control.expected_lon,
            control.expected_lat,
        );
        assert_eq!(result.operation, "EPSG:1311");
        assert_eq!(result.accuracy_m, 1.0);
    }
}

#[test]
fn wgs84_is_identity() {
    let result = crs::transform("EPSG:4326", 3.5, 56.5).unwrap();
    assert_eq!(result.longitude, 3.5);
    assert_eq!(result.latitude, 56.5);
    assert_eq!(result.operation, "identity:EPSG:4326");
    assert_eq!(result.accuracy_m, 0.0);
}

#[test]
fn unsupported_crs_is_rejected() {
    assert!(!crs::is_supported("EPSG:28992"));
    assert!(matches!(
        crs::transform("EPSG:28992", 100_000.0, 400_000.0),
        Err(crs::CrsError::Unsupported(_))
    ));
}

#[test]
fn out_of_area_is_rejected() {
    assert!(matches!(
        crs::transform("EPSG:4230", 100.0, 0.0),
        Err(crs::CrsError::OutOfArea(_))
    ));
    // North of 62N needs a different operation; do not transform it with 1311.
    assert!(matches!(
        crs::transform("EPSG:4230", 5.0, 70.0),
        Err(crs::CrsError::OutOfArea(_))
    ));
}

#[test]
fn invalid_coordinates_are_rejected() {
    assert!(matches!(
        crs::transform("EPSG:4326", 200.0, 55.0),
        Err(crs::CrsError::InvalidCoordinates(_))
    ));
    assert!(matches!(
        crs::transform("EPSG:4230", f64::NAN, 55.0),
        Err(crs::CrsError::InvalidCoordinates(_))
    ));
}

fn ed50_manifest() -> Manifest {
    Manifest {
        name: Some("SYNTHETIC ED50 WELL".into()),
        aliases: vec![],
        external_id: Some("SYNTHETIC-ED50-1".into()),
        source: Some("SYNTHETIC ED50 PACKAGE".into()),
        license: Some("Synthetic fixture for unrestricted testing".into()),
        confidentiality: Some("public".into()),
        download_allowed: true,
        source_crs: Some("EPSG:23031".into()),
        x: Some(500_000.0),
        y: Some(6_206_216.606_592),
    }
}

#[test]
fn qc_accepts_verified_ed50() {
    let findings = qc_findings(&ed50_manifest(), &[]);
    assert!(
        !findings.iter().any(|finding| finding.severity == "error"),
        "unexpected errors: {findings:?}"
    );
}

#[test]
fn qc_blocks_unverified_crs() {
    let mut manifest = ed50_manifest();
    manifest.source_crs = Some("EPSG:28992".into());
    manifest.x = Some(100_000.0);
    manifest.y = Some(400_000.0);
    assert!(
        qc_findings(&manifest, &[])
            .iter()
            .any(|finding| finding.code == "unverified_crs" && finding.severity == "error")
    );
}

#[test]
fn qc_blocks_missing_crs() {
    let mut manifest = ed50_manifest();
    manifest.source_crs = None;
    assert!(
        qc_findings(&manifest, &[])
            .iter()
            .any(|finding| finding.code == "missing_crs")
    );
}

#[test]
fn qc_flags_out_of_area_ed50() {
    let mut manifest = ed50_manifest();
    manifest.source_crs = Some("EPSG:4230".into());
    manifest.x = Some(100.0);
    manifest.y = Some(0.0);
    assert!(
        qc_findings(&manifest, &[])
            .iter()
            .any(|finding| finding.code == "out_of_range_coordinates"
                && finding.severity == "error")
    );
}
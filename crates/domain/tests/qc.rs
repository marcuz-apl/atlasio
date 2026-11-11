use atlasio_domain::{Candidate, Manifest, next_version, qc_findings};
use uuid::Uuid;

fn manifest() -> Manifest {
    Manifest {
        name: Some("SYNTHETIC WELL A".into()),
        aliases: vec!["SYNTHETIC ALT A".into()],
        external_id: Some("SYNTHETIC-001".into()),
        source: Some("SYNTHETIC PACKAGE".into()),
        license: Some("SYNTHETIC TEST USE".into()),
        confidentiality: Some("public-test".into()),
        download_allowed: true,
        source_crs: Some("EPSG:4326".into()),
        x: Some(10.0),
        y: Some(20.0),
    }
}

#[test]
fn missing_crs_is_blocking() {
    let mut item = manifest();
    item.source_crs = None;
    assert!(
        qc_findings(&item, &[])
            .iter()
            .any(|finding| finding.code == "missing_crs" && finding.severity == "error")
    );
}

#[test]
fn alternate_name_is_a_duplicate_candidate() {
    let candidate = Candidate {
        well_id: Uuid::new_v4(),
        name: "OTHER NAME".into(),
        aliases: vec!["SYNTHETIC ALT A".into()],
        external_id: None,
    };
    assert!(
        qc_findings(&manifest(), &[candidate])
            .iter()
            .any(|finding| finding.code == "possible_duplicate")
    );
}

#[test]
fn published_version_number_advances() {
    assert_eq!(next_version(&[]), 1);
    assert_eq!(next_version(&[1, 2]), 3);
}

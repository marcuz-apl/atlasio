pub mod crs;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Manifest {
    pub name: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub external_id: Option<String>,
    pub source: Option<String>,
    pub license: Option<String>,
    pub confidentiality: Option<String>,
    #[serde(default)]
    pub download_allowed: bool,
    pub source_crs: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct Candidate {
    pub well_id: Uuid,
    pub name: String,
    pub aliases: Vec<String>,
    pub external_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Finding {
    pub code: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub well_id: Option<Uuid>,
}

impl Finding {
    fn new(code: &str, severity: &str, message: &str, well_id: Option<Uuid>) -> Self {
        Self {
            code: code.into(),
            severity: severity.into(),
            message: message.into(),
            well_id,
        }
    }
}

fn blank(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(|text| text.trim().is_empty())
}

pub fn qc_findings(manifest: &Manifest, candidates: &[Candidate]) -> Vec<Finding> {
    let mut findings = Vec::new();
    if blank(&manifest.name) {
        findings.push(Finding::new(
            "missing_name",
            "error",
            "Well name is required.",
            None,
        ));
    }
    if blank(&manifest.source) {
        findings.push(Finding::new(
            "missing_source",
            "error",
            "Source organization or package is required.",
            None,
        ));
    }
    if blank(&manifest.license) {
        findings.push(Finding::new(
            "missing_license",
            "error",
            "Source license or permitted-use statement is required.",
            None,
        ));
    }
    match manifest.source_crs.as_deref() {
        None | Some("") => findings.push(Finding::new(
            "missing_crs",
            "error",
            "Source CRS must be identified; no default is assumed.",
            None,
        )),
        Some(source_crs) if crs::is_supported(source_crs) => {}
        Some(source_crs) => findings.push(Finding::new(
            "unverified_crs",
            "error",
            &format!(
                "No verified transformation to EPSG:4326 is registered for {source_crs}."
            ),
            None,
        )),
    }
    match (manifest.x, manifest.y) {
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => {
            // One code path validates the position: the same transformation used
            // at publication checks the numeric domain and the verified area.
            if let Some(source_crs) = manifest.source_crs.as_deref() {
                if crs::is_supported(source_crs) {
                    if let Err(error) = crs::transform(source_crs, x, y) {
                        findings.push(Finding::new(
                            "out_of_range_coordinates",
                            "error",
                            &error.to_string(),
                            None,
                        ));
                    }
                }
            }
        }
        _ => findings.push(Finding::new(
            "invalid_coordinates",
            "error",
            "Numeric source x and y are required.",
            None,
        )),
    }

    let names: Vec<String> = manifest
        .name
        .iter()
        .chain(manifest.aliases.iter())
        .map(|name| name.trim().to_lowercase())
        .collect();
    let external = manifest
        .external_id
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    for candidate in candidates {
        let name_match = std::iter::once(&candidate.name)
            .chain(candidate.aliases.iter())
            .any(|name| names.contains(&name.trim().to_lowercase()));
        let id_match = !external.is_empty()
            && candidate
                .external_id
                .as_deref()
                .is_some_and(|id| id.trim().to_lowercase() == external);
        if name_match || id_match {
            findings.push(Finding::new("possible_duplicate", "warning", "A published well may represent the same identity; reviewer resolution is required.", Some(candidate.well_id)));
        }
    }
    findings
}

pub fn next_version(versions: &[i32]) -> i32 {
    versions.iter().copied().max().unwrap_or(0) + 1
}

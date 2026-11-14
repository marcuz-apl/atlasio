pub mod condition;
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
    pub folder: Option<String>,
    pub well_symbol: Option<String>,
    pub drilling_structure: Option<String>,
    pub operator: Option<String>,
    pub datum_name: Option<String>,
    pub datum_value: Option<f64>,
    pub datum_unit: Option<String>,
    pub td_md: Option<f64>,
    pub td_unit: Option<String>,
    pub bottom_hole_x: Option<f64>,
    pub bottom_hole_y: Option<f64>,
    pub source_lat: Option<f64>,
    pub source_lon: Option<f64>,
    pub source_geo_crs: Option<String>,
    pub spud_date: Option<String>,
    pub completion_date: Option<String>,
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

/// A usable source position: projected x/y with its CRS, or geographic
/// longitude/latitude with its own CRS. Source values are never mutated.
#[derive(Clone, Debug, PartialEq)]
pub struct SourcePosition {
    pub crs: String,
    pub x: f64,
    pub y: f64,
}

/// Resolve the position a header actually provides. The projected surface pair
/// is primary when present; a geographic-only header falls back to lat/lon with
/// its declared geographic CRS. No CRS is ever assumed.
pub fn source_position(manifest: &Manifest) -> Option<SourcePosition> {
    if let (Some(x), Some(y)) = (manifest.x, manifest.y) {
        if x.is_finite() && y.is_finite() {
            if let Some(crs) = manifest
                .source_crs
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
            {
                return Some(SourcePosition {
                    crs: crs::normalize(crs),
                    x,
                    y,
                });
            }
        }
    }
    if let (Some(lat), Some(lon)) = (manifest.source_lat, manifest.source_lon) {
        if lat.is_finite() && lon.is_finite() {
            if let Some(crs) = manifest
                .source_geo_crs
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
            {
                return Some(SourcePosition {
                    crs: crs::normalize(crs),
                    x: lon,
                    y: lat,
                });
            }
        }
    }
    None
}

fn blank(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(|text| text.trim().is_empty())
}

fn is_iso_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
    {
        return false;
    }
    let month: u32 = text[5..7].parse().unwrap_or(0);
    let day: u32 = text[8..10].parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
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
    let position = source_position(manifest);
    if blank(&manifest.source_crs) && blank(&manifest.source_geo_crs) {
        findings.push(Finding::new(
            "missing_crs",
            "error",
            "Source CRS must be identified; no default is assumed.",
            None,
        ));
    }
    match &position {
        Some(position) if crs::is_supported(&position.crs) => {
            // One code path validates the position: the same transformation used
            // at publication checks the numeric domain and the verified area.
            if let Err(error) = crs::transform(&position.crs, position.x, position.y) {
                findings.push(Finding::new(
                    "out_of_range_coordinates",
                    "error",
                    &error.to_string(),
                    None,
                ));
            }
        }
        Some(position) => findings.push(Finding::new(
            "unverified_crs",
            "error",
            &format!(
                "No verified transformation to EPSG:4326 is registered for {}.",
                position.crs
            ),
            None,
        )),
        None => {
            let has_pair = (manifest.x.is_some() && manifest.y.is_some())
                || (manifest.source_lat.is_some() && manifest.source_lon.is_some());
            if !has_pair {
                findings.push(Finding::new(
                    "invalid_coordinates",
                    "error",
                    "Numeric source x and y, or latitude and longitude, are required.",
                    None,
                ));
            }
        }
    }
    if manifest.datum_value.is_some() && blank(&manifest.datum_unit) {
        findings.push(Finding::new(
            "missing_datum_unit",
            "warning",
            "Well datum value needs a unit (m or ft).",
            None,
        ));
    }
    if manifest.td_md.is_some() && blank(&manifest.td_unit) {
        findings.push(Finding::new(
            "missing_td_unit",
            "warning",
            "TD (MD) needs a unit (m or ft).",
            None,
        ));
    }
    if let Some(datum) = manifest
        .datum_name
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        if !matches!(datum.to_lowercase().as_str(), "kb" | "gl" | "rf" | "df") {
            findings.push(Finding::new(
                "unknown_datum_name",
                "warning",
                "Well datum name is outside the known KB/GL/RF/DF vocabulary; confirm the elevation reference.",
                None,
            ));
        }
    }
    if manifest.source_lat.is_some()
        && manifest.source_lon.is_some()
        && blank(&manifest.source_geo_crs)
    {
        findings.push(Finding::new(
            "missing_source_geo_crs",
            "warning",
            "Source latitude/longitude need their own geographic CRS; no default is assumed.",
            None,
        ));
    }
    if let (Some(position), Some(lat), Some(lon)) =
        (&position, manifest.source_lat, manifest.source_lon)
    {
        if manifest.x.is_some()
            && manifest.y.is_some()
            && !blank(&manifest.source_geo_crs)
            && crs::is_supported(&position.crs)
        {
            if let Ok(display) = crs::transform(&position.crs, position.x, position.y) {
                if (display.longitude - lon).abs() > 0.001
                    || (display.latitude - lat).abs() > 0.001
                {
                    findings.push(Finding::new(
                        "position_mismatch",
                        "warning",
                        "Source latitude/longitude disagree with the projected surface position beyond 0.001 degrees; reviewer confirmation is required.",
                        None,
                    ));
                }
            }
        }
    }
    for (value, code) in [
        (&manifest.spud_date, "invalid_spud_date"),
        (&manifest.completion_date, "invalid_completion_date"),
    ] {
        if let Some(text) = value.as_deref().map(str::trim).filter(|text| !text.is_empty()) {
            if !is_iso_date(text) {
                findings.push(Finding::new(
                    code,
                    "warning",
                    "Date must be ISO YYYY-MM-DD as provided by the source.",
                    None,
                ));
            }
        }
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
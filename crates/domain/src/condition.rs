use crate::{Candidate, Finding, Manifest, crs, qc_findings};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
/// The kind of value a column is expected to carry, used to choose which
/// pre-conditioning rules apply.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ColKind {
    Text,
    Number,
    Latitude,
    Longitude,
    Coordinate,
    Date,
}

/// A profiled column: inferred kind, fill rate, distinctness, and flags that
/// hint which conditioning rules the importer will need.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ColumnProfile {
    pub index: usize,
    pub name: String,
    pub kind: ColKind,
    pub filled: usize,
    pub total: usize,
    pub distinct: usize,
    pub samples: Vec<String>,
    pub flags: Vec<String>,
}

/// A whole-table profile built from a parsed grid.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TableProfile {
    pub rows: usize,
    pub columns: Vec<ColumnProfile>,
}

/// The pre-conditioning rules a batch applies to a column. Every rule is
/// reversible in the audit trail (before/after is recorded) and none mutates
/// the original file bytes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Rules {
    pub trim: bool,
    pub null_tokens: Vec<String>,
    pub decimal_comma: bool,
    pub strip_units: bool,
    pub dms_to_decimal: bool,
    pub date_formats: Vec<String>,
}

/// Batch-level defaults that stand in for values a table does not carry, such
/// as a declared coordinate system. No value is ever invented for a position:
/// a default CRS only fills a slot when the table already provides a pair.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Defaults {
    pub source: String,
    pub license: String,
    pub confidentiality: String,
    pub source_crs: String,
    pub source_geo_crs: String,
}

impl Default for Defaults {
    fn default() -> Self {
        Self {
            source: "Header table import".into(),
            license: "See source package".into(),
            confidentiality: "restricted".into(),
            source_crs: "EPSG:4326".into(),
            source_geo_crs: "EPSG:4326".into(),
        }
    }
}

/// The outcome of conditioning a single row into a governed manifest.
#[derive(Clone, Debug)]
pub struct RowOutcome {
    pub manifest: Manifest,
    pub findings: Vec<Finding>,
    pub blocked: bool,
    /// (target, before, after) for every value a rule actually changed, so
    /// the audit trail shows exactly what conditioning did.
    pub changes: Vec<(String, String, String)>,
}

const BASIC_NULL_TOKENS: [&str; 8] = ["", "-", "--", "n/a", "na", "null", "none", "-999.25"];

fn default_date_formats() -> Vec<String> {
    [
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%d.%m.%Y",
        "%d-%b-%Y",
        "%Y/%m/%d",
    ]
    .iter()
    .map(|text| text.to_string())
    .collect()
}

fn is_null_token(value: &str, rules: &Rules) -> bool {
    let trimmed = value.trim();
    if rules.trim {
        let lowered = trimmed.to_lowercase();
        return rules
            .null_tokens
            .iter()
            .any(|token| token.trim().to_lowercase() == lowered)
            || BASIC_NULL_TOKENS.contains(&lowered.as_str());
    }
    trimmed.is_empty()
}

fn normalize_decimal_comma(text: &str) -> String {
    let has_comma = text.contains(',');
    let has_dot = text.contains('.');
    if has_comma && has_dot {
        let last_comma = text.rfind(',').unwrap();
        let last_dot = text.rfind('.').unwrap();
        if last_comma > last_dot {
            // comma is decimal point, dot is thousands separator
            return text.replace('.', "").replace(',', ".");
        }
        // dot is decimal, comma is thousands
        return text.replace(',', "");
    }
    if has_comma {
        let parts: Vec<&str> = text.split(',').collect();
        if parts.len() > 2 {
            // multiple commas: thousands separators
            return text.replace(',', "");
        }
        if parts.len() == 2 {
            let before = parts[0];
            let after = parts[1];
            // "3.450,25" — thousands + decimal
            if before.contains('.') && after.len() <= 2 {
                return text.replace('.', "").replace(',', ".");
            }
            // "3,450,25" — two-group thousands
            if before.len() <= 3 && after.len() == 2 {
                // ambiguous: "12,34" is decimal; "1,234" is thousands
                // when after has exactly 2 digits and before has 2 digits,
                // prefer decimal interpretation
                return text.replace(',', ".");
            }
            return text.replace(',', "");
        }
        // single comma, no dot: decimal point
        return text.replace(',', ".");
    }
    text.to_string()
}

fn strip_unit(text: &str) -> String {
    let trimmed = text.trim();
    let mut prefix = String::new();
    for ch in trimmed.chars() {
        if ch.is_ascii_digit() || matches!(ch, '.' | '+' | '-' | ',' ) || (ch == 'e' || ch == 'E') {
            prefix.push(ch);
        } else {
            break;
        }
    }
    // A valid numeric prefix must parse as f64 after comma-normalization
    if !prefix.is_empty() && normalize_decimal_comma(&prefix).parse::<f64>().is_ok() {
        prefix
    } else {
        trimmed.to_string()
    }
}

fn looks_like_dms(text: &str) -> bool {
    let t = text.trim();
    if t.contains('\u{00B0}') {
        return true;
    }
    let hemispheres = ['N', 'S', 'E', 'W', 'n', 's', 'e', 'w'];
    let ends_hemi = t.ends_with('N') || t.ends_with('S') || t.ends_with('E') || t.ends_with('W')
        || t.ends_with('n') || t.ends_with('s') || t.ends_with('e') || t.ends_with('w');
    let numeric_tokens: Vec<&str> = t
        .split(|c: char| !c.is_ascii_digit() && c != '.' && c != ',' && !hemispheres.contains(&c))
        .filter(|s| !s.is_empty())
        .collect();
    ends_hemi && numeric_tokens.len() >= 2
}

fn parse_dms(text: &str) -> Option<f64> {
    let trimmed = text.trim().to_uppercase();
    let hemi_char = trimmed
        .chars()
        .rev()
        .find(|c| matches!(c, 'N' | 'S' | 'E' | 'W'));
    let negative = matches!(hemi_char, Some('S') | Some('W'));
    // Split on non-digit, non-decimal characters (excluding hemisphere letters)
    // to isolate the degree, minute, second number groups.
    let groups: Vec<&str> = trimmed
        .split(|c: char| !c.is_ascii_digit() && c != '.' && c != ',' && !matches!(c, 'N' | 'S' | 'E' | 'W'))
        .filter(|s| !s.trim().is_empty())
        .collect();
    if groups.is_empty() {
        return None;
    }
    let deg: f64 = groups[0].trim().replace(',', ".").parse().ok()?;
    let min: f64 = groups.get(1).and_then(|s| s.trim().replace(',', ".").parse().ok()).unwrap_or(0.0);
    let sec: f64 = groups.get(2).and_then(|s| s.trim().replace(',', ".").parse().ok()).unwrap_or(0.0);
    if !(0.0..=360.0).contains(&deg) {
        return None;
    }
    let value = deg + min / 60.0 + sec / 3600.0;
    Some(if negative { -value } else { value })
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = if m > 2 { m as i64 - 3 } else { m as i64 + 9 };
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u32; // 0..=146096
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 13]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y, m as u32, d as u32)
}

fn days_in_month(y: i64, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
            if leap { 29 } else { 28 }
        }
        _ => 0,
    }
}

fn month_abbr(name: &str) -> Option<u32> {
    Some(match name.to_lowercase().as_str() {
        "jan" => 1,
        "feb" => 2,
        "mar" => 3,
        "apr" => 4,
        "may" => 5,
        "jun" => 6,
        "jul" => 7,
        "aug" => 8,
        "sep" => 9,
        "oct" => 10,
        "nov" => 11,
        "dec" => 12,
        _ => return None,
    })
}

fn parse_with_format(text: &str, format: &str) -> Option<String> {
    let parse_parts = |parts: &[&str]| -> Option<(i64, u32, u32)> {
        fn digits(part: &str, len: usize) -> Option<i64> {
            if part.len() != len {
                return None;
            }
            part.parse::<i64>().ok()
        }
        match (format, parts) {
            ("%Y-%m-%d", [y, m, d]) => {
                let (y, m, d) = (digits(y, 4)?, digits(m, 2)?, digits(d, 2)?);
                Some((y, m as u32, d as u32))
            }
            ("%Y/%m/%d", [y, m, d]) => {
                let (y, m, d) = (digits(y, 4)?, digits(m, 2)?, digits(d, 2)?);
                Some((y, m as u32, d as u32))
            }
            ("%d/%m/%Y", [d, m, y]) => {
                let (d, m, y) = (digits(d, 2)?, digits(m, 2)?, digits(y, 4)?);
                Some((y, m as u32, d as u32))
            }
            ("%m/%d/%Y", [m, d, y]) => {
                let (m, d, y) = (digits(m, 2)?, digits(d, 2)?, digits(y, 4)?);
                Some((y, m as u32, d as u32))
            }
            ("%d.%m.%Y", [d, m, y]) => {
                let (d, m, y) = (digits(d, 2)?, digits(m, 2)?, digits(y, 4)?);
                Some((y, m as u32, d as u32))
            }
            ("%d-%b-%Y", [d, b, y]) => {
                let d = digits(d, 2)?;
                let m = month_abbr(b)?;
                let y = digits(y, 4)?;
                Some((y, m, d as u32))
            }
            _ => None,
        }
    };
    let triple = if format.contains('b') {
        text.split('-').collect::<Vec<_>>()
    } else if format.contains('/') {
        text.split('/').collect::<Vec<_>>()
    } else if format.contains('.') {
        text.split('.').collect::<Vec<_>>()
    } else {
        text.split('-').collect::<Vec<_>>()
    };
    let parts: Vec<&str> = triple;
    if let Some((y, m, d)) = parse_parts(&parts) {
        if (1000..=9999).contains(&y) && m >= 1 && m <= 12 && d >= 1 && d <= days_in_month(y, m) {
            return Some(format!("{y:04}-{m:02}-{d:02}"));
        }
    }
    None
}

fn excel_serial_to_iso(serial: f64) -> Option<String> {
    if !(1.0..=60000.0).contains(&serial) {
        return None;
    }
    let days = serial.floor() as i64;
    // Excel serial 1 = 1900-01-01 (with the 1900 leap bug). 1899-12-31 is the
    // practical zero for civil day math.
    let epoch = days_from_civil(1899, 12, 31);
    let (y, m, d) = civil_from_days(epoch + days);
    Some(format!("{y:04}-{m:02}-{d:02}"))
}

fn parse_date(text: &str, formats: &[String]) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    for format in formats {
        if let Some(iso) = parse_with_format(trimmed, format) {
            return Some(iso);
        }
    }
    // Already-ISO input is accepted even if it is not in the format list.
    if trimmed.len() == 10
        && trimmed.as_bytes()[4] == b'-'
        && trimmed.as_bytes()[7] == b'-'
        && trimmed.parse::<i64>().is_err()
    {
        return Some(trimmed.to_string());
    }
    if let Ok(serial) = trimmed.parse::<f64>() {
        if let Some(iso) = excel_serial_to_iso(serial) {
            return Some(iso);
        }
    }
    None
}

/// Clean a raw cell value toward its declared kind. The original is never
/// mutated; a clean result of `""` means the value was a null token.
pub fn clean(raw: &str, kind: ColKind, rules: &Rules) -> String {
    let trimmed = if rules.trim { raw.trim() } else { raw };
    if is_null_token(trimmed, rules) {
        return String::new();
    }
    match kind {
        ColKind::Date => parse_date(trimmed, &rules.date_formats).unwrap_or_else(|| trimmed.to_string()),
        ColKind::Text => trimmed.to_string(),
        ColKind::Number | ColKind::Latitude | ColKind::Longitude | ColKind::Coordinate => {
            if rules.dms_to_decimal && looks_like_dms(trimmed) {
                if let Some(value) = parse_dms(trimmed) {
                    return format!("{value:.6}");
                }
            }
            let mut text = trimmed.to_string();
            if rules.strip_units {
                text = strip_unit(&text);
            }
            if rules.decimal_comma {
                text = normalize_decimal_comma(&text);
            }
            if text.parse::<f64>().is_ok() {
                text
            } else {
                trimmed.to_string()
            }
        }
    }
}

fn kind_for_target(target: &str) -> ColKind {
    match target {
        "x" | "y" | "bottom_hole_x" | "bottom_hole_y" | "datum_value" | "td_md" => ColKind::Number,
        "source_lat" => ColKind::Latitude,
        "source_lon" => ColKind::Longitude,
        "spud_date" | "completion_date" => ColKind::Date,
        _ => ColKind::Text,
    }
}

fn normalize_header(text: String) -> Vec<String> {
    let lowered = text.to_lowercase();
    let mut words = Vec::new();
    let mut current = String::new();
    for ch in lowered.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch);
        } else if !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

fn header_matches(words: &[String], synonym: &str) -> bool {
    if words.is_empty() {
        return false;
    }
    if words.len() == 1 {
        return words[0].as_str() == synonym;
    }
    if words.iter().any(|word| word.as_str() == synonym) {
        return true;
    }
    let syn_words: Vec<&str> = synonym.split(' ').collect();
    if syn_words.len() < 2 {
        return false;
    }
    let limit = (words.len() as isize).saturating_sub(syn_words.len() as isize) as usize;
    if limit > words.len() - 1 {
        return false;
    }
    for start in 0..=limit {
        if words[start..start + syn_words.len()]
            .iter()
            .all(|w| syn_words.iter().any(|s| w.as_str() == *s))
        {
            return true;
        }
    }
    false
}

fn targets() -> Vec<(&'static str, &'static [&'static str])> {
    vec![
        ("name", &["well name", "wellname", "well label", "designation", "well"]),
        ("external_id", &["uwi", "unique well id", "api", "api number", "registration", "npdid", "external id"]),
        ("folder", &["folder", "folder name", "area"]),
        ("well_symbol", &["well symbol", "symbol", "short name"]),
        ("drilling_structure", &["drilling structure", "structure", "rig", "installation"]),
        ("operator", &["operator", "operator name", "operated by", "company"]),
        ("datum_name", &["well datum name", "datum name", "well datum", "datum reference"]),
        ("datum_value", &["datum value", "datum elevation", "datum height"]),
        ("datum_unit", &["datum unit", "datum value unit"]),
        ("td_md", &["td md", "total depth", "measured depth", "td"]),
        ("td_unit", &["td unit", "depth unit"]),
        ("bottom_hole_x", &["bottom hole x", "bh x", "bottom x"]),
        ("bottom_hole_y", &["bottom hole y", "bh y", "bottom y"]),
        ("x", &["surface x", "easting", "utmx"]),
        ("y", &["surface y", "northing", "utmy"]),
        ("source_lat", &["latitude", "surface latitude"]),
        ("source_lon", &["longitude", "surface longitude"]),
        ("source_crs", &["source crs", "crs", "coordinate system", "srid"]),
        ("source_geo_crs", &["source geo crs", "geographic crs", "geo crs"]),
        ("spud_date", &["spud date", "spudded", "spud"]),
        ("completion_date", &["completion date", "completed"]),
        ("alias", &["alias", "field", "discovery", "field name"]),
    ]
}

/// Suggest a column mapping from detected headers to target fields. Synonym
/// lists are ordered so specific targets win their column before generic ones
/// scan; a column is claimed by the first matching target.
pub fn suggest_map(headers: &[String]) -> BTreeMap<String, usize> {
    let words: Vec<Vec<String>> = headers.iter().map(|h| normalize_header(h.clone())).collect();
    let mut claimed = vec![false; headers.len()];
    let mut map = BTreeMap::new();
    for (target, synonyms) in targets() {
        for &synonym in synonyms {
            let found = words
                .iter()
                .enumerate()
                .find(|(index, words)| !claimed[*index] && header_matches(words, synonym));
            if let Some((index, _)) = found {
                claimed[index] = true;
                map.insert(target.to_string(), index);
                break;
            }
        }
    }
    // "Latitude"/"Longitude" are single words handled by the header-word path.
    for (target, word) in [("source_lat", "lat"), ("source_lon", "lon"), ("x", "x"), ("y", "y")] {
        if map.contains_key(target) {
            continue;
        }
        for (index, words) in words.iter().enumerate() {
            if !claimed[index] && words == &[word.to_string()] {
                claimed[index] = true;
                map.insert(target.to_string(), index);
                break;
            }
        }
    }
    map
}

/// Build the governed manifest for one table row after applying the rules.
/// Source coordinates are preserved as cleaned (never reprojected here); the
/// display transform happens once at publish, as the QC findings require.
pub fn build_row(
    headers: &[String],
    row: &[String],
    map: &BTreeMap<String, usize>,
    rules: &Rules,
    defaults: &Defaults,
    seen_external_ids: &mut HashSet<String>,
) -> RowOutcome {
    let _ = headers; // headers are carried for future context; not needed today.
    let mut changes = Vec::new();
    struct Collector<'a> {
        map: &'a BTreeMap<String, usize>,
        row: &'a [String],
        rules: &'a Rules,
        changes: &'a mut Vec<(String, String, String)>,
    }
    impl<'a> Collector<'a> {
        fn get(&self, target: &str) -> Option<String> {
            self.map.get(target).and_then(|index| self.row.get(*index)).map(|value| value.to_string())
        }
        fn text(&mut self, target: &str) -> Option<String> {
            let raw = self.get(target)?;
            let cleaned = clean(&raw, kind_for_target(target), self.rules);
            if cleaned != raw {
                self.changes.push((target.to_string(), raw.clone(), cleaned.clone()));
            }
            if cleaned.is_empty() {
                None
            } else {
                Some(cleaned)
            }
        }
        fn number(&mut self, target: &str) -> Option<f64> {
            self.text(target).and_then(|value| value.parse::<f64>().ok())
        }
        fn crs(&mut self, target: &str) -> Option<String> {
            self.text(target).and_then(|value| {
                let normalized = crs::normalize(&value);
                if normalized.is_empty() {
                    Some(value)
                } else if normalized.parse::<u32>().is_ok() {
                    Some(format!("EPSG:{normalized}"))
                } else {
                    Some(value)
                }
            })
        }
    }
    let mut collector = Collector {
        map,
        row,
        rules,
        changes: &mut changes,
    };

    let mut manifest = Manifest::default();
    manifest.name = collector.text("name");
    manifest.external_id = collector.text("external_id");
    manifest.folder = collector.text("folder");
    manifest.well_symbol = collector.text("well_symbol");
    manifest.drilling_structure = collector.text("drilling_structure");
    manifest.operator = collector.text("operator");
    manifest.datum_name = collector.text("datum_name");
    manifest.datum_unit = collector.text("datum_unit");
    manifest.datum_value = collector.number("datum_value");
    manifest.td_md = collector.number("td_md");
    manifest.td_unit = collector.text("td_unit");
    manifest.bottom_hole_x = collector.number("bottom_hole_x");
    manifest.bottom_hole_y = collector.number("bottom_hole_y");
    manifest.spud_date = collector.text("spud_date");
    manifest.completion_date = collector.text("completion_date");
    manifest.source_lat = collector.number("source_lat");
    manifest.source_lon = collector.number("source_lon");
    manifest.x = collector.number("x");
    manifest.y = collector.number("y");

    let has_projected = manifest.x.is_some() && manifest.y.is_some();
    let has_geographic = manifest.source_lat.is_some() && manifest.source_lon.is_some();
    manifest.source_crs = collector.crs("source_crs")
        .or_else(|| if has_projected { Some(defaults.source_crs.clone()) } else { None });
    manifest.source_geo_crs = collector.crs("source_geo_crs")
        .or_else(|| if has_geographic { Some(defaults.source_geo_crs.clone()) } else { None });

    manifest.source = Some(defaults.source.clone());
    manifest.license = Some(defaults.license.clone());
    manifest.confidentiality = Some(defaults.confidentiality.clone());
    if let Some(alias) = collector.text("alias") {
        manifest.aliases.push(alias);
    }

    let mut findings = qc_findings(&manifest, &[] as &[Candidate]);
    if let Some(external_id) = manifest.external_id.clone() {
        let normalized_id = external_id.trim().to_uppercase();
        if !normalized_id.is_empty() && !seen_external_ids.insert(normalized_id) {
            findings.push(Finding {
                code: "duplicate_external_id".into(),
                severity: "warning".into(),
                message: format!("UWI {external_id} appears more than once in this table."),
                well_id: None,
            });
        }
    }
    let blocked = findings.iter().any(|finding| {
        finding.severity == "error"
            && !matches!(finding.code.as_str(), "missing_name")
    })
        || (findings.iter().any(|f| f.code == "missing_name" && f.severity == "error")
            && manifest.external_id.is_none());
    RowOutcome {
        manifest,
        findings,
        blocked,
        changes,
    }
}

fn is_basic_null(value: &str) -> bool {
    let lowered = value.trim().to_lowercase();
    BASIC_NULL_TOKENS.contains(&lowered.as_str())
}

fn count_non_null(rows: &[Vec<String>], index: usize) -> Vec<String> {
    rows.iter()
        .filter_map(|row| row.get(index).cloned())
        .map(|value| value.trim().to_string())
        .filter(|value| !is_basic_null(value))
        .collect()
}

fn profile_column(index: usize, name: &str, rows: &[Vec<String>]) -> ColumnProfile {
    let total = rows.len();
    let values = count_non_null(rows, index);
    let filled = values.len();
    let mut distinct_set: BTreeSet<&str> = BTreeSet::new();
    for value in &values {
        distinct_set.insert(value);
    }
    let distinct = distinct_set.len();
    let samples = distinct_set.into_iter().take(3).map(|s| s.to_string()).collect();

    let lower = name.to_lowercase();
    let is_geo_name = lower.contains("latitude") || lower.contains("longitude")
        || lower == "lat" || lower == "lon" || lower == "long";

    let numeric_count = values
        .iter()
        .filter(|value| {
            let no_unit = strip_unit(value);
            normalize_decimal_comma(&no_unit).parse::<f64>().is_ok()
        })
        .count();
    let dates = values.iter().filter(|value| parse_date(value, &default_date_formats()).is_some()).count();
    let dms = values.iter().filter(|value| looks_like_dms(value)).count();

    let mut kind = ColKind::Text;
    if is_geo_name {
        kind = if lower.contains("latitude") || lower == "lat" {
            ColKind::Latitude
        } else {
            ColKind::Longitude
        };
    } else if filled > 0 {
        if dates * 2 >= filled && dates > 0 && dates >= numeric_count {
            kind = ColKind::Date;
        } else if numeric_count * 2 >= filled {
            kind = ColKind::Number;
        }
    }

    let mut flags = Vec::new();
    // units_embedded: a non-geo column where at least one value still carries
    // an alphabetic suffix after numeric prefix extraction (e.g. "3,450 m").
    let units_embedded = !is_geo_name
        && values.iter().any(|value| {
            let cleaned = strip_unit(value);
            let has_digits = cleaned.chars().any(|c| c.is_ascii_digit());
            let has_alpha = value
                .chars()
                .any(|c| c.is_ascii_alphabetic() && !matches!(c, 'N' | 'S' | 'E' | 'W' | 'n' | 's' | 'e' | 'w'));
            has_digits && has_alpha && cleaned != value.trim()
        });
    if units_embedded {
        flags.push("units_embedded".into());
    }
    let decimal_comma = values.iter().any(|value| value.contains(',') && value.contains(|c: char| c.is_ascii_digit()));
    if decimal_comma {
        flags.push("decimal_comma".into());
    }
    if dms > 0 {
        flags.push("dms".into());
    }
    if total > 0 && (total - filled) * 2 >= total {
        flags.push("null_heavy".into());
    }
    if distinct > 1 && distinct * 4 <= filled {
        flags.push("duplicate_values".into());
    }

    ColumnProfile {
        index,
        name: name.to_string(),
        kind,
        filled,
        total,
        distinct,
        samples,
        flags,
    }
}

/// Profile a parsed table: per-column kind, fill rate, and conditioning hints.
pub fn profile(headers: &[String], rows: &[Vec<String>]) -> TableProfile {
    let columns = headers
        .iter()
        .enumerate()
        .map(|(index, name)| profile_column(index, name, rows))
        .collect();
    TableProfile {
        rows: rows.len(),
        columns,
    }
}

/// Derive the conditioning rules from a table profile. Messy-data flags the
/// profiler detected (DMS coordinates, decimal commas, embedded units) turn on
/// the matching rule, so a typical table imports cleanly without hand-tuning.
/// Trimming and date parsing are always on; a null-token list is always
/// provided so empty cells and sentinel values collapse to null.
pub fn rules_from_profile(profile: &TableProfile) -> Rules {
    let mut dms = false;
    let mut decimal_comma = false;
    let mut units_embedded = false;
    for column in &profile.columns {
        for flag in &column.flags {
            match flag.as_str() {
                "dms" => dms = true,
                "decimal_comma" => decimal_comma = true,
                "units_embedded" => units_embedded = true,
                _ => {}
            }
        }
    }
    Rules {
        trim: true,
        null_tokens: BASIC_NULL_TOKENS.iter().map(|s| s.to_string()).collect(),
        decimal_comma,
        strip_units: units_embedded,
        dms_to_decimal: dms,
        date_formats: default_date_formats(),
    }
}

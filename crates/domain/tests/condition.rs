use atlasio_domain::condition::{
    build_row, clean, profile, suggest_map, ColKind, Defaults, Rules,
};
use std::collections::BTreeMap;

fn rules() -> Rules {
    Rules {
        trim: true,
        null_tokens: vec!["".into(), "-".into(), "N/A".into(), "-999.25".into()],
        decimal_comma: true,
        strip_units: true,
        dms_to_decimal: true,
        date_formats: vec![
            "%Y-%m-%d".into(),
            "%d/%m/%Y".into(),
            "%m/%d/%Y".into(),
            "%d.%m.%Y".into(),
            "%d-%b-%Y".into(),
            "%Y/%m/%d".into(),
        ],
    }
}

fn defaults() -> Defaults {
    Defaults {
        source: "Header table import".into(),
        license: "OGL-UK-3.0".into(),
        confidentiality: "public".into(),
        source_crs: "EPSG:23032".into(),
        source_geo_crs: "EPSG:4326".into(),
    }
}

fn headers17() -> Vec<String> {
    [
        "WellName",
        "UWI",
        "Folder",
        "Well symbol",
        "Surface X",
        "Surface Y",
        "Latitude",
        "Longitude",
        "Drilling structure",
        "Well datum name (KB, or GL, or RF)",
        "Well datum value",
        "TD (MD)",
        "Bottom hole X",
        "Bottom hole Y",
        "Spud date",
        "Completion date",
        "Operator",
    ]
    .iter()
    .map(|text| text.to_string())
    .collect()
}

#[test]
fn profile_detects_kinds_fill_and_flags() {
    let headers = vec![
        "WellName".to_string(),
        "Surface X".to_string(),
        "Latitude".to_string(),
        "Spud date".to_string(),
    ];
    let rows = vec![
        vec![
            "ALPHA-1".into(),
            "3,450 m".into(),
            "55°23'12.5\"N".into(),
            "12/05/2021".into(),
        ],
        vec![
            "BETA-2".into(),
            "3.100,5 m".into(),
            "55.000".into(),
            "2021-06-01".into(),
        ],
        vec!["".into(), "N/A".into(), "".into(), "-".into()],
        vec!["".into(), "2,100".into(), "60.25".into(), "13/07/2022".into()],
    ];
    let result = profile(&headers, &rows);
    assert_eq!(result.rows, 4);
    assert_eq!(result.columns[0].kind, ColKind::Text);
    assert_eq!(result.columns[1].kind, ColKind::Number);
    assert_eq!(result.columns[2].kind, ColKind::Latitude);
    assert_eq!(result.columns[3].kind, ColKind::Date);
    assert_eq!(result.columns[0].filled, 2);
    assert!(result.columns[0].flags.iter().any(|flag| flag == "null_heavy"));
    assert!(result.columns[1].flags.iter().any(|flag| flag == "units_embedded"));
    assert!(result.columns[1].flags.iter().any(|flag| flag == "decimal_comma"));
    assert!(result.columns[2].flags.iter().any(|flag| flag == "dms"));
}

#[test]
fn suggest_map_matches_industry_synonyms() {
    let map = suggest_map(&headers17());
    assert_eq!(map.get("name"), Some(&0));
    assert_eq!(map.get("external_id"), Some(&1));
    assert_eq!(map.get("folder"), Some(&2));
    assert_eq!(map.get("well_symbol"), Some(&3));
    assert_eq!(map.get("x"), Some(&4));
    assert_eq!(map.get("y"), Some(&5));
    assert_eq!(map.get("source_lat"), Some(&6));
    assert_eq!(map.get("source_lon"), Some(&7));
    assert_eq!(map.get("drilling_structure"), Some(&8));
    assert_eq!(map.get("datum_name"), Some(&9));
    assert_eq!(map.get("datum_value"), Some(&10));
    assert_eq!(map.get("td_md"), Some(&11));
    assert_eq!(map.get("bottom_hole_x"), Some(&12));
    assert_eq!(map.get("bottom_hole_y"), Some(&13));
    assert_eq!(map.get("spud_date"), Some(&14));
    assert_eq!(map.get("completion_date"), Some(&15));
    assert_eq!(map.get("operator"), Some(&16));
}

#[test]
fn suggest_map_handles_common_aliases() {
    let headers: Vec<String> = ["WELLNAME", "API", "EASTING", "NORTHING", "TD (MD)", "Operator"]
        .iter()
        .map(|text| text.to_string())
        .collect();
    let map = suggest_map(&headers);
    assert_eq!(map.get("name"), Some(&0));
    assert_eq!(map.get("external_id"), Some(&1));
    assert_eq!(map.get("x"), Some(&2));
    assert_eq!(map.get("y"), Some(&3));
    assert_eq!(map.get("td_md"), Some(&4));
    assert_eq!(map.get("operator"), Some(&5));
}

#[test]
fn clean_applies_null_tokens_trim_and_decimal_comma() {
    let rules = rules();
    assert_eq!(clean("N/A", ColKind::Number, &rules), "");
    assert_eq!(clean("-999.25", ColKind::Number, &rules), "");
    assert_eq!(clean("  ALPHA-1  ", ColKind::Text, &rules), "ALPHA-1");
    assert_eq!(clean("3.450,25", ColKind::Number, &rules), "3450.25");
    assert_eq!(clean("1,234,567.89", ColKind::Number, &rules), "1234567.89");
    assert_eq!(clean("3,450 m", ColKind::Number, &rules), "3450");
    assert_eq!(clean("3047.5m", ColKind::Number, &rules), "3047.5");
    assert_eq!(clean("3,450 m", ColKind::Text, &rules), "3,450 m");
}

#[test]
fn clean_converts_dms_to_decimal_degrees() {
    let rules = rules();
    let value = clean("55°23'12.5\"N", ColKind::Latitude, &rules);
    let parsed: f64 = value.parse().unwrap();
    assert!((parsed - 55.386806).abs() < 1e-5, "got {value}");
    let west = clean("3°12'00.0\"W", ColKind::Longitude, &rules);
    let parsed: f64 = west.parse().unwrap();
    assert!((parsed - (-3.2)).abs() < 1e-9, "got {west}");
    assert_eq!(clean("55.5", ColKind::Latitude, &rules), "55.5");
}

#[test]
fn clean_normalizes_dates_and_excel_serials() {
    let rules = rules();
    assert_eq!(clean("12/05/2021", ColKind::Date, &rules), "2021-05-12");
    assert_eq!(clean("2021/05/12", ColKind::Date, &rules), "2021-05-12");
    assert_eq!(clean("05-Dec-2021", ColKind::Date, &rules), "2021-12-05");
    assert_eq!(clean("31.01.1999", ColKind::Date, &rules), "1999-01-31");
    assert_eq!(clean("44439", ColKind::Date, &rules), "2021-09-01");
    assert_eq!(clean("2021-09-01", ColKind::Date, &rules), "2021-09-01");
    assert_eq!(clean("not a date", ColKind::Date, &rules), "not a date");
}

#[test]
fn build_row_maps_the_industry_header() {
    let headers = headers17();
    let map = suggest_map(&headers);
    let row: Vec<String> = [
        "SYNTH-01",
        "SYN-0001",
        "North Sea",
        "A",
        "423456.78",
        "6234567.89",
        "",
        "",
        "Jackup",
        "KB",
        "35.5",
        "3047.5 m",
        "",
        "",
        "12/05/2021",
        "01/08/2022",
        "Synthetic Energy Co",
    ]
    .iter()
    .map(|text| text.to_string())
    .collect();
    let mut seen = Default::default();
    let outcome = build_row(&headers, &row, &map, &rules(), &defaults(), &mut seen);
    assert!(!outcome.blocked, "findings: {:?}", outcome.findings);
    let manifest = &outcome.manifest;
    assert_eq!(manifest.name.as_deref(), Some("SYNTH-01"));
    assert_eq!(manifest.external_id.as_deref(), Some("SYN-0001"));
    assert_eq!(manifest.folder.as_deref(), Some("North Sea"));
    assert_eq!(manifest.well_symbol.as_deref(), Some("A"));
    assert_eq!(manifest.x, Some(423456.78));
    assert_eq!(manifest.y, Some(6234567.89));
    assert_eq!(manifest.source_crs.as_deref(), Some("EPSG:23032"));
    assert_eq!(manifest.drilling_structure.as_deref(), Some("Jackup"));
    assert_eq!(manifest.datum_name.as_deref(), Some("KB"));
    assert_eq!(manifest.datum_value, Some(35.5));
    assert_eq!(manifest.td_md, Some(3047.5));
    assert_eq!(manifest.td_unit, None, "unit stays unassumed");
    assert_eq!(manifest.spud_date.as_deref(), Some("2021-05-12"));
    assert_eq!(manifest.completion_date.as_deref(), Some("2022-08-01"));
    assert_eq!(manifest.operator.as_deref(), Some("Synthetic Energy Co"));
    assert!(manifest.source_lat.is_none());
    assert!(manifest.source_lon.is_none());
    assert!(!outcome.changes.is_empty(), "conditioning recorded");
}

#[test]
fn build_row_falls_back_to_geographic_pair() {
    let headers = vec![
        "WellName".to_string(),
        "Latitude".to_string(),
        "Longitude".to_string(),
    ];
    let map = suggest_map(&headers);
    let row = vec!["GEO-1".to_string(), "55.5".to_string(), "3.25".to_string()];
    let mut seen = Default::default();
    let outcome = build_row(&headers, &row, &map, &rules(), &defaults(), &mut seen);
    assert!(!outcome.blocked);
    assert_eq!(outcome.manifest.source_lat, Some(55.5));
    assert_eq!(outcome.manifest.source_lon, Some(3.25));
    assert_eq!(outcome.manifest.source_geo_crs.as_deref(), Some("EPSG:4326"));
    assert_eq!(outcome.manifest.x, None);
}

#[test]
fn build_row_accepts_per_row_crs_and_aliases() {
    let headers = vec![
        "WellName".to_string(),
        "Surface X".to_string(),
        "Surface Y".to_string(),
        "CRS".to_string(),
    ];
    let map = suggest_map(&headers);
    assert_eq!(map.get("source_crs"), Some(&3));
    let row = vec![
        "ED50-1".to_string(),
        "423456.78".to_string(),
        "6234567.89".to_string(),
        "ED50 / UTM zone 32N".to_string(),
    ];
    let mut seen = Default::default();
    let outcome = build_row(&headers, &row, &map, &rules(), &defaults(), &mut seen);
    assert!(!outcome.blocked);
    assert_eq!(outcome.manifest.source_crs.as_deref(), Some("EPSG:23032"));
}

#[test]
fn build_row_blocks_rows_without_any_position_or_crs() {
    let headers = vec!["WellName".to_string(), "Operator".to_string()];
    let map = suggest_map(&headers);
    let row = vec!["NOP-1".to_string(), "Op".to_string()];
    let mut seen = Default::default();
    let outcome = build_row(&headers, &row, &map, &rules(), &defaults(), &mut seen);
    assert!(outcome.blocked);
    assert!(outcome
        .findings
        .iter()
        .any(|finding| finding.code == "missing_crs" && finding.severity == "error"));
}

#[test]
fn build_row_blocks_rows_without_a_name() {
    let headers = vec!["Latitude".to_string(), "Longitude".to_string()];
    let map = suggest_map(&headers);
    let row = vec!["55.5".to_string(), "3.25".to_string()];
    let mut seen = Default::default();
    let outcome = build_row(&headers, &row, &map, &rules(), &defaults(), &mut seen);
    assert!(outcome.blocked);
    assert!(outcome
        .findings
        .iter()
        .any(|finding| finding.code == "missing_name"));
}

#[test]
fn build_row_warns_on_duplicate_uwi_without_blocking() {
    let headers = vec!["UWI".to_string(), "Latitude".to_string(), "Longitude".to_string()];
    let map = suggest_map(&headers);
    let row = vec!["DUP-1".to_string(), "55.5".to_string(), "3.25".to_string()];
    let mut seen = Default::default();
    let first = build_row(&headers, &row, &map, &rules(), &defaults(), &mut seen);
    assert!(!first.blocked);
    let second = build_row(&headers, &row, &map, &rules(), &defaults(), &mut seen);
    assert!(!second.blocked);
    assert!(second
        .findings
        .iter()
        .any(|finding| finding.code == "duplicate_external_id"
            && finding.severity == "warning"));
}

#[test]
fn build_row_preserves_source_values_and_records_changes() {
    let headers = vec![
        "WellName".to_string(),
        "Surface X".to_string(),
        "Surface Y".to_string(),
    ];
    let map = suggest_map(&headers);
    let row = vec![
        "  PAD-1  ".to_string(),
        " 3,450 m ".to_string(),
        "6.100,5".to_string(),
    ];
    let mut seen = Default::default();
    let outcome = build_row(&headers, &row, &map, &rules(), &defaults(), &mut seen);
    assert_eq!(outcome.manifest.name.as_deref(), Some("PAD-1"));
    assert_eq!(outcome.manifest.x, Some(3450.0));
    assert_eq!(outcome.manifest.y, Some(6100.5));
    let changed: Vec<&str> = outcome.changes.iter().map(|change| change.0.as_str()).collect();
    assert!(changed.contains(&"name"));
    assert!(changed.contains(&"x"));
    assert!(changed.contains(&"y"));
}

#[test]
fn empty_map_leaves_required_fields_blocked() {
    let headers = headers17();
    let row: Vec<String> = headers.iter().map(|_| "x".to_string()).collect();
    let map: BTreeMap<String, usize> = BTreeMap::new();
    let mut seen = Default::default();
    let outcome = build_row(&headers, &row, &map, &rules(), &defaults(), &mut seen);
    assert!(outcome.blocked);
}

#[test]
fn rules_from_profile_auto_enables_detected_flags() {
    use atlasio_domain::condition::rules_from_profile;
    // A table whose columns carry DMS, decimal commas, and embedded units
    // should turn on the matching rules without hand-tuning them.
    let headers = [
        "WellName",
        "Latitude",
        "Longitude",
        "TD (MD)",
        "Spud date",
    ];
    let rows = vec![
        vec!["A-1".into(), "55°23'12.5\"N".into(), "3°12'00.0\"W".into(), "3,450 m".into(), "2021-09-01".into()],
        vec!["B-2".into(), "55.4".into(), "3.2".into(), "3450".into(), "01/09/2021".into()],
    ];
    let headers: Vec<String> = headers.iter().map(|h| h.to_string()).collect();
    let prof = profile(&headers, &rows);
    let rules = rules_from_profile(&prof);

    assert!(rules.dms_to_decimal, "dms flag must enable dms_to_decimal");
    assert!(rules.decimal_comma, "decimal_comma flag must enable decimal_comma");
    assert!(rules.strip_units, "units_embedded flag must enable strip_units");
    assert!(rules.trim, "trim is always on for table imports");
    assert!(!rules.date_formats.is_empty(), "date parsing is always on");

    // A clean table with none of the messy flags keeps the rules minimal.
    let clean_headers = ["WellName", "Latitude", "Longitude", "TD (MD)"];
    let clean_rows = vec![vec![
        "A-1".into(),
        "55.4".into(),
        "3.2".into(),
        "3450".into(),
    ]];
    let clean_headers: Vec<String> = clean_headers.iter().map(|h| h.to_string()).collect();
    let clean_prof = profile(&clean_headers, &clean_rows);
    let clean_rules = rules_from_profile(&clean_prof);
    assert!(!clean_rules.dms_to_decimal);
    assert!(!clean_rules.decimal_comma);
    assert!(!clean_rules.strip_units);
}

//! Coordinate reference system transformations for import-time reprojection.
//!
//! Atlasio preserves the source CRS and source coordinates of every record and
//! derives a separate display position in `EPSG:4326`. This module is the single
//! place that derivation happens, so QC, publication, search, and the map agree.
//!
//! Only operations that are explicitly registered and verified against control
//! points are accepted. The first registered operation is **EPSG:1311, "ED50 to
//! WGS 84 (18)"** (Position Vector / EPSG:9606, stated accuracy 1.0 m), which PROJ
//! 9.4 ranks as the best ED50 -> WGS 84 operation for the southern North Sea
//! (UKCS, Netherlands, Denmark, and Norway south of 62N). It is a 7-parameter
//! Helmert on the International 1924 ellipsoid. The same datum shift is reused
//! for the projected ED50 / UTM zone 31N (`EPSG:23031`) and zone 32N
//! (`EPSG:23032`) variants after an inverse Transverse Mercator step.
//!
//! The implementation is pure Rust so the domain crate stays portable and unit
//! testable without a system PROJ library. PROJ is the authority: the operation
//! parameters and the control points in `fixtures/crs-control-points.json` were
//! generated with `cs2cs --area EPSG:2330 --accuracy 1.0`, and the tests assert
//! this module reproduces them. A point outside the verified area of use is
//! rejected rather than silently transformed with an operation that does not
//! apply there; other regions require registering their own operation.

use std::fmt;

const D2R: f64 = std::f64::consts::PI / 180.0;
const R2D: f64 = 180.0 / std::f64::consts::PI;
const ARCSEC_TO_RAD: f64 = std::f64::consts::PI / 648_000.0;

/// Conservative guard for the verified area of EPSG:1311 (southern North Sea).
/// Points outside this box are rejected, not transformed with an operation that
/// is not valid for them.
const AREA_LAT_MIN: f64 = 48.0;
const AREA_LAT_MAX: f64 = 62.0;
const AREA_LON_MIN: f64 = -12.0;
const AREA_LON_MAX: f64 = 12.0;

#[derive(Clone, Copy)]
struct Ellipsoid {
    a: f64,
    f: f64,
}

impl Ellipsoid {
    fn e2(self) -> f64 {
        self.f * (2.0 - self.f)
    }
}

const INTERNATIONAL_1924: Ellipsoid = Ellipsoid { a: 6_378_388.0, f: 1.0 / 297.0 };
const WGS84: Ellipsoid = Ellipsoid { a: 6_378_137.0, f: 1.0 / 298.257_223_563 };

/// Position Vector (EPSG:9606) Helmert parameters. Rotations are stored in
/// radians and the scale correction is dimensionless.
struct Helmert {
    dx: f64,
    dy: f64,
    dz: f64,
    rx: f64,
    ry: f64,
    rz: f64,
    s: f64,
}

impl Helmert {
    fn apply(&self, x: f64, y: f64, z: f64) -> (f64, f64, f64) {
        let s1 = 1.0 + self.s;
        (
            self.dx + s1 * (x - self.rz * y + self.ry * z),
            self.dy + s1 * (self.rz * x + y - self.rx * z),
            self.dz + s1 * (-self.ry * x + self.rx * y + z),
        )
    }
}

/// EPSG:1311, ED50 to WGS 84 (18).
const ED50_TO_WGS84: Helmert = Helmert {
    dx: -89.5,
    dy: -93.8,
    dz: -123.1,
    rx: 0.0,
    ry: 0.0,
    rz: -0.156 * ARCSEC_TO_RAD,
    s: 1.2e-6,
};

const OPERATION_ID: &str = "EPSG:1311";
const OPERATION_NAME: &str = "ED50 to WGS 84 (18)";
const OPERATION_ACCURACY_M: f64 = 1.0;

/// A derived display position and the exact operation that produced it.
#[derive(Clone, Debug, PartialEq)]
pub struct Transform {
    pub longitude: f64,
    pub latitude: f64,
    pub operation: String,
    pub operation_name: String,
    pub accuracy_m: f64,
}

/// Why a source position could not be transformed to `EPSG:4326`.
#[derive(Clone, Debug, PartialEq)]
pub enum CrsError {
    /// No verified operation to `EPSG:4326` is registered for this CRS.
    Unsupported(String),
    /// Coordinates are not finite or fall outside the CRS's numeric domain.
    InvalidCoordinates(String),
    /// Coordinates are valid but outside the verified area of the operation.
    OutOfArea(String),
}

impl fmt::Display for CrsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CrsError::Unsupported(crs) => write!(
                f,
                "No verified transformation to EPSG:4326 is registered for {crs}."
            ),
            CrsError::InvalidCoordinates(message) => write!(f, "{message}"),
            CrsError::OutOfArea(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for CrsError {}

fn normalize(crs: &str) -> String {
    crs.trim().to_uppercase()
}

/// Whether a verified operation to `EPSG:4326` is registered for this CRS.
pub fn is_supported(crs: &str) -> bool {
    matches!(
        normalize(crs).as_str(),
        "EPSG:4326" | "EPSG:4230" | "EPSG:23031" | "EPSG:23032"
    )
}

/// The CRS codes this slice can publish, with human-readable labels.
pub fn supported_crs() -> &'static [(&'static str, &'static str)] {
    &[
        ("EPSG:4326", "WGS 84 (longitude, latitude)"),
        ("EPSG:4230", "ED50 geographic (longitude, latitude)"),
        ("EPSG:23031", "ED50 / UTM zone 31N (easting, northing)"),
        ("EPSG:23032", "ED50 / UTM zone 32N (easting, northing)"),
    ]
}

/// Transform a source position to an `EPSG:4326` display position.
///
/// `x` and `y` follow the manifest convention: longitude/latitude for geographic
/// CRS, easting/northing for projected CRS. The source values are never mutated;
/// the caller stores them unchanged alongside the derived display position.
pub fn transform(crs: &str, x: f64, y: f64) -> Result<Transform, CrsError> {
    let code = normalize(crs);
    match code.as_str() {
        "EPSG:4326" => {
            check_geographic_range(x, y)?;
            Ok(Transform {
                longitude: x,
                latitude: y,
                operation: "identity:EPSG:4326".into(),
                operation_name: "Identity (source already EPSG:4326)".into(),
                accuracy_m: 0.0,
            })
        }
        "EPSG:4230" => {
            check_geographic_range(x, y)?;
            check_area(x, y)?;
            Ok(ed50_geographic_to_wgs84(y, x))
        }
        "EPSG:23031" => ed50_utm_to_wgs84(31, x, y),
        "EPSG:23032" => ed50_utm_to_wgs84(32, x, y),
        _ => Err(CrsError::Unsupported(code)),
    }
}

fn check_geographic_range(lon: f64, lat: f64) -> Result<(), CrsError> {
    if !lon.is_finite() || !lat.is_finite() {
        return Err(CrsError::InvalidCoordinates(
            "Source coordinates must be finite numbers.".into(),
        ));
    }
    if !(-180.0..=180.0).contains(&lon) || !(-90.0..=90.0).contains(&lat) {
        return Err(CrsError::InvalidCoordinates(
            "Longitude or latitude is outside EPSG:4326 bounds.".into(),
        ));
    }
    Ok(())
}

fn check_area(lon: f64, lat: f64) -> Result<(), CrsError> {
    if !(AREA_LAT_MIN..=AREA_LAT_MAX).contains(&lat)
        || !(AREA_LON_MIN..=AREA_LON_MAX).contains(&lon)
    {
        return Err(CrsError::OutOfArea(format!(
            "Position is outside the verified area of {OPERATION_ID} (southern North Sea); register a regional operation before publishing it."
        )));
    }
    Ok(())
}

fn ed50_geographic_to_wgs84(lat_deg: f64, lon_deg: f64) -> Transform {
    let (x, y, z) = geodetic_to_geocentric(lat_deg * D2R, lon_deg * D2R, INTERNATIONAL_1924);
    let (x, y, z) = ED50_TO_WGS84.apply(x, y, z);
    let (lat, lon) = geocentric_to_geodetic(x, y, z, WGS84);
    Transform {
        longitude: lon * R2D,
        latitude: lat * R2D,
        operation: OPERATION_ID.into(),
        operation_name: OPERATION_NAME.into(),
        accuracy_m: OPERATION_ACCURACY_M,
    }
}

fn ed50_utm_to_wgs84(zone: u32, easting: f64, northing: f64) -> Result<Transform, CrsError> {
    if !easting.is_finite() || !northing.is_finite() {
        return Err(CrsError::InvalidCoordinates(
            "Source coordinates must be finite numbers.".into(),
        ));
    }
    if !(0.0..=1_000_000.0).contains(&easting) || !(0.0..=10_000_000.0).contains(&northing) {
        return Err(CrsError::InvalidCoordinates(
            "UTM easting or northing is outside the projected domain.".into(),
        ));
    }
    let (lat, lon) = inverse_utm(easting, northing, zone, INTERNATIONAL_1924);
    let (lat_deg, lon_deg) = (lat * R2D, lon * R2D);
    check_area(lon_deg, lat_deg)?;
    Ok(ed50_geographic_to_wgs84(lat_deg, lon_deg))
}

fn geodetic_to_geocentric(lat: f64, lon: f64, e: Ellipsoid) -> (f64, f64, f64) {
    let (slat, clat) = lat.sin_cos();
    let (slon, clon) = lon.sin_cos();
    let e2 = e.e2();
    let n = e.a / (1.0 - e2 * slat * slat).sqrt();
    (n * clat * clon, n * clat * slon, n * (1.0 - e2) * slat)
}

fn geocentric_to_geodetic(x: f64, y: f64, z: f64, e: Ellipsoid) -> (f64, f64) {
    let e2 = e.e2();
    let lon = y.atan2(x);
    let p = (x * x + y * y).sqrt();
    let mut lat = z.atan2(p * (1.0 - e2));
    for _ in 0..12 {
        let slat = lat.sin();
        let n = e.a / (1.0 - e2 * slat * slat).sqrt();
        let next = (z + e2 * n * slat).atan2(p);
        if (next - lat).abs() < 1e-14 {
            lat = next;
            break;
        }
        lat = next;
    }
    (lat, lon)
}

/// Inverse Transverse Mercator for a northern-hemisphere UTM zone (Snyder).
fn inverse_utm(easting: f64, northing: f64, zone: u32, e: Ellipsoid) -> (f64, f64) {
    let k0 = 0.9996;
    let lon0 = (zone as f64 * 6.0 - 183.0) * D2R;
    let e2 = e.e2();
    let ep2 = e2 / (1.0 - e2);
    let x = easting - 500_000.0;
    let m = northing / k0;
    let mu = m / (e.a * (1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2 * e2 * e2 / 256.0));
    let e1 = (1.0 - (1.0 - e2).sqrt()) / (1.0 + (1.0 - e2).sqrt());
    let phi1 = mu
        + (3.0 * e1 / 2.0 - 27.0 * e1.powi(3) / 32.0) * (2.0 * mu).sin()
        + (21.0 * e1 * e1 / 16.0 - 55.0 * e1.powi(4) / 32.0) * (4.0 * mu).sin()
        + (151.0 * e1.powi(3) / 96.0) * (6.0 * mu).sin()
        + (1097.0 * e1.powi(4) / 512.0) * (8.0 * mu).sin();
    let (sphi, cphi) = phi1.sin_cos();
    let tphi = phi1.tan();
    let c1 = ep2 * cphi * cphi;
    let t1 = tphi * tphi;
    let n1 = e.a / (1.0 - e2 * sphi * sphi).sqrt();
    let r1 = e.a * (1.0 - e2) / (1.0 - e2 * sphi * sphi).powf(1.5);
    let d = x / (n1 * k0);
    let lat = phi1
        - (n1 * tphi / r1)
            * (d * d / 2.0
                - (5.0 + 3.0 * t1 + 10.0 * c1 - 4.0 * c1 * c1 - 9.0 * ep2) * d.powi(4) / 24.0
                + (61.0 + 90.0 * t1 + 298.0 * c1 + 45.0 * t1 * t1 - 252.0 * ep2 - 3.0 * c1 * c1)
                    * d.powi(6)
                    / 720.0);
    let lon = lon0
        + (d - (1.0 + 2.0 * t1 + c1) * d.powi(3) / 6.0
            + (5.0 - 2.0 * c1 + 28.0 * t1 - 3.0 * c1 * c1 + 8.0 * ep2 + 24.0 * t1 * t1)
                * d.powi(5)
                / 120.0)
            / cphi;
    (lat, lon)
}
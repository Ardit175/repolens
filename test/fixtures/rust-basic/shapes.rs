use std::collections::HashMap;
use std::fmt::{self, Display};

/// Something with an area.
pub trait Shape {
    fn area(&self) -> f64;
}

/// A round shape.
#[derive(Debug, Clone)]
pub struct Circle {
    pub radius: f64,
}

impl Circle {
    /// Builds a circle.
    pub fn new(radius: f64) -> Self {
        Circle { radius }
    }
}

impl Shape for Circle {
    fn area(&self) -> f64 {
        std::f64::consts::PI * self.radius * self.radius
    }
}

impl<T: Display> Wrapper<T> {
    fn show(&self) -> String {
        format!("{}", self.0)
    }
}

pub enum Kind {
    Round,
    Square,
}

pub type Registry = HashMap<String, Circle>;

pub fn total_area(shapes: &[Circle]) -> f64 {
    shapes.iter().map(|s| s.area()).sum()
}

mod tests {
    fn helper() {}
}

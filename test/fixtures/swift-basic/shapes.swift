import Foundation

/// Something with an area.
protocol Shape {
    func area() -> Double
}

/// A point in the plane.
struct Point {
    var x: Int
    var y: Int
}

/// A round shape.
@MainActor
final class Circle: Shape {
    let radius: Double

    /// Creates a circle.
    init(radius: Double) {
        self.radius = radius
    }

    deinit {}

    func area() -> Double {
        return radius * radius * 3.14
    }

    struct Style {
        func name() -> String { "plain" }
    }
}

enum Color {
    case red, green

    func label() -> String { "color" }
}

extension Circle {
    /// The unit circle.
    static func unit() -> Circle { Circle(radius: 1) }
}

// Sums the areas.
func totalArea(_ shapes: [Shape]) -> Double {
    return shapes.reduce(0) { $0 + $1.area() }
}

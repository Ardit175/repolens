package geometry;

import java.util.List;
import java.util.Objects;

/** Something with an area. */
public interface Shape {
    double area();
}

public enum Color {
    RED,
    GREEN
}

/**
 * A circle.
 */
public class Circle implements Shape {
    private double radius = 1;

    public Circle(double radius) {
        this.radius = radius;
    }

    @Override
    public double area() {
        return Math.PI * radius * radius;
    }

    public static class Builder {
        public Circle build() {
            return new Circle(1);
        }
    }
}

public record Point(int x, int y) {}

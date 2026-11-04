package geometry

import util.Helpers
import util.Format as Fmt
import lib.*

/** Something with an area. */
interface Shape {
    fun area(): Double
}

/** A round shape. */
@Suppress("unused")
class Circle(private val radius: Double) : Shape {
    /** Builds the unit circle. */
    fun unit(): Circle {
        return Circle(1.0)
    }

    override fun area(): Double {
        return Helpers.square(radius) * PI
    }

    companion object {
        const val PI = 3.14

        fun create(r: Double): Circle = Circle(r)
    }
}

data class Point(val x: Int, val y: Int)

enum class Color {
    RED,
    GREEN;

    fun label(): String = name.lowercase()
}

object Registry {
    fun size(): Int = 0
}

// Sums the areas.
fun totalArea(shapes: List<Shape>): Double {
    return shapes.sumOf { it.area() }
}

package shapes

import scala.collection.mutable
import scala.util.{Try, Success => Ok}
import java.util._

/** Something with an area. */
trait Shape {
  def area: Double
}

/** A point in the plane. */
case class Point(x: Int, y: Int)

/** A round shape. */
class Circle(val radius: Double) extends Shape {
  val unit = 1.0

  /** The area of the circle. */
  def area: Double = radius * radius * 3.14

  class Style {
    def name(): String = "plain"
  }
}

// Builds shapes.
object Shapes {
  def unitCircle(): Circle = new Circle(1)

  def total(shapes: List[Shape]): Double =
    shapes.map(_.area).sum
}

object Color {
  def label: String = "color"
}

def describe(s: Shape): String = s"area ${s.area}"

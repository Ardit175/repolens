using System;

namespace Geometry
{
    /// <summary>A point in the plane.</summary>
    public interface IShape
    {
        double Area();
    }

    public enum Color
    {
        Red,
        Green,
    }

    // A circle with a radius.
    public class Circle : IShape
    {
        private double radius = 1;

        public Circle(double radius)
        {
            this.radius = radius;
        }

        /// <summary>Returns the circle area.</summary>
        [Obsolete("use Scale")]
        public double Area()
        {
            return Math.PI * radius * radius;
        }

        public class Builder
        {
            public Circle Build()
            {
                return new Circle(2);
            }
        }
    }

    public record Point(double X, double Y);
}

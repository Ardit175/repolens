require 'json'
require_relative 'util/helpers'

# Something with an area.
module Geometry
  PI = 3.14

  # A round shape.
  class Circle
    attr_accessor :radius

    # Builds a circle.
    def initialize(radius)
      @radius = radius
    end

    def self.unit
      new(1)
    end

    def area
      Geometry.square(radius) * PI
    end

    class Label
      def text
        puts "circle"
      end
    end
  end

  def self.square(x)
    x * x
  end
end

def total_area(shapes)
  shapes.map { |s| s.area }.sum
end

#pragma once

namespace geo {

/** A shape with an area. */
class Shape {
public:
    virtual ~Shape() = default;
    virtual double area() const = 0;
};

}  // namespace geo

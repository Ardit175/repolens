#include <memory>
#include "shapes.hpp"

namespace geo {

// A point in the plane.
struct Point {
    int x;
    int y;
};

enum class Color { Red, Green };

/** A circle. */
template <typename T>
class Circle : public Shape {
public:
    Circle(T r) : radius_(r) {}

    double area() const override {
        return 3 * square(radius_);
    }

    struct Tag {
        int id;
    };

    void grow();

private:
    T radius_;
};

template <typename T>
void Circle<T>::grow() {
    radius_ = scale(radius_);
}

static int square(int n) { return n * n; }

std::unique_ptr<Shape> make(int r) {
    auto c = std::make_unique<Circle<int>>(r);
    return std::move(c);
}

}  // namespace geo

int main() {
    geo::Circle<int>* c = new geo::Circle<int>(2);
    int a = c->area();
    geo::make(a);
    return 0;
}

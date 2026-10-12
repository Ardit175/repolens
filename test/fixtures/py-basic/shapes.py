import math
from dataclasses import dataclass


# Computes the distance between two points.
def distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


@dataclass
def tagged(value):
    def inner():
        return value

    return inner


class Circle:
    """A circle."""

    radius = 1.0

    # Builds a unit circle.
    @staticmethod
    def unit():
        return Circle()

    async def area(self):
        return math.pi * self.radius**2


class Square:
    side = 2

    def area(self):
        return self.side * self.side

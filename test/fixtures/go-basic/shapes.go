package geometry

import (
	"fmt"
	"math"
)

// Shape is something with an area.
type Shape interface {
	Area() float64
}

// Circle is a round shape.
// It stores only its radius.
type Circle struct {
	Radius float64
}

// NewCircle builds a circle.
func NewCircle(r float64) *Circle {
	return &Circle{Radius: r}
}

// Area returns the circle's area.
func (c *Circle) Area() float64 {
	return math.Pi * c.Radius * c.Radius
}

// String formats the circle.
func (c Circle) String() string {
	return fmt.Sprintf("circle(%v)", c.Radius)
}

// Stack is a generic stack.
type Stack[T any] struct {
	items []T
}

// Push adds an item.
func (s *Stack[T]) Push(item T) {
	s.items = append(s.items, item)
}

type (
	// ID identifies a shape.
	ID    int
	Names []string
)

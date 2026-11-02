<?php

namespace Geometry;

use Util\Helpers;
use Util\Format as Fmt;

require_once 'util/helpers.php';

/** Something with an area. */
interface Shape
{
    public function area(): float;
}

/** A round shape. */
class Circle implements Shape
{
    const PI = 3.14;

    /** Builds a circle. */
    public function __construct(private float $radius)
    {
    }

    public static function unit(): Circle
    {
        return new Circle(1);
    }

    public function area(): float
    {
        return Helpers::square($this->radius) * self::PI;
    }
}

trait Labeled
{
    public function label(): string
    {
        return strtoupper("circle");
    }
}

enum Color
{
    case Red;

    public function name(): string
    {
        return "red";
    }
}

// Sums the areas.
function total_area(array $shapes): float
{
    return array_sum(array_map(fn($s) => $s->area(), $shapes));
}

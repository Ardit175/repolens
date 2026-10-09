import { sqrt } from './math';

/** A 2D point. */
export interface Point {
  x: number;
  y: number;
}

export type Shape = Circle | Square;

export enum Color {
  Red,
  Green,
}

/**
 * Computes the distance between two points.
 */
export function distance(a: Point, b: Point): number {
  return sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export const area = (s: Shape): number => s.area();

const untouched = 42;

export abstract class Circle {
  radius = 1;

  // Returns the circle area.
  area(): number {
    return Math.PI * this.radius ** 2;
  }

  abstract name(): string;
}

class Square {
  constructor(private side: number) {}

  area(): number {
    return this.side ** 2;
  }
}

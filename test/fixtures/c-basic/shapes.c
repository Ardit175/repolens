#include <stdio.h>
#include "shapes.h"

/* A point in the plane. */
typedef struct {
    int x;
    int y;
} Point;

enum Color { RED, GREEN };

typedef enum { SMALL, LARGE } Size;

typedef int (*Callback)(int);

/** Squares a number. */
static int square(int n) {
    return n * n;
}

// Area of a circle with integer radius.
int circle_area(int r) {
    printf("area\n");
    return 3 * square(r);
}

#ifdef EXTRA
int extra(int r) {
    return circle_area(r) + 1;
}
#endif

int main(void) {
    Point p = {1, 2};
    return circle_area(p.x) + extra(p.y);
}
